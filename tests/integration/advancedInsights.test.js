// GET /api/pulse/advanced-insights — scoping and date-semantics contract.
//
// Boots the REAL server/index.js over the in-memory supabase shim and drives real HTTP,
// so requireBusiness, bizOrFilter and the route wiring are all exercised. No database.
//
// Run: node tests/integration/advancedInsights.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'adv-insights-test-secret', TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5603', NODE_ENV: 'test',
});
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const A = '11111111-1111-4111-8111-111111111111';   // has data
const B = '22222222-2222-4222-8222-222222222222';   // member, but empty
const C = '33333333-3333-4333-8333-333333333333';   // NOT a member
const P = '44444444-4444-4444-4444-444444444444';   // personal workspace
const USER = 910101;

mem.__seed('businesses', [
  { id: A, name: 'A', type: 'company', owner_user_id: USER, created_at: '2026-01-01' },
  { id: B, name: 'B', type: 'company', owner_user_id: USER, created_at: '2026-01-02' },
  { id: C, name: 'C', type: 'company', owner_user_id: 999, created_at: '2026-01-03' },
  { id: P, name: 'Personal', type: 'personal', owner_user_id: USER, created_at: '2026-01-04' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: USER, business_id: A, role: 'owner', status: 'active' },
  { id: 2, user_id: USER, business_id: B, role: 'owner', status: 'active' },
  { id: 3, user_id: USER, business_id: P, role: 'owner', status: 'active' },
]);

const tx = (business_id, type, category, amount, transaction_date, created_at) =>
  ({ business_id, type, category, description: category, amount_original: amount, transaction_date, created_at });

mem.__seed('transactions', [
  // Business A — back-dated into JULY, all inserted "today" in September.
  tx(A, 'income',  'wash revenue',       10000, '2026-07-05', '2026-09-03T10:00:00Z'),
  tx(A, 'income',  'advertising slot',    5000, '2026-07-06', '2026-09-03T10:00:00Z'),
  tx(A, 'expense', 'refill supplies',     3000, '2026-07-07', '2026-09-03T10:00:00Z'),
  tx(A, 'expense', 'location rent',       2000, '2026-07-08', '2026-09-03T10:00:00Z'),
  tx(A, 'expense', 'equipment purchase',  8000, '2026-07-09', '2026-09-03T10:00:00Z'),
  tx(A, 'expense', 'PPh tax payment',      500, '2026-07-10', '2026-09-03T10:00:00Z'),
  tx(A, 'expense', 'loan interest',        250, '2026-07-11', '2026-09-03T10:00:00Z'),
  // Business C — must never be visible to USER.
  tx(C, 'income',  'wash revenue',      999999, '2026-07-05', '2026-09-03T10:00:00Z'),
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
async function get(p, { user = USER, biz } = {}) {
  const headers = {};
  // `user: null` means "send no token" — passing undefined would select the default.
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + p, { headers });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  console.log('\nMetrics');
  await t('returns computed cash-basis metrics for the active business', async () => {
    const r = await get('/pulse/advanced-insights', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.ok, true);
    const m = r.body.metrics;
    assert.strictEqual(m.revenue, 15000);
    assert.strictEqual(m.direct_costs, 3000);
    assert.strictEqual(m.gross_profit, 12000);
    assert.strictEqual(m.opex, 2000);
    assert.strictEqual(m.capex, 8000);
    assert.strictEqual(m.estimated_ebitda, 10000, 'capex/tax/interest must not reduce EBITDA');
    assert.strictEqual(m.estimated_net_profit, 9250);
  });

  await t('statuses and warnings ship with the numbers', async () => {
    const r = await get('/pulse/advanced-insights', { biz: A });
    assert.deepStrictEqual(r.body.status, {
      gross_profit: 'available', capex: 'available', ebitda: 'estimated', net_profit: 'estimated',
    });
    assert.ok(r.body.warnings.some((w) => /cash-basis/i.test(w)));
  });

  console.log('\nDate semantics');
  await t('back-dated rows report in their transaction month, not the insert month', async () => {
    const july = await get('/pulse/advanced-insights?from=2026-07-01&to=2026-07-31', { biz: A });
    assert.strictEqual(july.body.metrics.revenue, 15000, 'July must hold the revenue');
    const sept = await get('/pulse/advanced-insights?from=2026-09-01&to=2026-09-30', { biz: A });
    assert.strictEqual(sept.body.metrics.revenue, 0, 'September (insert month) must be empty');
  });

  await t('series is keyed by effective month', async () => {
    const r = await get('/pulse/advanced-insights', { biz: A });
    assert.deepStrictEqual(r.body.series.map((s) => s.period), ['2026-07']);
  });

  console.log('\nIsolation');
  await t('another business\'s data never appears', async () => {
    const r = await get('/pulse/advanced-insights', { biz: A });
    assert.ok(r.body.metrics.revenue < 999999, 'business C revenue leaked');
    assert.strictEqual(r.body.business_id, A);
  });

  await t('an empty business returns locked states, not an error', async () => {
    const r = await get('/pulse/advanced-insights', { biz: B });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.metrics.revenue, 0);
    assert.strictEqual(r.body.status.ebitda, 'locked');
    assert.strictEqual(r.body.status.net_profit, 'locked');
    assert.strictEqual(r.body.transactions_considered, 0);
  });

  await t('a business the user does not belong to is refused', async () => {
    const r = await get('/pulse/advanced-insights', { biz: C });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'workspace_not_accessible');
  });

  await t('a personal workspace is refused', async () => {
    const r = await get('/pulse/advanced-insights', { biz: P });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'business_workspace_required');
  });

  await t('unauthenticated is refused', async () => {
    const r = await get('/pulse/advanced-insights', { user: null });
    assert.strictEqual(r.status, 401, `status ${r.status}`);
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  // Exit without process.exit(): see tests/integration/reminderScoping.test.js for why.
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
