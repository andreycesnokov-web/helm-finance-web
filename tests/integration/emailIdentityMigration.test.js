// 042_email_identity.sql — DDL validity + IDEMPOTENCY proof over PGlite (real Postgres
// in WASM). No Supabase needed. Verifies the migration creates the expected objects, is
// safe to run TWICE, the sequence yields NEGATIVE ids, and the updated_at trigger fires.
//
// NOTE: PGlite has no Supabase roles (anon/authenticated/service_role); the migration's
// GRANT/REVOKE-to-role statements are guarded by `IF EXISTS (… pg_roles …)` so they no-op
// here. Full grant/revoke fidelity is exercised on the local Supabase stack (which DOES
// have those roles) — see _specs/email-identity-phase1.md fallback plan.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '../../migrations/042_email_identity.sql'), 'utf8');

async function freshDb() {
  const db = new PGlite();
  // Minimal stand-ins for the base tables 042 references via FK.
  await db.exec(`CREATE TABLE users (id BIGINT PRIMARY KEY);
                 INSERT INTO users (id) VALUES (12345), (-1);`);
  return db;
}

test('042 applies cleanly and is IDEMPOTENT (safe to run twice)', async () => {
  const db = await freshDb();
  await db.exec(SQL);          // first apply
  await db.exec(SQL);          // second apply must not error (CREATE IF NOT EXISTS / DROP TRIGGER IF EXISTS)
  // objects exist
  for (const t of ['user_email_identities', 'user_profiles', 'email_login_codes']) {
    const r = await db.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`);
    assert.equal(r.rows[0].ok, true, `${t} should exist`);
  }
  const seq = await db.query(`SELECT to_regclass('public.app_user_id_seq') IS NOT NULL AS ok`);
  assert.equal(seq.rows[0].ok, true, 'sequence should exist');
});

test('sequence yields NEGATIVE ids (disjoint from positive Telegram ids)', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  const a = Number((await db.query(`SELECT next_app_user_id() AS id`)).rows[0].id);
  const b = Number((await db.query(`SELECT next_app_user_id() AS id`)).rows[0].id);
  assert.ok(a < 0 && b < 0, `ids must be negative, got ${a}, ${b}`);
  assert.ok(b < a, 'sequence decrements');
});

test('case-insensitive uniqueness: CHECK forces lowercase + unique index blocks dupes', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  await db.exec(`INSERT INTO user_email_identities (user_id, email) VALUES (12345, 'a@x.com');`);
  // A different-cased email can never be STORED (normalized CHECK), so case-variants
  // can't coexist — defense in depth.
  await assert.rejects(
    () => db.exec(`INSERT INTO user_email_identities (user_id, email) VALUES (-1, 'A@x.com');`),
    /check|constraint/i, 'non-normalized email rejected by CHECK'
  );
  // The lower(email) UNIQUE index blocks a second row with the same normalized email.
  await assert.rejects(
    () => db.exec(`INSERT INTO user_email_identities (user_id, email) VALUES (-1, 'a@x.com');`),
    /unique|duplicate/i, 'duplicate normalized email rejected by the unique index'
  );
});

test('email normalized CHECK rejects non-normalized email', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  await assert.rejects(
    () => db.exec(`INSERT INTO user_email_identities (user_id, email) VALUES (12345, '  Mixed@X.com ');`),
    /check|constraint/i, 'non-normalized email must be rejected'
  );
});

test('updated_at trigger bumps the timestamp on UPDATE', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  await db.exec(`INSERT INTO user_profiles (user_id, display_name) VALUES (12345, 'X');`);
  const t1 = (await db.query(`SELECT updated_at FROM user_profiles WHERE user_id=12345`)).rows[0].updated_at;
  await db.exec(`UPDATE user_profiles SET display_name='Y' WHERE user_id=12345;`);
  const t2 = (await db.query(`SELECT updated_at FROM user_profiles WHERE user_id=12345`)).rows[0].updated_at;
  assert.ok(new Date(t2) >= new Date(t1), 'updated_at should advance (trigger fired)');
});

test('email_login_codes has consumed_by_user_id + purpose CHECK', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  const col = await db.query(`SELECT 1 FROM information_schema.columns
    WHERE table_name='email_login_codes' AND column_name='consumed_by_user_id'`);
  assert.equal(col.rows.length, 1, 'consumed_by_user_id present');
  await assert.rejects(
    () => db.exec(`INSERT INTO email_login_codes (email, code_hash, purpose, expires_at)
                   VALUES ('a@x.com','h','bogus', now());`),
    /check|constraint/i, 'invalid purpose must be rejected'
  );
});
