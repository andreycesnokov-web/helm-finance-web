// Comprehensive integration test suite for live FX rates provider and cross-module consistency
//
// Scenarios tested:
// 1. Successful rate update with full honest metadata (pair, rate, source, effective date, retrieval timestamp)
// 2. Timeout / source failure preserves last good rate with its real effective date and marks status as stale
// 3. Service restart persistence (reloads saved rates from disk cache across restarts)
// 4. Currency without rate returns null, never guesses 1:1, and flags incomplete balance across modules
// 5. Weekend / non-publication days are marked as weekend_holding, not technical failure
// 6. Immutability of historical transactions (booked_rate and amount_idr stay untouched)
// 7. Screen consistency: Accounts, Pulse, Radar, and AI CFO produce identical IDR valuations
//
// Run: node tests/integration/liveFxProvider.test.js

const path = require('path');
const fs = require('fs');
const Module = require('module');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
const TEST_CACHE_FILE = path.join(ROOT, 'server', 'data', 'test_fx_rates_cache.json');

Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake',
  SUPABASE_SECRET_KEY: 'fake',
  BOT_TOKEN: 'fake',
  JWT_SECRET: 'live-fx-test-secret',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5615',
  NODE_ENV: 'test',
  FX_CACHE_FILE: TEST_CACHE_FILE,
});

// Mock Supabase
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = 88888;

mem.__seed('users', [
  { id: USER_ID, email: 'cfo@livefx.test', is_active: true },
]);

mem.__seed('businesses', [
  { id: BIZ_ID, name: 'PT Live FX Consistency Corp', type: 'company', owner_user_id: USER_ID, base_currency: 'IDR', created_at: '2026-01-01' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_ID, business_id: BIZ_ID, role: 'owner', status: 'active' },
]);

mem.__seed('wallets', [
  { id: 'w-bca-idr', business_id: BIZ_ID, name: 'BCA IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-wise-usd', business_id: BIZ_ID, name: 'Wise USD', currency: 'USD', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-binance-usdt', business_id: BIZ_ID, name: 'Binance USDT', currency: 'USDT', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-rare-cur', business_id: BIZ_ID, name: 'Dubai AED', currency: 'AED', type: 'bank', scope: 'business', is_active: true },
]);

mem.__seed('transactions', [
  // Existing historical transaction: booked at 16,300 IDR/USD in the past
  { id: 'tx-hist-1', business_id: BIZ_ID, wallet_id: 'w-wise-usd', type: 'income', amount_original: 1000, amount_idr: 16300000, booked_rate: 16300, currency_original: 'USD', scope: 'business', created_at: '2026-08-15T10:00:00Z' },
  // IDR transaction
  { id: 'tx-idr-1', business_id: BIZ_ID, wallet_id: 'w-bca-idr', type: 'income', amount_original: 10000000, amount_idr: 10000000, currency_original: 'IDR', scope: 'business', created_at: '2026-10-01T10:00:00Z' },
  // USDT transaction: 500 USDT
  { id: 'tx-usdt-1', business_id: BIZ_ID, wallet_id: 'w-binance-usdt', type: 'income', amount_original: 500, amount_idr: 8900000, currency_original: 'USDT', scope: 'business', created_at: '2026-10-01T11:00:00Z' },
  // AED transaction: 200 AED (unvalued currency scenario)
  { id: 'tx-aed-1', business_id: BIZ_ID, wallet_id: 'w-rare-cur', type: 'income', amount_original: 200, amount_idr: null, currency_original: 'AED', scope: 'business', created_at: '2026-10-01T12:00:00Z' },
]);

mem.__seed('debts', [
  { id: 'debt-usd-1', business_id: BIZ_ID, type: 'payable', counterparty: 'AWS Cloud', currency: 'USD', amount: 200, original_amount: 200, paid_amount: 0, status: 'open', approval_status: 'approved', due_date: '2026-10-15' },
]);

// Start server
const app = require(path.join(ROOT, 'server', 'index.js'));
const fx = require(path.join(ROOT, 'server', 'lib', 'fxProvider.js'));
const { cashItems, forecast } = require(path.join(ROOT, 'client', 'src', 'v2', 'lib', 'radarSeries.js'));

const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
const authHeaders = {
  authorization: `Bearer ${tok(USER_ID)}`,
  'x-business-id': BIZ_ID,
};

async function reqGet(urlPath) {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT}${urlPath}`, {
    headers: authHeaders,
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

  console.log('\n=== INTEGRATION TEST SUITE: LIVE FX RATES PROVIDER & CONSISTENCY ===\n');

  // Clean test cache before starting
  if (fs.existsSync(TEST_CACHE_FILE)) {
    try { fs.unlinkSync(TEST_CACHE_FILE); } catch (_) {}
  }

  // ── SCENARIO 1: Successful rate update with full honest metadata ────────────
  await test('1. Successful rate update with full honest metadata and distinct crypto/fiat rates', async () => {
    // Inject mock connector simulating live responses from Bank Indonesia, ExchangeRate-API, CoinGecko
    fx.setMockConnector(async () => {
      const nowIso = new Date().toISOString();
      return {
        status: 'fresh',
        rate_effective_date: '2026-10-02',
        rates: {
          IDR: {
            currency: 'IDR', pair: 'IDR/IDR', direction: 'identity', rate: 1, rate_str: '1',
            source: 'base_currency', rate_type: 'base_currency', rate_effective_date: '2026-10-05',
            retrieved_at: nowIso, calculated_at: nowIso, as_of: '2026-10-05', status: 'fresh', is_fixed_accounting: true
          },
          USD: {
            currency: 'USD', pair: 'USD/IDR', direction: 'base_to_quote', rate: 17898, rate_str: '17898',
            source: 'bi_jisdor', rate_type: 'official_fixing', rate_effective_date: '2026-10-02',
            retrieved_at: nowIso, calculated_at: nowIso, as_of: '2026-10-05', status: 'fresh', is_fixed_accounting: false
          },
          EUR: {
            currency: 'EUR', pair: 'EUR/IDR', direction: 'base_to_quote', rate: 20154.42, rate_str: '20154.42',
            source: 'exchangerate_api', rate_type: 'market_api', rate_effective_date: '2026-10-05',
            retrieved_at: nowIso, calculated_at: nowIso, as_of: '2026-10-05', status: 'fresh', is_fixed_accounting: false
          },
          SGD: {
            currency: 'SGD', pair: 'SGD/IDR', direction: 'base_to_quote', rate: 14002.58, rate_str: '14002.58',
            source: 'exchangerate_api', rate_type: 'market_api', rate_effective_date: '2026-10-05',
            retrieved_at: nowIso, calculated_at: nowIso, as_of: '2026-10-05', status: 'fresh', is_fixed_accounting: false
          },
          USDT: {
            currency: 'USDT', pair: 'USDT/IDR', direction: 'base_to_quote', rate: 17894.22, rate_str: '17894.22', rate_usd: 0.999847,
            source: 'coingecko', rate_type: 'crypto_market_api', rate_effective_date: '2026-10-05',
            retrieved_at: nowIso, calculated_at: nowIso, as_of: '2026-10-05', status: 'fresh', is_fixed_accounting: false
          }
        }
      };
    });

    const refreshRes = await fx.refreshRates({ force: true });
    assert.equal(refreshRes.ok, true, 'refreshRates succeeded');

    const usdQuote = fx.getQuote('USD');
    assert.equal(usdQuote.rate, 17898);
    assert.equal(usdQuote.source, 'bi_jisdor');
    assert.equal(usdQuote.rate_effective_date, '2026-10-02');
    assert.equal(usdQuote.rate_type, 'official_fixing');

    const usdtQuote = fx.getQuote('USDT');
    assert.equal(usdtQuote.rate, 17894.22);
    assert.equal(usdtQuote.source, 'coingecko');
    assert.notEqual(usdtQuote.rate, usdQuote.rate, 'USDT is NOT equated 1:1 to USD');

    const meta = fx.getProviderMetadata();
    assert.equal(meta.status, 'fresh');
    assert.equal(meta.rate_effective_date, '2026-10-02');
  });

  // ── SCENARIO 2: Timeout / failure retains last good rate as stale ───────────
  await test('2. Timeout / source failure preserves last good rate with its real effective date and marks status as stale', async () => {
    // Inject failing connector simulating network timeout / downstream 503
    fx.setMockConnector(async () => {
      throw new Error('ETIMEDOUT: Connection to Bank Indonesia timed out');
    });

    const refreshRes = await fx.refreshRates({ force: true });
    assert.equal(refreshRes.ok, false, 'refreshRates flagged failure');

    // Rates from last successful run MUST be preserved with their true effective date
    const usdQuote = fx.getQuote('USD');
    assert.equal(usdQuote.rate, 17898, 'Last successful USD rate preserved');
    assert.equal(usdQuote.rate_effective_date, '2026-10-02', 'True effective date preserved');

    const meta = fx.getProviderMetadata();
    assert.equal(meta.status, 'stale', 'Status changed to stale');
    assert.ok(meta.last_error.includes('ETIMEDOUT'), 'Last error recorded');
  });

  // ── SCENARIO 3: Service restart persistence ────────────────────────────────
  await test('3. Service restart persistence (reloads saved rates from disk cache across restarts)', async () => {
    // Assert cache file exists and contains valid JSON
    assert.ok(fs.existsSync(TEST_CACHE_FILE), 'Disk cache file exists');

    // Create a new isolated LiveFxState instance (simulating fresh server restart)
    const freshState = new fx.LiveFxState();
    const usd = freshState.getQuote('USD');
    assert.ok(usd, 'USD quote restored from disk cache');
    assert.equal(usd.rate, 17898, 'Restored rate matches cached rate');
    assert.equal(usd.rate_effective_date, '2026-10-02', 'Restored rate effective date matches');
    assert.equal(freshState.getMetadata().status, 'cached', 'Restored status is cached');
  });

  // ── SCENARIO 4: Currency without rate flags incomplete total and avoids 1:1 fallback
  await test('4. Currency without rate returns null, avoids 1:1 fallback, and flags incomplete balance', async () => {
    // Query currency without rate ('AED' is in wallets but not in FX provider)
    const aedQuote = fx.getQuote('AED');
    assert.equal(aedQuote, null, 'Unvalued currency quote returns null');

    // Check GET /api/wallets
    const walletsRes = await reqGet('/api/wallets');
    assert.equal(walletsRes.status, 200);
    assert.equal(walletsRes.body.has_incomplete_balance, true, 'has_incomplete_balance is true in /api/wallets');
    assert.ok(walletsRes.body.unvalued_currencies.includes('AED'), 'AED is in unvalued_currencies');

    const aedWallet = walletsRes.body.wallets.find(w => w.currency === 'AED');
    assert.ok(aedWallet, 'AED wallet found');
    assert.equal(aedWallet.balance_idr, null, 'Unvalued wallet balance_idr is null');
    assert.equal(aedWallet.is_unvalued, true, 'is_unvalued is true');

    // Total balance in IDR must NOT include AED as 1:1 (200 AED must not become 200 IDR)
    // Wallets: BCA 10M IDR + Wise 1,000 USD * 17,898 + Binance 500 USDT * 17,894.22
    const expectedValuedIdr = 10000000 + (1000 * 17898) + Math.round(500 * 17894.22);
    assert.equal(walletsRes.body.total_balance_idr, expectedValuedIdr, 'Total excludes unvalued currency without 1:1 fallback');

    // Check GET /api/pulse
    const pulseRes = await reqGet('/api/pulse?scope=business');
    assert.equal(pulseRes.status, 200);
    assert.equal(pulseRes.body.has_incomplete_balance, true, 'has_incomplete_balance is true in /api/pulse');
    assert.ok(pulseRes.body.unvalued_currencies.includes('AED'));
    assert.equal(pulseRes.body.totalBalance, expectedValuedIdr, 'Pulse totalBalance excludes unvalued currency');

    // Check GET /api/ai-cfo/context
    const cfoRes = await reqGet('/api/ai-cfo/context');
    assert.equal(cfoRes.status, 200);
    assert.equal(cfoRes.body.cash.has_incomplete_balance, true, 'has_incomplete_balance is true in AI CFO cash');
    assert.ok(cfoRes.body.cash.unvalued_currencies.includes('AED'));
    assert.equal(cfoRes.body.cash.total_balance, expectedValuedIdr, 'AI CFO total_balance excludes unvalued currency');
  });

  // ── SCENARIO 5: Weekend / non-publication days are marked as weekend_holding
  await test('5. Weekend / non-publication days are marked as weekend_holding, not technical failure', async () => {
    const liveInstance = new fx.LiveFxState();

    // Sunday test
    const sundayDate = new Date('2026-10-04T12:00:00Z');
    assert.equal(liveInstance.isWeekendOrHolding(sundayDate), true, 'Sunday is detected as weekend');

    // Saturday test
    const saturdayDate = new Date('2026-10-03T12:00:00Z');
    assert.equal(liveInstance.isWeekendOrHolding(saturdayDate), true, 'Saturday is detected as weekend');

    // Monday morning before fixing publication (e.g. 05:00 UTC = 12:00 WIB)
    const mondayMorning = new Date('2026-10-05T05:00:00Z');
    assert.equal(liveInstance.isWeekendOrHolding(mondayMorning), true, 'Monday pre-publication is holding previous rate');

    // Tuesday afternoon (normal business day)
    const tuesdayAfternoon = new Date('2026-10-06T10:00:00Z');
    assert.equal(liveInstance.isWeekendOrHolding(tuesdayAfternoon), false, 'Tuesday business hours is active');
  });

  // ── SCENARIO 6: Immutability of historical transactions ────────────────────
  await test('6. Immutability of historical transactions (booked_rate and amount_idr stay untouched)', async () => {
    // In database, tx-hist-1 was booked at 16,300 IDR/USD with amount_idr = 16,300,000
    const txRow = mem.__db['transactions'].find(t => t.id === 'tx-hist-1');
    assert.ok(txRow, 'Historical transaction exists in DB');
    assert.equal(txRow.booked_rate, 16300, 'Historical booked_rate is 16300');
    assert.equal(txRow.amount_idr, 16300000, 'Historical amount_idr is 16300000');

    // Even though live rate is now 17,898, historical row is NEVER updated
    assert.notEqual(txRow.booked_rate, fx.getQuote('USD').rate, 'Historical booked_rate is independent from live rate');
  });

  // ── SCENARIO 7: Screen consistency across Accounts, Pulse, Radar, AI CFO ──
  await test('7. Screen consistency: Accounts, Pulse, Radar, and AI CFO produce identical IDR valuations', async () => {
    const walletsRes = await reqGet('/api/wallets');
    const pulseRes = await reqGet('/api/pulse?scope=business');
    const cfoRes = await reqGet('/api/ai-cfo/context');

    const accountsTotal = walletsRes.body.total_balance_idr;
    const pulseTotal = pulseRes.body.totalBalance;
    const cfoTotal = cfoRes.body.cash.total_balance;

    // 1. Cash total equality across Accounts, Pulse, AI CFO
    assert.equal(accountsTotal, pulseTotal, 'Accounts total matches Pulse totalBalance');
    assert.equal(pulseTotal, cfoTotal, 'Pulse totalBalance matches AI CFO total_balance');

    // 2. Exact same USD rate in Pulse rates and AI CFO rates
    const pulseUsdRate = pulseRes.body.rates.USD.rate;
    const cfoUsdRate = cfoRes.body.rates.USD.rate;
    const providerUsdRate = fx.getQuote('USD').rate;
    assert.equal(pulseUsdRate, providerUsdRate, 'Pulse uses live provider rate');
    assert.equal(cfoUsdRate, providerUsdRate, 'AI CFO uses live provider rate');

    // 3. Radar valuation of foreign debt (debt-usd-1: 200 USD payable)
    const { items: radarItems } = cashItems({
      debts: pulseRes.body.debts,
      obligations: [],
      repayments: [],
      horizon: 30,
      rates: pulseRes.body.rates,
    });

    const usdDebtItem = radarItems.find(it => it.id === 'debt-usd-1');
    assert.ok(usdDebtItem, 'debt-usd-1 found in Radar items');
    const expectedDebtIdr = Math.round(200 * providerUsdRate);
    assert.equal(usdDebtItem.amount, expectedDebtIdr, 'Radar converts USD payable using the exact same rate');

    // 4. Radar forecast starts with the exact same balance
    const f = forecast({ balance: pulseRes.body.totalBalance, burnRate: pulseRes.body.burnRate, items: radarItems, horizon: 30 });
    assert.equal(f.start, pulseTotal, 'Radar forecast starts with Pulse totalBalance');
  });

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;

  // Cleanup test cache
  if (fs.existsSync(TEST_CACHE_FILE)) {
    try { fs.unlinkSync(TEST_CACHE_FILE); } catch (_) {}
  }

  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
