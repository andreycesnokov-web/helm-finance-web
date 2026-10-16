'use strict';
// Platform admin security on real PostgreSQL (Platform admin). Migrations 072 + 073 on a disposable database
// built from the production schema snapshot + release chain. Two independent connections for every race.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { createRealPgSupabase } = require('./_realPgSupabase');
const { CHAIN, D4 } = require('./_d4Harness');
const admins = require('../../server/lib/platformAdmin');

const sql = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let db, a, b, supa;
const conn = async () => { const c = new Client({ connectionString: db.connectionString }); await c.connect(); return c };
const q = (c, s, p) => c.query(s, p);
const one = async (s, p) => (await a.query(s, p)).rows[0];
async function user(id, verified = true) {
  await a.query('INSERT INTO public.users(id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
  await a.query(`INSERT INTO public.user_email_identities(user_id,email,email_verified_at) VALUES($1,$2,${verified ? 'now()' : 'NULL'})
    ON CONFLICT DO NOTHING`, [id, `u${String(id).replace('-', 'm')}@t.local`]);
}
const activeSupers = async () => Number((await one("SELECT count(*) n FROM public.platform_admins WHERE role='super_admin' AND is_active")).n);
const reset = async (rows) => {
  await a.query('ALTER TABLE public.platform_admins DISABLE TRIGGER trg_platform_admins_guard');
  await a.query('DELETE FROM public.platform_admins');
  await a.query('ALTER TABLE public.platform_admins ENABLE TRIGGER trg_platform_admins_guard');
  for (const [id, role] of rows) await a.query("INSERT INTO public.platform_admins(user_id,role,created_by) VALUES($1,$2,$1)", [id, role]);
};

before(async () => {
  db = await createProdSchemaDatabase('pa_security', [...CHAIN, D4]);
  if (!db) return;
  a = await conn(); b = await conn();
  await a.query(sql('072_platform_admins.sql'));
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) await user(id);
  await user(9, false);
  // State a database can be in after running 072 alone: deleting an admin's user leaves an orphaned, active row.
  await a.query("INSERT INTO public.platform_admins(user_id,role,created_by) VALUES(1,'super_admin',1),(8,'platform_admin',1)");
  await a.query('DELETE FROM public.users WHERE id=8');
  assert.equal(Number((await one('SELECT count(*) n FROM public.platform_admins WHERE user_id=8')).n), 1, '072 leaves the orphan (reproduced)');
  await a.query(sql('073_platform_admins_security.sql'));
  supa = createRealPgSupabase(db.connectionString);
});
after(async () => { try { await supa?.pool?.end() } catch { /* */ } await a?.end(); await b?.end(); await db?.drop?.(); });
const skip = () => !db;

test('073 removes orphaned admin rows left by 072 and audits the removal', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  assert.equal(Number((await one('SELECT count(*) n FROM public.platform_admins WHERE user_id=8')).n), 0);
  assert.equal(Number((await one("SELECT count(*) n FROM public.audit_events WHERE action='orphan_role_removed' AND entity_id='8'")).n), 1);
});

test('A. DELETE works, the last super_admin is protected, user deletion cascades, a reused id is not an admin', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await reset([[1, 'super_admin'], [3, 'platform_admin']]);
  assert.equal((await a.query('DELETE FROM public.platform_admins WHERE user_id=3')).rowCount, 1, 'regular admin row is deleted');
  await assert.rejects(a.query('DELETE FROM public.platform_admins WHERE user_id=1'), /cannot_revoke_last_super_admin/);
  await assert.rejects(a.query('DELETE FROM public.users WHERE id=1'), /cannot_revoke_last_super_admin/, 'the last super_admin\'s user cannot be deleted');
  await a.query("INSERT INTO public.platform_admins(user_id,role,created_by) VALUES(4,'platform_admin',1)");
  await a.query('DELETE FROM public.users WHERE id=4');
  assert.equal(Number((await one('SELECT count(*) n FROM public.platform_admins WHERE user_id=4')).n), 0, 'cascade removes the admin row (no orphan)');
  await user(4);
  assert.equal(await admins.resolvePlatformAdmin(supa, 4, 'email'), null, 'a re-created user with the same id is not an admin');
});

test('B. concurrent revocation of two super_admins never leaves zero (25 rounds, direct SQL and RPC)', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  for (let round = 0; round < 25; round++) {
    await reset([[1, 'super_admin'], [2, 'super_admin']]);
    await a.query('BEGIN'); await b.query('BEGIN');
    const pa = a.query('UPDATE public.platform_admins SET is_active=false, revoked_at=now() WHERE user_id=1').then(() => a.query('COMMIT'), (e) => a.query('ROLLBACK').then(() => { throw e }));
    const pb = b.query('UPDATE public.platform_admins SET is_active=false, revoked_at=now() WHERE user_id=2').then(() => b.query('COMMIT'), (e) => b.query('ROLLBACK').then(() => { throw e }));
    const r = await Promise.allSettled([pa, pb]);
    assert.equal(await activeSupers(), 1, `round ${round}: ${r.map(x => x.status).join('/')}`);
    assert.equal(r.filter(x => x.status === 'rejected').length, 1);
    assert.match(r.find(x => x.status === 'rejected').reason.message, /cannot_revoke_last_super_admin/);
  }
  for (let round = 0; round < 25; round++) {
    await reset([[1, 'super_admin'], [2, 'super_admin']]);
    // Each super_admin revokes the other at the same time through the production RPC.
    const r = await Promise.allSettled([a.query('SELECT public.rpc_platform_admin_revoke(1,2) r'), b.query('SELECT public.rpc_platform_admin_revoke(2,1) r')]);
    assert.ok(await activeSupers() >= 1, `rpc round ${round}: ${r.map(x => x.status + ':' + (x.reason?.message || '')).join(' | ')}`);
  }
  await reset([[1, 'super_admin'], [2, 'super_admin']]);
  await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await assert.rejects(a.query('UPDATE public.platform_admins SET is_active=false WHERE user_id=1'), /platform_admin_change_requires_read_committed/);
  await a.query('ROLLBACK');
});

test('C. no SECURITY DEFINER in 072/073, pinned search_path, backend-only EXECUTE, schema shadowing has no effect', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const fns = (await a.query(`SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authd, has_function_privilege('service_role',p.oid,'EXECUTE') svc
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
    ('fn_bootstrap_platform_super_admin','rpc_platform_admin_grant','rpc_platform_admin_revoke','cfo_require_active_super_admin','fn_platform_admins_guard')`)).rows;
  assert.equal(fns.length, 5);
  for (const f of fns) {
    assert.equal(f.prosecdef, false, f.proname);
    assert.deepEqual(f.proconfig, ['search_path=pg_catalog, public'], f.proname);
    assert.equal(f.anon, false, f.proname); assert.equal(f.authd, false, f.proname);
    if (f.proname !== 'fn_platform_admins_guard') assert.equal(f.svc, true, f.proname);
  }
  assert.equal(Number((await one("SELECT count(*) n FROM pg_proc WHERE proname='fn_bootstrap_platform_super_admin'")).n), 1, 'exactly one overload');
  // An attacker-controlled schema first in search_path cannot make an unverified user look verified.
  await reset([]);
  await a.query('CREATE SCHEMA evil; CREATE TABLE evil.user_email_identities(user_id bigint, email text, email_verified_at timestamptz)');
  await a.query("INSERT INTO evil.user_email_identities VALUES(9,'u9@t.local',now())");
  await a.query('SET search_path = evil, public');
  await assert.rejects(a.query('SELECT public.fn_bootstrap_platform_super_admin(9)'), /email_not_verified/);
  await a.query('RESET search_path'); await a.query('DROP SCHEMA evil CASCADE');
});

test('D. 073 is idempotent; re-running 072 after 073 would revert the fixes (the runner must never re-run it)', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  const defs = async () => (await one(`SELECT md5(string_agg(pg_get_functiondef(oid),'' ORDER BY proname)) h FROM pg_proc
    WHERE proname IN ('fn_platform_admins_guard','fn_bootstrap_platform_super_admin','rpc_platform_admin_grant','rpc_platform_admin_revoke')`)).h;
  const d0 = await defs();
  await a.query(sql('073_platform_admins_security.sql'));
  assert.equal(await defs(), d0, '073 twice = same definitions');
  await a.query(sql('072_platform_admins.sql'));
  assert.notEqual(await defs(), d0, 'a re-run of 072 replaces the fixed guard/bootstrap');
  await a.query(sql('073_platform_admins_security.sql'));
  assert.equal(await defs(), d0, '073 restores them');
});

test('6. audit is atomic: when the audit row cannot be written, bootstrap/grant/revoke change nothing', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await reset([]);
  const since = (await one('SELECT clock_timestamp() t')).t;
  await a.query(`CREATE FUNCTION public.test_fail_admin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.entity_type='platform_admin' THEN RAISE EXCEPTION 'audit_store_unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_fail_admin_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.test_fail_admin_audit()`);
  await assert.rejects(admins.bootstrapSuperAdmin(supa, 'u1@t.local'), /audit_store_unavailable|bootstrap_rpc_failed/);
  assert.equal(await activeSupers(), 0, 'no role without audit (bootstrap)');
  await a.query('ALTER TABLE public.audit_events DISABLE TRIGGER test_fail_admin_audit');
  assert.equal((await admins.bootstrapSuperAdmin(supa, 'u1@t.local')).status, 'bootstrapped');
  assert.equal(Number((await one("SELECT count(*) n FROM public.audit_events WHERE action='role_bootstrap' AND entity_id='1'")).n), 1);
  await a.query('ALTER TABLE public.audit_events ENABLE TRIGGER test_fail_admin_audit');
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'u2@t.local', role: 'super_admin', actorUserId: 1 }), /admin_grant_failed/);
  assert.equal(Number((await one('SELECT count(*) n FROM public.platform_admins WHERE user_id=2')).n), 0, 'no role without audit (grant)');
  await a.query('ALTER TABLE public.audit_events DISABLE TRIGGER test_fail_admin_audit');
  await admins.grantPlatformAdminRole(supa, { email: 'u2@t.local', role: 'super_admin', actorUserId: 1 });
  await a.query('ALTER TABLE public.audit_events ENABLE TRIGGER test_fail_admin_audit');
  await assert.rejects(admins.revokePlatformAdminRole(supa, { targetUserId: 2, actorUserId: 1 }), /admin_revoke_failed/);
  assert.equal((await one('SELECT is_active FROM public.platform_admins WHERE user_id=2')).is_active, true, 'no revocation without audit');
  await a.query('DROP TRIGGER test_fail_admin_audit ON public.audit_events; DROP FUNCTION public.test_fail_admin_audit()');
  await admins.revokePlatformAdminRole(supa, { targetUserId: 2, actorUserId: 1 });
  const audit = (await a.query("SELECT action FROM public.audit_events WHERE entity_type='platform_admin' AND entity_id='2' AND created_at >= $1 ORDER BY created_at", [since])).rows.map(r => r.action);
  assert.deepEqual(audit, ['role_granted', 'role_revoked']);
});

test('grant/revoke/bootstrap refusals: only an active verified super_admin acts; unverified targets refused; bootstrap once', async (t) => {
  if (skip()) return t.skip('no PostgreSQL');
  await reset([[1, 'super_admin'], [3, 'platform_admin']]);
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'u5@t.local', role: 'super_admin', actorUserId: 3 }), /super_admin_required/, 'platform_admin cannot grant');
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'u5@t.local', role: 'super_admin', actorUserId: 5 }), /super_admin_required/, 'a regular user cannot make themselves super_admin');
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'u9@t.local', role: 'platform_admin', actorUserId: 1 }), /email_not_verified/);
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'nobody@t.local', role: 'platform_admin', actorUserId: 1 }), /user_not_found/);
  await assert.rejects(admins.revokePlatformAdminRole(supa, { targetUserId: 1, actorUserId: 3 }), /super_admin_required/);
  await assert.rejects(admins.revokePlatformAdminRole(supa, { targetUserId: 1, actorUserId: 1 }), /cannot_revoke_last_super_admin/);
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'u1@t.local', role: 'platform_admin', actorUserId: 1 }), /cannot_revoke_last_super_admin/, 'the last super_admin cannot be demoted');
  // A super_admin whose email is no longer verified cannot act.
  await a.query('UPDATE public.user_email_identities SET email_verified_at=NULL WHERE user_id=1');
  await assert.rejects(admins.grantPlatformAdminRole(supa, { email: 'u5@t.local', role: 'platform_admin', actorUserId: 1 }), /super_admin_required/);
  await a.query('UPDATE public.user_email_identities SET email_verified_at=now() WHERE user_id=1');
  // Bootstrap: unverified refused, second user refused while a super_admin exists, repeat is idempotent, races serialize.
  await assert.rejects(admins.bootstrapSuperAdmin(supa, 'u9@t.local'), /email_not_verified/);
  await assert.rejects(admins.bootstrapSuperAdmin(supa, 'u5@t.local'), /super_admin_already_exists|Active super_admin already exists/);
  assert.equal((await admins.bootstrapSuperAdmin(supa, 'u1@t.local')).status, 'already_super_admin');
  for (let round = 0; round < 25; round++) {
    await reset([]);
    const r = await Promise.allSettled([a.query('SELECT public.fn_bootstrap_platform_super_admin(5) r'), b.query('SELECT public.fn_bootstrap_platform_super_admin(6) r')]);
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1, `bootstrap race ${round}`);
    assert.equal(await activeSupers(), 1);
  }
  // No non-atomic fallback: a client without rpc() fails closed.
  await assert.rejects(admins.bootstrapSuperAdmin({ from: () => { throw new Error('must not query') } }, 'u1@t.local'), /admin_atomic_rpc_required/);
  await assert.rejects(admins.grantPlatformAdminRole({}, { email: 'u5@t.local', role: 'platform_admin', actorUserId: 1 }), /admin_atomic_rpc_required/);
});
