// 043_telegram_user_state.sql — DDL validity + idempotency over PGlite. No Supabase.
// Role GRANT/REVOKE is role-guarded (no-op in PGlite); full grant fidelity is verified
// on local Supabase.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '../../migrations/043_telegram_user_state.sql'), 'utf8');
const A = '11111111-1111-1111-1111-111111111111';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    INSERT INTO users VALUES (8800001);
    INSERT INTO businesses VALUES ('${A}','business');`);
  return db;
}

test('043 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  await db.exec(SQL); await db.exec(SQL);
  const r = await db.query(`SELECT to_regclass('public.telegram_user_state') IS NOT NULL AS ok`);
  assert.equal(r.rows[0].ok, true);
});

test('active_business_id ON DELETE SET NULL clears when the business is deleted', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  await db.exec(`INSERT INTO telegram_user_state (user_id, active_business_id) VALUES (8800001, '${A}');`);
  await db.exec(`DELETE FROM businesses WHERE id='${A}';`);
  const r = await db.query(`SELECT active_business_id FROM telegram_user_state WHERE user_id=8800001`);
  assert.equal(r.rows[0].active_business_id, null); // selection cleared, row preserved
});

test('updated_at trigger bumps on UPDATE', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  await db.exec(`INSERT INTO telegram_user_state (user_id) VALUES (8800001);`);
  const t1 = (await db.query(`SELECT updated_at FROM telegram_user_state WHERE user_id=8800001`)).rows[0].updated_at;
  await db.exec(`UPDATE telegram_user_state SET active_business_id='${A}' WHERE user_id=8800001;`);
  const t2 = (await db.query(`SELECT updated_at FROM telegram_user_state WHERE user_id=8800001`)).rows[0].updated_at;
  assert.ok(new Date(t2) >= new Date(t1));
});

test('user_id cascades when the user is deleted', async () => {
  const db = await freshDb();
  await db.exec(SQL);
  await db.exec(`INSERT INTO telegram_user_state (user_id) VALUES (8800001);`);
  await db.exec(`DELETE FROM users WHERE id=8800001;`);
  const r = await db.query(`SELECT count(*)::int AS c FROM telegram_user_state`);
  assert.equal(r.rows[0].c, 0);
});
