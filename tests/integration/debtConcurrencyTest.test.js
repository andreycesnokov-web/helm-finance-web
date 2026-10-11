// Concurrency and race-condition integration test for /api/debts/:id/pay
// Verifies behavior under concurrent partial payments, overpayments, and request replays.
const path = require('path');
const Module = require('module');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const http = require('http');

// Mock in-memory database
const mem = require('./_memorySupabase');

const PORT = 5699;
Object.assign(process.env, {
  PORT: String(PORT),
  NODE_ENV: 'test',
  JWT_SECRET: 'concurrency-test-secret',
  SUPABASE_URL: 'http://localhost:0/fake',
  SUPABASE_SECRET_KEY: 'fake',
  BOT_TOKEN: 'fake',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
});

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = 888123;
const WALLET_ID = 'wallet-idr-01';

// Seed business and user
mem.__seed('businesses', [
  { id: BIZ_ID, name: 'Test Corp', type: 'company', owner_user_id: USER_ID, created_at: '2026-01-01' }
]);
mem.__seed('business_members', [
  { id: 1, user_id: USER_ID, business_id: BIZ_ID, role: 'owner', status: 'active' }
]);
mem.__seed('wallets', [
  { id: WALLET_ID, business_id: BIZ_ID, name: 'BCA IDR', currency: 'IDR', scope: 'business' }
]);

const token = jwt.sign({ userId: USER_ID, role: 'owner', authChannel: 'email' }, process.env.JWT_SECRET);

// Helper for making HTTP requests
function sendPay(debtId, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/debts/${debtId}/pay`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${token}`,
        'x-business-id': BIZ_ID,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch (e) { json = { raw: data }; }
        resolve({ status: res.statusCode, data: json });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('--- Starting /api/debts/:id/pay Concurrency Test ---');
  require('../../server/index.js');
  await new Promise(r => setTimeout(r, 1000));

  // Case 1: Two concurrent partial payments of 4,000,000 on a 10,000,000 debt
  console.log('\n[Case 1] Two simultaneous partial payments (4M + 4M on 10M debt)...');
  mem.__seed('debts', [
    {
      id: 701,
      business_id: BIZ_ID,
      type: 'payable',
      counterparty: 'Vendor Alpha',
      amount: 10000000,
      original_amount: 10000000,
      paid_amount: 0,
      status: 'open',
      currency: 'IDR',
    }
  ]);
  mem.__seed('transactions', []);

  // Send both simultaneously
  const p1 = sendPay(701, { amount: 4000000, wallet_id: WALLET_ID });
  const p2 = sendPay(701, { amount: 4000000, wallet_id: WALLET_ID });
  const [res1, res2] = await Promise.all([p1, p2]);

  console.log('Res 1:', res1.status, res1.data.ok ? 'OK' : res1.data.error);
  console.log('Res 2:', res2.status, res2.data.ok ? 'OK' : res2.data.error);

  const txs1 = (mem.__db['transactions'] || []).filter(t => (t.description || '').includes('Vendor Alpha'));
  const debt1 = (mem.__db['debts'] || []).find(d => d.id === 701);

  console.log(`Transactions recorded: ${txs1.length}`);
  console.log(`Total transaction amount: ${txs1.reduce((s, t) => s + Number(t.amount_original), 0)}`);
  console.log(`Debt paid_amount stored: ${debt1.paid_amount}`);
  console.log(`Debt status: ${debt1.status}`);

  // Case 2: Race condition causing overpayment (6M + 6M on 10M debt sent concurrently)
  console.log('\n[Case 2] Concurrent overpayment race (6M + 6M on 10M debt)...');
  mem.__seed('debts', [
    {
      id: 702,
      business_id: BIZ_ID,
      type: 'payable',
      counterparty: 'Vendor Beta',
      amount: 10000000,
      original_amount: 10000000,
      paid_amount: 0,
      status: 'open',
      currency: 'IDR',
    }
  ]);

  const p3 = sendPay(702, { amount: 6000000, wallet_id: WALLET_ID });
  const p4 = sendPay(702, { amount: 6000000, wallet_id: WALLET_ID });
  const [res3, res4] = await Promise.all([p3, p4]);

  console.log('Res 3:', res3.status, res3.data.ok ? 'OK' : res3.data.error);
  console.log('Res 4:', res4.status, res4.data.ok ? 'OK' : res4.data.error);

  const txs2 = (mem.__db['transactions'] || []).filter(t => (t.description || '').includes('Vendor Beta'));
  const debt2 = (mem.__db['debts'] || []).find(d => d.id === 702);

  console.log(`Transactions recorded: ${txs2.length}`);
  console.log(`Total transaction amount: ${txs2.reduce((s, t) => s + Number(t.amount_original), 0)}`);
  console.log(`Debt paid_amount stored: ${debt2.paid_amount}`);
  console.log(`Debt status: ${debt2.status}`);

  // Case 3: Replay duplicate of the same request
  console.log('\n[Case 3] Sequential replay duplicate of 4M payment...');
  mem.__seed('debts', [
    {
      id: 703,
      business_id: BIZ_ID,
      type: 'payable',
      counterparty: 'Vendor Gamma',
      amount: 10000000,
      original_amount: 10000000,
      paid_amount: 0,
      status: 'open',
      currency: 'IDR',
    }
  ]);
  const resSeq1 = await sendPay(703, { amount: 4000000, wallet_id: WALLET_ID });
  const resSeq2 = await sendPay(703, { amount: 4000000, wallet_id: WALLET_ID });
  console.log('Sequential 1:', resSeq1.status, resSeq1.data.ok ? 'OK' : resSeq1.data.error);
  console.log('Sequential 2:', resSeq2.status, resSeq2.data.ok ? 'OK' : resSeq2.data.error);
  const txs3 = (mem.__db['transactions'] || []).filter(t => (t.description || '').includes('Vendor Gamma'));
  const debt3 = (mem.__db['debts'] || []).find(d => d.id === 703);
  console.log(`Transactions recorded: ${txs3.length}`);
  console.log(`Total transaction amount: ${txs3.reduce((s, t) => s + Number(t.amount_original), 0)}`);
  console.log(`Debt paid_amount stored: ${debt3.paid_amount}`);

  console.log('\n--- Concurrency Test Finished ---');
  process.exit(0);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
