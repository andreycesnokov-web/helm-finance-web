'use strict';
// Billing Management Center over real PostgreSQL and the real Express server (Platform admin + Business).
// Disposable database: production schema snapshot + release chain + D4 + commercial trial + billing center.
// Plan terms below are TEST VALUES ONLY; Starter/Control/Pro stay unpublished drafts.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { CHAIN, D4, seeder, startServer, openAdmin } = require('./_d4Harness');

const MIGRATIONS = ['20261015033808_cfo_commercial_trial.sql', '20261017090000_billing_management_center.sql', '20261017120000_billing_enforcement.sql'];
const ADMIN = 9100, A_OWNER = 1101, B_OWNER = 1102, MEMBER = 1103, C_OWNER = 1104, D_OWNER = 1105, E_OWNER = 1106;
const F8 = { documents: true, ai: true, import: true, payroll: false, team: false, approvals: false, export: true, integrations: false };
const L5 = { users: 2, companies: 1, documents: 3, ai: 100, imports: 10 };
let db, admin, api, seed;
const key = () => crypto.randomUUID();
const past = () => new Date(Date.now() - 60000).toISOString();
const terms = (name, over = {}) => ({ name_i18n: { en: name, ru: name, id: name }, description_i18n: { en: 'test', ru: 'тест', id: 'uji' }, price_minor: 1900,
  currency: 'USD', features: F8, limits: L5, terms_version: 'test-only', effective_at: past(), approval_status: 'approved', ...over });

before(async () => {
  db = await createProdSchemaDatabase('billing_center', [...CHAIN, D4]);
  if (!db) return;
  admin = await openAdmin(db.connectionString);
  for (const m of MIGRATIONS) await admin.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', m), 'utf8'));
  // Production carries the legacy plan rows seeded by migration 005 (the snapshot is schema-only).
  await admin.query("INSERT INTO public.plan_limits(plan) VALUES ('free'),('business'),('founder'),('enterprise') ON CONFLICT DO NOTHING");
  seed = seeder(admin);
  for (const u of [ADMIN, A_OWNER, B_OWNER, MEMBER, C_OWNER, D_OWNER, E_OWNER]) {
    await admin.query('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
    await admin.query(`INSERT INTO public.user_email_identities (user_id, email, email_verified_at) VALUES ($1, $2, now())`, [u, `c${u}@test.local`]);
  }
  Object.assign(process.env, { COMMERCIAL_BILLING_ENABLED: 'true', ADMIN_TELEGRAM_IDS: String(ADMIN) });
  delete process.env.COMMERCIAL_BILLING_FIXTURES;
  api = await startServer(db.connectionString);
});
after(async () => { await api?.stop(); await admin?.end(); await db?.drop?.(); });
const skip = () => !db;

const catalog = async () => (await api.call('/admin/billing/catalog', { user: ADMIN })).body;
const head = async (code) => (await catalog()).plans.find(p => p.plan === code);
async function cat(code, payload, expected) {
  const e = expected ?? Number((await head(code))?.catalog_version ?? 0);
  return api.call('/admin/billing/catalog/' + code, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: e, terms: payload } });
}
const publish = (code, t, extra = {}) => cat(code, { action: 'publish', confirm_publish: true, publish: true, ...t, ...extra });
async function company(owner, name) {
  const r = await api.call('/businesses', { method: 'POST', user: owner, body: { name, request_key: key(), country: 'Indonesia', timezone: 'Asia/Jakarta' } });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.business.id;
}
const billing = (user, biz) => api.call('/billing', { user, biz });
async function trial(owner, biz, code) {
  const s = (await billing(owner, biz)).body, plan = s.account.catalog.find(p => p.plan === code);
  assert.ok(plan, code + ' offered');
  const sel = await api.call('/billing/plan', { method: 'POST', user: owner, biz, body: { request_key: key(), plan_version_id: plan.id, expected_version: Number(s.account.version) } });
  assert.equal(sel.status, 200, JSON.stringify(sel.body));
  const tr = await api.call('/billing/trial', { method: 'POST', user: owner, biz, body: { request_key: key(), plan_version_id: plan.id, expected_version: Number(sel.body.version) } });
  assert.equal(tr.status, 200, JSON.stringify(tr.body)); return plan;
}
async function adminCmd(biz, action, payload) {
  const d = (await api.call('/admin/billing/companies/' + biz, { user: ADMIN })).body;
  return api.call(`/admin/billing/companies/${biz}/${action}`, { method: 'POST', user: ADMIN, body: { request_key: key(), expected_version: Number(d.account.version), payload } });
}
const reserve = (actor, biz, resource) => admin.query(`SELECT public.rpc_billing_quota($1,$2,$3,$4,'reserve',1) r`, [actor, biz, key(), resource]).then(x => x.rows[0].r);
const counts = async () => (await admin.query(`SELECT (SELECT count(*) FROM public.plan_versions)::int v,(SELECT count(*) FROM public.billing_admin_commands)::int c`)).rows[0];

let A, B;
test('plans: any code, legacy codes reserved, drafts never replace published terms, preview writes nothing', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const shipped = (await catalog()).plans.map(p => p.plan).sort();
  assert.deepEqual(shipped, ['control', 'pro', 'starter'], 'legacy plan rows are not part of the commercial catalog');
  for (const p of (await catalog()).plans) assert.equal((await catalog()).versions.find(v => v.id === p.current_version_id).approval_status, 'draft', p.plan + ' stays unpublished');
  for (const code of ['enterprise', 'free']) {
    const r = await cat(code, { action: 'draft', ...terms(code, { approval_status: 'draft' }) }, 0);
    assert.equal(r.status, 409, code); assert.equal(r.body.error, 'billing_plan_code_reserved');
  }
  assert.equal((await cat('Zero!', { action: 'draft', ...terms('x', { approval_status: 'draft' }) }, 0)).status, 400);
  const d = await cat('zero_activity', { action: 'draft', ...terms('Zero Activity', { approval_status: 'draft' }) }, 0);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const noConfirm = await cat('zero_activity', { action: 'publish', ...terms('Zero Activity'), publish: true });
  assert.equal(noConfirm.status, 409); assert.equal(noConfirm.body.error, 'billing_publish_not_confirmed');
  const pub = await publish('zero_activity', terms('Zero Activity', { trial_hours: 72, price_annual_minor: 19000 }));
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  let h = await head('zero_activity');
  assert.equal(h.current_version_id, pub.body.terms.id); assert.equal(h.draft_version_id, null); assert.equal(h.commercial_available, true);
  // A new draft is stored beside the published version and changes nothing for customers.
  const d2 = await cat('zero_activity', { action: 'draft', ...terms('Zero Activity', { approval_status: 'draft', price_minor: 2900 }) });
  assert.equal(d2.status, 200);
  h = await head('zero_activity');
  assert.equal(h.current_version_id, pub.body.terms.id, 'published terms stay current'); assert.equal(h.draft_version_id, d2.body.terms.id);
  // Preview: diff + subscriber note, nothing written, no receipt.
  const before = await counts();
  const pv = await api.call('/admin/billing/catalog/zero_activity/preview', { method: 'POST', user: ADMIN, body: { expected_version: Number(h.catalog_version),
    terms: { action: 'publish', ...terms('Zero Activity', { price_minor: 3900, limits: { ...L5, users: 9 }, trial_hours: 72, price_annual_minor: 19000, effective_at: pub.body.terms.effective_at }) } } });
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.valid, true); assert.equal(pv.body.dry_run, true);
  assert.deepEqual(pv.body.changes.map(c => c.field).sort(), ['limits.users', 'price_minor']);
  assert.deepEqual(await counts(), before, 'preview wrote nothing');
  assert.equal(Number((await head('zero_activity')).catalog_version), Number(h.catalog_version));
  for (const [over, code] of [[{ limits: { ...L5, exports: 100 } }, 'billing_limit_without_counter'], [{ features: { ...F8, export: false } }, 'billing_feature_always_included'],
    [{ features: { ...F8, teleport: true } }, 'billing_unknown_feature'], [{ limit_policies: { storage_mb: 'soft' } }, 'billing_invalid_terms']]) {
    const bad = await api.call('/admin/billing/catalog/zero_activity/preview', { method: 'POST', user: ADMIN, body: { expected_version: Number(h.catalog_version), terms: { action: 'publish', ...terms('Z', over) } } });
    assert.equal(bad.body.valid, false); assert.equal(bad.body.error, code);
  }
  // Published terms are immutable at the database level.
  await assert.rejects(admin.query(`UPDATE public.plan_versions SET price_minor=1 WHERE id=$1`, [pub.body.terms.id]), /billing_terms_immutable/);
  await assert.rejects(admin.query(`DELETE FROM public.plan_versions WHERE id=$1`, [pub.body.terms.id]), /billing_terms_immutable/);
});

test('subscribers keep their version; trial length comes from the version; archive stops only new selections', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  assert.equal((await publish('growth', terms('Growth', { price_minor: 9900 }))).status, 200);
  A = await company(A_OWNER, 'Center A');
  const v1 = await trial(A_OWNER, A, 'growth');
  let row = (await admin.query(`SELECT extract(epoch FROM trial_ends_at-trial_started_at)::int s, trial_hours FROM public.billing_accounts WHERE business_id=$1`, [A])).rows[0];
  assert.equal(row.s, 168 * 3600); assert.equal(row.trial_hours, 168);
  // A new published version (payroll on, higher price) does not touch company A.
  const v2 = await publish('growth', terms('Growth', { price_minor: 12900, features: { ...F8, payroll: true } }));
  let a = (await billing(A_OWNER, A)).body;
  assert.equal(a.access.effective_plan_version_id, v1.id); assert.equal(a.access.features.payroll, false);
  assert.equal(a.account.catalog.find(p => p.plan === 'growth').id, v2.body.terms.id, 'new customers see the new version');
  // 72-hour trial from the zero_activity version.
  B = await company(B_OWNER, 'Center B');
  await trial(B_OWNER, B, 'zero_activity');
  row = (await admin.query(`SELECT extract(epoch FROM trial_ends_at-trial_started_at)::int s, trial_hours, trial_ends_at FROM public.billing_accounts WHERE business_id=$1`, [B])).rows[0];
  assert.equal(row.s, 72 * 3600); assert.equal(row.trial_hours, 72);
  let b = (await billing(B_OWNER, B)).body.access;
  assert.equal(b.restricted, false); assert.equal(b.trial_hours, 72); assert.ok(b.trial_seconds_remaining <= 72 * 3600);
  // Switching plans during the trial keeps the trial window fixed.
  const s = (await billing(B_OWNER, B)).body;
  const sw = await api.call('/billing/plan', { method: 'POST', user: B_OWNER, biz: B, body: { request_key: key(), plan_version_id: v2.body.terms.id, expected_version: Number(s.account.version) } });
  assert.equal(sw.status, 200);
  b = (await billing(B_OWNER, B)).body.access;
  assert.equal(b.effective_plan, 'growth'); assert.equal(b.trial_ends_at.slice(0, 19), new Date(row.trial_ends_at).toISOString().slice(0, 19)); assert.equal(b.restricted, false);
  // Archive: existing subscriber keeps access, the plan disappears for new customers and admin assignment.
  const sel = await api.call('/billing/plan', { method: 'POST', user: B_OWNER, biz: B, body: { request_key: key(), plan_version_id: (await head('zero_activity')).current_version_id, expected_version: Number(sw.body.version) } });
  assert.equal(sel.status, 200);
  assert.equal((await cat('zero_activity', { action: 'archive' })).status, 200);
  assert.equal((await billing(B_OWNER, B)).body.access.restricted, false, 'subscriber keeps the agreed terms');
  const C = await company(C_OWNER, 'Center C'), cs = (await billing(C_OWNER, C)).body;
  assert.equal(cs.account.catalog.some(p => p.plan === 'zero_activity'), false);
  const cSel = await api.call('/billing/plan', { method: 'POST', user: C_OWNER, biz: C, body: { request_key: key(), plan_version_id: (await head('zero_activity')).current_version_id, expected_version: Number(cs.account.version) } });
  assert.equal(cSel.status, 409); assert.equal(cSel.body.error, 'billing_plan_not_approved');
  const assign = await adminCmd(C, 'assign', { plan_version_id: (await head('zero_activity')).current_version_id, reason: 'Assign archived plan' });
  assert.equal(assign.status, 409); assert.equal(assign.body.error, 'billing_plan_archived');
  assert.equal((await cat('zero_activity', { action: 'unarchive' })).status, 200);
  assert.equal((await head('zero_activity')).commercial_available, false, 'unarchive does not republish by itself');
});

test('customer overrides: base + individual terms = effective (SQL and API agree); never create access; enforceable keys only', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const deny = await api.call('/payroll/runs', { method: 'POST', user: A_OWNER, biz: A, body: {} });
  assert.equal(deny.status, 402); assert.equal(deny.body.error, 'billing_feature_denied');
  const lim = await adminCmd(A, 'override', { kind: 'limit', key: 'users', value: 12, reason: 'Enterprise deal: 12 seats' });
  assert.equal(lim.status, 200, JSON.stringify(lim.body));
  assert.equal((await adminCmd(A, 'override', { kind: 'feature', key: 'payroll', value: true, reason: 'Payroll pilot for this client' })).status, 200);
  const acc = (await billing(A_OWNER, A)).body.access;
  assert.equal(acc.limits.users, 12); assert.equal(acc.limits.documents, 3, 'other limits stay from the base plan'); assert.equal(acc.features.payroll, true);
  const sql = (await admin.query(`SELECT public.billing_effective_terms($1) t`, [A])).rows[0].t;
  assert.deepEqual(sql.limits, acc.limits); assert.deepEqual(sql.features, acc.features);
  assert.notEqual((await api.call('/payroll/runs', { method: 'POST', user: A_OWNER, biz: A, body: {} })).status, 402, 'the override is enforced on the server');
  const dup = await adminCmd(A, 'override', { kind: 'limit', key: 'users', value: 20, reason: 'Second seats override' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error, 'billing_override_overlap');
  for (const [kind, k] of [['limit', 'exports'], ['limit', 'companies'], ['feature', 'pulse']]) {
    const r = await adminCmd(A, 'override', { kind, key: k, value: kind === 'limit' ? 5 : true, reason: 'Unenforceable override' });
    assert.equal(r.status, 400, k); assert.equal(r.body.error, 'billing_override_not_enforceable');
  }
  assert.equal((await adminCmd(A, 'override', { kind: 'discount', value: { percent: 20 }, reason: 'Launch partner discount' })).status, 200);
  assert.equal((await billing(A_OWNER, A)).body.access.discount_percent, 20);
  const list = (await api.call('/admin/billing/overrides', { user: ADMIN })).body.overrides.filter(o => o.company.id === A);
  const seats = list.find(o => o.key === 'users');
  assert.equal(seats.base_value, 2); assert.equal(seats.effective_value, 12); assert.equal(String(seats.approved_by), String(ADMIN)); assert.equal(seats.reason, 'Enterprise deal: 12 seats');
  assert.equal((await adminCmd(A, 'revoke_override', { override_id: seats.id, reason: 'Deal ended early' })).status, 200);
  assert.equal((await billing(A_OWNER, A)).body.access.limits.users, 2);
  // Overrides never open access for a company whose trial has ended.
  const D = await company(D_OWNER, 'Center D');
  await trial(D_OWNER, D, 'growth');
  await admin.query(`UPDATE public.billing_accounts SET trial_started_at=trial_started_at-interval '200 hours', trial_ends_at=trial_ends_at-interval '200 hours' WHERE business_id=$1`, [D]);
  assert.equal((await adminCmd(D, 'override', { kind: 'feature', key: 'documents', value: true, reason: 'Should not revive access' })).status, 200);
  const dAcc = (await billing(D_OWNER, D)).body.access;
  assert.equal(dAcc.restricted, true); assert.deepEqual(dAcc.features, {});
  assert.equal((await admin.query(`SELECT public.billing_effective_terms($1) t`, [D])).rows[0].t, null);
  assert.equal((await api.call(`/admin/billing/companies/${A}/override`, { method: 'POST', user: A_OWNER, body: {} })).status, 403);
});

test('quota policies: hard refuses, soft allows and warns, 0 = unavailable, seats always hard', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  assert.equal((await publish('meter', terms('Meter', { limits: { users: 1, companies: 1, documents: 2, ai: 0, imports: 1 }, limit_policies: { documents: 'soft', ai: 'soft', users: 'soft' } }))).status, 200);
  const E = await company(E_OWNER, 'Center E');
  await trial(E_OWNER, E, 'meter');
  const docs = [await reserve(E_OWNER, E, 'documents'), await reserve(E_OWNER, E, 'documents'), await reserve(E_OWNER, E, 'documents')];
  assert.deepEqual(docs.map(d => d.over_limit), [false, false, true], 'soft: the third upload is allowed and reported');
  await reserve(E_OWNER, E, 'imports');
  await assert.rejects(reserve(E_OWNER, E, 'imports'), /billing_quota_reached/, 'hard (default)');
  await assert.rejects(reserve(E_OWNER, E, 'ai'), /billing_quota_reached/, '0 means unavailable even when soft');
  await assert.rejects(reserve(E_OWNER, E, 'users'), /billing_quota_reached/, 'seats are always hard');
  const r = await api.call('/documents/upload-init', { method: 'POST', user: E_OWNER, biz: E, body: { request_key: key(), sha256: 'a'.repeat(64), file_name: 'x.pdf', mime_type: 'application/pdf', size: 10 } });
  assert.notEqual(r.status, 402);
});

test('admin API: RBAC, real read models (no invented MRR), audit trail, concurrent commands', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  for (const p of ['overview', 'subscriptions', 'overrides', 'audit', 'payments', 'settings', 'catalog']) {
    assert.equal((await api.call('/admin/billing/' + p, { user: A_OWNER })).status, 403, p);
    assert.equal((await api.call('/admin/billing/' + p, { user: ADMIN })).status, 200, p);
  }
  assert.equal((await api.call('/admin/billing/catalog/growth/preview', { method: 'POST', user: A_OWNER, body: {} })).status, 403);
  const legacy = await seed.company({ owner: MEMBER, name: 'Legacy Center' });
  const ov = (await api.call('/admin/billing/overview', { user: ADMIN })).body;
  assert.equal(ov.payments_connected, false); assert.equal(ov.mrr, null); assert.equal(ov.active_paid, 0);
  assert.ok(ov.trialing >= 3); assert.ok(ov.expired >= 1); assert.ok(ov.legacy >= 1);
  const subs = (await api.call('/admin/billing/subscriptions', { user: ADMIN })).body.subscriptions;
  assert.equal(subs.find(s => s.id === legacy).status, 'legacy');
  const a = subs.find(s => s.id === A);
  assert.equal(a.status, 'trialing'); assert.equal(a.selected.plan, 'growth'); assert.equal(a.selected.version, 1); assert.equal(a.discount_percent, 20);
  const audit = (await api.call('/admin/billing/audit', { user: ADMIN })).body.entries;
  assert.ok(audit.some(e => e.action === 'override' && e.company === 'Center A' && e.reason === 'Enterprise deal: 12 seats'));
  assert.ok(audit.some(e => e.action === 'catalog' && e.code === 'zero_activity' && e.payload_action === 'archive'));
  const pay = (await api.call('/admin/billing/payments', { user: ADMIN })).body;
  assert.equal(pay.connected, false); assert.deepEqual(pay.periods, []);
  // Five admins publish a new plan at the same catalog version: exactly one wins.
  const race = await Promise.all(Array.from({ length: 5 }, () => api.call('/admin/billing/catalog/race_plan', { method: 'POST', user: ADMIN,
    body: { request_key: key(), expected_version: 0, terms: { action: 'publish', confirm_publish: true, ...terms('Race') } } })));
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409, 409, 409, 409]);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM public.plan_versions WHERE plan='race_plan'`)).rows[0].n, 1);
  // Concurrent overrides on the same account version: one wins, the rest are stale.
  const d = (await api.call('/admin/billing/companies/' + B, { user: ADMIN })).body;
  const ors = await Promise.all(['documents', 'ai', 'imports'].map(k => api.call(`/admin/billing/companies/${B}/override`, { method: 'POST', user: ADMIN,
    body: { request_key: key(), expected_version: Number(d.account.version), payload: { kind: 'limit', key: k, value: 50, reason: 'Concurrent override' } } })));
  assert.deepEqual(ors.map(r => r.status).sort(), [200, 409, 409]);
  // Replaying the same admin command returns the stored result instead of writing twice.
  const k = key(), body = { request_key: k, expected_version: Number((await api.call('/admin/billing/companies/' + B, { user: ADMIN })).body.account.version),
    payload: { kind: 'discount', value: { percent: 10 }, reason: 'Replay-safe discount' } };
  const r1 = await api.call(`/admin/billing/companies/${B}/override`, { method: 'POST', user: ADMIN, body });
  const r2 = await api.call(`/admin/billing/companies/${B}/override`, { method: 'POST', user: ADMIN, body });
  assert.equal(r1.status, 200); assert.equal(r2.body.is_replay, true);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM public.billing_overrides WHERE business_id=$1 AND kind='discount'`, [B])).rows[0].n, 1);
});

test('migration down is fail-closed: refuses without confirmation and while it would lose overrides or new terms', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const down = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261017090000_billing_management_center_down.sql'), 'utf8');
  await assert.rejects(admin.query(down), /billing_center_down_not_confirmed/);
  await admin.query('ROLLBACK').catch(() => {});
  await admin.query("SET cfo.confirm_down = '20261017090000'");
  await assert.rejects(admin.query(down), /billing_center_down_would_lose_terms/);
  await admin.query('ROLLBACK').catch(() => {});
  await admin.query('RESET cfo.confirm_down');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM public.billing_schema_versions WHERE version='20261017090000'`)).rows[0].n, 1, 'still applied');
});
