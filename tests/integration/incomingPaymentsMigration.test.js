// 048_incoming_payments_foundation.sql — DDL validity, constraint BEHAVIOUR, idempotency,
// over PGlite. No Supabase.
//
// These tests exist because the constraints ARE the accounting safety surface. A missing
// business_id NOT NULL, a unique index that lets a retried webhook insert the same money
// twice, or a net_amount that does not equal gross − fee − withholding would all be
// invisible to a grep and wrong in production — as revenue.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIG = path.join(__dirname, '../../migrations/048_incoming_payments_foundation.sql');
const SQL = fs.readFileSync(MIG, 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const WALLET_A = '33333333-3333-3333-3333-333333333333';
const OWNER = -1;

// Minimal stand-ins for the tables 048 references. Column sets are only as wide as the FKs
// and the migration need — this is a constraint test, not a schema clone.
async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    CREATE TABLE wallets (id uuid PRIMARY KEY, business_id uuid NULL, user_id bigint NULL);
    CREATE TABLE transactions (id BIGSERIAL PRIMARY KEY, business_id uuid NULL);
    CREATE TABLE debts (id BIGSERIAL PRIMARY KEY, business_id uuid NULL);
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');
    INSERT INTO wallets VALUES ('${WALLET_A}', '${BIZ_A}', ${OWNER});`);
  await db.exec(SQL);
  return db;
}

const fails = async (db, sql) => {
  try { await db.exec(sql); return null; } catch (e) { return e.message; }
};

// A valid, minimal receipt. Overrides let each test bend exactly one thing.
function insertPayment(o = {}) {
  const f = {
    business_id: `'${BIZ_A}'`, source_type: `'manual_bank_entry'`, provider: 'NULL',
    gross_amount: '100.00', fee_amount: '0', tax_or_withholding_amount: '0',
    net_amount: '100.00', currency: `'IDR'`, idempotency_key: `'key-1'`,
    ...o,
  };
  const cols = Object.keys(f).join(', ');
  const vals = Object.values(f).join(', ');
  return `INSERT INTO incoming_payments (${cols}) VALUES (${vals});`;
}

const count = async (db, where = '') =>
  (await db.query(`SELECT count(*)::int AS n FROM incoming_payments ${where}`)).rows[0].n;

test('048 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  const err = await fails(db, SQL);   // second application
  assert.strictEqual(err, null, `re-applying 048 failed: ${err}`);
});

test('the table starts empty', async () => {
  const db = await freshDb();
  assert.strictEqual(await count(db), 0);
});

test('a valid minimal receipt inserts', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, insertPayment()), null);
  assert.strictEqual(await count(db), 1);
});

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────
test('business_id is NOT NULL — a payment can never be workspace-less', async () => {
  const db = await freshDb();
  const err = await fails(db, insertPayment({ business_id: 'NULL' }));
  assert.match(err || '', /null value|not-null/i);
});

test('business_id must reference a real business', async () => {
  const db = await freshDb();
  const err = await fails(db, insertPayment({ business_id: `'44444444-4444-4444-4444-444444444444'` }));
  assert.match(err || '', /foreign key/i);
});

// ── Vocabularies ─────────────────────────────────────────────────────────────────────────
test('source_type is a closed vocabulary', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertPayment({ source_type: `'carrier_pigeon'` })) || '', /check constraint/i);
  for (const s of ['manual_bank_entry', 'manual_gateway_import', 'gateway_settlement',
                   'bank_statement_import', 'future_gateway_api', 'future_bank_api']) {
    const err = await fails(db, insertPayment({ source_type: `'${s}'`, idempotency_key: `'k-${s}'` }));
    assert.strictEqual(err, null, `source_type ${s} should be allowed at DB level: ${err}`);
  }
});

test('status and reconciliation_status are closed vocabularies', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertPayment({ status: `'booked'` })) || '', /check constraint/i);
  assert.match(await fails(db, insertPayment({ reconciliation_status: `'guessed'` })) || '', /check constraint/i);
});

test('status is the REVIEW axis only — match state cannot be expressed there', async () => {
  const db = await freshDb();
  // Two columns able to hold the same fact can disagree. Match state lives in exactly one.
  assert.match(await fails(db, insertPayment({ status: `'matched'` })) || '', /check constraint/i);
  assert.match(await fails(db, insertPayment({ status: `'unmatched'` })) || '', /check constraint/i);
  for (const s of ['draft', 'reviewed', 'rejected']) {
    const extra = s === 'draft' ? {} : { reviewed_by_user_id: `${OWNER}`, reviewed_at: 'now()' };
    assert.strictEqual(await fails(db, insertPayment({ status: `'${s}'`, idempotency_key: `'st-${s}'`, ...extra })), null);
  }
});

test('fee and withholding have NO DEFAULT — a non-API writer cannot inherit a zero-fee claim', async () => {
  const db = await freshDb();
  // The bank-import feeder, a backfill, or direct SQL all omit these columns. A DEFAULT 0
  // would silently record "the gateway charged nothing" for every one of them.
  await db.exec(`INSERT INTO incoming_payments
    (business_id, source_type, gross_amount, net_amount, currency, idempotency_key)
    VALUES ('${BIZ_A}', 'gateway_settlement', 100, 97, 'IDR', 'nodefault');`);
  const r = await db.query('SELECT fee_amount, tax_or_withholding_amount FROM incoming_payments');
  assert.strictEqual(r.rows[0].fee_amount, null, 'fee_amount defaulted to a confirmed zero');
  assert.strictEqual(r.rows[0].tax_or_withholding_amount, null);
});

test('defaults are the safe ones: draft + unmatched', async () => {
  const db = await freshDb();
  await db.exec(insertPayment());
  const r = await db.query('SELECT status, reconciliation_status, currency FROM incoming_payments');
  assert.strictEqual(r.rows[0].status, 'draft');
  assert.strictEqual(r.rows[0].reconciliation_status, 'unmatched');
  assert.strictEqual(r.rows[0].currency, 'IDR');
});

// ── Money ────────────────────────────────────────────────────────────────────────────────
test('negative amounts are rejected', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertPayment({ gross_amount: '-1', net_amount: '-1' })) || '', /check constraint/i);
  assert.match(await fails(db, insertPayment({ fee_amount: '-1' })) || '', /check constraint/i);
  assert.match(await fails(db, insertPayment({ net_amount: '-5' })) || '', /check constraint/i);
});

test('net must equal gross minus fee minus withholding when all are known', async () => {
  const db = await freshDb();
  // The headline accounting error: booking the gross as if no fee were charged.
  const err = await fails(db, insertPayment({ gross_amount: '100', fee_amount: '3', net_amount: '100' }));
  assert.match(err || '', /incoming_payments_net_consistent/i);

  assert.strictEqual(await fails(db, insertPayment({
    gross_amount: '100', fee_amount: '3', tax_or_withholding_amount: '2', net_amount: '95',
  })), null);
});

test('an UNKNOWN fee (NULL) is allowed and does not force net = gross', async () => {
  const db = await freshDb();
  // NULL means "not known yet" — different from a confirmed zero fee. The arithmetic check
  // must not fire, because there is nothing to verify against.
  const err = await fails(db, insertPayment({ fee_amount: 'NULL', net_amount: '97' }));
  assert.strictEqual(err, null, `unknown fee should be storable: ${err}`);
});

// ── Review stamp ─────────────────────────────────────────────────────────────────────────
test('a review stamp is all-or-nothing', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertPayment({ reviewed_by_user_id: `${OWNER}` })) || '',
    /incoming_payments_review_stamp/i);
  assert.match(await fails(db, insertPayment({ reviewed_at: 'now()' })) || '',
    /incoming_payments_review_stamp/i);
  assert.strictEqual(await fails(db, insertPayment({ reviewed_by_user_id: `${OWNER}`, reviewed_at: 'now()' })), null);
});

// ── Idempotency ──────────────────────────────────────────────────────────────────────────
test('the same key twice in one business+source is REJECTED', async () => {
  const db = await freshDb();
  await db.exec(insertPayment({ idempotency_key: `'dup'` }));
  const err = await fails(db, insertPayment({ idempotency_key: `'dup'` }));
  assert.match(err || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('a NULL provider still deduplicates — the COALESCE index case', async () => {
  const db = await freshDb();
  // Plain multi-column UNIQUE treats NULLs as distinct, so without COALESCE this is exactly
  // where unlimited duplicate manual entries would slip through.
  await db.exec(insertPayment({ provider: 'NULL', idempotency_key: `'nullprov'` }));
  const err = await fails(db, insertPayment({ provider: 'NULL', idempotency_key: `'nullprov'` }));
  assert.match(err || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('the same key is allowed in a DIFFERENT business — no cross-tenant collision', async () => {
  const db = await freshDb();
  await db.exec(insertPayment({ idempotency_key: `'shared'` }));
  const err = await fails(db, insertPayment({ business_id: `'${BIZ_B}'`, idempotency_key: `'shared'` }));
  assert.strictEqual(err, null, `a second workspace must own its own key space: ${err}`);
  assert.strictEqual(await count(db), 2);
});

test('the same key is allowed for a different provider or source', async () => {
  const db = await freshDb();
  await db.exec(insertPayment({ provider: `'midtrans'`, idempotency_key: `'x'` }));
  assert.strictEqual(await fails(db, insertPayment({ provider: `'xendit'`, idempotency_key: `'x'` })), null);
  assert.strictEqual(await fails(db, insertPayment({
    provider: `'midtrans'`, source_type: `'bank_statement_import'`, idempotency_key: `'x'`,
  })), null);
});

test('an empty idempotency_key is rejected', async () => {
  const db = await freshDb();
  assert.match(await fails(db, insertPayment({ idempotency_key: `'   '` })) || '', /check constraint/i);
});

// ── Links stay inert ─────────────────────────────────────────────────────────────────────
test('deleting a linked transaction NULLs the link but keeps the evidence', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO transactions (business_id) VALUES ('${BIZ_A}');`);
  const txId = (await db.query('SELECT id FROM transactions LIMIT 1')).rows[0].id;
  await db.exec(insertPayment({ linked_transaction_id: String(txId) }));
  await db.exec(`DELETE FROM transactions WHERE id = ${txId};`);
  // The receipt must survive: the money still arrived even if the ledger row went away.
  assert.strictEqual(await count(db), 1);
  const r = await db.query('SELECT linked_transaction_id FROM incoming_payments');
  assert.strictEqual(r.rows[0].linked_transaction_id, null);
});

test('a business with payments cannot be hard-deleted — evidence is RESTRICT, like 031', async () => {
  const db = await freshDb();
  await db.exec(insertPayment());
  // Migration 031 set the convention: evidence uses RESTRICT because businesses are
  // soft-archived in the app (D9) and a hard purge is a separate, deliberate admin
  // procedure. Receipts are no less durable than documents.
  const err = await fails(db, `DELETE FROM businesses WHERE id = '${BIZ_A}';`);
  assert.match(err || '', /foreign key|violates/i);
  assert.strictEqual(await count(db), 1, 'the receipt was swept away with the workspace');
});

test('the same provider transaction cannot be recorded twice under different keys', async () => {
  const db = await freshDb();
  await db.exec(insertPayment({ provider: `'midtrans'`, provider_transaction_id: `'TX-1'`, idempotency_key: `'key-a'` }));
  // A caller choosing a different idempotency_key must not be able to double-record the
  // same gateway transaction — the key index would never fire on its own.
  const err = await fails(db, insertPayment({ provider: `'midtrans'`, provider_transaction_id: `'TX-1'`, idempotency_key: `'key-b'` }));
  assert.match(err || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('the provider-transaction guard is partial — many rows may have no provider txn id', async () => {
  const db = await freshDb();
  await db.exec(insertPayment({ idempotency_key: `'m1'` }));
  assert.strictEqual(await fails(db, insertPayment({ idempotency_key: `'m2'` })), null);
  assert.strictEqual(await count(db), 2);
});

test('the same provider transaction id in a DIFFERENT business is allowed', async () => {
  const db = await freshDb();
  await db.exec(insertPayment({ provider: `'midtrans'`, provider_transaction_id: `'TX-1'`, idempotency_key: `'k1'` }));
  const err = await fails(db, insertPayment({
    business_id: `'${BIZ_B}'`, provider: `'midtrans'`, provider_transaction_id: `'TX-1'`, idempotency_key: `'k1'`,
  }));
  assert.strictEqual(err, null);
});

// ── Trigger ──────────────────────────────────────────────────────────────────────────────
test('updated_at is maintained by the trigger, not the caller', async () => {
  const db = await freshDb();
  await db.exec(insertPayment());
  const before = (await db.query('SELECT updated_at FROM incoming_payments')).rows[0].updated_at;
  await db.exec(`UPDATE incoming_payments SET description = 'touched';`);
  const after = (await db.query('SELECT updated_at FROM incoming_payments')).rows[0].updated_at;
  assert.ok(new Date(after) >= new Date(before), 'updated_at did not advance');
});
