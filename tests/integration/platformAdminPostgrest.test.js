'use strict';
// Platform admin RPCs through the REAL request path the app uses: @supabase/supabase-js → PostgREST → PostgreSQL.
// A throwaway PostgREST container (local Supabase image, nothing downloaded) points at a disposable database.
// Skips (and must then be reported as NOT VERIFIED) when Docker or the image is unavailable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { CHAIN, D4 } = require('./_d4Harness');
const admins = require('../../server/lib/platformAdmin');

const IMAGE = process.env.PGRST_TEST_IMAGE || 'public.ecr.aws/supabase/postgrest:v14.16';
const NETWORK = process.env.PGRST_TEST_NETWORK || 'supabase_network_Helmcare-platform';
const DB_HOST = process.env.PGRST_TEST_DB_HOST || 'supabase_db_Helmcare-platform';
const ROLE = 'xr_pgrst_auth', ROLE_PW = 'xr-pgrst-' + crypto.randomBytes(6).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const NAME = 'xr-pgrst-' + crypto.randomBytes(4).toString('hex');
let db, adminPg, c, container = null, proxy, base, skipReason = null;
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const client = (role) => createClient(base, jwt.sign({ role }, SECRET, { expiresIn: '10m' }), { auth: { persistSession: false, autoRefreshToken: false } });
const sql = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');

before(async () => {
  try { docker('image', 'inspect', IMAGE); docker('network', 'inspect', NETWORK); } catch { skipReason = 'docker or PostgREST image unavailable'; return; }
  db = await createProdSchemaDatabase('pa_pgrst', [...CHAIN, D4]);
  if (!db) { skipReason = 'no PostgreSQL'; return; }
  c = new Client({ connectionString: db.connectionString }); await c.connect();
  await c.query(sql('072_platform_admins.sql')); await c.query(sql('073_platform_admins_security.sql'));
  for (const [id, ok] of [[11, true], [12, true], [13, false], [14, true]]) {
    await c.query('INSERT INTO users(id) VALUES($1)', [id]);
    await c.query(`INSERT INTO user_email_identities(user_id,email,email_verified_at) VALUES($1,$2,${ok ? 'now()' : 'NULL'})`, [id, `p${id}@t.local`]);
  }
  adminPg = new Client({ connectionString: db.connectionString.replace(/\/[^/?]+(\?|$)/, '/postgres$1') }); await adminPg.connect();
  await adminPg.query(`DO $$ BEGIN CREATE ROLE ${ROLE} LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await adminPg.query(`ALTER ROLE ${ROLE} PASSWORD '${ROLE_PW}'`);
  await adminPg.query(`GRANT anon, authenticated, service_role TO ${ROLE}`);
  container = docker('run', '-d', '--rm', '--name', NAME, '--network', NETWORK, '-p', '127.0.0.1::3000',
    '-e', `PGRST_DB_URI=postgres://${ROLE}:${ROLE_PW}@${DB_HOST}:5432/${db.name}`, '-e', 'PGRST_DB_SCHEMAS=public',
    '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${SECRET}`, IMAGE);
  const port = docker('port', NAME, '3000/tcp').split('\n')[0].split(':').pop();
  // supabase-js calls <url>/rest/v1/...; the standalone PostgREST serves at the root.
  proxy = http.createServer((req, res) => {
    const p = http.request({ host: '127.0.0.1', port, path: req.url.replace(/^\/rest\/v1/, ''), method: req.method, headers: { ...req.headers, host: '127.0.0.1:' + port } },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) });
    p.on('error', () => { res.writeHead(502); res.end() }); req.pipe(p);
  }).listen(0);
  base = `http://127.0.0.1:${proxy.address().port}`;
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
    if (r && r.status < 500) return;
    await new Promise(res => setTimeout(res, 500));
  }
  skipReason = 'PostgREST did not start: ' + docker('logs', NAME).slice(-400);
});
after(async () => {
  if (container) try { docker('rm', '-f', NAME) } catch { /* */ }
  proxy?.close();
  if (adminPg) { try { await adminPg.query(`REVOKE anon, authenticated, service_role FROM ${ROLE}`); await adminPg.query(`DROP ROLE IF EXISTS ${ROLE}`) } catch { /* */ } await adminPg.end(); }
  await c?.end(); await db?.drop?.();
});

test('bootstrap, grant and revoke through supabase-js → PostgREST → PostgreSQL', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const svc = client('service_role');
  await assert.rejects(admins.bootstrapSuperAdmin(svc, 'p13@t.local'), /email_not_verified/, 'unverified refused');
  // Concurrent first bootstrap through two independent HTTP clients: exactly one super_admin.
  const race = await Promise.allSettled([admins.bootstrapSuperAdmin(client('service_role'), 'p11@t.local'), admins.bootstrapSuperAdmin(client('service_role'), 'p12@t.local')]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(race.map(r => r.reason?.message || r.value?.status)));
  assert.match(race.find(r => r.status === 'rejected').reason.message, /Active super_admin already exists/);
  const first = race.find(r => r.status === 'fulfilled').value.userId, second = first === 11 ? 12 : 11;
  assert.equal((await admins.bootstrapSuperAdmin(svc, `p${first}@t.local`)).status, 'already_super_admin', 'repeat is idempotent');
  assert.equal(Number((await c.query("SELECT count(*) n FROM audit_events WHERE action='role_bootstrap'")).rows[0].n), 1, 'audited once, in the same transaction');
  // Grant / revoke via the real client; the role and its audit row appear together.
  await admins.grantPlatformAdminRole(svc, { email: `p${second}@t.local`, role: 'platform_admin', actorUserId: first });
  assert.ok(await admins.resolvePlatformAdmin(svc, second, 'email'));
  await assert.rejects(admins.grantPlatformAdminRole(svc, { email: 'p14@t.local', role: 'super_admin', actorUserId: second }), /super_admin_required/);
  await assert.rejects(admins.revokePlatformAdminRole(svc, { targetUserId: first, actorUserId: first }), /cannot_revoke_last_super_admin/);
  await admins.revokePlatformAdminRole(svc, { targetUserId: second, actorUserId: first });
  assert.equal(await admins.resolvePlatformAdmin(svc, second, 'email'), null);
  // Public API keys cannot reach the admin RPCs or tables.
  for (const role of ['anon', 'authenticated']) {
    const x = client(role);
    const r1 = await x.rpc('fn_bootstrap_platform_super_admin', { p_user_id: 14 });
    const r2 = await x.rpc('rpc_platform_admin_grant', { p_actor: first, p_email: 'p14@t.local', p_role: 'super_admin' });
    const r3 = await x.from('platform_admins').select('user_id');
    assert.ok(r1.error && r2.error && r3.error, `${role}: ${JSON.stringify([r1.error, r2.error, r3.error])}`);
  }
  assert.equal(Number((await c.query("SELECT count(*) n FROM platform_admins WHERE user_id=14")).rows[0].n), 0);
});

test('RPC errors fail closed through PostgREST (missing function → PGRST202), no fallback path', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await c.query('ALTER FUNCTION public.fn_bootstrap_platform_super_admin(bigint) RENAME TO fn_bootstrap_platform_super_admin_off');
  await c.query("NOTIFY pgrst, 'reload schema'");
  await new Promise(r => setTimeout(r, 1500));
  const svc = client('service_role');
  await c.query("UPDATE platform_admins SET is_active=false WHERE role='platform_admin'");
  const before = Number((await c.query('SELECT count(*) n FROM platform_admins')).rows[0].n);
  const err = await admins.bootstrapSuperAdmin(svc, 'p14@t.local').then(() => null, e => e);
  assert.ok(err && err.code === 'bootstrap_rpc_failed', String(err?.message));
  assert.match(err.message, /PGRST202|Could not find the function/);
  assert.equal(Number((await c.query('SELECT count(*) n FROM platform_admins')).rows[0].n), before, 'nothing written by any fallback');
  await c.query('ALTER FUNCTION public.fn_bootstrap_platform_super_admin_off(bigint) RENAME TO fn_bootstrap_platform_super_admin');
  await c.query("NOTIFY pgrst, 'reload schema'");
});
