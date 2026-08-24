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
    CREATE TABLE business_members (
      id BIGSERIAL PRIMARY KEY, business_id uuid, user_id BIGINT, role text, status text DEFAULT 'active');
    CREATE TABLE audit_events (
      id BIGSERIAL PRIMARY KEY, business_id uuid, actor_user_id BIGINT, actor_role text,
      channel text, entity_type text, entity_id text, action text,
      before_json jsonb, after_json jsonb, created_at timestamptz DEFAULT now());
    INSERT INTO users VALUES (${OWNER}), (${CFO}), (7700002);
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');
    INSERT INTO business_members (business_id, user_id, role, status) VALUES
      ('${BIZ_A}', ${CFO}, 'cfo', 'active');`);
  await db.exec(SQL);
  return db;
}
const auditCount = async (db) =>
  (await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE entity_type = 'notification_grant'`)).rows[0].n;
const grantEnabled = async (db, user, cat, biz = BIZ_A) =>
  (await db.query(`SELECT enabled FROM business_member_notification_grants
     WHERE business_id='${biz}' AND user_id=${user} AND category='${cat}'`)).rows[0]?.enabled ?? null;
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

// ── Atomic grant change + audit (apply_notification_grants) ──────────────────
const apply = (db, changes, { biz = BIZ_A, user = CFO, by = OWNER, role = 'owner' } = {}) =>
  db.query(`SELECT apply_notification_grants('${biz}', ${user}, ${by}, '${role}', '${JSON.stringify(changes)}'::jsonb) AS r`);

test('apply: a grant writes the row AND exactly one audit event, atomically', async () => {
  const db = await freshDb();
  const { rows } = await apply(db, { company_financial: true });
  assert.strictEqual(rows[0].r.changed, 1);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), true);
  assert.strictEqual(await auditCount(db), 1);
});

test('apply: repeating the same value is idempotent — no duplicate audit', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  const { rows } = await apply(db, { company_financial: true });   // same value again
  assert.strictEqual(rows[0].r.changed, 0, 'a no-op change reported a change');
  assert.strictEqual(await auditCount(db), 1, 'the idempotent repeat wrote a duplicate audit row');
});

test('apply: a revoke writes a revoked audit event', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  await apply(db, { company_financial: false });
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
  const { rows } = await db.query(`SELECT action FROM audit_events WHERE entity_type='notification_grant' ORDER BY id`);
  assert.deepStrictEqual(rows.map(r => r.action), ['granted', 'revoked']);
});

test('apply: a non-grantable target is rejected and writes nothing', async () => {
  const db = await freshDb();
  await db.exec(`UPDATE business_members SET role='manager' WHERE user_id=${CFO}`);   // no longer ceo/cfo
  const err = await fails(db, `SELECT apply_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'owner', '{"company_financial":true}'::jsonb)`);
  assert.ok(err && /member_not_grantable/.test(err), `expected member_not_grantable, got: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), null, 'a grant was written for an ineligible member');
});

test('apply: an unknown category is rejected and writes nothing', async () => {
  const db = await freshDb();
  const err = await fails(db, `SELECT apply_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'owner', '{"not_real":true}'::jsonb)`);
  assert.ok(err && /unknown_category/.test(err), `expected unknown_category, got: ${err}`);
  assert.strictEqual(await auditCount(db), 0);
});

test('apply: if the audit insert fails, the grant change ROLLS BACK', async () => {
  const db = await freshDb();
  // A trigger that rejects any audit insert simulates the audit write failing. Because the
  // function is one transaction, the grant upsert that ran first must be undone.
  await db.exec(`
    CREATE FUNCTION _boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit down'; END $$;
    CREATE TRIGGER _boom_t BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION _boom();`);
  const err = await fails(db, `SELECT apply_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'owner', '{"company_financial":true}'::jsonb)`);
  assert.ok(err && /audit down/.test(err), `expected the audit failure to surface, got: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), null,
    'the grant survived even though its audit event failed — not atomic');
});

// ── Stale-grant disable (disable_member_notification_grants) ─────────────────
test('disable: turns off all enabled grants and audits each as auto_revoked', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true, tax_compliance: true });
  const { rows } = await db.query(`SELECT disable_member_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'admin') AS r`);
  assert.strictEqual(rows[0].r.changed, 2);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
  assert.strictEqual(await grantEnabled(db, CFO, 'tax_compliance'), false);
  const { rows: a } = await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE action='auto_revoked'`);
  assert.strictEqual(a[0].n, 2);
});

test('disable: re-promotion does not restore — grants stay OFF until re-granted', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  await db.query(`SELECT disable_member_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'admin')`);
  // Simulate a re-promotion: role is CFO again. The old row must remain disabled.
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false, 're-promotion silently restored a grant');
});

test('disable is business-scoped: business B grants are untouched', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${BIZ_B}', ${CFO}, 'cfo', 'active')`);
  await apply(db, { company_financial: true }, { biz: BIZ_A });
  await apply(db, { company_financial: true }, { biz: BIZ_B });
  await db.query(`SELECT disable_member_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'admin')`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial', BIZ_A), false);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial', BIZ_B), true, "business A's disable leaked into B");
});

test('the extended migration re-applies cleanly (functions included)', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL), null, 're-applying the extended 046 failed');
});
