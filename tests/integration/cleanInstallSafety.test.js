'use strict';
// scripts/install-v2.mjs on disposable EMPTY databases: full install, idempotent re-run (nothing added), refusal of
// a foreign non-empty database, refusal after a changed baseline, and the customer/test-data gate. Storage is
// skipped here (no Storage API in CI); the bucket step is covered by the clean-install rehearsal.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { assertDisposableUrl, assertDisposableDatabase } = require('./_disposableDbGuard');

const BASE = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgrespassword@localhost:5432/testdb';
const dbs = []; let mod, adminOk = false;
const urlFor = (name) => { const u = new URL(BASE); u.pathname = '/' + name; return u.toString(); };
async function emptyDb(prefix) {
  const a = new Client({ connectionString: BASE }); await a.connect();
  const name = `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  await a.query(`CREATE DATABASE ${name}`); dbs.push(name);
  for (const role of ['anon NOLOGIN', 'authenticated NOLOGIN', 'service_role NOLOGIN BYPASSRLS'])
    await a.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
  await a.end(); return urlFor(name);
}
const quiet = () => {};

before(async () => {
  assertDisposableUrl(BASE, { adminOnly: true });
  const a = new Client({ connectionString: BASE, connectionTimeoutMillis: 4000 });
  try { await a.connect(); await assertDisposableDatabase(a); adminOk = true; } catch { adminOk = false; } finally { await a.end().catch(() => {}); }
  mod = await import('../../scripts/install-v2.mjs');
});
after(async () => {
  if (!adminOk) return;
  const a = new Client({ connectionString: BASE }); await a.connect();
  for (const n of dbs) { await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [n]); await a.query(`DROP DATABASE IF EXISTS ${n}`); }
  await a.end();
});

test('empty database: baseline + reference data + V2 chain + postflight, clean of customer data; re-run adds nothing', async (t) => {
  if (!adminOk) return t.skip('no disposable PostgreSQL');
  const url = await emptyDb('install_clean');
  const plan = await mod.install({ connectionString: url, mode: 'plan', log: quiet }); assert.equal(plan.state, 'EMPTY'); assert.equal(plan.ok, true);
  const r1 = await mod.install({ connectionString: url, mode: 'install', skipStorage: true, log: quiet });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const step = (r, name) => r.steps.find((s) => s.name.startsWith(name));
  assert.match(step(r1, 'V2 migration chain').note, /^31 applied/);
  assert.equal(step(r1, 'no customer or test data').note, 'clean');
  const r2 = await mod.install({ connectionString: url, mode: 'install', skipStorage: true, log: quiet });
  assert.equal(r2.ok, true, JSON.stringify(r2)); assert.equal(r2.state, 'INSTALLED');
  assert.equal(step(r2, 'reference data 001 re-run').note, '0 rows added');
  assert.match(step(r2, 'V2 migration chain').note, /^0 applied/);
  const c = new Client({ connectionString: url }); await c.connect();
  const ledger = (await c.query("SELECT file FROM public.cfo_migration_ledger WHERE file LIKE 'install/%' ORDER BY file")).rows.map((x) => x.file);
  assert.deepEqual(ledger, ['install/000_baseline_public_schema.sql', 'install/001_reference_data.sql']);
  // The pre-launch gate catches customer data.
  await c.query('INSERT INTO public.users(id) VALUES (-424242)');
  const gate = await mod.install({ connectionString: url, mode: 'verify-empty', skipStorage: true, log: quiet });
  assert.equal(gate.ok, false); assert.ok(gate.findings.some((f) => f.startsWith('users:')));
  // A changed baseline after installation stops the run.
  await c.query("UPDATE public.cfo_migration_ledger SET sha256=repeat('0',64) WHERE file='install/000_baseline_public_schema.sql'");
  const changed = await mod.install({ connectionString: url, mode: 'install', skipStorage: true, log: quiet });
  assert.equal(changed.ok, false); assert.match(changed.reason, /changed after installation/);
  await c.end();
});

test('a non-empty database not installed by the installer is refused (existing databases use migrate-v2)', async (t) => {
  if (!adminOk) return t.skip('no disposable PostgreSQL');
  const url = await emptyDb('install_foreign');
  const c = new Client({ connectionString: url }); await c.connect(); await c.query('CREATE TABLE public.users(id bigint)'); await c.end();
  const r = await mod.install({ connectionString: url, mode: 'install', skipStorage: true, log: quiet });
  assert.equal(r.ok, false); assert.equal(r.state, 'FOREIGN');
});
