'use strict';
// COMMERCIAL_BILLING_ENABLED=false = "billing paused" for commercial_v2 companies (V2_DYNAMIC_PLAN_MATRIX.md §6):
// no legacy Free limits, plan features still apply, no quota counting, no expiry restriction, costly external
// features refused; legacy companies keep today's legacy behaviour. Data is prepared through the same SQL RPCs the
// API uses (the admin catalog routes are 404 while the flag is OFF). Numbers are TEST values only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { CHAIN, D4, startServer, openAdmin } = require('./_d4Harness');

const MIGRATIONS = ['20261015033808_cfo_commercial_trial.sql', '20261017090000_billing_management_center.sql', '20261017120000_billing_enforcement.sql', '20261018090000_billing_plan_matrix.sql'];
const SUPER = 9700, OWNER = 1701, EXPIRED_OWNER = 1702, LEGACY_OWNER = 1703, NOPLAN_OWNER = 1704;
let db, admin, api, C, X, L, N;
const key = () => crypto.randomUUID();
const CATS = [{ name: 'Sales', group_type: 'income', activity_type: 'operating', sort_order: 0 }];

before(async () => {
  db = await createProdSchemaDatabase('billing_paused', [...CHAIN, D4]);
  if (!db) return;
  admin = await openAdmin(db.connectionString);
  for (const m of ['072_platform_admins.sql', '073_platform_admins_security.sql']) await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', m), 'utf8'));
  for (const m of MIGRATIONS) await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', m), 'utf8'));
  await admin.query("INSERT INTO public.plan_limits(plan, max_wallets, max_transactions_per_month) VALUES ('free', 1, 30),('business',20,2000),('founder',100,10000),('enterprise',null,null) ON CONFLICT (plan) DO UPDATE SET max_wallets=EXCLUDED.max_wallets, max_transactions_per_month=EXCLUDED.max_transactions_per_month");
  for (const u of [SUPER, OWNER, EXPIRED_OWNER, LEGACY_OWNER, NOPLAN_OWNER]) {
    await admin.query('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
    await admin.query('INSERT INTO public.user_email_identities (user_id, email, email_verified_at) VALUES ($1, $2, now())', [u, `paused${u}@test.local`]);
  }
  await admin.query("INSERT INTO public.platform_admins (user_id, role, is_active, created_by) VALUES ($1, 'super_admin', true, $1)", [SUPER]);
  // Publish a Starter TEST version through the catalog RPC (payroll not included; AI included).
  const h = (await admin.query("SELECT catalog_version, current_version_id FROM public.plan_limits WHERE plan='starter'")).rows[0];
  const v = (await admin.query('SELECT * FROM public.plan_versions WHERE id=$1', [h.current_version_id])).rows[0];
  const terms = { action: 'publish', confirm_publish: true, publish: true, name_i18n: v.name_i18n, description_i18n: v.description_i18n, price_minor: Number(v.price_minor),
    currency: v.currency, trial_hours: 168, terms_version: 'test-paused', effective_at: new Date(Date.now() - 60000).toISOString(), approval_status: 'approved',
    features: { documents: true, ai: true, import: true, payroll: false, team: true, approvals: false, export: true, integrations: false, cfo_ai: true },
    limits: { users: 2, companies: 1, documents: 100, ai: 50, imports: 5, transactions: 1000, storage_mb: null, integrations: 0, accounts: 1, bank_rows: 100, mcp: 0, ai_accountant: 0, ai_extraction: 10 } };
  const pub = (await admin.query('SELECT public.rpc_billing_catalog_command($1,$2,$3,$4,$5) r', [SUPER, key(), 'starter', Number(h.catalog_version), terms])).rows[0].r;
  const version = pub.terms.id;
  const mk = async (owner, name, commercial = true) => (await admin.query(`SELECT public.${commercial ? 'rpc_create_business_commercial_once' : 'rpc_create_business_once'}($1,$2,$3,$4) r`,
    [owner, key(), { name, base_currency: 'IDR', country: 'Indonesia', timezone: 'Asia/Jakarta' }, JSON.stringify(CATS)])).rows[0].r.business.id;
  const startTrial = async (owner, biz) => {
    let acct = (await admin.query('SELECT version FROM public.billing_accounts WHERE business_id=$1', [biz])).rows[0];
    await admin.query('SELECT public.rpc_billing_trial_command($1,$2,$3,$4,$5,$6,false)', [owner, biz, key(), 'select_plan', version, Number(acct.version)]);
    acct = (await admin.query('SELECT version FROM public.billing_accounts WHERE business_id=$1', [biz])).rows[0];
    await admin.query('SELECT public.rpc_billing_trial_command($1,$2,$3,$4,$5,$6,false)', [owner, biz, key(), 'activate_trial', version, Number(acct.version)]);
  };
  C = await mk(OWNER, 'Paused Starter'); await startTrial(OWNER, C);
  X = await mk(EXPIRED_OWNER, 'Paused Expired'); await startTrial(EXPIRED_OWNER, X);
  await admin.query('ALTER TABLE public.billing_accounts DISABLE TRIGGER USER');
  await admin.query("UPDATE public.billing_accounts SET trial_started_at=now()-interval '200 hours', trial_ends_at=now()-interval '32 hours' WHERE business_id=$1", [X]);
  await admin.query('ALTER TABLE public.billing_accounts ENABLE TRIGGER USER');
  N = await mk(NOPLAN_OWNER, 'Paused No Plan');
  L = await mk(LEGACY_OWNER, 'Legacy Company', false);
  // A legacy company on the legacy free plan (no legacy trial, no subscription): the legacy limits decide.
  await admin.query("UPDATE public.businesses SET trial_ends_at=now()-interval '1 day', plan='free', subscription_status='inactive' WHERE id=$1", [L]);
  Object.assign(process.env, { COMMERCIAL_BILLING_ENABLED: 'false' });
  delete process.env.ADMIN_TELEGRAM_IDS; delete process.env.COMMERCIAL_BILLING_FIXTURES;
  api = await startServer(db.connectionString);
});
after(async () => { await api?.stop(); await admin?.end(); await db?.drop?.(); });
const skip = () => !db;
const wallet = (user, biz, name) => api.call('/wallets', { method: 'POST', user, biz, body: { request_key: key(), name, currency: 'IDR', opening_balance: 1000, opening_balance_date: '2026-09-30' } });

test('paused: billing routes are not exposed; companies keep their policy', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  assert.equal((await api.call('/billing', { user: OWNER, biz: C })).status, 404);
  assert.equal((await admin.query('SELECT billing_policy FROM public.businesses WHERE id=$1', [C])).rows[0].billing_policy, 'commercial_v2');
  assert.notEqual((await admin.query('SELECT billing_policy FROM public.businesses WHERE id=$1', [L])).rows[0].billing_policy, 'commercial_v2');
});
test('paused: a commercial company is never cut to the legacy Free limits and no quota is counted', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const rs = []; for (let i = 0; i < 3; i++) rs.push(await wallet(OWNER, C, 'Paused acc ' + i));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200], JSON.stringify(rs.map((r) => r.body)));
  const tx = await api.call('/transactions/batch', { method: 'POST', user: OWNER, biz: C, body: { request_key: key(), transactions: Array.from({ length: 40 }, (_, i) => ({ type: 'income', amount: 10 + i, currency: 'IDR', scope: 'business', wallet_id: rs[0].body.wallet.id, description: 'paused ' + i })) } });
  assert.equal(tx.status, 200, JSON.stringify(tx.body));
  assert.equal(Number((await admin.query('SELECT count(*) n FROM public.billing_quota_reservations WHERE business_id=$1', [C])).rows[0].n), 0, 'nothing metered while paused');
});
test('paused: plan features still apply (payroll not in the plan → 402), costly external features are refused (503)', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const p = await api.call('/payroll/employees', { method: 'POST', user: OWNER, biz: C, body: { name: 'Employee', monthly_salary: 1000 } });
  assert.equal(p.status, 402, JSON.stringify(p.body)); assert.equal(p.body.error, 'billing_feature_denied');
  const ai = await api.call('/ai-cfo/ask', { method: 'POST', user: OWNER, biz: C, headers: { 'Idempotency-Key': key() }, body: { question: 'cash?' } });
  assert.equal(ai.status, 503, JSON.stringify(ai.body)); assert.equal(ai.body.error, 'billing_paused');
});
test('paused: an expired trial does not block work; a company without a plan keeps the core financial features', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  assert.equal((await wallet(EXPIRED_OWNER, X, 'Expired acc')).status, 200);
  assert.equal((await wallet(NOPLAN_OWNER, N, 'No plan acc')).status, 200);
  const p = await api.call('/payroll/employees', { method: 'POST', user: NOPLAN_OWNER, biz: N, body: { name: 'E', monthly_salary: 1 } });
  assert.equal(p.status, 402, 'no plan chosen: core only, no paid modules');
});
test('paused: legacy companies keep exactly the legacy behaviour (legacy Free wallet limit still applies)', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  assert.equal((await wallet(LEGACY_OWNER, L, 'Legacy 1')).status, 200);
  const second = await wallet(LEGACY_OWNER, L, 'Legacy 2');
  assert.equal(second.status, 403, JSON.stringify(second.body)); assert.equal(second.body.feature, 'wallets');
});
test('paused: tenant isolation unchanged', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  for (const p of ['/transactions?period=all', '/wallets']) assert.ok([403, 404].includes((await api.call(p, { user: OWNER, biz: L })).status), p);
  assert.ok([403, 404].includes((await wallet(OWNER, X, 'cross')).status));
});
