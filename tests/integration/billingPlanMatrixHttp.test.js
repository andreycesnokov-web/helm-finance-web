'use strict';
// Plan matrix (20261018090000): publication contract, Super-Admin-only catalog writes, the public catalog, pinned
// subscriptions, 7/14-day trials from the version, expiring overrides, the new meters and concurrent publication.
// Disposable database: production schema snapshot + release chain + D4 + 072/073 + the four billing migrations.
// Numbers marked TEST are test values only — not the owner's commercial matrix.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { CHAIN, D4, startServer, openAdmin } = require('./_d4Harness');

const MIGRATIONS = ['20261015033808_cfo_commercial_trial.sql', '20261017090000_billing_management_center.sql', '20261017120000_billing_enforcement.sql', '20261018090000_billing_plan_matrix.sql'];
const SUPER = 9600, STAFF = 9601, OA = 1601, OB = 1602, OC = 1603;
const FEATURES = { documents: true, ai: true, import: true, payroll: false, team: true, approvals: false, export: true, integrations: false };
// TEST values for the PENDING keys (explicit: publication refuses an undecided metered key).
const PENDING_TEST = { companies: 1, imports: 5, bank_rows: 3, accounts: 2, storage_mb: null, ai_accountant: 0, ai_extraction: 10, mcp: 0, integrations: 0 };
let db, admin, api;
const key = () => crypto.randomUUID();

before(async () => {
  db = await createProdSchemaDatabase('billing_matrix', [...CHAIN, D4]);
  if (!db) return;
  admin = await openAdmin(db.connectionString);
  for (const m of ['072_platform_admins.sql', '073_platform_admins_security.sql']) await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', m), 'utf8'));
  // The seeded catalog of a clean install: three draft plans with empty terms, then the four billing migrations.
  for (const m of MIGRATIONS) await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', m), 'utf8'));
  await admin.query("INSERT INTO public.plan_limits(plan) VALUES ('free'),('business'),('founder'),('enterprise') ON CONFLICT DO NOTHING");
  for (const u of [SUPER, STAFF, OA, OB, OC]) {
    await admin.query('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
    await admin.query('INSERT INTO public.user_email_identities (user_id, email, email_verified_at) VALUES ($1, $2, now())', [u, `matrix${u}@test.local`]);
  }
  await admin.query("INSERT INTO public.platform_admins (user_id, role, is_active, created_by) VALUES ($1, 'super_admin', true, $1), ($2, 'platform_admin', true, $1)", [SUPER, STAFF]);
  Object.assign(process.env, { COMMERCIAL_BILLING_ENABLED: 'true' });
  delete process.env.ADMIN_TELEGRAM_IDS; delete process.env.COMMERCIAL_BILLING_FIXTURES;
  api = await startServer(db.connectionString);
});
after(async () => { await api?.stop(); await admin?.end(); await db?.drop?.(); });
const skip = () => !db;

const catalog = async () => (await api.call('/admin/billing/catalog', { user: SUPER })).body;
const head = async (code) => (await catalog()).plans.find((p) => p.plan === code);
const draftOf = async (code) => { const c = await catalog(), h = c.plans.find((p) => p.plan === code); return { h, v: c.versions.find((v) => v.id === (h.draft_version_id || h.current_version_id)) }; };
function termsFrom(v, over = {}) {
  return { name_i18n: v.name_i18n, description_i18n: v.description_i18n, price_minor: Number(v.price_minor), currency: v.currency, trial_hours: v.trial_hours,
    features: v.features, limits: v.limits, terms_version: 'test-matrix', effective_at: new Date(Date.now() - 60000).toISOString(), approval_status: 'approved', ...over };
}
async function publish(code, over = {}, user = SUPER) {
  const { h, v } = await draftOf(code);
  return api.call('/admin/billing/catalog/' + code, { method: 'POST', user, body: { request_key: key(), expected_version: Number(h.catalog_version),
    terms: { action: 'publish', confirm_publish: true, publish: true, ...termsFrom(v, over) } } });
}
async function company(owner, name) {
  const r = await api.call('/businesses', { method: 'POST', user: owner, body: { name, request_key: key(), country: 'Indonesia', timezone: 'Asia/Jakarta' } });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.business.id;
}
async function trial(owner, biz, code) {
  const s = (await api.call('/billing', { user: owner, biz })).body, plan = s.account.catalog.find((p) => p.plan === code);
  assert.ok(plan, code + ' offered');
  const sel = await api.call('/billing/plan', { method: 'POST', user: owner, biz, body: { request_key: key(), plan_version_id: plan.id, expected_version: Number(s.account.version) } });
  assert.equal(sel.status, 200, JSON.stringify(sel.body));
  const tr = await api.call('/billing/trial', { method: 'POST', user: owner, biz, body: { request_key: key(), plan_version_id: plan.id, expected_version: Number(sel.body.version) } });
  assert.equal(tr.status, 200, JSON.stringify(tr.body)); return plan;
}
const terms = async (biz) => (await admin.query('SELECT public.billing_effective_terms($1) t', [biz])).rows[0].t;
async function override(biz, payload) {
  const d = (await api.call('/admin/billing/companies/' + biz, { user: SUPER })).body;
  return api.call(`/admin/billing/companies/${biz}/override`, { method: 'POST', user: SUPER, body: { request_key: key(), expected_version: Number(d.account.version), payload } });
}

let A, B;
test('the owner-value drafts cannot be published until every PENDING metered limit and the feature matrix are decided', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const { v } = await draftOf('starter');
  assert.deepEqual(v.limits, { users: 2, transactions: 1000, documents: 100, ai: 50 }, 'APPROVED starting values');
  const r = await publish('starter'); assert.equal(r.status, 400); assert.equal(r.body.error, 'billing_terms_incomplete');
  // Features decided but one metered key still undecided → refused (absent is never "unlimited").
  const { mcp, ...almost } = PENDING_TEST; void mcp;
  const r2 = await publish('starter', { features: FEATURES, limits: { ...v.limits, ...almost } }); assert.equal(r2.body.error, 'billing_terms_incomplete');
  const ok = await publish('starter', { features: FEATURES, limits: { ...v.limits, ...PENDING_TEST } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(Number(ok.body.terms.price_minor), 5900, 'price kept');
});
test('only a Platform SUPER admin may change or publish plans; a platform admin can preview (with affected companies)', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const r = await publish('starter', { limits: { users: 3, transactions: 1000, documents: 100, ai: 50, ...PENDING_TEST }, features: FEATURES }, STAFF);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'super_admin_required');
  const h = await head('starter');
  const pv = await api.call('/admin/billing/catalog/starter/preview', { method: 'POST', user: STAFF, body: { expected_version: Number(h.catalog_version),
    terms: { action: 'publish', ...termsFrom((await draftOf('starter')).v, { limits: { users: 3, transactions: 1000, documents: 100, ai: 50, ...PENDING_TEST }, features: FEATURES }) } } });
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.ok(Array.isArray(pv.body.affected));
  assert.equal((await api.call('/admin/billing/catalog/starter', { method: 'POST', user: OA, body: {} })).status, 403);
});
test('public catalog: only published plans, values and states, no drafts or internal fields, readable without identity', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const r = await fetch(api.base.replace(/\/api$/, '') + '/api/public/plans');
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const body = await r.json();
  assert.deepEqual(body.plans.map((p) => p.plan), ['starter'], 'control and pro are still drafts');
  const p = body.plans[0], lim = Object.fromEntries(p.limits.map((l) => [l.key, l]));
  assert.equal(p.price_minor, 5900); assert.equal(p.trial_hours, 168);
  assert.equal(lim.transactions.value, 1000); assert.equal(lim.transactions.state, 'limited');
  assert.equal(lim.mcp.state, 'disabled'); assert.equal(lim.storage_mb.state, 'unlimited');
  assert.ok(lim.transactions.definition.en && lim.transactions.definition.ru && lim.transactions.definition.id, 'plain-language definitions');
  for (const k of ['approval_status', 'limit_policies', 'fixture_label', 'terms_version', 'id']) assert.ok(!(k in p), 'internal field exposed: ' + k);
  assert.equal(p.features.find((f) => f.key === 'payroll').included, false); assert.equal(p.features.find((f) => f.key === 'pulse').included, true);
});
test('existing subscribers keep their version; a new version (2,000 transactions, 14-day trial) applies to new companies only', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  A = await company(OA, 'Matrix A'); await trial(OA, A, 'starter');
  let row = (await admin.query('SELECT extract(epoch FROM trial_ends_at-trial_started_at)::int s FROM public.billing_accounts WHERE business_id=$1', [A])).rows[0];
  assert.equal(row.s, 168 * 3600);
  const before = (await admin.query('SELECT trial_ends_at FROM public.billing_accounts WHERE business_id=$1', [A])).rows[0].trial_ends_at;
  const pub = await publish('starter', { features: FEATURES, limits: { users: 2, transactions: 2000, documents: 100, ai: 50, ...PENDING_TEST }, trial_hours: 336 });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal((await terms(A)).limits.transactions, 1000, 'existing subscriber pinned to its version');
  assert.equal(String((await admin.query('SELECT trial_ends_at FROM public.billing_accounts WHERE business_id=$1', [A])).rows[0].trial_ends_at), String(before), 'running trial unchanged');
  B = await company(OB, 'Matrix B'); await trial(OB, B, 'starter');
  row = (await admin.query('SELECT extract(epoch FROM trial_ends_at-trial_started_at)::int s, trial_hours FROM public.billing_accounts WHERE business_id=$1', [B])).rows[0];
  assert.equal(row.s, 336 * 3600); assert.equal(row.trial_hours, 336);
  assert.equal((await terms(B)).limits.transactions, 2000);
  const pubPlans = await (await fetch(api.base.replace(/\/api$/, '') + '/api/public/plans')).json();
  assert.equal(pubPlans.plans[0].limits.find((l) => l.key === 'transactions').value, 2000, 'public page follows the published catalog (cache ≤ 30 s)');
});
test('company override: a temporary higher limit for one company, audited, then the plan value again after expiry', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const r = await override(A, { kind: 'limit', key: 'transactions', value: 1500, reason: 'Rehearsal: seasonal peak', ends_at: new Date(Date.now() + 2500).toISOString() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await terms(A)).limits.transactions, 1500);
  assert.equal((await terms(B)).limits.transactions, 2000, 'other companies unaffected');
  await new Promise((x) => setTimeout(x, 3000));
  assert.equal((await terms(A)).limits.transactions, 1000, 'back to the plan value after expiry');
  assert.ok(Number((await admin.query("SELECT count(*) n FROM public.billing_admin_commands WHERE action='override'")).rows[0].n) >= 1);
});
test('new meters: financial accounts and statement rows are enforced on the server', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const w = [];
  for (let i = 0; i < 3; i++) w.push(await api.call('/wallets', { method: 'POST', user: OA, biz: A, body: { request_key: key(), name: 'Acc ' + i, currency: 'IDR', opening_balance: 1000, opening_balance_date: '2026-09-30' } }));
  assert.deepEqual(w.map((r) => r.status), [200, 200, 402], JSON.stringify(w.map((r) => r.body)));
  assert.equal(w[2].body.error, 'billing_quota_reached'); assert.equal(w[2].body.resource, 'accounts');
  const wallet = w[0].body.wallet.id;
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ tx_date: '2026-10-0' + (i + 1), description: 'row ' + i, amount: 100 + i, row_index: i }));
  const big = await api.call('/bank-import/batches', { method: 'POST', user: OA, biz: A, body: { wallet_id: wallet, file_name: 'big.csv', file_type: 'csv', currency: 'IDR', rows: rows(4) } });
  assert.equal(big.status, 402, JSON.stringify(big.body)); assert.equal(big.body.resource, 'bank_rows');
  const small = await api.call('/bank-import/batches', { method: 'POST', user: OA, biz: A, body: { wallet_id: wallet, file_name: 'small.csv', file_type: 'csv', currency: 'IDR', rows: rows(2) } });
  assert.equal(small.status, 200, JSON.stringify(small.body));
  const usage = (await admin.query('SELECT public.billing_usage($1) u', [A])).rows[0].u;
  assert.equal(usage.accounts, 2); assert.equal(usage.bank_rows, 2);
});
test('plan change during the trial: Control applies at once, the trial end does not move', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const cv = (await draftOf('control')).v;
  assert.equal((await publish('control', { features: { ...FEATURES, payroll: true, approvals: true }, limits: { ...cv.limits, ...PENDING_TEST, accounts: 10 } })).status, 200);
  const end0 = (await admin.query('SELECT trial_ends_at FROM public.billing_accounts WHERE business_id=$1', [A])).rows[0].trial_ends_at;
  const s = (await api.call('/billing', { user: OA, biz: A })).body, control = s.account.catalog.find((p) => p.plan === 'control');
  const sel = await api.call('/billing/plan', { method: 'POST', user: OA, biz: A, body: { request_key: key(), plan_version_id: control.id, expected_version: Number(s.account.version) } });
  assert.equal(sel.status, 200, JSON.stringify(sel.body));
  assert.equal((await terms(A)).plan, 'control'); assert.equal((await terms(A)).limits.accounts, 10);
  assert.equal(String((await admin.query('SELECT trial_ends_at FROM public.billing_accounts WHERE business_id=$1', [A])).rows[0].trial_ends_at), String(end0));
  const w = await api.call('/wallets', { method: 'POST', user: OA, biz: A, body: { request_key: key(), name: 'After upgrade', currency: 'IDR' } });
  assert.equal(w.status, 200, 'the higher limit applies at once');
});
test('concurrent publications of one plan: exactly one wins (catalog version CAS), every publication audited with before and after', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const h = await head('pro'), pv = (await draftOf('pro')).v;
  const body = (users) => ({ request_key: key(), expected_version: Number(h.catalog_version), terms: { action: 'publish', confirm_publish: true, publish: true,
    ...termsFrom(pv, { features: { ...FEATURES, payroll: true, approvals: true, integrations: true }, limits: { ...pv.limits, ...PENDING_TEST, users } }) } });
  const rs = await Promise.all([15, 16, 17].map((u) => api.call('/admin/billing/catalog/pro', { method: 'POST', user: SUPER, body: body(u) })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status + ':' + (r.body.error || '')).join(','));
  const last = (await admin.query("SELECT actor_user_id, result FROM public.billing_admin_commands WHERE action='catalog' ORDER BY created_at DESC LIMIT 1")).rows[0];
  assert.equal(Number(last.actor_user_id), SUPER); assert.ok(last.result.previous && last.result.terms, 'old and new terms recorded');
});
