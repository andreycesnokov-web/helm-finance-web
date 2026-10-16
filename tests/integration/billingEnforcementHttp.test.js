'use strict';
// Billing enforcement over real PostgreSQL and the real Express server (Business + Platform admin).
// Disposable database: production schema snapshot + release chain + D4 + commercial trial + billing center +
// billing enforcement. Plan terms are TEST VALUES ONLY. The verified paid period below is a database
// fixture for the expiry check (no payment code exists or runs).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { createRealPgSupabase } = require('./_realPgSupabase');
const { CHAIN, D4, seeder, startServer, openAdmin } = require('./_d4Harness');

const MIGRATIONS = ['20261015033808_cfo_commercial_trial.sql', '20261017090000_billing_management_center.sql', '20261017120000_billing_enforcement.sql'];
const ADMIN = 9200, OA = 1301, OB = 1302, OC = 1303, OD = 1304, OL = 1305;
const ALL_OFF = { documents: true, ai: false, import: true, payroll: false, team: false, approvals: false, export: true, integrations: false,
  pulse: true, radar: false, transactions: true, accounts: true, bills: false, cfo_ai: false, ai_accountant: false, tax_compliance: false, accounting_export: false, api: false };
const ALL_ON = Object.fromEntries(Object.keys(ALL_OFF).map(k => [k, true]));
let db, admin, api, seed, supa, billing;
const key = () => crypto.randomUUID();

before(async () => {
  db = await createProdSchemaDatabase('billing_enf', [...CHAIN, D4]);
  if (!db) return;
  admin = await openAdmin(db.connectionString);
  // Platform admin is database-backed RBAC (072 + 073): an email session with an active platform_admins row.
  await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '072_platform_admins.sql'), 'utf8'));
  await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '073_platform_admins_security.sql'), 'utf8'));
  for (const m of MIGRATIONS) await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', m), 'utf8'));
  await admin.query("INSERT INTO public.plan_limits(plan) VALUES ('free'),('business'),('founder'),('enterprise') ON CONFLICT DO NOTHING");
  seed = seeder(admin);
  for (const u of [ADMIN, OA, OB, OC, OD, OL]) {
    await admin.query('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
    await admin.query('INSERT INTO public.user_email_identities (user_id, email, email_verified_at) VALUES ($1, $2, now())', [u, `enf${u}@test.local`]);
  }
  await admin.query("INSERT INTO public.platform_admins (user_id, role, is_active, created_by) VALUES ($1, 'super_admin', true, $1)", [ADMIN]);
  Object.assign(process.env, { COMMERCIAL_BILLING_ENABLED: 'true' });
  delete process.env.ADMIN_TELEGRAM_IDS;   // deprecated: never an admin grant
  delete process.env.COMMERCIAL_BILLING_FIXTURES;
  api = await startServer(db.connectionString);
  supa = createRealPgSupabase(db.connectionString);
  billing = require('../../server/lib/commercialBilling');
});
after(async () => { await api?.stop(); try { await supa?.pool?.end() } catch { /* */ } await admin?.end(); await db?.drop?.(); });
const skip = () => !db;

const terms = (name, features, limits, extra = {}) => ({ action: 'publish', confirm_publish: true, publish: true, name_i18n: { en: name, ru: name, id: name },
  description_i18n: { en: 't', ru: 't', id: 't' }, price_minor: 1000, currency: 'USD', features, limits, terms_version: 'test-only',
  effective_at: new Date(Date.now() - 60000).toISOString(), approval_status: 'approved', ...extra });
async function publish(code, t) {
  const cat = (await api.call('/admin/billing/catalog', { user: ADMIN })).body, head = cat.plans.find(p => p.plan === code);
  const r = await api.call('/admin/billing/catalog/' + code, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(head?.catalog_version ?? 0), terms: t } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.terms;
}
async function company(owner, name, plan) {
  const r = await api.call('/businesses', { method: 'POST', user: owner, body: { name, request_key: key(), country: 'Indonesia', timezone: 'Asia/Jakarta' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const biz = r.body.business.id, s = (await api.call('/billing', { user: owner, biz })).body, v = s.account.catalog.find(p => p.plan === plan);
  const sel = await api.call('/billing/plan', { method: 'POST', user: owner, biz, body: { request_key: key(), plan_version_id: v.id, expected_version: Number(s.account.version) } });
  const tr = await api.call('/billing/trial', { method: 'POST', user: owner, biz, body: { request_key: key(), plan_version_id: v.id, expected_version: Number(sel.body.version) } });
  assert.equal(tr.status, 200, JSON.stringify(tr.body)); return biz;
}
const call = (user, biz, p, method = 'GET', body) => api.call(p, { method, user, biz, body });
const batch = (user, biz, n, k = key(), type = 'expense') => call(user, biz, '/transactions/batch', 'POST',
  { request_key: k, transactions: Array.from({ length: n }, (_, i) => ({ type, amount: 1000 + i, scope: 'business', description: 'enf ' + i })) });
const usage = async (biz) => (await admin.query('SELECT public.billing_usage($1) u', [biz])).rows[0].u;
const denied = (r, code = 'billing_feature_denied') => { assert.equal(r.status, 402, JSON.stringify(r.body)); assert.equal(r.body.error, code); assert.equal(r.body.billing_url, '/business/billing'); };
const notBilling = (r, what) => assert.ok(r.status !== 402 && !String(r.body?.error || '').startsWith('billing_'), `${what}: ${r.status} ${JSON.stringify(r.body)}`);
const fakeId = '00000000-0000-4000-8000-000000000001';

let A, B, PRO;
test('1-2. the plan allows or denies each module on the server, including AI and advanced reads', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await publish('basic', terms('Basic', ALL_OFF, { users: 2, companies: 1, documents: 2, ai: 0, imports: 5, transactions: 3, storage_mb: 1, integrations: 0 }));
  PRO = await publish('pro_full', terms('Pro', ALL_ON, { users: 5, companies: 1, documents: 50, ai: 10, imports: 5, transactions: 2, storage_mb: 50, integrations: 1 },
    { limit_policies: { transactions: 'soft' } }));
  A = await company(OA, 'Enf A', 'basic'); B = await company(OB, 'Enf B', 'pro_full');
  // Denied by the Basic plan, allowed by Pro (the route itself may then answer anything except a billing refusal).
  for (const [p, m, feature] of [['/debts', 'POST', 'bills'], ['/ai-cfo/context', 'GET', 'cfo_ai'], ['/tax-split/suggest', 'POST', 'tax_compliance'],
    ['/accountant/tax-knowledge/cards', 'GET', 'tax_compliance'], ['/pulse/advanced-insights', 'GET', 'radar'], ['/accountant/operation-documents/action', 'POST', 'accounting_export'],
    ['/payment-connections', 'POST', 'integrations'], ['/ai-accountant/document-intake', 'GET', 'ai_accountant']]) {
    const a = await call(OA, A, p, m, m === 'GET' ? undefined : {});
    denied(a); assert.equal(a.body.feature, feature, p);
    notBilling(await call(OB, B, p, m, m === 'GET' ? undefined : { request_key: key() }), 'Pro ' + p);
  }
  // Basic views and own data stay open on the Basic plan.
  for (const p of ['/pulse', '/accountant/obligations', '/accountant/tax-calendar', '/accountant/operation-documents/package', '/transactions', '/wallets', '/debts'])
    notBilling(await call(OA, A, p), 'Basic read ' + p);
  const ok = await batch(OA, A, 1);
  assert.ok(ok.status < 300, JSON.stringify(ok.body));
  assert.equal((await usage(A)).transactions, 1);
});

test('3. direct API bypass attempts are refused (aliases, sub-routes, MCP)', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  for (const [p, m] of [[`/debts/${fakeId}/approve`, 'PATCH'], [`/debts/${fakeId}/pay`, 'POST'], [`/decisions/debts/${fakeId}/payment`, 'POST'],
    [`/invoices/${fakeId}/allocate`, 'POST'], ['/ai-accountant/documents/classify', 'POST'], ['/parse', 'POST'], ['/ai-cfo/ask', 'POST'], ['/accountant/ask', 'POST'],
    [`/payment-connections/${fakeId}`, 'PATCH'], ['/incoming-payments/gateway-import', 'POST'], [`/documents/${fakeId}/tax-obligation`, 'POST']])
    assert.equal((await call(OA, A, p, m, { request_key: key() })).status, 402, `${m} ${p}`);
  // MCP / external API: Basic has no 'api' → reads and writes refused; Pro reads; AI tool counted only on success.
  const bizA = { business: { id: A, billing_policy: 'commercial_v2' } }, bizB = { business: { id: B, billing_policy: 'commercial_v2' } };
  assert.equal((await billing.mcpGate(supa, OA, bizA, 'get_company_context')).error, 'billing_feature_denied');
  assert.equal((await billing.mcpGate(supa, OA, bizA, 'list_documents')).error, 'billing_feature_denied');
  assert.equal((await billing.mcpGate(supa, OB, bizB, 'unknown_tool')).error, 'billing_feature_denied');
  const g = await billing.mcpGate(supa, OB, bizB, 'list_documents'); assert.equal(g.error, undefined);
  const before = (await usage(B)).ai || 0;
  const failed = await billing.mcpGate(supa, OB, bizB, 'analyze_invoice'); await failed.settle(false);
  assert.equal((await usage(B)).ai || 0, before, 'a failed AI tool call is not counted');
  const okCall = await billing.mcpGate(supa, OB, bizB, 'analyze_invoice'); await okCall.settle(true);
  assert.equal((await usage(B)).ai, before + 1);
});

test('9, 11, 12. transactions: hard limit, failed request returns the quota, retry with the same key is free, races', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const k = key();
  const first = await batch(OA, A, 2, k); assert.ok(first.status < 300, JSON.stringify(first.body));
  assert.equal((await usage(A)).transactions, 3);
  const replay = await batch(OA, A, 2, k); assert.ok(replay.status < 300, 'replay returns the stored result: ' + JSON.stringify(replay.body));
  assert.equal((await usage(A)).transactions, 3, 'the replay consumed nothing');
  denied(await batch(OA, A, 1), 'billing_quota_reached');
  // Concurrency on a fresh Basic company: 6 parallel one-row batches, limit 3 → exactly 3 admitted.
  const D = await company(OD, 'Enf D', 'basic');
  const bad = await call(OD, D, '/transactions/batch', 'POST', { request_key: key(), transactions: [{ type: 'not-a-type', amount: 1, scope: 'business' }] });
  assert.ok(bad.status >= 400 && bad.status < 500 && bad.status !== 402, 'invalid request: ' + bad.status);
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await usage(D)).transactions || 0, 0, 'a failed request returns its reservation');
  const res = await Promise.all(Array.from({ length: 6 }, () => batch(OD, D, 1)));
  assert.equal(res.filter(r => r.status < 300).length, 3, JSON.stringify(res.map(r => r.status)));
  assert.equal(res.filter(r => r.status === 402 && r.body.error === 'billing_quota_reached').length, 3);
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await usage(D)).transactions, 3);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM public.transactions WHERE business_id=$1 AND description LIKE 'enf %'`, [D])).rows[0].n, 3);
});

test('10, 13. soft limit allows and warns; the period is the UTC calendar month', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  for (let i = 0; i < 2; i++) assert.ok((await batch(OB, B, 1)).status < 300);
  const third = await batch(OB, B, 1);
  assert.ok(third.status < 300, JSON.stringify(third.body));
  // The harness reads JSON only; check the warning through the reservation result instead of the header.
  const r = (await admin.query(`SELECT public.rpc_billing_quota($1,$2,$3,'transactions','reserve',1) r`, [OB, B, key()])).rows[0].r;
  assert.equal(r.over_limit, true); assert.equal(r.policy, 'soft');
  // Last month's usage does not count in this period.
  const lastMonth = (await admin.query(`SELECT (date_trunc('month',now() AT TIME ZONE 'UTC') - interval '1 month')::date d`)).rows[0].d;
  await admin.query(`INSERT INTO public.billing_quota_reservations(business_id,request_key,actor_user_id,resource,units,period_start,plan_version_id,state)
    VALUES($1,$2,$3,'transactions',500,$4,$5,'committed')`, [A, key(), OA, lastMonth, (await admin.query(`SELECT plan_version_id FROM public.billing_quota_reservations WHERE business_id=$1 LIMIT 1`, [A])).rows[0].plan_version_id]);
  assert.equal((await usage(A)).transactions, 3, 'only the current UTC month is counted');
});

test('storage and integrations are counted from real rows plus requests in flight', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const init = (user, biz, size) => call(user, biz, '/documents/upload-init', 'POST', { file_name: 'a.pdf', mime_type: 'application/pdf', file_size: size, document_type: 'invoice', sha256: 'b'.repeat(64) });
  denied(await init(OA, A, 2 * 1048576), 'billing_quota_reached');               // 2 MB > 1 MB plan storage
  notBilling(await init(OA, A, 512 * 1024), 'small upload passes admission');     // route may still refuse (storage not configured)
  await new Promise(r => setTimeout(r, 300));
  await admin.query(`INSERT INTO public.document_files(business_id,storage_path,sha256_hash,file_size) VALUES($1,'t/x.pdf',$2,1048576)`, [A, 'c'.repeat(64)]);
  assert.equal((await usage(A)).storage_mb, 1);
  denied(await init(OA, A, 1000), 'billing_quota_reached');
  await admin.query(`INSERT INTO public.payment_provider_connections(business_id,provider,status) VALUES($1,'xendit','connected')`, [B]);
  assert.equal((await usage(B)).integrations, 1);
  denied(await call(OB, B, '/payment-connections', 'POST', {}), 'billing_quota_reached');
});

test('4-7. trial expiry, paid period expiry, admin grant and customer override; own data stays available', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const C = await company(OC, 'Enf C', 'pro_full');
  await admin.query(`UPDATE public.billing_accounts SET trial_started_at=trial_started_at-interval '200 hours', trial_ends_at=trial_ends_at-interval '200 hours' WHERE business_id=$1`, [C]);
  denied(await batch(OC, C, 1), 'billing_restricted');
  denied(await call(OC, C, '/ai-cfo/context'), 'billing_restricted');
  for (const p of ['/transactions', '/wallets', '/debts', '/documents', '/pulse', '/accountant/obligations', '/accountant/operation-documents/package', '/financial-operations/recent', '/billing'])
    notBilling(await call(OC, C, p), 'after expiry ' + p);
  notBilling(await call(OC, C, `/documents/${fakeId}/signed-url`, 'POST', {}), 'download after expiry');
  // A verified paid period (database fixture) restores access; when it ends, access ends again.
  await admin.query(`INSERT INTO public.billing_service_periods(business_id,plan_version_id,payment_id,payment_verified,environment,starts_at,ends_at)
    VALUES($1,$2,'test-verified-period',true,'sandbox',now()-interval '1 day',now()+interval '1 day')`, [C, PRO.id]);
  assert.ok((await batch(OC, C, 1)).status < 300);
  assert.equal((await call(OC, C, '/billing')).body.access.subscription_status, 'active');
  await admin.query(`UPDATE public.billing_service_periods SET ends_at=now()-interval '1 minute' WHERE business_id=$1`, [C]);
  denied(await batch(OC, C, 1), 'billing_restricted');
  // Admin grant opens access; revoking it closes access.
  const d = (await api.call('/admin/billing/companies/' + C, { user: ADMIN })).body;
  assert.equal((await api.call(`/admin/billing/companies/${C}/grant`, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(d.account.version),
    payload: { plan_version_id: PRO.id, ends_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Support grant for test' } } })).status, 200);
  assert.ok((await batch(OC, C, 1)).status < 300);
  // Customer override: Basic company A gets bills and more transactions.
  const da = (await api.call('/admin/billing/companies/' + A, { user: ADMIN })).body;
  assert.equal((await api.call(`/admin/billing/companies/${A}/override`, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(da.account.version),
    payload: { kind: 'feature', key: 'bills', value: true, reason: 'Bills for this client' } } })).status, 200);
  notBilling(await call(OA, A, '/debts', 'POST', { request_key: key() }), 'override enables bills');
  const da2 = (await api.call('/admin/billing/companies/' + A, { user: ADMIN })).body;
  const lim = da2.limits.find(l => l.key === 'transactions');
  assert.deepEqual([lim.base, lim.effective, lim.used, lim.enforcement], [3, 3, 3, 'server']);
  assert.equal((await api.call(`/admin/billing/companies/${A}/override`, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(da2.account.version),
    payload: { kind: 'limit', key: 'transactions', value: 10, reason: 'More operations for this client' } } })).status, 200);
  assert.ok((await batch(OA, A, 1)).status < 300, 'override raises the limit');
  const da3 = (await api.call('/admin/billing/companies/' + A, { user: ADMIN })).body.limits.find(l => l.key === 'transactions');
  assert.deepEqual([da3.base, da3.individual, da3.effective, da3.used], [3, 10, 10, 4]);
});

test('8. tenant isolation: the same user gets each company\'s own plan; non-members get nothing', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await seed.member(B, OA, 'admin');
  denied(await call(OA, A, '/ai-cfo/context'));
  notBilling(await call(OA, B, '/ai-cfo/context'), 'same user in the Pro company');
  const x = await call(OD, A, '/transactions');
  assert.ok([403, 404].includes(x.status), 'non-member: ' + x.status);
  // Legacy companies keep their policy: no commercial admission at all.
  const L = await seed.company({ owner: OL, name: 'Enf Legacy' });
  notBilling(await call(OL, L, '/debts', 'POST', {}), 'legacy company');
  notBilling(await call(OL, L, '/ai-cfo/context'), 'legacy company AI');
});

test('migration down is fail-closed while usage of the new resources exists', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const down = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261017120000_billing_enforcement_down.sql'), 'utf8');
  await assert.rejects(admin.query(down), /billing_enforcement_down_not_confirmed/); await admin.query('ROLLBACK').catch(() => {});
  await admin.query("SET cfo.confirm_down = '20261017120000'");
  await assert.rejects(admin.query(down), /billing_enforcement_down_would_lose_usage/); await admin.query('ROLLBACK').catch(() => {});
  await admin.query('RESET cfo.confirm_down');
});
