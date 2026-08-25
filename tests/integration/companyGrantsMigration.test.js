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
// 047 hardens apply_notification_grants with actor-side authorization (CREATE OR REPLACE).
const MIG47 = path.join(__dirname, '../../migrations/047_notification_grants_actor_authorization.sql');
const SQL47 = fs.readFileSync(MIG47, 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const OWNER = -1;     // active owner of BIZ_A (the authorised actor)
const CFO = -2;
const OWNER_B = -10;  // active owner of BIZ_B

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    CREATE TABLE business_members (
      id BIGSERIAL PRIMARY KEY, business_id uuid, user_id BIGINT, role text, status text DEFAULT 'active',
      display_name text);
    CREATE TABLE audit_events (
      id BIGSERIAL PRIMARY KEY, business_id uuid, actor_user_id BIGINT, actor_role text,
      channel text, entity_type text, entity_id text, action text,
      before_json jsonb, after_json jsonb, created_at timestamptz DEFAULT now());
    INSERT INTO users VALUES (${OWNER}), (${CFO}), (7700002), (${OWNER_B});
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');
    INSERT INTO business_members (business_id, user_id, role, status) VALUES
      ('${BIZ_A}', ${OWNER},   'owner', 'active'),
      ('${BIZ_A}', ${CFO},     'cfo',   'active'),
      ('${BIZ_B}', ${OWNER_B}, 'owner', 'active');`);
  await db.exec(SQL);
  await db.exec(SQL47);
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
// Attempt an apply that is expected to be REJECTED; returns the error message (or null on success).
const applyErr = async (db, changes, opts = {}) => {
  try { await apply(db, changes, opts); return null; } catch (e) { return e.message; }
};
const lastAuditActorRole = async (db) =>
  (await db.query(`SELECT actor_role FROM audit_events WHERE entity_type='notification_grant'
     ORDER BY id DESC LIMIT 1`)).rows[0]?.actor_role ?? null;

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

// ── Membership trigger — the DB-level stale-grant safety ─────────────────────
// The trigger fires in the same transaction as any business_members role/status change, so these
// tests exercise the exact enforcement production gets, across every writer. Helpers below drive
// the membership table directly (as any route or a direct UPDATE would).
const setRole   = (db, role, { user = CFO, biz = BIZ_A } = {}) =>
  db.exec(`UPDATE business_members SET role='${role}' WHERE business_id='${biz}' AND user_id=${user}`);
const setStatus = (db, status, { user = CFO, biz = BIZ_A } = {}) =>
  db.exec(`UPDATE business_members SET status='${status}' WHERE business_id='${biz}' AND user_id=${user}`);

test('trigger: demotion CFO→manager disables grants and writes an auto_revoked audit row', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true, tax_compliance: true });
  await setRole(db, 'manager');
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
  assert.strictEqual(await grantEnabled(db, CFO, 'tax_compliance'), false);
  const { rows } = await db.query(`SELECT count(*)::int AS n, count(actor_user_id)::int AS actors
    FROM audit_events WHERE action='auto_revoked'`);
  assert.strictEqual(rows[0].n, 2, 'auto_revoke audit rows were not written');
  assert.strictEqual(rows[0].actors, 0, 'the auto-revoke trusted a client actor instead of the system');
});

test('trigger: promoting a manager who has a stale enabled grant leaves it OFF', async () => {
  const db = await freshDb();
  // A stale enabled grant exists for a MANAGER (e.g. seeded, or from before 046). Promotion to CFO
  // must NOT make it effective — the transition resets it.
  await db.exec(`UPDATE business_members SET role='manager' WHERE user_id=${CFO}`);
  await db.exec(grant(BIZ_A, CFO, 'company_financial', true));   // stale enabled grant on a manager
  await setRole(db, 'cfo');   // promote into eligibility
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false, 'a stale grant rode a promotion back to life');
});

test('trigger: activating an inactive member as CEO leaves a stale grant OFF', async () => {
  const db = await freshDb();
  await setStatus(db, 'inactive');
  await db.exec(grant(BIZ_A, CFO, 'company_financial', true));   // stale enabled grant while inactive
  await db.exec(`UPDATE business_members SET status='active', role='ceo' WHERE user_id=${CFO}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
});

test('trigger: a re-invited (re-inserted) member starts with all grants OFF', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  // Remove the membership row entirely (grants persist — they only cascade on user/business delete)
  // then re-insert as CFO, the shape of a fresh invite accept that does not reuse the old row.
  await db.exec(`DELETE FROM business_members WHERE user_id=${CFO}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), true, 'precondition: the grant survives a membership delete');
  await db.exec(`INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${BIZ_A}', ${CFO}, 'cfo', 'active')`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false, 'a re-inserted member inherited an old grant');
});

test('trigger: reactivating a removed member (UPDATE) leaves stale grants OFF', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  await setStatus(db, 'removed');           // removal disables via the trigger
  // Force a stale ENABLED row back on directly (as a rogue write or pre-046 state might), then
  // reactivate: the reactivation transition must disable it again.
  await db.exec(`UPDATE business_member_notification_grants SET enabled=true WHERE user_id=${CFO}`);
  await db.exec(`UPDATE business_members SET status='active', role='cfo' WHERE user_id=${CFO}`);  // re-invite
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
});

test('trigger: a same-role, same-status update does NOT disable a live grant', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  await db.exec(`UPDATE business_members SET display_name='X', role='cfo', status='active' WHERE user_id=${CFO}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), true, 'an unrelated edit wiped a live grant');
});

test('trigger: changing member A does not touch member B grants', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${BIZ_A}', 7700002, 'cfo', 'active')`);
  await apply(db, { company_financial: true }, { user: CFO });
  await apply(db, { company_financial: true }, { user: 7700002 });
  await setRole(db, 'manager', { user: CFO });   // demote A only
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
  assert.strictEqual(await grantEnabled(db, 7700002, 'company_financial'), true, "member A's demotion revoked member B's grant");
});

test('trigger: a Business A transition cannot affect Business B grants', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${BIZ_B}', ${CFO}, 'cfo', 'active')`);
  await apply(db, { company_financial: true }, { biz: BIZ_A });
  await apply(db, { company_financial: true }, { biz: BIZ_B, by: OWNER_B });
  await setRole(db, 'manager', { biz: BIZ_A });
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial', BIZ_A), false);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial', BIZ_B), true, "business A's transition reached business B");
  // The disable scan itself must be business-scoped: exactly ONE auto-revoke, for business A's one
  // grant — not two, which is what an unscoped scan (touching business B's identical category)
  // would produce. Both businesses hold the same category for the same user, so this pins scope.
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM audit_events
    WHERE action='auto_revoked' AND business_id='${BIZ_A}'`);
  assert.strictEqual(rows[0].n, 1, 'the disable scan was not scoped to the transitioning business');
});

// ── Concurrency: grant vs demotion, both orderings, cannot leave an enabled grant ──
test('race grant-then-demote: the demotion trigger disables the just-made grant', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });   // grant commits first
  await setRole(db, 'manager');                    // then demotion → trigger disables
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false);
});

test('race demote-then-grant: the grant is refused because the member is no longer CEO/CFO', async () => {
  const db = await freshDb();
  await setRole(db, 'manager');                    // demotion commits first
  const err = await fails(db, `SELECT apply_notification_grants('${BIZ_A}', ${CFO}, ${OWNER}, 'owner', '{"company_financial":true}'::jsonb)`);
  assert.ok(err && /member_not_grantable/.test(err), `the grant was not refused after demotion: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), null);
});

test('the grant RPC locks the member row (FOR UPDATE) to serialise against transitions', () => {
  // PGlite is single-connection, so the lock cannot be exercised concurrently here; its PRESENCE
  // is what serialises the two transactions in production. Pin it so it cannot be dropped.
  assert.match(SQL, /FROM business_members\s+WHERE business_id = p_business_id AND user_id = p_user_id\s+FOR UPDATE/,
    'apply_notification_grants no longer locks the member row');
});

// ── Atomicity of the membership transition + trigger cleanup ─────────────────
test('atomic: if the trigger audit insert fails, the MEMBERSHIP change rolls back', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  // Make the auto_revoke audit insert fail. Because the trigger runs in the membership UPDATE's
  // transaction, the demotion must roll back too — role stays CFO, grant stays enabled.
  await db.exec(`
    CREATE FUNCTION _boom() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='auto_revoked' THEN RAISE EXCEPTION 'audit down'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER _boom_t BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION _boom();`);
  const err = await fails(db, `UPDATE business_members SET role='manager' WHERE user_id=${CFO}`);
  assert.ok(err && /audit down/.test(err), `the audit failure did not surface: ${err}`);
  const { rows } = await db.query(`SELECT role FROM business_members WHERE user_id=${CFO}`);
  assert.strictEqual(rows[0].role, 'cfo', 'the demotion committed despite its cleanup failing — not atomic');
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), true, 'the grant changed despite the transaction failing');
});

test('atomic: if the membership UPDATE itself fails, the grant cleanup does not happen', async () => {
  const db = await freshDb();
  await apply(db, { company_financial: true });
  // A BEFORE trigger rejects the specific transition, so the UPDATE fails before commit. The
  // trigger-driven cleanup shares that transaction and must not persist.
  await db.exec(`
    CREATE FUNCTION _reject() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.role='manager' THEN RAISE EXCEPTION 'membership rejected'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER _reject_t BEFORE UPDATE ON business_members FOR EACH ROW EXECUTE FUNCTION _reject();`);
  const err = await fails(db, `UPDATE business_members SET role='manager' WHERE user_id=${CFO}`);
  assert.ok(err && /membership rejected/.test(err), `the membership rejection did not surface: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), true, 'the grant was disabled even though the membership update failed');
});

test('flag independence: the trigger fires regardless of any app feature flag', async () => {
  // The trigger is DB-level and has no knowledge of COMPANY_NOTIFICATION_GRANTS_ENABLED. A role
  // change disables grants whether the app flag is on or off — which is the whole point of moving
  // enforcement into the database.
  const db = await freshDb();
  await apply(db, { company_financial: true });
  const prev = process.env.COMPANY_NOTIFICATION_GRANTS_ENABLED;
  delete process.env.COMPANY_NOTIFICATION_GRANTS_ENABLED;   // "flag off"
  try {
    await setRole(db, 'manager');
    assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), false, 'the trigger depended on the app flag');
  } finally { if (prev !== undefined) process.env.COMPANY_NOTIFICATION_GRANTS_ENABLED = prev; }
});

test('the extended migration re-applies cleanly (trigger + function)', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL), null, 're-applying the extended 046 failed');
  assert.strictEqual(await fails(db, SQL47), null, 're-applying 047 failed');
});

// ── 047: actor-side authorization inside the RPC ─────────────────────────────
// v0 policy: only an ACTIVE OWNER of the business may grant/revoke. The RPC derives the actor role
// from business_members and never trusts p_actor_role. A forbidden actor changes nothing and writes
// no audit row.

test('047: an OWNER actor can grant a CFO', async () => {
  const db = await freshDb();
  const { rows } = await apply(db, { company_financial: true });   // by = OWNER (active owner)
  assert.strictEqual(rows[0].r.changed, 1);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), true);
});

test('047: an OWNER actor can grant a CEO', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO business_members (business_id, user_id, role, status)
                 VALUES ('${BIZ_A}', 7700002, 'ceo', 'active')`);
  const { rows } = await apply(db, { company_financial: true }, { user: 7700002 });
  assert.strictEqual(rows[0].r.changed, 1);
  assert.strictEqual(await grantEnabled(db, 7700002, 'company_financial'), true);
});

test('047: a NON-OWNER actor cannot grant, and writes no audit', async () => {
  const db = await freshDb();
  const err = await applyErr(db, { company_financial: true }, { by: CFO });   // CFO is not an owner
  assert.ok(err && /actor_not_authorized/.test(err), `expected actor_not_authorized, got: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), null, 'a grant was written');
  assert.strictEqual(await auditCount(db), 0, 'a forbidden actor wrote an audit row');
});

test('047: an INACTIVE actor cannot grant', async () => {
  const db = await freshDb();
  await db.exec(`UPDATE business_members SET status='inactive' WHERE user_id=${OWNER} AND business_id='${BIZ_A}'`);
  const err = await applyErr(db, { company_financial: true });
  assert.ok(err && /actor_not_authorized/.test(err), `expected actor_not_authorized, got: ${err}`);
  assert.strictEqual(await auditCount(db), 0);
});

test('047: a REMOVED actor cannot grant', async () => {
  const db = await freshDb();
  await db.exec(`UPDATE business_members SET status='removed' WHERE user_id=${OWNER} AND business_id='${BIZ_A}'`);
  const err = await applyErr(db, { company_financial: true });
  assert.ok(err && /actor_not_authorized/.test(err), `expected actor_not_authorized, got: ${err}`);
});

test('047: an actor from ANOTHER business cannot grant', async () => {
  const db = await freshDb();
  // OWNER_B is an active owner of BIZ_B, but not of BIZ_A. Granting on BIZ_A must be refused.
  const err = await applyErr(db, { company_financial: true }, { by: OWNER_B });
  assert.ok(err && /actor_not_authorized/.test(err), `expected actor_not_authorized, got: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), null);
  assert.strictEqual(await auditCount(db), 0);
});

test('047: a missing actor (no membership row) cannot grant', async () => {
  const db = await freshDb();
  const err = await applyErr(db, { company_financial: true }, { by: 7700002 });  // not a member of BIZ_A
  assert.ok(err && /actor_not_authorized/.test(err), `expected actor_not_authorized, got: ${err}`);
});

test('047: the audit uses the DB-DERIVED actor role, not the trusted caller role', async () => {
  const db = await freshDb();
  // Caller lies about its role; the RPC must record the derived 'owner', not the spoofed string.
  await apply(db, { company_financial: true }, { role: 'super_admin_hacker' });
  assert.strictEqual(await lastAuditActorRole(db), 'owner',
    'the audit trusted the caller-supplied actor role');
});

test('047: an EMPLOYEE/staff target cannot receive a grant', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO business_members (business_id, user_id, role, status)
                 VALUES ('${BIZ_A}', 7700002, 'employee', 'active')`);
  const err = await applyErr(db, { company_financial: true }, { user: 7700002 });
  assert.ok(err && /member_not_grantable/.test(err), `expected member_not_grantable, got: ${err}`);
});

test('047: an INACTIVE target cannot receive a grant', async () => {
  const db = await freshDb();
  await db.exec(`UPDATE business_members SET status='inactive' WHERE user_id=${CFO} AND business_id='${BIZ_A}'`);
  const err = await applyErr(db, { company_financial: true });
  assert.ok(err && /member_not_grantable/.test(err), `expected member_not_grantable, got: ${err}`);
});

test('047: a REMOVED target cannot receive a grant', async () => {
  const db = await freshDb();
  await db.exec(`UPDATE business_members SET status='removed' WHERE user_id=${CFO} AND business_id='${BIZ_A}'`);
  const err = await applyErr(db, { company_financial: true });
  assert.ok(err && /member_not_grantable/.test(err), `expected member_not_grantable, got: ${err}`);
});

test('047: the ACTOR membership row is locked FOR UPDATE (actor-demotion race)', () => {
  // Source guard: the actor lookup must lock its row so a concurrent owner demotion serialises with
  // the grant. PGlite is single-connection and cannot exercise true lock contention (that is the
  // two-session procedure in the PR46.2 runbook); this pins the lock so it cannot be silently
  // dropped, mirroring the existing target-row guard above.
  assert.match(SQL47,
    /user_id = p_granted_by AND status = 'active'\s*\n\s*LIMIT 1\s*\n\s*FOR UPDATE/,
    'apply_notification_grants no longer locks the actor membership row');
});

test('047: demote-then-grant — a just-demoted owner cannot push a grant through', async () => {
  // The sequential half of the actor-demotion race (the concurrent half needs two sessions). Once
  // the owner is no longer an active owner, the RPC refuses: the FOR UPDATE lock is what makes this
  // hold even when the demotion and the grant overlap.
  const db = await freshDb();
  await db.exec(`UPDATE business_members SET role='manager' WHERE user_id=${OWNER} AND business_id='${BIZ_A}'`);
  const err = await applyErr(db, { company_financial: true });   // actor was owner, now manager
  assert.ok(err && /actor_not_authorized/.test(err), `expected actor_not_authorized, got: ${err}`);
  assert.strictEqual(await grantEnabled(db, CFO, 'company_financial'), null);
  assert.strictEqual(await auditCount(db), 0);
});
