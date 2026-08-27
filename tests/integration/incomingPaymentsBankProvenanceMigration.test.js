// 049_incoming_payments_bank_import_provenance.sql — DDL validity, the one-payment-per-row
// guarantee, and idempotency, over PGlite. No Supabase.
//
// The partial unique index is the point of this migration: without it, re-confirming a batch
// or re-importing an overlapping statement records the same money twice, and the caller-side
// pre-check is the only thing standing in the way.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL_048 = fs.readFileSync(path.join(__dirname, '../../migrations/048_incoming_payments_foundation.sql'), 'utf8');
const SQL_049 = fs.readFileSync(path.join(__dirname, '../../migrations/049_incoming_payments_bank_import_provenance.sql'), 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const BATCH = '55555555-5555-5555-5555-555555555555';
const ROW_1 = '66666666-6666-6666-6666-666666666666';
const ROW_2 = '77777777-7777-7777-7777-777777777777';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    CREATE TABLE wallets (id uuid PRIMARY KEY, business_id uuid NULL, user_id bigint NULL);
    CREATE TABLE transactions (id BIGSERIAL PRIMARY KEY, business_id uuid NULL);
    CREATE TABLE debts (id BIGSERIAL PRIMARY KEY, business_id uuid NULL);
    CREATE TABLE bank_import_batches (id uuid PRIMARY KEY, business_id uuid NULL);
    CREATE TABLE bank_import_rows (id uuid PRIMARY KEY, batch_id uuid NULL, business_id uuid NULL);
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');
    INSERT INTO bank_import_batches VALUES ('${BATCH}', '${BIZ_A}');
    INSERT INTO bank_import_rows VALUES ('${ROW_1}', '${BATCH}', '${BIZ_A}'), ('${ROW_2}', '${BATCH}', '${BIZ_A}');`);
  await db.exec(SQL_048);
  await db.exec(SQL_049);
  return db;
}

const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const count = async (db) => (await db.query('SELECT count(*)::int AS n FROM incoming_payments')).rows[0].n;

function insertBridged(o = {}) {
  const f = {
    business_id: `'${BIZ_A}'`, source_type: `'bank_statement_import'`, provider: `'bank'`,
    gross_amount: '250000', fee_amount: '0', tax_or_withholding_amount: '0', net_amount: '250000',
    currency: `'IDR'`, idempotency_key: `'bank_row:hash-abc'`,
    bank_import_batch_id: `'${BATCH}'`, bank_import_row_id: `'${ROW_1}'`, ...o,
  };
  return `INSERT INTO incoming_payments (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')});`;
}

test('049 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL_049), null);
});

test('both provenance columns exist and are nullable', async () => {
  const db = await freshDb();
  const r = await db.query(`SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name='incoming_payments' AND column_name LIKE 'bank_import%' ORDER BY column_name`);
  assert.deepStrictEqual(r.rows.map((x) => x.column_name), ['bank_import_batch_id', 'bank_import_row_id']);
  assert.ok(r.rows.every((x) => x.is_nullable === 'YES'));
});

test('a bridged payment stores its batch and row', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, insertBridged()), null);
  const r = await db.query('SELECT bank_import_batch_id, bank_import_row_id FROM incoming_payments');
  assert.strictEqual(r.rows[0].bank_import_batch_id, BATCH);
  assert.strictEqual(r.rows[0].bank_import_row_id, ROW_1);
});

test('ONE payment per statement line — the second is rejected', async () => {
  const db = await freshDb();
  await db.exec(insertBridged());
  // Re-confirming a batch, or an overlapping re-import, must not double-record the money —
  // even under a different idempotency_key.
  const err = await fails(db, insertBridged({ idempotency_key: `'different-key'` }));
  assert.match(err || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('different rows in the same batch each get a payment', async () => {
  const db = await freshDb();
  await db.exec(insertBridged({ bank_import_row_id: `'${ROW_1}'`, idempotency_key: `'k1'` }));
  assert.strictEqual(await fails(db, insertBridged({ bank_import_row_id: `'${ROW_2}'`, idempotency_key: `'k2'` })), null);
  assert.strictEqual(await count(db), 2);
});

test('the guard is PARTIAL — manual payments with no bank row are unaffected', async () => {
  const db = await freshDb();
  const manual = (k) => insertBridged({
    source_type: `'manual_bank_entry'`, provider: 'NULL', bank_import_batch_id: 'NULL',
    bank_import_row_id: 'NULL', idempotency_key: `'${k}'`,
  });
  await db.exec(manual('m1'));
  assert.strictEqual(await fails(db, manual('m2')), null);
  assert.strictEqual(await count(db), 2);
});

test('provenance must reference a real batch and row', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertBridged({ bank_import_row_id: `'88888888-8888-8888-8888-888888888888'` })) || '',
    /foreign key/i);
});

test('deleting the import batch keeps the evidence and NULLs the pointer', async () => {
  const db = await freshDb();
  await db.exec(insertBridged());
  await db.exec(`DELETE FROM bank_import_rows WHERE id = '${ROW_1}';`);
  await db.exec(`DELETE FROM bank_import_batches WHERE id = '${BATCH}';`);
  // The money still arrived even if the import artefacts were cleaned up.
  assert.strictEqual(await count(db), 1);
  const r = await db.query('SELECT bank_import_batch_id, bank_import_row_id FROM incoming_payments');
  assert.strictEqual(r.rows[0].bank_import_batch_id, null);
  assert.strictEqual(r.rows[0].bank_import_row_id, null);
});

test('the same bank row id cannot leak across businesses', async () => {
  const db = await freshDb();
  await db.exec(insertBridged());
  // A different workspace claiming the same statement line is a cross-tenant duplicate; it is
  // allowed by this index (scoped per business) but the bridge refuses it before insert —
  // covered in tests/incomingPaymentsBridge.test.js ("a row or batch from another business").
  const err = await fails(db, insertBridged({ business_id: `'${BIZ_B}'`, idempotency_key: `'other'` }));
  assert.strictEqual(err, null);
});
