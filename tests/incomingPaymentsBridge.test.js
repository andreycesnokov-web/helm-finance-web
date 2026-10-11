// Unit tests for the bank-import → incoming-payments bridge (pure, no I/O).
// Run: node --test tests/incomingPaymentsBridge.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../server/lib/incomingPaymentsBridge');

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WALLET_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const BATCH = { id: 'batch-1', business_id: BIZ_A, wallet_id: WALLET_A, currency: 'IDR' };

const row = (o = {}) => ({
  id: 'row-1', batch_id: 'batch-1', business_id: BIZ_A, amount: 250000, direction: 'in',
  description: 'TRF FROM BUDI', bank_reference: 'REF-9', tx_date: '2026-08-01',
  review_status: 'confirmed', dedup_hash: 'hash-abc', ...o,
});
const build = (r, b = BATCH) => B.buildPaymentFromBankRow(r, b, { businessId: BIZ_A, actingUserId: 7001 });
const ok = (r, b) => { const x = build(r, b); assert.strictEqual(x.ok, true, `expected ok, got ${x.reason}`); return x.value; };
const skip = (r, b) => { const x = build(r, b); assert.strictEqual(x.ok, false, 'expected a skip'); return x.reason; };

// ── Direction ────────────────────────────────────────────────────────────────────────────
test('a credit line produces a payment', () => {
  const v = ok(row());
  assert.strictEqual(v.gross_amount, 250000);
  assert.strictEqual(v.source_type, 'bank_statement_import');
  assert.strictEqual(v.provider, 'bank');
});

test('a DEBIT line never produces a payment', () => {
  // The load-bearing rule: an expense must not appear in a table about money arriving.
  assert.strictEqual(skip(row({ direction: 'out' })), 'not_a_credit');
  assert.strictEqual(skip(row({ direction: 'debit' })), 'not_a_credit');
  assert.strictEqual(skip(row({ direction: 'out', final_transaction_type: 'income' })), 'not_a_credit',
    'an explicit debit direction must win over a mis-suggested type');
});

test('direction wording variants are handled', () => {
  assert.strictEqual(B.isCreditRow({ direction: 'in' }), true);
  assert.strictEqual(B.isCreditRow({ direction: 'CREDIT' }), true);
  assert.strictEqual(B.isCreditRow({ direction: ' In ' }), true);
  assert.strictEqual(B.isCreditRow({ direction: 'out' }), false);
});

test('a missing direction falls back to the confirmed type, and refuses when there is none', () => {
  assert.strictEqual(B.isCreditRow({ final_transaction_type: 'income' }), true);
  assert.strictEqual(B.isCreditRow({ suggested_type: 'income' }), true);
  assert.strictEqual(B.isCreditRow({ suggested_type: 'expense' }), false);
  // Refusing beats guessing: a wrong guess records an expense as incoming revenue.
  assert.strictEqual(B.isCreditRow({}), false);
  assert.strictEqual(B.isCreditRow({ direction: 'sideways' }), false);
});

// ── Confirmation ─────────────────────────────────────────────────────────────────────────
test('only rows a human confirmed are bridged', () => {
  assert.strictEqual(skip(row({ review_status: 'review_required', match_status: null })), 'not_confirmed');
  assert.strictEqual(skip(row({ review_status: 'excluded', match_status: 'confirmed' })), 'not_confirmed');
  assert.strictEqual(build(row({ review_status: null, match_status: 'confirmed' })).ok, true);
  assert.strictEqual(build(row({ review_status: 'imported' })).ok, true);
});

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────
test('a row or batch from another business is refused', () => {
  assert.strictEqual(skip(row({ business_id: BIZ_B })), 'row_other_business');
  assert.strictEqual(skip(row(), { ...BATCH, business_id: BIZ_B }), 'batch_other_business');
});

test('a row whose batch_id does not match the batch is refused', () => {
  assert.strictEqual(skip(row({ batch_id: 'other-batch' })), 'row_batch_mismatch');
});

test('business_id always comes from the caller context, never the row', () => {
  const v = ok(row());
  assert.strictEqual(v.business_id, BIZ_A);
});

// ── Money ────────────────────────────────────────────────────────────────────────────────
test('a bank credit is gross = net with a CONFIRMED zero fee, not an unknown one', () => {
  // The statement line shows what actually landed; there is no separate fee on it to know
  // about. That is why bank_statement_import is not a gateway source type.
  const v = ok(row({ amount: 250000 }));
  assert.strictEqual(v.gross_amount, 250000);
  assert.strictEqual(v.fee_amount, 0);
  assert.strictEqual(v.tax_or_withholding_amount, 0);
  assert.strictEqual(v.net_amount, 250000);
});

test('non-positive or unparseable amounts are refused', () => {
  assert.strictEqual(skip(row({ amount: 0 })), 'invalid_amount');
  assert.strictEqual(skip(row({ amount: -5 })), 'invalid_amount');
  assert.strictEqual(skip(row({ amount: null })), 'invalid_amount');
  assert.strictEqual(skip(row({ amount: 'abc' })), 'invalid_amount');
});

// ── Ledger-inert ─────────────────────────────────────────────────────────────────────────
test('the bridged payment is draft, unmatched, and linked to no ledger row', () => {
  const v = ok(row());
  assert.strictEqual(v.status, 'draft');
  assert.strictEqual(v.reconciliation_status, 'unmatched');
  assert.strictEqual(v.linked_transaction_id, null);
  assert.strictEqual(v.linked_debt_id, null);
});

test('even when the import created a transaction, the bridge does not claim the match', () => {
  // The confirm flow may have just written a ledger row for this same line. Copying its id
  // here would assert a reviewed match nobody performed.
  const v = ok(row({ linked_transaction_id: 4242 }));
  assert.strictEqual(v.linked_transaction_id, null);
});

// ── Provenance ───────────────────────────────────────────────────────────────────────────
test('batch and row ids are preserved', () => {
  const v = ok(row());
  assert.strictEqual(v.bank_import_batch_id, 'batch-1');
  assert.strictEqual(v.bank_import_row_id, 'row-1');
});

test('the bank reference goes to payer_reference, NOT provider_transaction_id', () => {
  // Bank exports repeat references across lines; putting one in provider_transaction_id
  // would make 048's provider-transaction unique index reject legitimate rows.
  const v = ok(row({ bank_reference: 'REF-9' }));
  assert.strictEqual(v.payer_reference, 'REF-9');
  assert.strictEqual(v.provider_transaction_id, undefined);
});

test('wallet and currency come from the batch', () => {
  const v = ok(row(), { ...BATCH, currency: 'USD' });
  assert.strictEqual(v.wallet_id, WALLET_A);
  assert.strictEqual(v.currency, 'USD');
  assert.strictEqual(ok(row(), { ...BATCH, currency: null }).currency, 'IDR');
  assert.strictEqual(ok(row(), { ...BATCH, wallet_id: null }).wallet_id, null);
});

test('the statement date becomes transaction_at', () => {
  assert.strictEqual(ok(row({ tx_date: '2026-08-01' })).transaction_at, '2026-08-01T00:00:00.000Z');
  assert.strictEqual(ok(row({ tx_date: null })).transaction_at, null);
});

// ── Idempotency ──────────────────────────────────────────────────────────────────────────
test('the key derives from dedup_hash, so a re-uploaded overlapping statement collides', () => {
  const a = B.bridgeIdempotencyKey({ id: 'row-1', dedup_hash: 'hash-abc' });
  const b = B.bridgeIdempotencyKey({ id: 'row-2', dedup_hash: 'hash-abc' });
  assert.strictEqual(a, b, 'the same statement line under a new row id must collide');
  assert.match(a, /^bank_row:hash-abc$/);
});

test('a row with no dedup_hash falls back to its row id', () => {
  assert.strictEqual(B.bridgeIdempotencyKey({ id: 'row-7' }), 'bank_row_id:row-7');
  assert.strictEqual(B.bridgeIdempotencyKey({ id: 'row-7', dedup_hash: '  ' }), 'bank_row_id:row-7');
});

test('different statement lines get different keys', () => {
  assert.notStrictEqual(ok(row({ dedup_hash: 'h1' })).idempotency_key, ok(row({ dedup_hash: 'h2' })).idempotency_key);
});

// ── Guards ───────────────────────────────────────────────────────────────────────────────
test('missing inputs are refused rather than throwing', () => {
  assert.strictEqual(B.buildPaymentFromBankRow(null, BATCH, { businessId: BIZ_A }).reason, 'missing_row_or_batch');
  assert.strictEqual(B.buildPaymentFromBankRow(row(), null, { businessId: BIZ_A }).reason, 'missing_row_or_batch');
  assert.strictEqual(B.buildPaymentFromBankRow(row(), BATCH, {}).reason, 'missing_business');
});
