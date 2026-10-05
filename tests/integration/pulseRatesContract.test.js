// Contract test for GET /api/pulse FX rates and honest valuation metadata
//
// Verifies:
// 1. GET /api/pulse?scope=business returns server-provided rates with honest metadata.
// 2. Base currency (IDR) has source='base_currency' and rate_effective_date=as_of_date.
// 3. Foreign currencies (USD, EUR, SGD, etc.) from static server valuation table:
//    - source: 'fixed_accounting_table'
//    - rate_type: 'fixed_accounting_rate'
//    - is_fixed_accounting: true
//    - calculated_at: request timestamp
//    - as_of: request date (YYYY-MM-DD)
//    - rate_effective_date: null (proves verification date is NOT faked with today's date)
//    - verified_at: null
// 4. Accounts in pulse return matching honest FX metadata for each wallet.
// 5. Client radarFigures consumes these server rates directly without client guessing.
//
// Run: node tests/integration/pulseRatesContract.test.js
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
  JWT_SECRET: 'pulse-rates-secret',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5614',
  NODE_ENV: 'test',
});

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = 77777;

mem.__seed('users', [
  { id: USER_ID, email: 'owner@pulserates.test', is_active: true },
]);

mem.__seed('businesses', [
  { id: BIZ_ID, name: 'PT Pulse Rates Corp', type: 'company', owner_user_id: USER_ID, base_currency: 'IDR', created_at: '2026-01-01' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_ID, business_id: BIZ_ID, role: 'owner', status: 'active' },
]);

mem.__seed('wallets', [
  { id: 'w-idr', business_id: BIZ_ID, name: 'BCA IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-usd', business_id: BIZ_ID, name: 'Wise USD', currency: 'USD', type: 'bank', scope: 'business', is_active: true },
]);

mem.__seed('transactions', [
  { id: 'tx-1', business_id: BIZ_ID, wallet_id: 'w-idr', type: 'income', amount_idr: 50000000, amount_original: 50000000, currency_original: 'IDR', transaction_date: '2026-10-01' },
  { id: 'tx-2', business_id: BIZ_ID, wallet_id: 'w-usd', type: 'income', amount_idr: 16300000, amount_original: 1000, currency_original: 'USD', transaction_date: '2026-10-01' },
]);

mem.__seed('debts', [
  { id: 'debt-usd', business_id: BIZ_ID, type: 'payable', counterparty: 'US Cloud', currency: 'USD', amount: 500, original_amount: 500, paid_amount: 0, status: 'open', approval_status: 'approved', due_date: '2026-10-20' },
  { id: 'debt-undated', business_id: BIZ_ID, type: 'payable', counterparty: 'Undated Legal', currency: 'IDR', amount: 10000000, original_amount: 10000000, paid_amount: 0, status: 'open', approval_status: 'approved', due_date: null },
]);

require(path.join(ROOT, 'server', 'index.js'));

const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);

async function getPulse() {
  const headers = {
    authorization: `Bearer ${tok(USER_ID)}`,
    'x-business-id': BIZ_ID,
  };
  const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/pulse?scope=business`, {
    headers,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

(async () => {
  await new Promise((r) => setTimeout(r, 700));

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

  console.log('\nGET /api/pulse FX rates & honest valuation metadata contract');

  await test('pulse endpoint returns HTTP 200 with rates dictionary and as_of_date', async () => {
    const res = await getPulse();
    assert.equal(res.status, 200);
    assert.ok(res.body.rates, 'res.body.rates exists');
    assert.ok(res.body.as_of_date, 'res.body.as_of_date exists');
  });

  await test('base currency IDR has base_currency source and verified effective date', async () => {
    const res = await getPulse();
    const idrRate = res.body.rates.IDR;
    assert.ok(idrRate, 'rates.IDR exists');
    assert.equal(idrRate.rate, 1);
    assert.equal(idrRate.source, 'base_currency');
    assert.equal(idrRate.rate_type, 'base_currency');
    assert.equal(idrRate.is_fixed_accounting, true);
    assert.equal(idrRate.rate_effective_date, res.body.as_of_date);
    assert.equal(idrRate.verified_at, res.body.as_of_date);
  });

  await test('foreign currencies (USD, EUR, SGD) have honest fixed_accounting_table metadata with null effective date', async () => {
    const res = await getPulse();
    for (const cur of ['USD', 'EUR', 'SGD', 'USDT']) {
      const entry = res.body.rates[cur];
      assert.ok(entry, `rates.${cur} exists`);
      assert.ok(entry.rate > 0, `rates.${cur}.rate is positive`);
      assert.equal(entry.source, 'fixed_accounting_table');
      assert.equal(entry.rate_type, 'fixed_accounting_rate');
      assert.equal(entry.is_fixed_accounting, true);
      assert.ok(entry.calculated_at, 'calculated_at is set');
      assert.equal(entry.as_of, res.body.as_of_date);
      // Honest metadata: verification date must NOT be falsified with today's request date
      assert.equal(entry.rate_effective_date, null, 'rate_effective_date must be null for fixed static rate');
      assert.equal(entry.verified_at, null, 'verified_at must be null for fixed static rate');
    }
  });

  await test('accounts list returns matching honest FX metadata for each wallet', async () => {
    const res = await getPulse();
    const idrWallet = res.body.accounts.find(a => a.name === 'BCA IDR');
    const usdWallet = res.body.accounts.find(a => a.name === 'Wise USD');

    assert.ok(idrWallet, 'BCA IDR found');
    assert.equal(idrWallet.rate_today, 1);
    assert.equal(idrWallet.rate_source, 'base_currency');
    assert.equal(idrWallet.rate_effective_date, res.body.as_of_date);
    assert.equal(idrWallet.is_fixed_accounting, true);

    assert.ok(usdWallet, 'Wise USD found');
    assert.equal(usdWallet.rate_today, 16300);
    assert.equal(usdWallet.rate_source, 'fixed_accounting_table');
    assert.equal(usdWallet.rate_effective_date, null);
    assert.equal(usdWallet.is_fixed_accounting, true);
    assert.equal(usdWallet.rate_type, 'fixed_accounting_rate');
  });

  await test('client radarFigures consumes server rates and metadata directly without client guessing', async () => {
    const res = await getPulse();
    const { radarFigures } = await import('../../client/src/lib/radarFigures.js');

    const figures = radarFigures(res.body, { today: res.body.as_of_date });

    // Server rates are preserved in serverRatesAvailable
    assert.ok(figures.serverRatesAvailable.USD);
    assert.equal(figures.serverRatesAvailable.USD.source, 'fixed_accounting_table');
    assert.equal(figures.serverRatesAvailable.USD.rate_effective_date, null);
    assert.equal(figures.serverRatesAvailable.USD.is_fixed_accounting, true);

    // Dated USD payable is converted via server rate
    const usdDebt = figures.payables.find(p => p.id === 'debt-usd');
    assert.ok(usdDebt, 'debt-usd is in payables');
    assert.equal(usdDebt.amount_idr, 500 * 16300);
    assert.equal(usdDebt.rate_source, 'fixed_accounting_table');
    assert.equal(usdDebt.rate_effective_date, null);
    assert.equal(usdDebt.is_fixed_accounting, true);

    // Undated obligation is strictly excluded from totalOut and tracked in undatedDebts
    assert.equal(figures.totalOut, 500 * 16300);
    assert.equal(figures.undatedDebts.length, 1);
    assert.equal(figures.undatedDebts[0].id, 'debt-undated');
    assert.equal(figures.assumptions.undatedCount, 1);
  });

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
