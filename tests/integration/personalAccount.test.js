// Personal Account v1 — isolation + provisioning contract over PGlite (real SQL via
// the supabase shim + the real migration-044 guards). Proves the hard isolation rules
// without a running Supabase: personal finance is scoped strictly by
// business_id = personal_workspace_id AND scope='personal'; provisioning creates ONLY
// a type='personal' workspace, at most one per user; the DB trigger rejects non-owner
// personal members; and a business id is rejected on the personal path.
const { test } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { makeClient } = require('./_pgliteSupabase');
const PW = require('../../server/lib/personalWorkspace');

const USER = -10;        // email-first (negative id)
const OTHER = -11;
const BIZ = '11111111-1111-1111-1111-111111111111';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY);
    INSERT INTO users VALUES (${USER}),(${OTHER});
    CREATE TABLE businesses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id bigint NOT NULL,
      name text NOT NULL, type text NOT NULL DEFAULT 'business', base_currency text DEFAULT 'IDR',
      plan text DEFAULT 'free', created_at timestamptz DEFAULT now());
    CREATE TABLE business_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, user_id bigint NOT NULL,
      role text DEFAULT 'owner', status text DEFAULT 'active');
    CREATE TABLE wallets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id bigint, business_id uuid, scope text DEFAULT 'business',
      name text, type text, currency text DEFAULT 'IDR', color text, is_active boolean DEFAULT true,
      sort_order int DEFAULT 0, created_by_user_id bigint, updated_at timestamptz);
    CREATE TABLE transactions (
      id bigserial PRIMARY KEY, business_id uuid, user_id bigint, created_by_user_id bigint, scope text,
      type text, amount_original numeric, amount_idr numeric, currency_original text, wallet_id uuid,
      category text, description text, transaction_date date, source text, created_at timestamptz DEFAULT now());
    CREATE TABLE cashflow_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id bigint, business_id uuid, name text NOT NULL,
      group_type text NOT NULL, activity_type text, is_system boolean DEFAULT false, sort_order int DEFAULT 0);

    -- A pre-existing BUSINESS workspace owned by USER (must never mix with personal).
    INSERT INTO businesses (id, owner_user_id, name, type) VALUES ('${BIZ}', ${USER}, 'Acme', 'business');
    INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${BIZ}', ${USER}, 'owner', 'active');
  `);
  // Migration 044 guards (exact objects from migrations/044_personal_account_v1_foundation.sql).
  await db.exec(`
    CREATE OR REPLACE FUNCTION fn_personal_v1_owner_only_membership() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE v_type text; v_owner bigint;
    BEGIN
      SELECT type, owner_user_id INTO v_type, v_owner FROM businesses WHERE id = NEW.business_id;
      IF v_type = 'personal' AND NEW.user_id IS DISTINCT FROM v_owner THEN
        RAISE EXCEPTION 'personal workspace is owner-only in V1 (no non-owner members)';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS trg_personal_v1_owner_only ON business_members;
    CREATE TRIGGER trg_personal_v1_owner_only BEFORE INSERT OR UPDATE ON business_members
      FOR EACH ROW EXECUTE FUNCTION fn_personal_v1_owner_only_membership();
    CREATE UNIQUE INDEX businesses_one_personal_v1_per_owner_uidx
      ON businesses (owner_user_id) WHERE type = 'personal';
  `);
  return { db, supabase: makeClient(db) };
}

test('provision creates exactly ONE type=personal workspace + owner membership + seeded categories', async () => {
  const { db, supabase } = await setup();
  const ws = await PW.provisionPersonalWorkspace(supabase, USER);
  assert.equal(ws.type, 'personal');
  assert.equal(ws.owner_user_id, USER);
  const biz = await db.query(`SELECT count(*)::int n FROM businesses WHERE owner_user_id=${USER} AND type='personal'`);
  assert.equal(biz.rows[0].n, 1);
  const mem = await db.query(`SELECT role FROM business_members WHERE business_id='${ws.id}' AND user_id=${USER}`);
  assert.equal(mem.rows[0].role, 'owner');
  const cats = await db.query(`SELECT group_type, activity_type FROM cashflow_categories WHERE business_id='${ws.id}'`);
  assert.equal(cats.rows.filter(c => c.group_type === 'inflow').length, PW.PERSONAL_CATEGORIES.income.length);
  assert.equal(cats.rows.filter(c => c.activity_type === 'financing').length, PW.PERSONAL_CATEGORIES.business_related.length);
});

test('provision is idempotent — second call reuses, never a second workspace or duplicate categories', async () => {
  const { db, supabase } = await setup();
  const a = await PW.provisionPersonalWorkspace(supabase, USER);
  const b = await PW.provisionPersonalWorkspace(supabase, USER);
  assert.equal(a.id, b.id);
  const n = await db.query(`SELECT count(*)::int n FROM businesses WHERE owner_user_id=${USER} AND type='personal'`);
  assert.equal(n.rows[0].n, 1);
  const totalCats = PW.PERSONAL_CATEGORIES.income.length + PW.PERSONAL_CATEGORIES.expense.length + PW.PERSONAL_CATEGORIES.business_related.length;
  const c = await db.query(`SELECT count(*)::int n FROM cashflow_categories WHERE business_id='${a.id}'`);
  assert.equal(c.rows[0].n, totalCats);
});

test('no BUSINESS workspace is ever auto-created by provisioning', async () => {
  const { db, supabase } = await setup();
  const before = await db.query(`SELECT count(*)::int n FROM businesses WHERE type='business'`);
  await PW.provisionPersonalWorkspace(supabase, USER);
  const after = await db.query(`SELECT count(*)::int n FROM businesses WHERE type='business'`);
  assert.equal(after.rows[0].n, before.rows[0].n); // unchanged (still just Acme)
});

test('read-only resolve (no createIfMissing) does NOT provision — mirrors /access/status path', async () => {
  const { db, supabase } = await setup();
  await assert.rejects(() => PW.resolvePersonalWorkspace(supabase, OTHER, { createIfMissing: false }),
    (e) => { assert.equal(e.status, 409); return true; });
  const n = await db.query(`SELECT count(*)::int n FROM businesses WHERE owner_user_id=${OTHER}`);
  assert.equal(n.rows[0].n, 0); // nothing created
});

test('one personal workspace MAX — DB partial unique index rejects a second', async () => {
  const { db, supabase } = await setup();
  const ws = await PW.provisionPersonalWorkspace(supabase, USER);
  await assert.rejects(() => db.query(`INSERT INTO businesses (owner_user_id, name, type) VALUES (${USER}, 'Personal 2', 'personal')`));
  assert.ok(ws.id);
});

test('non-owner personal member rejected by the DB trigger', async () => {
  const { db, supabase } = await setup();
  const ws = await PW.provisionPersonalWorkspace(supabase, USER);
  await assert.rejects(() => db.query(`INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${ws.id}', ${OTHER}, 'admin', 'active')`),
    /owner-only/);
});

test('personal route rejects a business workspace id (rejectBusinessWorkspaceId → 409)', async () => {
  const { supabase } = await setup();
  await assert.rejects(() => PW.rejectBusinessWorkspaceId(supabase, BIZ),
    (e) => { assert.equal(e.message, 'personal_workspace_required'); assert.equal(e.status, 409); return true; });
  // null + a personal id pass cleanly
  await PW.rejectBusinessWorkspaceId(supabase, null);
});

test('ISOLATION: personal wallet invisible in business scope, business wallet invisible in personal scope', async () => {
  const { db, supabase } = await setup();
  const ws = await PW.provisionPersonalWorkspace(supabase, USER);
  await db.query(`INSERT INTO wallets (user_id, business_id, scope, name, type, currency) VALUES (${USER}, '${ws.id}', 'personal', 'My Cash', 'cash', 'IDR')`);
  await db.query(`INSERT INTO wallets (user_id, business_id, scope, name, type, currency) VALUES (${USER}, '${BIZ}', 'business', 'Acme Bank', 'bank', 'IDR')`);

  const personalView = await db.query(`SELECT name FROM wallets WHERE business_id='${ws.id}' AND scope='personal'`);
  assert.deepEqual(personalView.rows.map(r => r.name), ['My Cash']);
  const businessView = await db.query(`SELECT name FROM wallets WHERE business_id='${BIZ}' AND scope='business'`);
  assert.deepEqual(businessView.rows.map(r => r.name), ['Acme Bank']);
});

test('ISOLATION: personal tx invisible in business tx and vice versa', async () => {
  const { db, supabase } = await setup();
  const ws = await PW.provisionPersonalWorkspace(supabase, USER);
  await db.query(`INSERT INTO transactions (business_id, user_id, scope, type, amount_original, amount_idr, currency_original, description) VALUES ('${ws.id}', ${USER}, 'personal', 'expense', 50, 50, 'IDR', 'Groceries')`);
  await db.query(`INSERT INTO transactions (business_id, user_id, scope, type, amount_original, amount_idr, currency_original, description) VALUES ('${BIZ}', ${USER}, 'business', 'income', 999, 999, 'IDR', 'Invoice')`);

  const personalTx = await db.query(`SELECT description FROM transactions WHERE business_id='${ws.id}' AND scope='personal'`);
  assert.deepEqual(personalTx.rows.map(r => r.description), ['Groceries']);
  const businessTx = await db.query(`SELECT description FROM transactions WHERE business_id='${BIZ}' AND scope='business'`);
  assert.deepEqual(businessTx.rows.map(r => r.description), ['Invoice']);
});

test('walletBalances: income adds, expense subtracts, transfer legs adjust each wallet', async () => {
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const tx = [
    { wallet_id: A, type: 'income', amount_original: 100 },
    { wallet_id: A, type: 'expense', amount_original: 30 },
    { wallet_id: A, type: 'expense', amount_original: 20, source: 'xfer:1' }, // transfer out of A
    { wallet_id: B, type: 'income', amount_original: 20, source: 'xfer:1' },  // transfer into B
  ];
  const bal = PW.walletBalances(tx);
  assert.equal(bal.get(A), 50);  // 100 - 30 - 20
  assert.equal(bal.get(B), 20);
});
