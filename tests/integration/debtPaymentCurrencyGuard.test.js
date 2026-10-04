// Integration tests for debt payment currency guard in POST /api/debts/:id/pay
//
// Verifies:
// 1. Both cross-currency directions (USD debt + IDR wallet, IDR debt + USD wallet) are rejected:
//    - Returns HTTP 400 with cross_currency_not_supported.
//    - Zero transactions created.
//    - Debt record completely untouched.
// 2. Missing or unknown currency is rejected without IDR substitution.
// 3. Foreign wallet (belonging to another business) is rejected with HTTP 400.
// 4. Same-currency partial payments work and update balances and statuses accurately.
// 5. Same-currency full payments work and mark debt as settled.
//
// Run: node tests/integration/debtPaymentCurrencyGuard.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake',
  SUPABASE_SECRET_KEY: 'fake',
  BOT_TOKEN: 'fake',
  JWT_SECRET: 'guard-test-secret',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5613',
  NODE_ENV: 'test',
});

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const USER = 98888;

mem.__seed('businesses', [
  { id: BIZ_A, name: 'PT Company A', type: 'company', owner_user_id: USER, base_currency: 'IDR', created_at: '2026-01-01' },
  { id: BIZ_B, name: 'PT Company B', type: 'company', owner_user_id: 9999, base_currency: 'IDR', created_at: '2026-01-01' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER, business_id: BIZ_A, role: 'owner', status: 'active' },
]);

mem.__seed('wallets', [
  { id: 'w-idr-a', business_id: BIZ_A, name: 'BCA IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-usd-a', business_id: BIZ_A, name: 'Wise USD', currency: 'USD', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-no-cur', business_id: BIZ_A, name: 'Broken Wallet', currency: null, type: 'bank', scope: 'business', is_active: true },
  { id: 'w-biz-b', business_id: BIZ_B, name: 'Other Co Wallet', currency: 'USD', type: 'bank', scope: 'business', is_active: true },
]);

mem.__seed('debts', [
  { id: 'debt-usd-1', business_id: BIZ_A, type: 'payable', counterparty: 'Vendor US', currency: 'USD', amount: 1000, original_amount: 1000, paid_amount: 0, status: 'open', approval_status: 'approved' },
  { id: 'debt-idr-1', business_id: BIZ_A, type: 'payable', counterparty: 'Vendor ID', currency: 'IDR', amount: 16300000, original_amount: 16300000, paid_amount: 0, status: 'open', approval_status: 'approved' },
  { id: 'debt-no-cur', business_id: BIZ_A, type: 'payable', counterparty: 'Vendor Unknown', currency: null, amount: 500, original_amount: 500, paid_amount: 0, status: 'open', approval_status: 'approved' },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);

async function postPay(debtId, body) {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${tok(USER)}`,
    'x-business-id': BIZ_A,
  };
  const res = await fetch(`${BASE}/debts/${debtId}/pay`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: json };
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    fail++;
    console.error(`  XX  ${name}\n      ${err.stack || err.message}`);
  }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  console.log('\nDebt Payment Currency Guard Tests');

  await t('1. Direction USD Debt -> IDR Wallet is rejected before mutations', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const debtBefore = { ...(mem.__db.debts || []).find(d => d.id === 'debt-usd-1') };

    const res = await postPay('debt-usd-1', {
      amount: 1000,
      wallet_id: 'w-idr-a',
    });

    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'cross_currency_not_supported');
    assert.equal(res.body.debt_currency, 'USD');
    assert.equal(res.body.wallet_currency, 'IDR');

    // Verify zero mutations
    const txCountAfter = (mem.__db.transactions || []).length;
    assert.equal(txCountAfter, txCountBefore, 'No transactions created');

    const debtAfter = (mem.__db.debts || []).find(d => d.id === 'debt-usd-1');
    assert.equal(debtAfter.paid_amount, debtBefore.paid_amount, 'paid_amount unchanged');
    assert.equal(debtAfter.status, debtBefore.status, 'status unchanged');
  });

  await t('2. Direction IDR Debt -> USD Wallet is rejected before mutations', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const debtBefore = { ...(mem.__db.debts || []).find(d => d.id === 'debt-idr-1') };

    const res = await postPay('debt-idr-1', {
      amount: 16300000,
      wallet_id: 'w-usd-a',
    });

    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'cross_currency_not_supported');
    assert.equal(res.body.debt_currency, 'IDR');
    assert.equal(res.body.wallet_currency, 'USD');

    // Verify zero mutations
    const txCountAfter = (mem.__db.transactions || []).length;
    assert.equal(txCountAfter, txCountBefore, 'No transactions created');

    const debtAfter = (mem.__db.debts || []).find(d => d.id === 'debt-idr-1');
    assert.equal(debtAfter.paid_amount, debtBefore.paid_amount, 'paid_amount unchanged');
    assert.equal(debtAfter.status, debtBefore.status, 'status unchanged');
  });

  await t('3. Debt without currency is rejected without silent IDR fallback', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const res = await postPay('debt-no-cur', {
      amount: 500,
      wallet_id: 'w-idr-a',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'debt_currency_missing');
    assert.equal((mem.__db.transactions || []).length, txCountBefore, 'No transaction created');
  });

  await t('4. Wallet without currency is rejected without silent IDR fallback', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const res = await postPay('debt-usd-1', {
      amount: 100,
      wallet_id: 'w-no-cur',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'wallet_currency_missing');
    assert.equal((mem.__db.transactions || []).length, txCountBefore, 'No transaction created');
  });

  await t('5. Foreign wallet belonging to another company is rejected with 400', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const res = await postPay('debt-usd-1', {
      amount: 100,
      wallet_id: 'w-biz-b',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid or inaccessible wallet');
    assert.equal((mem.__db.transactions || []).length, txCountBefore, 'No transaction created');
  });

  await t('6. Same-currency partial payment (USD -> USD) succeeds and updates status', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const res = await postPay('debt-usd-1', {
      amount: 400,
      wallet_id: 'w-usd-a',
      date: '2026-10-04',
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.isFullyPaid, false);
    assert.equal(res.body.remaining, 600);

    const tx = (mem.__db.transactions || []).slice(txCountBefore)[0];
    assert.ok(tx, 'Transaction created');
    assert.equal(tx.amount_original, 400);
    assert.equal(tx.currency_original, 'USD');
    assert.equal(tx.wallet_id, 'w-usd-a');

    const debt = (mem.__db.debts || []).find(d => d.id === 'debt-usd-1');
    assert.equal(debt.paid_amount, 400);
    assert.equal(debt.status, 'partial');
    assert.equal(debt.is_settled, undefined);
  });

  await t('7. Same-currency completion payment (USD -> USD) succeeds and marks debt settled', async () => {
    const txCountBefore = (mem.__db.transactions || []).length;
    const res = await postPay('debt-usd-1', {
      amount: 600,
      wallet_id: 'w-usd-a',
      date: '2026-10-04',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.isFullyPaid, true);
    assert.equal(res.body.remaining, 0);

    const tx = (mem.__db.transactions || []).slice(txCountBefore)[0];
    assert.ok(tx, 'Transaction created');
    assert.equal(tx.amount_original, 600);
    assert.equal(tx.currency_original, 'USD');

    const debt = (mem.__db.debts || []).find(d => d.id === 'debt-usd-1');
    assert.equal(debt.paid_amount, 1000);
    assert.equal(debt.status, 'paid');
    assert.equal(debt.is_settled, true);
    assert.ok(debt.settled_at);
  });

  await t('8. Same-currency payment (IDR -> IDR) succeeds seamlessly', async () => {
    const res = await postPay('debt-idr-1', {
      amount: 16300000,
      wallet_id: 'w-idr-a',
      date: '2026-10-04',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.isFullyPaid, true);
    assert.equal(res.body.remaining, 0);

    const debt = (mem.__db.debts || []).find(d => d.id === 'debt-idr-1');
    assert.equal(debt.paid_amount, 16300000);
    assert.equal(debt.status, 'paid');
    assert.equal(debt.is_settled, true);
  });

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
