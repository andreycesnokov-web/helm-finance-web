// Integration tests for AI CFO routes:
// 1. GET /api/ai-cfo/context
// 2. POST /api/ai-cfo/ask
//
// Verifies:
// - Resolution of ReferenceError: bizTxs is not defined in buildAiCfoContext.
// - Strict company isolation (Company A never sees Company B data).
// - Personal wallet exclusion (Personal wallet transactions never distort business burn rate or cash).
// - Exact calculation invariants (burn rate, runway, total balance, debt obligations).
// - Multi-currency valuation at today's rate.
// - Role access checks and question validation.
//
// Run: node tests/integration/aiCfoRoutes.test.js
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
  JWT_SECRET: 'ai-cfo-test-secret',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5611',
  NODE_ENV: 'test',
});

// Extend _memorySupabase .or() filter to handle is.null and eq.false
const origOr = mem.createClient().from('x').constructor.prototype.or;
mem.createClient().from('x').constructor.prototype.or = function(expr) {
  const parts = String(expr).split(',').map((p) => {
    const mNull = p.match(/^(\w+)\.is\.null$/);
    if (mNull) return (r) => r[mNull[1]] == null;
    const mEq = p.match(/^(\w+)\.eq\.(.*)$/);
    if (mEq) {
      const col = mEq[1], val = mEq[2];
      if (val === 'false') return (r) => r[col] === false || r[col] == null;
      if (val === 'true') return (r) => r[col] === true;
      return (r) => String(r[col]) === val;
    }
    return () => false;
  });
  this.filters.push((r) => parts.some((f) => f(r)));
  return this;
};

let mockAnthropicCalls = [];
class MockAnthropic {
  constructor(opts) {
    this.apiKey = opts?.apiKey;
    this.messages = {
      create: async (params) => {
        mockAnthropicCalls.push(params);
        return {
          content: [{ text: 'Mocked Anthropic CFO response: Cash runway is sufficient at 101 days.' }],
        };
      },
    };
  }
}

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  if (request === '@anthropic-ai/sdk') return MockAnthropic;
  return origLoad.apply(this, arguments);
};

const BIZ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 90101;
const USER_B = 90202;
const USER_OTHER = 90303;

mem.__seed('businesses', [
  { id: BIZ_A, name: 'PT Alpha Utama', type: 'company', owner_user_id: USER_A, base_currency: 'IDR', created_at: '2026-01-01' },
  { id: BIZ_B, name: 'PT Beta Sejahtera', type: 'company', owner_user_id: USER_B, base_currency: 'IDR', created_at: '2026-01-01' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_A, business_id: BIZ_A, role: 'owner', status: 'active' },
  { id: 2, user_id: USER_B, business_id: BIZ_B, role: 'owner', status: 'active' },
]);

mem.__seed('wallets', [
  { id: 'w-biz-a1', business_id: BIZ_A, name: 'BCA Operasional', currency: 'IDR', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-biz-a2', business_id: BIZ_A, name: 'Wise USD', currency: 'USD', type: 'bank', scope: 'business', is_active: true },
  { id: 'w-pers-a1', business_id: BIZ_A, name: 'Personal Cash', currency: 'IDR', type: 'cash', scope: 'personal', is_active: true },
  { id: 'w-biz-b1', business_id: BIZ_B, name: 'Mandiri Beta', currency: 'IDR', type: 'bank', scope: 'business', is_active: true },
]);

const d = (daysAgo) => {
  const dt = new Date(Date.now() - daysAgo * 86400000);
  return dt.toISOString();
};

mem.__seed('transactions', [
  // Biz A transactions
  { id: 'tx-1', business_id: BIZ_A, wallet_id: 'w-biz-a1', type: 'income', amount_original: 50000000, amount_idr: 50000000, currency_original: 'IDR', scope: 'business', created_at: d(20), transaction_date: d(20).slice(0, 10) },
  { id: 'tx-2', business_id: BIZ_A, wallet_id: 'w-biz-a1', type: 'expense', amount_original: 10000000, amount_idr: 10000000, currency_original: 'IDR', scope: 'business', created_at: d(15), transaction_date: d(15).slice(0, 10) },
  { id: 'tx-3', business_id: BIZ_A, wallet_id: 'w-biz-a1', type: 'expense', amount_original: 5000000, amount_idr: 5000000, currency_original: 'IDR', scope: 'business', created_at: d(5), transaction_date: d(5).slice(0, 10) },
  // Older expense outside 30-day window (establishes >30 days history)
  { id: 'tx-old', business_id: BIZ_A, wallet_id: 'w-biz-a1', type: 'expense', amount_original: 1000000, amount_idr: 1000000, currency_original: 'IDR', scope: 'business', created_at: d(35), transaction_date: d(35).slice(0, 10) },
  // Biz A USD wallet transaction: $1,000 income = 16,300,000 IDR
  { id: 'tx-usd', business_id: BIZ_A, wallet_id: 'w-biz-a2', type: 'income', amount_original: 1000, amount_idr: 16300000, currency_original: 'USD', scope: 'business', created_at: d(10), transaction_date: d(10).slice(0, 10) },
  // Biz A Personal wallet tx (99M personal expense — MUST NOT pollute business burn rate or cash balance)
  { id: 'tx-p1', business_id: BIZ_A, wallet_id: 'w-pers-a1', type: 'expense', amount_original: 99000000, amount_idr: 99000000, currency_original: 'IDR', scope: 'personal', created_at: d(2), transaction_date: d(2).slice(0, 10) },
  // Biz B transactions (MUST NOT be visible in Biz A)
  { id: 'tx-b1', business_id: BIZ_B, wallet_id: 'w-biz-b1', type: 'income', amount_original: 100000000, amount_idr: 100000000, currency_original: 'IDR', scope: 'business', created_at: d(10), transaction_date: d(10).slice(0, 10) },
]);

mem.__seed('debts', [
  { id: 'debt-1', business_id: BIZ_A, type: 'payable', counterparty: 'Supplier X', amount: 8000000, original_amount: 8000000, paid_amount: 0, status: 'open', approval_status: 'approved', due_date: d(-10).slice(0, 10) },
  { id: 'debt-b1', business_id: BIZ_B, type: 'payable', counterparty: 'Supplier Beta', amount: 999000000, original_amount: 999000000, paid_amount: 0, status: 'open', approval_status: 'approved', due_date: d(-10).slice(0, 10) },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);

async function get(path, { user = USER_A, biz = BIZ_A } = {}) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + path, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: json };
}

async function post(path, body, { user = USER_A, biz = BIZ_A } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
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

  console.log('\nAI CFO — Route and Math Verification');

  await t('GET /api/ai-cfo/context succeeds with HTTP 200 (no bizTxs ReferenceError)', async () => {
    const res = await get('/ai-cfo/context', { user: USER_A, biz: BIZ_A });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.cash, 'Context has cash object');
    assert.ok(res.body.wallets_summary, 'Context has wallets_summary');
    assert.ok(res.body.current_month, 'Context has current_month');
  });

  await t('Business cash calculation excludes personal wallets and includes multi-currency valuation', async () => {
    const res = await get('/ai-cfo/context', { user: USER_A, biz: BIZ_A });
    const cash = res.body.cash;
    // BCA IDR: 50M - 10M - 5M - 1M = 34M IDR
    // Wise USD: $1,000 * 16,300 = 16.3M IDR
    // Total business cash = 34M + 16.3M = 50.3M IDR
    assert.equal(cash.total_balance, 50300000, `Expected 50.3M IDR total cash, got ${cash.total_balance}`);
    assert.equal(cash.wallets_count, 2, 'Only 2 business wallets counted');
    // Personal cash must be isolated
    assert.equal(res.body.wallets_summary.personal_cash, -99000000, 'Personal cash tracked separately');
  });

  await t('Business burn rate and runway exclude personal expenses', async () => {
    const res = await get('/ai-cfo/context', { user: USER_A, biz: BIZ_A });
    const burnRate = res.body.current_month.burn_rate;
    // Business expenses in last 30 days: 10M + 5M = 15M IDR (tx-p1 99M personal expense is EXCLUDED!)
    // Daily burn = 15M / 30 = 500,000 IDR/day
    assert.equal(burnRate, 500000, `Expected 500,000 daily burn, got ${burnRate}`);
    // Runway = 50.3M / 500,000 = 100.6 -> 101 days
    assert.equal(res.body.runway_days, 101, `Expected 101 days runway, got ${res.body.runway_days}`);
  });

  await t('Company isolation: Business A does not see Business B data', async () => {
    const resA = await get('/ai-cfo/context', { user: USER_A, biz: BIZ_A });
    const resB = await get('/ai-cfo/context', { user: USER_B, biz: BIZ_B });

    assert.equal(resA.body.cash.total_balance, 50300000); // 50.3M IDR for Biz A
    assert.equal(resB.body.cash.total_balance, 100000000); // 100M IDR for Biz B
    assert.equal(resA.body.payables.total_remaining, 8000000); // Supplier X only
    assert.equal(resB.body.payables.total_remaining, 999000000); // Supplier Beta only
  });

  await t('Unauthorized or unassociated user is refused access with HTTP 403/404', async () => {
    const res = await get('/ai-cfo/context', { user: USER_OTHER, biz: BIZ_A });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403/404 for non-member, got ${res.status}`);
  });

  await t('POST /api/ai-cfo/ask responds without ReferenceError (local fallback)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post('/ai-cfo/ask', {
      question: 'What is our current cash runway?',
      language: 'en',
    }, { user: USER_A, biz: BIZ_A });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.used_ai_provider, false, 'Used local fallback when no API key configured');
    assert.ok(res.body.answer, 'Returns answer');
    assert.ok(typeof res.body.answer === 'string', 'Answer is string');
    assert.ok(res.body.answer.length > 10, 'Answer is substantial');
  });

  await t('POST /api/ai-cfo/ask uses mock AI provider when API key is set (zero paid calls)', async () => {
    process.env.ANTHROPIC_API_KEY = 'mock-key-for-test';
    mockAnthropicCalls = [];
    const res = await post('/ai-cfo/ask', {
      question: 'What is our current cash runway?',
      language: 'en',
    }, { user: USER_A, biz: BIZ_A });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.used_ai_provider, true, 'Indicates AI provider used');
    assert.equal(mockAnthropicCalls.length, 1, 'Mock Anthropic called exactly once');
    assert.ok(res.body.answer.includes('Mocked Anthropic CFO response'), 'Returns mocked provider text');
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t('POST /api/ai-cfo/ask rejects out-of-scope question via guardrail', async () => {
    const res = await post('/ai-cfo/ask', {
      question: 'Give me a recipe for soup and пельмени',
      language: 'en',
    }, { user: USER_A, biz: BIZ_A });
    assert.equal(res.status, 200);
    assert.equal(res.body.out_of_scope, true, 'Marked out of scope');
  });

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
