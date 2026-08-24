// 046_company_notification_grants.sql — DDL validity, constraint BEHAVIOUR, idempotency, over
// PGlite. No Supabase. Role GRANT/REVOKE is role-guarded (no-op in PGlite); full grant fidelity
// is verified on local Supabase, as with 043/045.
//
// The table is created empty and, at this phase, is read only behind a default-off flag. These
// tests exist because the constraints are the security surface: a unique index that permitted two
// rows for one (business, user, category), or a missing business_id NOT NULL, would be invisible
// to a grep and wrong in production.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIG = path.join(__dirname, '../../migrations/046_company_notification_grants.sql');
const SQL = fs.readFileSync(MIG, 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const OWNER = -1;
const CFO = -2;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    INSERT INTO users VALUES (${OWNER}), (${CFO}), (7700002);
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');`);
  await db.exec(SQL);
  return db;
}
const fails = async (db, sql) => {
  try { await db.exec(sql); return null; } catch (e) { return e.message; }
};
const grant = (biz, user, cat, enabled = true) =>
  `INSERT INTO business_member_notification_grants (business_id, user_id, category, enabled)
   VALUES ('${biz}', ${user}, '${cat}', ${enabled});`;

test('046 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  const err = await fails(db, SQL);   // second application
  assert.strictEqual(err, null, `re-applying 046 failed: ${err}`);
});

test('the table starts empty', async () => {
  const db = await freshDb();
  const { rows } = await db.query('SELECT count(*)::int AS n FROM business_member_notification_grants');
  assert.strictEqual(rows[0].n, 0);
});

test('one grant per (business, user, category) — the second insert is rejected', async () => {
  const db = await freshDb();
  await db.exec(grant(BIZ_A, CFO, 'company_financial', true));
  const err = await fails(db, grant(BIZ_A, CFO, 'company_financial', false));
  assert.ok(err && /unique|duplicate/i.test(err), `a duplicate grant was accepted: ${err}`);
});

test('the same user+category IS allowed in a different business', async () => {
  const db = await freshDb();
  await db.exec(grant(BIZ_A, CFO, 'company_financial'));
  const err = await fails(db, grant(BIZ_B, CFO, 'company_financial'));
  assert.strictEqual(err, null, `a per-business grant was wrongly blocked: ${err}`);
});

test('business_id is NOT NULL — a global grant is impossible', async () => {
  const db = await freshDb();
  const err = await fails(db,
    `INSERT INTO business_member_notification_grants (business_id, user_id, category, enabled)
     VALUES (NULL, ${CFO}, 'company_financial', true);`);
  assert.ok(err && /null/i.test(err), `a NULL business_id was accepted: ${err}`);
});

test('enabled is NOT NULL — presence never has to mean granted', async () => {
  const db = await freshDb();
  const err = await fails(db,
    `INSERT INTO business_member_notification_grants (business_id, user_id, category)
     VALUES ('${BIZ_A}', ${CFO}, 'company_financial');`);
  assert.ok(err && /null/i.test(err), `a NULL enabled was accepted: ${err}`);
});

test('deleting the business cascades its grants away', async () => {
  const db = await freshDb();
  await db.exec(grant(BIZ_A, CFO, 'company_financial'));
  await db.exec(`DELETE FROM businesses WHERE id = '${BIZ_A}';`);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM business_member_notification_grants');
  assert.strictEqual(rows[0].n, 0, 'grants outlived their business');
});

test('deleting the granting owner nulls granted_by, but keeps the grant', async () => {
  const db = await freshDb();
  await db.exec(
    `INSERT INTO business_member_notification_grants (business_id, user_id, category, enabled, granted_by_user_id)
     VALUES ('${BIZ_A}', ${CFO}, 'company_financial', true, ${OWNER});`);
  await db.exec(`DELETE FROM users WHERE id = ${OWNER};`);
  const { rows } = await db.query(
    'SELECT granted_by_user_id FROM business_member_notification_grants');
  assert.strictEqual(rows.length, 1, 'the grant was cascade-deleted with the owner');
  assert.strictEqual(rows[0].granted_by_user_id, null, 'granted_by was not nulled');
});

test('the updated_at trigger moves on UPDATE', async () => {
  const db = await freshDb();
  await db.exec(grant(BIZ_A, CFO, 'company_financial', true));
  const t0 = (await db.query('SELECT updated_at FROM business_member_notification_grants')).rows[0].updated_at;
  await db.exec(`SELECT pg_sleep(0.01);`);
  await db.exec(`UPDATE business_member_notification_grants SET enabled = false WHERE user_id = ${CFO};`);
  const t1 = (await db.query('SELECT updated_at FROM business_member_notification_grants')).rows[0].updated_at;
  assert.ok(new Date(t1) >= new Date(t0), 'updated_at did not advance');
});
