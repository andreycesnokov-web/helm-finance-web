// 050_incoming_payment_match_candidates.sql — DDL, constraints, and the same-business guard
// trigger, over PGlite. No Supabase.
//
// The trigger is the reason this file exists. A cross-company match would attribute one
// company's money to another's receivable, which is the worst thing this feature could do.
// The API checks it too; this proves the database refuses it even if a route ever forgets.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../migrations/', f), 'utf8');
const SQL_048 = read('048_incoming_payments_foundation.sql');
const SQL_050 = read('050_incoming_payment_match_candidates.sql');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const PAY_A = '33333333-3333-3333-3333-333333333333';
const PAY_B = '44444444-4444-4444-4444-444444444444';
const OWNER = -1;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    CREATE TABLE wallets (id uuid PRIMARY KEY, business_id uuid NULL, user_id bigint NULL);
    CREATE TABLE transactions (id BIGSERIAL PRIMARY KEY, business_id uuid NULL, type text NULL);
    CREATE TABLE debts (id BIGSERIAL PRIMARY KEY, business_id uuid NULL, type text NULL);
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');
    INSERT INTO debts (business_id, type) VALUES ('${BIZ_A}','receivable'), ('${BIZ_B}','receivable');
    INSERT INTO transactions (business_id, type) VALUES ('${BIZ_A}','income'), ('${BIZ_B}','income');`);
  await db.exec(SQL_048);
  await db.exec(SQL_050);
  const pay = (id, biz, key) => `INSERT INTO incoming_payments
    (id, business_id, source_type, gross_amount, fee_amount, tax_or_withholding_amount, net_amount, currency, idempotency_key)
    VALUES ('${id}', '${biz}', 'manual_bank_entry', 100, 0, 0, 100, 'IDR', '${key}');`;
  await db.exec(pay(PAY_A, BIZ_A, 'k-a'));
  await db.exec(pay(PAY_B, BIZ_B, 'k-b'));
  return db;
}

const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const count = async (db) => (await db.query('SELECT count(*)::int AS n FROM incoming_payment_match_candidates')).rows[0].n;
const debtId = async (db, biz) => (await db.query(`SELECT id FROM debts WHERE business_id='${biz}' LIMIT 1`)).rows[0].id;
const txId = async (db, biz) => (await db.query(`SELECT id FROM transactions WHERE business_id='${biz}' LIMIT 1`)).rows[0].id;

function insertCandidate(o = {}) {
  const f = { business_id: `'${BIZ_A}'`, incoming_payment_id: `'${PAY_A}'`, target_type: `'debt'`,
              score: '0.9', ...o };
  return `INSERT INTO incoming_payment_match_candidates (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')});`;
}

test('050 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL_050), null);
});

test('a valid same-business debt candidate inserts', async () => {
  const db = await freshDb();
  const err = await fails(db, insertCandidate({ target_debt_id: await debtId(db, BIZ_A) }));
  assert.strictEqual(err, null, `valid candidate rejected: ${err}`);
  assert.strictEqual(await count(db), 1);
});

// ── The guard ────────────────────────────────────────────────────────────────────────────
test('a candidate pointing at ANOTHER business\'s receivable is refused by the DB', async () => {
  const db = await freshDb();
  const err = await fails(db, insertCandidate({ target_debt_id: await debtId(db, BIZ_B) }));
  assert.match(err || '', /different business/i);
  assert.strictEqual(await count(db), 0);
});

test('a candidate pointing at ANOTHER business\'s transaction is refused by the DB', async () => {
  const db = await freshDb();
  const err = await fails(db, insertCandidate({
    target_type: `'transaction'`, target_transaction_id: await txId(db, BIZ_B) }));
  assert.match(err || '', /different business/i);
});

test('a candidate whose business disagrees with its payment is refused', async () => {
  const db = await freshDb();
  const err = await fails(db, insertCandidate({
    business_id: `'${BIZ_B}'`, incoming_payment_id: `'${PAY_A}'`, target_debt_id: await debtId(db, BIZ_B) }));
  assert.match(err || '', /must match its incoming payment/i);
});

test('the guard also fires on UPDATE, not just INSERT', async () => {
  const db = await freshDb();
  await db.exec(insertCandidate({ target_debt_id: await debtId(db, BIZ_A) }));
  const err = await fails(db, `UPDATE incoming_payment_match_candidates SET target_debt_id = ${await debtId(db, BIZ_B)};`);
  assert.match(err || '', /different business/i);
});

// ── Target integrity ─────────────────────────────────────────────────────────────────────
test('target_type must agree with which target is set', async () => {
  const db = await freshDb();
  // Claiming 'debt' while pointing at a transaction would make every reader wrong.
  assert.match(await fails(db, insertCandidate({
    target_type: `'debt'`, target_transaction_id: await txId(db, BIZ_A) })) || '', /check constraint/i);
  assert.match(await fails(db, insertCandidate({ target_type: `'debt'` })) || '', /check constraint/i);
  assert.match(await fails(db, insertCandidate({
    target_type: `'transaction'`, target_debt_id: await debtId(db, BIZ_A) })) || '', /check constraint/i);
});

test('exactly one target — never both', async () => {
  const db = await freshDb();
  const err = await fails(db, insertCandidate({
    target_debt_id: await debtId(db, BIZ_A), target_transaction_id: await txId(db, BIZ_A) }));
  assert.match(err || '', /check constraint/i);
});

test('an unknown target_type is refused', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertCandidate({ target_type: `'invoice'`, target_debt_id: '1' })) || '',
    /check constraint/i);
});

// ── Score and status ─────────────────────────────────────────────────────────────────────
test('score is bounded to 0..1', async () => {
  const db = await freshDb();
  const d = await debtId(db, BIZ_A);
  assert.match(await fails(db, insertCandidate({ target_debt_id: d, score: '1.5' })) || '', /check constraint/i);
  assert.match(await fails(db, insertCandidate({ target_debt_id: d, score: '-0.1' })) || '', /check constraint/i);
});

test('a candidate is born suggested with no decider', async () => {
  const db = await freshDb();
  await db.exec(insertCandidate({ target_debt_id: await debtId(db, BIZ_A) }));
  const r = await db.query('SELECT status, decided_by_user_id, decided_at FROM incoming_payment_match_candidates');
  assert.strictEqual(r.rows[0].status, 'suggested');
  assert.strictEqual(r.rows[0].decided_by_user_id, null);
});

test('a decision stamp is all-or-nothing, and suggested carries no decider', async () => {
  const db = await freshDb();
  const d = await debtId(db, BIZ_A);
  assert.match(await fails(db, insertCandidate({ target_debt_id: d, status: `'accepted'` })) || '',
    /decision_stamp/i);
  assert.match(await fails(db, insertCandidate({ target_debt_id: d, decided_by_user_id: `${OWNER}`, decided_at: 'now()' })) || '',
    /decision_stamp/i);
  assert.strictEqual(await fails(db, insertCandidate({
    target_debt_id: d, status: `'accepted'`, decided_by_user_id: `${OWNER}`, decided_at: 'now()' })), null);
});

// ── Uniqueness and lifecycle ─────────────────────────────────────────────────────────────
test('one proposal per (payment, target) — re-running does not accumulate', async () => {
  const db = await freshDb();
  const d = await debtId(db, BIZ_A);
  await db.exec(insertCandidate({ target_debt_id: d }));
  assert.match(await fails(db, insertCandidate({ target_debt_id: d, score: '0.5' })) || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('one payment may have candidates against both a debt and a transaction', async () => {
  const db = await freshDb();
  await db.exec(insertCandidate({ target_debt_id: await debtId(db, BIZ_A) }));
  assert.strictEqual(await fails(db, insertCandidate({
    target_type: `'transaction'`, target_transaction_id: await txId(db, BIZ_A) })), null);
  assert.strictEqual(await count(db), 2);
});

test('deleting the payment removes its proposals but never the reverse', async () => {
  const db = await freshDb();
  await db.exec(insertCandidate({ target_debt_id: await debtId(db, BIZ_A) }));
  await db.exec(`DELETE FROM incoming_payments WHERE id = '${PAY_A}';`);
  assert.strictEqual(await count(db), 0);
});

test('accepting a candidate does not touch the debt it points at', async () => {
  const db = await freshDb();
  const d = await debtId(db, BIZ_A);
  await db.exec(insertCandidate({ target_debt_id: d }));
  const before = (await db.query(`SELECT * FROM debts WHERE id = ${d}`)).rows[0];
  await db.exec(`UPDATE incoming_payment_match_candidates
    SET status='accepted', decided_by_user_id=${OWNER}, decided_at=now();`);
  const after = (await db.query(`SELECT * FROM debts WHERE id = ${d}`)).rows[0];
  assert.deepStrictEqual(after, before, 'accepting a candidate mutated the receivable');
});
