// Batch 10 against the REAL migration 031 (PGlite, in memory — touches no real database):
// the same inserts POST /api/debts/:id/withholding makes, the 031 guard, isolation, and the
// remaining balance computed from what is stored. Migration 031 is not changed.
// Run: node tests/integration/withholdingSettlement.test.js
const fs = require('node:fs'); const path = require('node:path');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const W = require('../../server/lib/debtWithholding');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, plan text DEFAULT 'free',
  trial_status text DEFAULT 'inactive', trial_ends_at timestamptz, subscription_status text);
CREATE TABLE counterparties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE debts (id integer PRIMARY KEY, business_id uuid, type text, amount numeric, original_amount numeric, paid_amount numeric, due_date date);
CREATE TABLE transactions (id integer PRIMARY KEY, business_id uuid, amount_original numeric);
CREATE TABLE compliance_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE payroll_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE tax_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE official_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
INSERT INTO businesses (id, name) VALUES ('${A}','A'),('${B}','B');
INSERT INTO debts VALUES
  (1,'${A}','receivable',100,100,98,'2026-09-01'),   -- customer paid net of PPh 23
  (2,'${A}','payable',100,100,98,'2026-09-01'),      -- we paid the supplier net
  (3,'${A}','receivable',100,100,90,'2026-09-01'),   -- has a transaction allocation already
  (4,'${B}','receivable',100,100,0,'2026-09-01');
INSERT INTO transactions VALUES (10,'${A}',90);
`;

// What the route writes: a withholding_record, then its allocation (or the record is undone).
async function recordWithholding(db, biz, debtId, amount, slip = null) {
  const rec = (await db.query(`INSERT INTO withholding_records (business_id, debt_id, tax_type, withholding_amount, bukti_potong_document_id, status)
    VALUES ($1,$2,'pph_23',$3,$4,$5) RETURNING id`, [biz, debtId, amount, slip, slip ? W.SLIP_RECEIVED : W.WAITING])).rows[0];
  try {
    await db.query(`INSERT INTO debt_settlement_allocations (business_id, debt_id, settlement_source_type, withholding_record_id, allocated_amount)
      VALUES ($1,$2,'withholding_record',$3,$4)`, [biz, debtId, rec.id, amount]);
    return { ok: true, id: rec.id };
  } catch (e) {
    await db.query('DELETE FROM withholding_records WHERE id=$1', [rec.id]);
    if (W.isGuardRejection(e)) return { status: 409, message: W.GUARD_MESSAGE };
    throw e;
  }
}
async function remaining(db, biz, id) {
  const debt = (await db.query('SELECT * FROM debts WHERE id=$1', [id])).rows[0];
  const allocs = (await db.query('SELECT * FROM debt_settlement_allocations WHERE business_id=$1', [biz])).rows;
  const recs = (await db.query('SELECT * FROM withholding_records WHERE business_id=$1', [biz])).rows;
  const [row] = W.attachWithholdings([debt], W.withholdingByDebt(allocs, recs));
  return W.debtStatusOf(row, new Date('2026-10-03T10:00:00Z'));
}

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(MIG('030_business_registry.sql'));
  for (const f of ['031_tax_document_linking.sql', '032_tax_settlement_modes.sql', '033_intercompany_funding.sql', '034_tax_deposit_allocation.sql']) await db.exec(MIG(f));
  console.log('\nWithholding settlement (real 031 guard)');

  await t('receivable withheld by the customer: remaining 0, paid, waiting for the slip, never overdue', async () => {
    const r = await recordWithholding(db, A, 1, 2);
    assert.ok(r.ok);
    const d = await remaining(db, A, 1);
    assert.deepStrictEqual([d.remaining_amount, d.status, d.withholding_waiting_slip, d.days_overdue], [0, 'paid', true, 0]);
    assert.strictEqual(Number((await db.query('SELECT paid_amount FROM debts WHERE id=1')).rows[0].paid_amount), 98, 'paid_amount untouched');
  });

  await t('payable withheld by us: remaining 0', async () => {
    assert.ok((await recordWithholding(db, A, 2, 2)).ok);
    assert.strictEqual((await remaining(db, A, 2)).remaining_amount, 0);
  });

  await t('the guard rejects when a transaction allocation already uses the room → 409 with the DECISIONS message, nothing left behind', async () => {
    await db.query(`INSERT INTO debt_settlement_allocations (business_id, debt_id, settlement_source_type, transaction_id, allocated_amount) VALUES ($1,3,'transaction',10,10)`, [A]);
    const before = Number((await db.query('SELECT count(*) c FROM withholding_records')).rows[0].c);
    const r = await recordWithholding(db, A, 3, 10);
    assert.deepStrictEqual(r, { status: 409, message: W.GUARD_MESSAGE });
    assert.strictEqual(Number((await db.query('SELECT count(*) c FROM withholding_records')).rows[0].c), before, 'record undone');
    assert.strictEqual((await remaining(db, A, 3)).remaining_amount, 10, 'remaining unchanged');
  });

  await t('isolation: a withholding for another business’s invoice is rejected by 031', async () => {
    await assert.rejects(db.query(`INSERT INTO withholding_records (business_id, debt_id, withholding_amount) VALUES ($1, 4, 1)`, [A]));
    const recB = (await db.query(`INSERT INTO withholding_records (business_id, debt_id, withholding_amount) VALUES ($1, 4, 1) RETURNING id`, [B])).rows[0];
    await assert.rejects(db.query(`INSERT INTO debt_settlement_allocations (business_id, debt_id, settlement_source_type, withholding_record_id, allocated_amount) VALUES ($1,1,'withholding_record',$2,1)`, [A, recB.id]));
  });

  await t('another business’s withholdings never change this business’s balances', async () => {
    const a1 = await remaining(db, A, 1);
    assert.strictEqual(a1.remaining_amount, 0);
    const b4 = await remaining(db, B, 4);
    assert.strictEqual(b4.remaining_amount, 100);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
