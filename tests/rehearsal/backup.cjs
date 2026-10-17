'use strict';
// Phase K2 — backup of the clean install after realistic synthetic operations, restored into a SEPARATE fresh
// Supabase-equivalent instance (db + GoTrue + Storage). Covers Postgres (public, auth, storage schemas) AND the
// Storage object files (a separate backend). Every resource is xr-ci-*, 127.0.0.1 only.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');
const { Client } = require('pg');
const { assert, collector, state, S } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/backup.json');
const DIR = require('./env.cjs').HOME + '/backup'; fs.mkdirSync(DIR, { recursive: true });
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const docker = (...a) => sh('docker', a, { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const KEY = crypto.randomBytes(32); fs.writeFileSync(DIR + '/backup.key', KEY.toString('hex'), { mode: 0o600 });
const enc = (buf) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const out = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), out]); };
const dec = (blob) => { const d = crypto.createDecipheriv('aes-256-gcm', KEY, blob.subarray(0, 12)); d.setAuthTag(blob.subarray(12, 28)); return Buffer.concat([d.update(blob.subarray(28)), d.final()]); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const url = (port) => `postgresql://supabase_admin:${S.db_password}@127.0.0.1:${port}/postgres`;
async function metrics(port) {
  const c = new Client({ connectionString: url(port) }); await c.connect();
  const q = async (s) => (await c.query(s)).rows;
  const digest = async (t, order = 'id') => (await q(`SELECT count(*)::int n, md5(coalesce(string_agg(md5(row_to_json(x)::text), '' ORDER BY ${order}), '')) h FROM public.${t} x`))[0];
  const m = { tables: {} };
  for (const t of ['users', 'user_email_identities', 'user_profiles', 'auth_user_links', 'auth_app_sessions', 'platform_admins', 'businesses', 'business_members', 'wallets', 'transactions', 'debts',
    'bank_import_batches', 'bank_import_rows', 'financial_documents', 'document_files', 'document_audit', 'billing_accounts', 'billing_grants', 'plan_versions', 'audit_events', 'cfo_migration_ledger'])
    m.tables[t] = await digest(t, ['users', 'user_email_identities', 'user_profiles', 'auth_user_links'].includes(t) ? 'user_id' : t === 'cfo_migration_ledger' ? 'file' : 'id').catch((e) => ({ error: e.message.slice(0, 80) }));
  m.balances = await q('SELECT id, fn_wallet_ledger_balance(id)::text b FROM public.wallets ORDER BY id');
  m.auth_users = (await q("SELECT count(*)::int n, md5(string_agg(id::text||email||coalesce(encrypted_password,'')||coalesce(email_confirmed_at::text,''), '' ORDER BY id)) h FROM auth.users"))[0];
  m.storage_objects = (await q("SELECT count(*)::int n, md5(string_agg(bucket_id||name, '' ORDER BY name)) h FROM storage.objects"))[0];
  m.buckets = await q('SELECT id, public FROM storage.buckets ORDER BY id');
  m.functions = (await q("SELECT count(*)::int n, md5(string_agg(md5(pg_get_functiondef(p.oid)), '' ORDER BY p.proname, p.oid::regprocedure::text)) h FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'"))[0];
  m.grants = (await q("SELECT md5(string_agg(grantee||table_name||privilege_type, ',' ORDER BY grantee, table_name, privilege_type)) h FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')"))[0].h;
  m.rls = (await q("SELECT md5(string_agg(relname||relrowsecurity::text, ',' ORDER BY relname)) h FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'"))[0].h;
  m.policies = (await q("SELECT count(*)::int n, md5(string_agg(schemaname||tablename||policyname||coalesce(qual,''), ',' ORDER BY schemaname, tablename, policyname)) h FROM pg_policies WHERE schemaname IN ('public','storage')"))[0];
  await c.end(); return m;
}
(async () => {
  const before = await metrics(55440);
  let dumpBytes, filesBytes;
  await check('backup: pg_dump (public + auth + storage schemas) and the Storage file tree, both encrypted at rest with a checksum', async () => {
    const t0 = Date.now();
    const dump = docker('exec', 'xr-ci-db', 'pg_dump', '-Fc', '-U', 'supabase_admin', '-h', '127.0.0.1', '-d', 'postgres', '-n', 'public', '-n', 'auth', '-n', 'storage');
    const files = docker('exec', 'xr-ci-storage', 'tar', '-C', '/var/lib/storage', '-cf', '-', '.');
    fs.writeFileSync(DIR + '/db.dump.enc', enc(dump), { mode: 0o600 }); fs.writeFileSync(DIR + '/storage.tar.enc', enc(files), { mode: 0o600 });
    dumpBytes = dump.length; filesBytes = files.length;
    state({ backup: { db_sha256: sha(dump), files_sha256: sha(files), db_bytes: dump.length, files_bytes: files.length, ms: Date.now() - t0 } });
    return { db_bytes: dump.length, files_bytes: files.length, ms: Date.now() - t0 };
  });
  await check('restore: a fresh second instance receives the decrypted dump (checksums verified) with zero restore errors', async () => {
    const t0 = Date.now(), b = state().backup;
    const dump = dec(fs.readFileSync(DIR + '/db.dump.enc')); assert.equal(sha(dump), b.db_sha256);
    try { docker('rm', '-f', '-v', 'xr-ci-db2'); } catch { /* none */ }
    docker('run', '-d', '--name', 'xr-ci-db2', '--network', 'xr-ci-net', '-p', '127.0.0.1:55460:5432'.replace('55460', '55446'), '-e', 'POSTGRES_PASSWORD=' + S.db_password, '-e', 'JWT_SECRET=' + S.supabase_jwt_secret, 'public.ecr.aws/supabase/postgres:17.6.1.158');
    for (let i = 0; i < 90; i++) { try { docker('exec', 'xr-ci-db2', 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
    await new Promise((r) => setTimeout(r, 4000));
    sh('docker', ['exec', '-i', 'xr-ci-db2', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-h', '127.0.0.1', '-d', 'postgres', '-q'],
      { input: `ALTER USER authenticator WITH PASSWORD '${S.db_password}'; ALTER USER supabase_auth_admin WITH PASSWORD '${S.db_password}'; ALTER USER supabase_storage_admin WITH PASSWORD '${S.db_password}';`, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    let errors = '';
    try { sh('docker', ['exec', '-i', 'xr-ci-db2', 'pg_restore', '-U', 'supabase_admin', '-h', '127.0.0.1', '-d', 'postgres', '--clean', '--if-exists'], { input: dump, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }); }
    catch (e) { errors = String(e.stderr || e.message); }
    fs.writeFileSync(DIR + '/restore-errors.txt', errors);
    const lines = errors.split('\n').filter((l) => /error/i.test(l));
    assert.equal(lines.length, 0, lines.slice(0, 6).join(' | '));
    return { ms: Date.now() - t0 };
  });
  let after;
  await check('restored database = source: every table digest, wallet balance, billing, auth users, storage metadata, functions, grants, RLS, policies', async () => {
    after = await metrics(55446);
    const diff = [];
    for (const [k, v] of Object.entries(before)) if (JSON.stringify(v) !== JSON.stringify(after[k])) diff.push(k);
    for (const [t, v] of Object.entries(before.tables)) if (JSON.stringify(v) !== JSON.stringify(after.tables[t])) diff.push('table:' + t);
    assert.deepEqual(diff, []);
    return { tables: Object.keys(before.tables).length, wallets: before.balances.length, auth_users: before.auth_users.n, storage_objects: before.storage_objects.n, functions: before.functions.n, policies: before.policies.n };
  });
  await check('migration ledger and postflight invariants hold on the restored database (runner --check)', async () => {
    const out = sh('node', ['scripts/migrate-v2.mjs', '--check'], { cwd: require('./env.cjs').ROOT, env: { ...process.env, DATABASE_URL: url(55446).replace('supabase_admin', 'postgres') } }).toString();
    // Same checks as the source database, all passing (the count follows the migration manifest, not a constant).
    const src = sh('node', ['scripts/migrate-v2.mjs', '--check'], { cwd: require('./env.cjs').ROOT, env: { ...process.env, DATABASE_URL: url(55440).replace('supabase_admin', 'postgres') } }).toString();
    const ok = (out.match(/^OK/mg) || []).length, expected = (src.match(/^OK/mg) || []).length;
    assert.ok(!/^(FAIL|NOT OK)/m.test(out), out.slice(-400)); assert.ok(expected >= 13, 'source postflight'); assert.equal(ok, expected, out.slice(-400));
    return { postflight_ok: ok, source_postflight_ok: expected };
  });
  await check('Auth recovers: a NEW GoTrue on the restored database signs a customer in with the original password; app link intact', async () => {
    try { docker('rm', '-f', 'xr-ci-auth2'); } catch { /* none */ }
    docker('run', '-d', '--name', 'xr-ci-auth2', '--network', 'xr-ci-net', '-p', '127.0.0.1:55453:9999', '-e', 'GOTRUE_API_HOST=0.0.0.0', '-e', 'GOTRUE_API_PORT=9999',
      '-e', 'API_EXTERNAL_URL=http://127.0.0.1:55453', '-e', 'GOTRUE_DB_DRIVER=postgres', '-e', `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${S.db_password}@xr-ci-db2:5432/postgres`,
      '-e', 'GOTRUE_SITE_URL=http://127.0.0.1:55470', '-e', 'GOTRUE_JWT_SECRET=' + S.supabase_jwt_secret, '-e', 'GOTRUE_JWT_EXP=3600', '-e', 'GOTRUE_JWT_AUD=authenticated',
      '-e', 'GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated', '-e', 'GOTRUE_JWT_ADMIN_ROLES=service_role', '-e', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true', '-e', 'GOTRUE_MAILER_AUTOCONFIRM=false',
      '-e', 'GOTRUE_SMTP_HOST=xr-ci-mail', '-e', 'GOTRUE_SMTP_PORT=1025', '-e', 'GOTRUE_SMTP_ADMIN_EMAIL=no-reply@rehearsal.invalid', 'public.ecr.aws/supabase/gotrue:v2.195.0');
    let r;
    for (let i = 0; i < 40; i++) { r = await fetch('http://127.0.0.1:55453/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner.alpha@rehearsal.test', password: state().alpha_password }) }).catch(() => null); if (r && r.status !== 502 && r.status < 500) break; await new Promise((x) => setTimeout(x, 1000)); }
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body).slice(0, 200));
    const c = new Client({ connectionString: url(55446) }); await c.connect();
    const link = (await c.query('SELECT user_id FROM public.auth_user_links WHERE auth_user_id=$1', [body.user.id])).rows[0]; await c.end();
    assert.ok(link && Number(link.user_id) < 0, 'auth user is not linked to its app identity after restore');
    return { auth_user_restored: true, linked_app_user: Number(link.user_id) };
  });
  await check('Storage recovers: files restored into a NEW Storage service; every object row has its file and documents download byte-identical', async () => {
    const files = dec(fs.readFileSync(DIR + '/storage.tar.enc')); assert.equal(sha(files), state().backup.files_sha256);
    try { docker('rm', '-f', '-v', 'xr-ci-storage2'); } catch { /* none */ }
    docker('run', '-d', '--name', 'xr-ci-storage2', '--network', 'xr-ci-net', '-p', '127.0.0.1:55455:5000', '-e', 'ANON_KEY=' + S.anon_key, '-e', 'SERVICE_KEY=' + S.service_key,
      '-e', 'POSTGREST_URL=http://xr-ci-rest:3000', '-e', 'PGRST_JWT_SECRET=' + S.supabase_jwt_secret, '-e', 'AUTH_JWT_SECRET=' + S.supabase_jwt_secret,
      '-e', `DATABASE_URL=postgres://supabase_storage_admin:${S.db_password}@xr-ci-db2:5432/postgres`, '-e', 'FILE_SIZE_LIMIT=52428800', '-e', 'STORAGE_BACKEND=file',
      '-e', 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage', '-e', 'TENANT_ID=stub', '-e', 'REGION=stub', '-e', 'GLOBAL_S3_BUCKET=stub', '-e', 'ENABLE_IMAGE_TRANSFORMATION=false', 'public.ecr.aws/supabase/storage-api:v1.68.10');
    sh('docker', ['exec', '-i', 'xr-ci-storage2', 'sh', '-c', 'mkdir -p /var/lib/storage && tar -C /var/lib/storage -xf -'], { input: files, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    const c = new Client({ connectionString: url(55446) }); await c.connect();
    const objs = (await c.query("SELECT bucket_id, name FROM storage.objects ORDER BY name")).rows; await c.end();
    const src = new Client({ connectionString: url(55440) }); await src.connect(); await src.end();
    let ok = 0;
    for (let i = 0; i < 40; i++) { const h = await fetch('http://127.0.0.1:55455/status').catch(() => null); if (h && h.status < 500) break; await new Promise((x) => setTimeout(x, 1000)); }
    for (const o of objs) {
      const a = await fetch(`http://127.0.0.1:55455/object/${o.bucket_id}/${o.name}`, { headers: { authorization: 'Bearer ' + S.service_key, apikey: S.service_key } });
      const b = await fetch(`http://127.0.0.1:55445/object/${o.bucket_id}/${o.name}`, { headers: { authorization: 'Bearer ' + S.service_key, apikey: S.service_key } });
      assert.equal(a.status, 200, `${o.name}: restored ${a.status}`);
      assert.equal(sha(Buffer.from(await a.arrayBuffer())), sha(Buffer.from(await b.arrayBuffer())), 'bytes differ: ' + o.name); ok++;
    }
    assert.ok(ok > 0, 'no objects to verify');
    return { objects_verified: ok };
  });
  process.exit(save({ before_summary: { tables: Object.keys(before.tables).length } }) ? 0 : 1);
})().catch((e) => { console.error('BACKUP CRASHED', e); process.exit(1); });
