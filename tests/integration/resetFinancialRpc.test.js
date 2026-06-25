// R001 rpc_reset_business_financial — atomic, business-scoped, membership-gated.
// Runs the REAL SQL function over PGlite (Postgres/plpgsql in WASM). No Docker.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const R001 = fs.readFileSync(path.join(__dirname, '../../migrations/R001_reset_business_financial.sql'), 'utf8');

const BIZ = '11111111-1111-1111-1111-111111111111';
const PERSONAL = '22222222-2222-2222-2222-222222222222';
const OWNER = 1, ADMIN = 2, CFO = 3, STRANGER = 4, INACTIVE = 5;

// Minimal schema covering what R001 touches. Optional tables are added per-scenario;
// to_regclass guards in R001 mean absent tables are simply skipped.
async function base({ itemsBusinessId = true, withItems = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text NOT NULL DEFAULT 'business', owner_user_id bigint);
    CREATE TABLE business_members (business_id uuid, user_id bigint, role text, status text);
    CREATE TABLE wallets (id uuid PRIMARY KEY, business_id uuid);
    CREATE TABLE transactions (id bigint PRIMARY KEY, business_id uuid);
    CREATE TABLE debts (id bigint PRIMARY KEY, business_id uuid);
    CREATE TABLE reminders (id bigint PRIMARY KEY, business_id uuid);
    CREATE TABLE payroll_payments (id uuid PRIMARY KEY, business_id uuid, transaction_id bigint REFERENCES transactions(id), wallet_id uuid REFERENCES wallets(id));
    CREATE TABLE payroll_employees (id uuid PRIMARY KEY, business_id uuid, default_wallet_id uuid REFERENCES wallets(id));
  `);
  if (withItems) {
    await db.exec(`CREATE TABLE payroll_payment_items (
      id uuid PRIMARY KEY, ${itemsBusinessId ? 'business_id uuid,' : ''}
      payroll_payment_id uuid REFERENCES payroll_payments(id) ON DELETE CASCADE);`);
  }
  await db.exec(`
    INSERT INTO businesses VALUES ('${BIZ}','business',${OWNER}), ('${PERSONAL}','personal',${OWNER});
    INSERT INTO business_members VALUES
      ('${BIZ}',${ADMIN},'admin','active'),
      ('${BIZ}',${CFO},'cfo','active'),
      ('${BIZ}',${INACTIVE},'admin','inactive');
    INSERT INTO wallets VALUES ('aaaaaaaa-0000-0000-0000-000000000001','${BIZ}');
    INSERT INTO transactions VALUES (10,'${BIZ}'), (11,'${BIZ}');
    INSERT INTO debts VALUES (20,'${BIZ}');
    INSERT INTO reminders VALUES (30,'${BIZ}');
    INSERT INTO payroll_payments VALUES ('bbbbbbbb-0000-0000-0000-000000000001','${BIZ}',10,'aaaaaaaa-0000-0000-0000-000000000001');
    INSERT INTO payroll_employees VALUES ('dddddddd-0000-0000-0000-000000000001','${BIZ}','aaaaaaaa-0000-0000-0000-000000000001');
  `);
  if (withItems) {
    const cols = itemsBusinessId ? `('cccccccc-0000-0000-0000-000000000001','${BIZ}','bbbbbbbb-0000-0000-0000-000000000001')`
                                 : `('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001')`;
    await db.exec(`INSERT INTO payroll_payment_items VALUES ${cols};`);
  }
  await db.exec(R001);
  return db;
}
const reset = async (db, biz, actor) =>
  (await db.query(`SELECT rpc_reset_business_financial('${biz}', ${actor}) AS r`)).rows[0].r;
const count = async (db, t) => Number((await db.query(`SELECT count(*)::int AS c FROM ${t}`)).rows[0].c);

test('old one-arg overload is absent after applying R001', async () => {
  const db = await base();
  const rows = (await db.query(`SELECT pg_get_function_identity_arguments(oid) AS args
    FROM pg_proc WHERE proname = 'rpc_reset_business_financial'`)).rows;
  assert.deepEqual(rows.map(r => r.args).sort(), ['p_business uuid, p_actor_user_id bigint']);
});

test('owner_user_id WITHOUT active membership is rejected (delete nothing)', async () => {
  const db = await base(); // OWNER=1 has no business_members row
  const r = await reset(db, BIZ, OWNER);
  assert.equal(r.ok, false); assert.equal(r.error, 'forbidden');
  assert.equal(await count(db, 'transactions'), 2);
});

test('admin and cfo with active membership are allowed', async () => {
  for (const actor of [ADMIN, CFO]) {
    const db = await base();
    const r = await reset(db, BIZ, actor);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(await count(db, 'transactions'), 0);
    assert.equal(await count(db, 'wallets'), 0);
    assert.equal(await count(db, 'payroll_payment_items'), 0);
  }
});

test('owner WITH active membership is allowed', async () => {
  const db = await base();
  await db.exec(`INSERT INTO business_members VALUES ('${BIZ}',${OWNER},'owner','active');`);
  const r = await reset(db, BIZ, OWNER);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.deleted.transactions, 2);
});

test('inactive member and stranger are rejected', async () => {
  const db = await base();
  for (const actor of [INACTIVE, STRANGER]) {
    const r = await reset(db, BIZ, actor);
    assert.equal(r.error, 'forbidden');
  }
  assert.equal(await count(db, 'transactions'), 2);
});

test('personal workspace is rejected', async () => {
  const db = await base();
  await db.exec(`INSERT INTO business_members VALUES ('${PERSONAL}',${ADMIN},'owner','active');`);
  const r = await reset(db, PERSONAL, ADMIN);
  assert.equal(r.error, 'personal_workspace_not_allowed');
});

test('unknown business is rejected', async () => {
  const db = await base();
  const r = await reset(db, '99999999-9999-9999-9999-999999999999', ADMIN);
  assert.equal(r.error, 'business_not_found');
});

test('payroll_payment_items cleanup works WITH business_id column', async () => {
  const db = await base({ itemsBusinessId: true });
  const r = await reset(db, BIZ, ADMIN);
  assert.equal(r.deleted.payroll_payment_items, 1);
  assert.equal(await count(db, 'payroll_payment_items'), 0);
});

test('payroll_payment_items cleanup works WITHOUT business_id (via payroll_payments link)', async () => {
  const db = await base({ itemsBusinessId: false });
  const r = await reset(db, BIZ, ADMIN);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.deleted.payroll_payment_items, 1);
  assert.equal(await count(db, 'payroll_payment_items'), 0);
});

test('missing optional payroll child table does not break reset', async () => {
  const db = await base({ withItems: false });
  const r = await reset(db, BIZ, ADMIN);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await count(db, 'transactions'), 0);
});

test('payroll_employees.default_wallet_id is cleared so wallet delete cannot fail', async () => {
  const db = await base(); // employee dddd... has default_wallet_id = the business wallet
  const r = await reset(db, BIZ, ADMIN);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.deleted.payroll_employee_wallet_refs_cleared, 1);
  assert.equal(await count(db, 'wallets'), 0);
  // employee row PRESERVED, ref nulled
  assert.equal(await count(db, 'payroll_employees'), 1);
  const e = (await db.query(`SELECT default_wallet_id FROM payroll_employees`)).rows[0];
  assert.equal(e.default_wallet_id, null);
});

test('033/034 RESTRICT children (tax-deposit + intercompany) do not block reset', async () => {
  const db = await base();
  await db.exec(`
    CREATE TABLE tax_deposit_accounts (id uuid PRIMARY KEY, business_id uuid);
    CREATE TABLE tax_deposit_entries (id uuid PRIMARY KEY, business_id uuid, transaction_id bigint REFERENCES transactions(id) ON DELETE RESTRICT);
    CREATE TABLE tax_deposit_allocations (id uuid PRIMARY KEY, business_id uuid, deposit_entry_id uuid REFERENCES tax_deposit_entries(id) ON DELETE RESTRICT);
    CREATE TABLE intercompany_funding_records (id uuid PRIMARY KEY, cash_payer_business_id uuid, economic_owner_business_id uuid,
      funded_transaction_id bigint REFERENCES transactions(id) ON DELETE RESTRICT, funded_debt_id bigint REFERENCES debts(id) ON DELETE RESTRICT);
    CREATE TABLE intercompany_settlement_allocations (id uuid PRIMARY KEY, funding_record_id uuid REFERENCES intercompany_funding_records(id) ON DELETE RESTRICT,
      repayment_transaction_id bigint REFERENCES transactions(id) ON DELETE RESTRICT);
    INSERT INTO tax_deposit_accounts VALUES ('e0000000-0000-0000-0000-000000000001','${BIZ}');
    INSERT INTO tax_deposit_entries VALUES ('e1000000-0000-0000-0000-000000000001','${BIZ}',10);
    INSERT INTO tax_deposit_allocations VALUES ('e2000000-0000-0000-0000-000000000001','${BIZ}','e1000000-0000-0000-0000-000000000001');
    INSERT INTO intercompany_funding_records VALUES ('f0000000-0000-0000-0000-000000000001','${BIZ}','${BIZ}',11,20);
    INSERT INTO intercompany_settlement_allocations VALUES ('f1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',11);
  `);
  const r = await reset(db, BIZ, ADMIN);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await count(db, 'transactions'), 0);
  assert.equal(await count(db, 'debts'), 0);
  assert.equal(await count(db, 'tax_deposit_entries'), 0);
  assert.equal(await count(db, 'tax_deposit_allocations'), 0);
  assert.equal(await count(db, 'intercompany_funding_records'), 0);
  assert.equal(await count(db, 'intercompany_settlement_allocations'), 0);
});

test('any failure rolls back ALL deletes (atomic)', async () => {
  const db = await base();
  await db.exec(`INSERT INTO business_members VALUES ('${BIZ}',${OWNER},'owner','active');`);
  // A RESTRICT child of wallets with a row → wallet delete (last step) throws → rollback.
  await db.exec(`
    CREATE TABLE wallet_lock (id int PRIMARY KEY, wallet_id uuid REFERENCES wallets(id) ON DELETE RESTRICT);
    INSERT INTO wallet_lock VALUES (1,'aaaaaaaa-0000-0000-0000-000000000001');`);
  const r = await reset(db, BIZ, OWNER);
  assert.equal(r.ok, false); assert.equal(r.error, 'reset_failed');
  assert.deepEqual(r.deleted, {});
  // Earlier deletes in the same subtransaction must be rolled back:
  assert.equal(await count(db, 'transactions'), 2);
  assert.equal(await count(db, 'debts'), 1);
  assert.equal(await count(db, 'payroll_payments'), 1);
});
