// Integration test: Cold start in a clean process with empty cache and unreachable network
// Verifies:
// 1. Empty persistent storage + external sources unreachable.
// 2. USD does NOT receive 16,300 or another substitute quote (q === null).
// 3. API endpoints (/api/wallets, /api/pulse, /api/ai-cfo/context) return incomplete valuation:
//    - has_incomplete_balance = true
//    - unvalued_currencies contains 'USD'
//    - total cash excludes USD without 1:1 or fake fixed rate fallback
// 4. Mutations dependent on missing rate are rejected BEFORE changes:
//    - POST /api/debts/:id/pay fails with 400 fx_rate_unavailable; 0 transactions, 0 debt changes.
//    - POST /api/wallets with opening balance fails with 400 fx_rate_unavailable; 0 wallets created.
// 5. Explicit valid manual rates are accepted and processed under existing contract.
//
// Run: node tests/integration/coldStartUnvaluedFx.test.js

const path = require('path');
const fs = require('fs');
const Module = require('module');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
const TEST_COLD_CACHE = path.join(ROOT, 'server', 'data', 'test_cold_start_cache.json');

// Ensure cache file is completely absent before process startup
if (fs.existsSync(TEST_COLD_CACHE)) {
  try { fs.unlinkSync(TEST_COLD_CACHE); } catch (_) {}
}

Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake',
  SUPABASE_SECRET_KEY: 'fake',
  BOT_TOKEN: 'fake',
  JWT_SECRET: 'cold-start-fx-test-secret',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5616',
  NODE_ENV: 'test',
  FX_CACHE_FILE: TEST_COLD_CACHE,
  // FX_PROVIDER is deliberately omitted to test production default ('hybrid')
});

// Mock external network fetch to simulate completely unreachable network
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(url, opts) {
  const urlStr = String(url);
  // Intercept external FX endpoints
  if (urlStr.includes('bi.go.id') || urlStr.includes('open.er-api.com') || urlStr.includes('coingecko.com')) {
    throw new Error('network_unreachable: simulated offline environment');
  }
  return originalFetch.apply(this, arguments);
};

// Mock Supabase
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = 55555;

mem.__seed('users', [
  { id: USER_ID, email: 'owner@coldstart.test', is_active: true },
]);

mem.__seed('businesses', [
  { id: BIZ_ID, name: 'PT Cold Start Logistics', type: 'company', owner_user_id: USER_ID, base_currency: 'IDR', created_at: '2026-01-01' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_ID, business_id: BIZ_ID, role: 'owner', status: 'active' },
]);

mem.__seed('wallets', [
  { id: 'w-bca-idr', business_id: BIZ_ID, name: 'BCA IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-wise-usd', business_id: BIZ_ID, name: 'Wise USD', currency: 'USD', type: 'bank', scope: 'business', is_active: true },
]);

mem.__seed('transactions', [
  { id: 'tx-idr-1', business_id: BIZ_ID, wallet_id: 'w-bca-idr', type: 'income', amount_original: 10000000, amount_idr: 10000000, currency_original: 'IDR', scope: 'business', transaction_date: '2026-10-01' },
  { id: 'tx-usd-1', business_id: BIZ_ID, wallet_id: 'w-wise-usd', type: 'income', amount_original: 1000, amount_idr: null, currency_original: 'USD', scope: 'business', transaction_date: '2026-10-01' },
]);

mem.__seed('debts', [
  { id: 'debt-usd-1', business_id: BIZ_ID, type: 'payable', counterparty: 'Oracle Cloud US', currency: 'USD', amount: 500, original_amount: 500, paid_amount: 0, status: 'open', approval_status: 'approved', due_date: '2026-10-20' },
]);

// Boot server and fx module
require(path.join(ROOT, 'server', 'index.js'));
const fx = require(path.join(ROOT, 'server', 'lib', 'fxProvider.js'));

const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
const authHeaders = {
  authorization: `Bearer ${tok(USER_ID)}`,
  'x-business-id': BIZ_ID,
  'content-type': 'application/json',
};

async function reqGet(urlPath) {
  const res = await originalFetch(`http://127.0.0.1:${process.env.PORT}${urlPath}`, {
    headers: authHeaders,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function reqPost(urlPath, body) {
  const res = await originalFetch(`http://127.0.0.1:${process.env.PORT}${urlPath}`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  const resBody = await res.json().catch(() => null);
  return { status: res.status, body: resBody };
}

(async () => {
  await new Promise((r) => setTimeout(r, 600));

  let pass = 0, fail = 0;
  const test = async (name, fn) => {
    try {
      await fn();
      pass++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      fail++;
      console.log(`  XX  ${name}\n      ${err.stack || err.message}`);
    }
  };

  console.log('\n=== INTEGRATION TEST: COLD START WITHOUT CACHE & NETWORK ===\n');

  // 1. Cold start verification on server provider
  await test('1. USD has no quote, does not receive 16,300 or any substitute quote', async () => {
    assert.equal(fs.existsSync(TEST_COLD_CACHE), false, 'Temporary cache file must be absent');
    
    // Attempt a refresh; with network down, it must fail gracefully
    const refreshRes = await fx.refreshRates({ force: true });
    assert.equal(refreshRes.ok, false, 'Refresh fails due to unreachable network');

    const usdQuote = fx.getQuote('USD');
    assert.equal(usdQuote, null, 'USD quote must be null (no rate)');

    const idrQuote = fx.getQuote('IDR');
    assert.ok(idrQuote, 'IDR quote is present');
    assert.equal(idrQuote.rate, 1, 'IDR rate is 1');

    const ratesMap = fx.getRatesMap();
    assert.equal(ratesMap.USD, undefined, 'USD must not exist in ratesMap');
    assert.ok(ratesMap.IDR, 'IDR exists in ratesMap');

    // getTodayRate for USD must throw fx_rate_unavailable
    assert.throws(
      () => fx.getTodayRate('USD'),
      /fx_rate_unavailable:USD/,
      'getTodayRate(USD) throws fx_rate_unavailable'
    );
  });

  // 2. Wallets API valuation
  await test('2. GET /api/wallets marks has_incomplete_balance and excludes unvalued USD from total cash', async () => {
    const res = await reqGet('/api/wallets');
    assert.equal(res.status, 200);
    assert.equal(res.body.has_incomplete_balance, true, 'has_incomplete_balance is true');
    assert.ok(res.body.unvalued_currencies.includes('USD'), 'unvalued_currencies contains USD');

    // Total balance in IDR must be only the IDR wallet (10,000,000), excluding USD (0 IDR equivalent)
    assert.equal(res.body.total_balance_idr, 10000000, 'Total cash is exactly 10,000,000 IDR');

    const usdWallet = res.body.wallets.find(w => w.currency === 'USD');
    assert.ok(usdWallet, 'Wise USD wallet is returned');
    assert.equal(usdWallet.balance, 1000, 'Native balance of 1,000 USD is preserved');
    assert.equal(usdWallet.balance_idr, null, 'balance_idr is null');
    assert.equal(usdWallet.is_unvalued, true, 'is_unvalued is true');
    assert.equal(usdWallet.rate_today, null, 'rate_today is null');
  });

  // 3. Pulse API valuation
  await test('3. GET /api/pulse marks has_incomplete_balance and excludes unvalued USD from totalBalance', async () => {
    const res = await reqGet('/api/pulse?scope=business');
    assert.equal(res.status, 200);
    assert.equal(res.body.has_incomplete_balance, true, 'has_incomplete_balance is true');
    assert.ok(res.body.unvalued_currencies.includes('USD'), 'unvalued_currencies contains USD');
    assert.equal(res.body.totalBalance, 10000000, 'Pulse totalBalance is exactly 10,000,000 IDR');
  });

  // 4. AI CFO Context valuation
  await test('4. GET /api/ai-cfo/context passes incomplete flag and excludes unvalued USD from cash context', async () => {
    const res = await reqGet('/api/ai-cfo/context');
    assert.equal(res.status, 200);
    assert.equal(res.body.cash.has_incomplete_balance, true, 'cash.has_incomplete_balance is true');
    assert.ok(res.body.cash.unvalued_currencies.includes('USD'), 'cash.unvalued_currencies contains USD');
    assert.equal(res.body.cash.total_balance, 10000000, 'AI CFO cash total_balance is 10,000,000 IDR');
  });

  // 5. Debt payment without rate is rejected BEFORE mutations
  await test('5. POST /api/debts/:id/pay on USD debt without rate is rejected with zero DB mutations', async () => {
    const initialTxs = mem.__db['transactions'].length;
    const initialDebt = JSON.parse(JSON.stringify(mem.__db['debts'].find(d => d.id === 'debt-usd-1')));

    const payRes = await reqPost('/api/debts/debt-usd-1/pay', {
      amount: 100,
      wallet_id: 'w-wise-usd',
      date: '2026-10-05',
    });

    assert.equal(payRes.status, 400, 'HTTP 400 returned');
    assert.equal(payRes.body.error, 'fx_rate_unavailable', 'Error code is fx_rate_unavailable');
    assert.equal(payRes.body.currency, 'USD', 'Currency reported as USD');

    // Verify zero mutations in DB
    assert.equal(mem.__db['transactions'].length, initialTxs, 'Zero transactions created');
    const postDebt = mem.__db['debts'].find(d => d.id === 'debt-usd-1');
    assert.equal(postDebt.paid_amount, initialDebt.paid_amount, 'paid_amount untouched');
    assert.equal(postDebt.status, initialDebt.status, 'debt status untouched');
  });

  // 6. Wallet creation with opening balance without rate is rejected BEFORE mutations
  await test('6. POST /api/wallets with USD opening balance without rate is rejected with zero DB mutations', async () => {
    const initialWallets = mem.__db['wallets'].length;
    const initialTxs = mem.__db['transactions'].length;

    const createRes = await reqPost('/api/wallets', {
      name: 'New USD Account',
      currency: 'USD',
      type: 'bank',
      opening_balance: 500,
      scope: 'business',
    });

    assert.equal(createRes.status, 400, 'HTTP 400 returned');
    assert.equal(createRes.body.error, 'fx_rate_unavailable', 'Error code is fx_rate_unavailable');

    // Verify zero mutations in DB
    assert.equal(mem.__db['wallets'].length, initialWallets, 'Zero wallets created');
    assert.equal(mem.__db['transactions'].length, initialTxs, 'Zero transactions created');
  });

  // 7. Explicit valid manual rate succeeds under existing contract
  await test('7. POST /api/debts/:id/pay with explicit valid manual rate succeeds and records payment', async () => {
    const initialTxs = mem.__db['transactions'].length;

    const payRes = await reqPost('/api/debts/debt-usd-1/pay', {
      amount: 100,
      wallet_id: 'w-wise-usd',
      date: '2026-10-05',
      rate: '16500',
      manual_reason: 'agreed_rate_with_vendor',
    });

    assert.equal(payRes.status, 200, 'HTTP 200 returned for explicit manual rate');
    assert.equal(mem.__db['transactions'].length, initialTxs + 1, 'Transaction successfully created');

    const createdTx = mem.__db['transactions'][mem.__db['transactions'].length - 1];
    assert.equal(createdTx.amount_original, 100);
    assert.equal(createdTx.currency_original, 'USD');
    assert.equal(createdTx.amount_idr, 1650000, '100 USD * 16,500 = 1,650,000 IDR');
    assert.equal(createdTx.booked_rate, '16500', 'booked_rate is 16500');
    assert.equal(createdTx.rate_source, 'manual', 'rate_source is manual');

    const updatedDebt = mem.__db['debts'].find(d => d.id === 'debt-usd-1');
    assert.equal(updatedDebt.paid_amount, 100, 'Debt paid_amount updated to 100');
    assert.equal(updatedDebt.status, 'partial', 'Debt status updated to partial');
  });

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;

  if (fs.existsSync(TEST_COLD_CACHE)) {
    try { fs.unlinkSync(TEST_COLD_CACHE); } catch (_) {}
  }

  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
