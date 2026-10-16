'use strict';
// Commercial Billing Phase 1 over real PostgreSQL and the real Express server (Business + Platform/admin).
// Disposable database: production schema snapshot + release chain + commercial trial migration + D4.
// The plan TERMS published below are TEST VALUES ONLY, not the owner's commercial limits: the repository
// ships the three plans as drafts with empty features/limits, and terms are published via the admin catalog.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { CHAIN, D4, seeder, startServer, openAdmin } = require('./_d4Harness');

const fs = require('node:fs');
const path = require('node:path');
const COMMERCIAL = '20261015033808_cfo_commercial_trial.sql', CENTER = '20261017090000_billing_management_center.sql';
const ADMIN = 9000, OWNER = 1001, UNVERIFIED = 1002, ACCOUNTANT = 1003, OTHER = 2001, RACER = 3001;
const H168 = 168 * 3600 * 1000;
const TEST_TERMS = {
  starter: { price: 5900, features: { documents: true, ai: true, import: true, payroll: false, team: false, approvals: false, export: true, integrations: false }, limits: { users: 1, companies: 1, documents: 2, ai: 50, imports: 5 } },
  control: { price: 14900, features: { documents: true, ai: true, import: true, payroll: true, team: true, approvals: true, export: true, integrations: false }, limits: { users: 5, companies: 1, documents: 500, ai: 500, imports: 50 } },
  pro: { price: 29900, features: { documents: true, ai: true, import: true, payroll: true, team: true, approvals: true, export: true, integrations: true }, limits: { users: null, companies: 3, documents: null, ai: 2000, imports: null } },
};
let db, admin, api, seed;
const key = () => crypto.randomUUID();

before(async () => {
  db = await createProdSchemaDatabase('billing_p1', [...CHAIN, D4]);
  if (!db) return;
  admin = await openAdmin(db.connectionString);
  // The commercial migration uses unqualified names (as applied on staging); the snapshot loader's session has
  // pg_dump's empty search_path, so apply it on a fresh session with the default search_path, like Supabase does.
  const m072 = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '072_platform_admins.sql'), 'utf8');
  await admin.query(m072);
  await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '073_platform_admins_security.sql'), 'utf8'));
  await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', COMMERCIAL), 'utf8'));
  await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', CENTER), 'utf8'));
  await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261017120000_billing_enforcement.sql'), 'utf8'));
  seed = seeder(admin);
  for (const u of [ADMIN, OWNER, UNVERIFIED, ACCOUNTANT, OTHER, RACER]) await admin.query('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
  for (const u of [ADMIN, OWNER, ACCOUNTANT, OTHER, RACER]) await admin.query(`INSERT INTO public.user_email_identities (user_id, email, email_verified_at) VALUES ($1, $2, now())`, [u, `u${u}@test.local`]);
  await admin.query(`INSERT INTO public.user_email_identities (user_id, email) VALUES ($1, 'unverified@test.local')`, [UNVERIFIED]);
  await admin.query("INSERT INTO public.platform_admins (user_id, role, is_active, created_by) VALUES ($1, 'super_admin', true, $1) ON CONFLICT (user_id) DO UPDATE SET is_active = true, role = 'super_admin'", [ADMIN]);
  Object.assign(process.env, { COMMERCIAL_BILLING_ENABLED: 'true' });
  delete process.env.COMMERCIAL_BILLING_FIXTURES;
  api = await startServer(db.connectionString);
});
after(async () => { await api?.stop(); await admin?.end(); await db?.drop?.(); });

const skip = () => !db;
async function createCommercialCompany(owner, name) {
  const r = await api.call('/businesses', { method: 'POST', user: owner, body: { name, request_key: key(), country: 'Indonesia', timezone: 'Asia/Jakarta' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.business.id;
}
const billing = (user, biz) => api.call('/billing', { user, biz });
const command = (user, biz, path, body) => api.call('/billing/' + path, { method: 'POST', user, biz, body });
async function publishTestTerms() {
  const cat = await api.call('/admin/billing/catalog', { user: ADMIN });
  assert.equal(cat.status, 200);
  for (const [code, t] of Object.entries(TEST_TERMS)) {
    const p = cat.body.plans.find(x => x.plan === code);
    const r = await api.call('/admin/billing/catalog/' + code, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(p.catalog_version), terms: {
      action: 'version', name_i18n: { en: code, ru: code, id: code }, description_i18n: { en: 'test', ru: 'тест', id: 'uji' }, price_minor: t.price, currency: 'USD',
      features: t.features, limits: t.limits, terms_version: 'test-only-v1', effective_at: new Date(Date.now() - 60000).toISOString(), approval_status: 'approved', publish: true, confirm_publish: true } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
}
async function startTrial(owner, biz, code) {
  const s = await billing(owner, biz);
  const plan = s.body.account.catalog.find(p => p.plan === code);
  const sel = await command(owner, biz, 'plan', { request_key: key(), plan_version_id: plan.id, expected_version: Number(s.body.account.version) });
  assert.equal(sel.status, 200, JSON.stringify(sel.body));
  const tr = await command(owner, biz, 'trial', { request_key: key(), plan_version_id: plan.id, expected_version: Number(sel.body.version) });
  assert.equal(tr.status, 200, JSON.stringify(tr.body));
  return { plan, trial: tr.body };
}
const age = (biz, hours) => admin.query(`UPDATE public.billing_accounts SET trial_started_at=trial_started_at-make_interval(hours=>$2), trial_ends_at=trial_ends_at-make_interval(hours=>$2) WHERE business_id=$1`, [biz, hours]);

let A; // the main commercial company
test('enrollment: V2 companies are commercial, existing ones stay legacy; draft plans cannot be chosen', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  A = await createCommercialCompany(OWNER, 'Billing Co A');
  const s = await billing(OWNER, A);
  assert.equal(s.status, 200);
  assert.equal(s.body.policy, 'commercial_v2');
  assert.equal(s.body.access.restricted, true, 'no trial yet → restricted, never silently free access');
  assert.equal(s.body.access.subscription_status, 'not_started');
  assert.deepEqual(s.body.account.catalog, [], 'shipped drafts (empty terms) are not offered');
  assert.equal(s.body.payments_available, false);
  const drafts = (await admin.query(`SELECT v.id FROM public.plan_versions v WHERE v.approval_status='draft'`)).rows;
  assert.equal(drafts.length, 3);
  const r = await command(OWNER, A, 'plan', { request_key: key(), plan_version_id: drafts[0].id, expected_version: 1 });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'billing_plan_not_approved');
  const legacy = await seed.company({ owner: OTHER, name: 'Legacy Co' });
  const l = await billing(OTHER, legacy);
  assert.equal(l.body.policy, 'legacy'); assert.equal(l.body.account, null);
  const lt = await command(OTHER, legacy, 'trial', { request_key: key(), plan_version_id: drafts[0].id, expected_version: 1 });
  assert.equal(lt.status, 409); assert.equal(lt.body.error, 'billing_account_not_enrolled');
  // Catalog administration is platform-only.
  assert.equal((await api.call('/admin/billing/catalog', { user: OWNER })).status, 403);
  // Draft prices match the preliminary catalogue: Starter $59, Control $149, Pro $299.
  const prices = (await admin.query(`SELECT plan, price_minor, currency FROM public.plan_versions ORDER BY price_minor`)).rows;
  assert.deepEqual(prices.map(p => [p.plan, Number(p.price_minor), p.currency]), [['starter', 5900, 'USD'], ['control', 14900, 'USD'], ['pro', 29900, 'USD']]);
});

test('catalog: three published plans, sorted by price; trial is exactly 168 hours and grants the selected plan', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await publishTestTerms();
  const s = await billing(OWNER, A);
  assert.deepEqual(s.body.account.catalog.map(p => [p.plan, Number(p.price_minor)]), [['starter', 5900], ['control', 14900], ['pro', 29900]]);
  const { trial } = await startTrial(OWNER, A, 'control');
  assert.equal(trial.already_started, false);
  const row = (await admin.query(`SELECT extract(epoch FROM trial_ends_at-trial_started_at)::numeric AS d FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0];
  assert.equal(Number(row.d), 168 * 3600, 'exactly 168h to the microsecond');
  const a = (await billing(OWNER, A)).body.access;
  assert.equal(a.restricted, false); assert.equal(a.subscription_status, 'trialing'); assert.equal(a.effective_access_source, 'trial');
  assert.equal(a.effective_plan, 'control'); assert.equal(a.features.payroll, true); assert.equal(a.subscription_active, false, 'trial is never paid access');
  assert.ok(a.trial_seconds_remaining > H168 / 1000 - 120 && a.trial_seconds_remaining <= H168 / 1000);
});

test('trial once: replays, conflicting replays, a second activation and stale writes never restart or extend it', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const before = (await admin.query(`SELECT trial_started_at, trial_ends_at, version FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0];
  const s = (await billing(OWNER, A)).body;
  const body = { request_key: key(), plan_version_id: s.account.selected_plan_version_id, expected_version: Number(s.account.version) };
  const first = await command(OWNER, A, 'trial', body);
  assert.equal(first.body.already_started, true);
  const replay = await command(OWNER, A, 'trial', body);
  assert.equal(replay.body.is_replay, true); assert.equal(replay.body.trial_ends_at, first.body.trial_ends_at);
  const conflict = await command(OWNER, A, 'trial', { ...body, expected_version: body.expected_version + 7 });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'billing_command_conflict');
  const stale = await command(OWNER, A, 'plan', { request_key: key(), plan_version_id: s.account.selected_plan_version_id, expected_version: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'billing_stale');
  for (const f of ['trial_ends_at', 'trial_started_at', 'business_id', 'p_allow_fixture']) {
    const inj = await command(OWNER, A, 'trial', { ...body, request_key: key(), [f]: '2030-01-01T00:00:00Z' });
    assert.equal(inj.status, 400, f);
  }
  const now = (await admin.query(`SELECT trial_started_at, trial_ends_at, version FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0];
  assert.equal(now.trial_started_at.getTime(), before.trial_started_at.getTime());
  assert.equal(now.trial_ends_at.getTime(), before.trial_ends_at.getTime());
  assert.equal(String(now.version), String(before.version), 'no write happened');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM public.billing_events WHERE business_id=$1 AND event_type='trial_activated'`, [A])).rows[0].n, 1);
});

test('concurrency: parallel activations from many tabs start exactly one trial; parallel selections, one wins', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const B = await createCommercialCompany(RACER, 'Racer Co');
  const s = (await billing(RACER, B)).body;
  const plans = s.account.catalog;
  const sel = await Promise.all(plans.map(p => command(RACER, B, 'plan', { request_key: key(), plan_version_id: p.id, expected_version: Number(s.account.version) })));
  assert.deepEqual(sel.map(r => r.status).sort(), [200, 409, 409]);
  assert.ok(sel.filter(r => r.status === 409).every(r => r.body.error === 'billing_stale'));
  const won = sel.find(r => r.status === 200).body;
  const tabs = await Promise.all(Array.from({ length: 10 }, () => command(RACER, B, 'trial', { request_key: key(), plan_version_id: won.selected_plan_version_id, expected_version: Number(won.version) })));
  assert.ok(tabs.every(r => r.status === 200), JSON.stringify(tabs.map(r => r.body)));
  assert.equal(tabs.filter(r => r.body.already_started === false).length, 1);
  assert.equal(new Set(tabs.map(r => r.body.trial_ends_at)).size, 1, 'every tab sees the same single deadline');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM public.billing_events WHERE business_id=$1 AND event_type='trial_activated'`, [B])).rows[0].n, 1);
});

test('roles and tenants: only a verified owner of THIS company manages billing; others cannot read or write it', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await seed.member(A, ACCOUNTANT, 'accountant');
  const s = (await billing(ACCOUNTANT, A)).body;
  assert.equal(s.can_manage, false);
  const r = await command(ACCOUNTANT, A, 'plan', { request_key: key(), plan_version_id: s.account.catalog[0].id, expected_version: Number(s.account.version) });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'billing_forbidden');
  const C = await createCommercialCompany(UNVERIFIED, 'Unverified Co');
  const u = (await billing(UNVERIFIED, C)).body;
  const ur = await command(UNVERIFIED, C, 'plan', { request_key: key(), plan_version_id: u.account.catalog[0].id, expected_version: Number(u.account.version) });
  assert.equal(ur.status, 403); assert.equal(ur.body.error, 'billing_email_verification_required');
  // Another company's owner addressing company A: refused before any billing data is returned or written.
  const before = (await admin.query(`SELECT version FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0].version;
  const x = await billing(OTHER, A);
  assert.ok([403, 404].includes(x.status), String(x.status)); assert.equal(x.body?.account, undefined);
  const xw = await command(OTHER, A, 'plan', { request_key: key(), plan_version_id: s.account.catalog[2].id, expected_version: Number(before) });
  assert.ok([403, 404].includes(xw.status), String(xw.status));
  assert.equal((await admin.query(`SELECT version FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0].version, before);
});

test('server-side features: a plan without payroll refuses payroll writes; quota reservations never exceed the limit', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const S = await createCommercialCompany(OTHER, 'Starter Co');
  await startTrial(OTHER, S, 'starter');
  const p = await api.call('/payroll/runs', { method: 'POST', user: OTHER, biz: S, body: {} });
  assert.equal(p.status, 402); assert.equal(p.body.error, 'billing_feature_denied');
  const tm = await api.call('/team/invite', { method: 'POST', user: OTHER, biz: S, body: { role: 'accountant' } });
  assert.equal(tm.status, 402); assert.equal(tm.body.error, 'billing_feature_denied');
  // Control (company A) has payroll: admission lets the request through to the route itself.
  const ok = await api.call('/payroll/runs', { method: 'POST', user: OWNER, biz: A, body: {} });
  assert.notEqual(ok.status, 402);
  // Starter documents limit = 2 (test value): 6 concurrent reservations, exactly 2 succeed.
  const res = await Promise.allSettled(Array.from({ length: 6 }, () => admin.query(`SELECT public.rpc_billing_quota($1,$2,$3,'documents','reserve',1) r`, [OTHER, S, key()])));
  assert.equal(res.filter(x => x.status === 'fulfilled').length, 2);
  assert.ok(res.filter(x => x.status === 'rejected').every(x => /billing_quota_reached/.test(x.reason.message)));
});

test('expiry: after 168h access ends on the server, reads stay available, the trial cannot be restarted', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await age(A, 169);
  const a = (await billing(OWNER, A)).body.access;
  assert.equal(a.restricted, true); assert.equal(a.subscription_status, 'expired'); assert.equal(a.trial_status_effective, 'expired');
  assert.equal(a.trial_seconds_remaining, 0); assert.deepEqual(a.features, {});
  const w = await api.call('/transactions', { method: 'POST', user: OWNER, biz: A, body: {} });
  assert.equal(w.status, 402); assert.equal(w.body.error, 'billing_restricted');
  assert.equal((await api.call('/wallets', { user: OWNER, biz: A })).status, 200, 'data remains readable');
  const s = (await billing(OWNER, A)).body;
  const again = await command(OWNER, A, 'trial', { request_key: key(), plan_version_id: s.account.selected_plan_version_id, expected_version: Number(s.account.version) });
  assert.equal(again.body.already_started, true);
  assert.equal((await billing(OWNER, A)).body.access.restricted, true, 'a second activation never revives access');
  // Choosing another plan after expiry is allowed and does not grant access without payment.
  const sel = await command(OWNER, A, 'plan', { request_key: key(), plan_version_id: s.account.catalog[2].id, expected_version: Number(s.account.version) });
  assert.equal(sel.status, 200);
  assert.equal((await billing(OWNER, A)).body.access.restricted, true);
});

test('admin exceptions are separate from trial and payment: a grant opens access, revoking closes it, nothing becomes paid', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const d = await api.call('/admin/billing/companies/' + A, { user: ADMIN });
  const plan = d.body.account.plan_versions.find(v => v.plan === 'pro' && v.approval_status === 'approved');
  const g = await api.call(`/admin/billing/companies/${A}/grant`, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(d.body.account.version),
    payload: { plan_version_id: plan.id, ends_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Pilot partner access' } } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  let a = (await billing(OWNER, A)).body.access;
  assert.equal(a.restricted, false); assert.equal(a.effective_access_source, 'admin_override'); assert.equal(a.subscription_active, false);
  assert.equal(a.subscription_status, 'expired', 'the trial stays expired; the grant is reported separately');
  const grant = (await admin.query(`SELECT id FROM public.billing_grants WHERE business_id=$1`, [A])).rows[0];
  const v = (await admin.query(`SELECT version FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0].version;
  const r = await api.call(`/admin/billing/companies/${A}/revoke`, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(v), payload: { grant_id: grant.id, reason: 'Pilot finished' } } });
  assert.equal(r.status, 200);
  a = (await billing(OWNER, A)).body.access;
  assert.equal(a.restricted, true);
  // The legacy admin trial/override endpoints write columns the commercial policy ignores: refused, never a silent no-op.
  for (const [method, path, body] of [['POST', `/admin/businesses/${A}/trial`, { action: 'activate', reason: 'x' }], ['PATCH', `/admin/businesses/${A}/access`, { plan: 'founder', reason: 'x' }]]) {
    const l = await api.call(path, { method, user: ADMIN, body });
    assert.equal(l.status, 409, path); assert.equal(l.body.error, 'billing_use_commercial_admin');
  }
  assert.equal((await admin.query(`SELECT trial_status, admin_override_plan FROM public.businesses WHERE id=$1`, [A])).rows[0].admin_override_plan, null);
  assert.equal((await billing(OWNER, A)).body.access.restricted, true);
  // Non-admins cannot use the admin commands.
  assert.equal((await api.call(`/admin/billing/companies/${A}/grant`, { method: 'POST', user: OWNER, body: {} })).status, 403);
});

test('legacy companies keep their access policy: no commercial admission, legacy admin tools still work', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const legacy = await seed.company({ owner: OTHER, name: 'Legacy Co 2' });
  const w = await api.call('/transactions', { method: 'POST', user: OTHER, biz: legacy, body: {} });
  assert.notEqual(w.status, 402);
  const l = await api.call(`/admin/businesses/${legacy}/trial`, { method: 'POST', user: ADMIN, body: { action: 'activate', reason: 'legacy support' } });
  assert.equal(l.status, 200, JSON.stringify(l.body));
});
