// Throwaway PostgreSQL database with the REAL production schema (tests/fixtures/schema snapshot)
// plus the migrations under test. Each call creates its own database, so these tests never share
// tables with the hand-written schemas other integration tests create in the CI database.
// Needs DATABASE_URL (a superuser, as in the CI postgres service); otherwise callers skip.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');
const SNAPSHOT = path.join(ROOT, 'tests', 'fixtures', 'schema', 'prod_public_schema_2026-10-08.sql');
const BASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgrespassword@localhost:5432/testdb';

function urlForDatabase(name) {
  const u = new URL(BASE_URL);
  u.pathname = '/' + name;
  return u.toString();
}

// Returns { connectionString, name, drop() } or null when PostgreSQL is not reachable.
async function createProdSchemaDatabase(prefix, migrations = []) {
  const admin = new Client({ connectionString: BASE_URL, connectionTimeoutMillis: 4000 });
  try { await admin.connect(); } catch (e) {
    console.warn(`[SKIP] PostgreSQL not reachable (${e.message}).`);
    return null;
  }
  const name = `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  // Supabase roles the schema and migrations refer to (cluster-wide, created once).
  // (duplicate_object is ignored: several test files may create them at the same moment)
  for (const role of ['anon NOLOGIN', 'authenticated NOLOGIN', 'service_role NOLOGIN BYPASSRLS']) {
    await admin.query(`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
  }
  await admin.end();

  const connectionString = urlForDatabase(name);
  const c = new Client({ connectionString });
  await c.connect();
  await c.query(fs.readFileSync(SNAPSHOT, 'utf8'));
  // Like Supabase: the API roles can use the schema; RLS (enabled on every table) still applies.
  await c.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await c.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role');
  for (const m of migrations) await c.query(fs.readFileSync(path.join(ROOT, 'migrations', m), 'utf8'));
  await c.end();

  return {
    name,
    connectionString,
    async drop() {
      const a = new Client({ connectionString: BASE_URL });
      await a.connect();
      await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`);
      await a.query(`DROP DATABASE IF EXISTS ${name}`);
      await a.end();
    },
  };
}

module.exports = { createProdSchemaDatabase };
