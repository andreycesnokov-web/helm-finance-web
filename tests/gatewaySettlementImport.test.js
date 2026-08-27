// Unit tests for provider-agnostic settlement batch validation (pure, no I/O, no network).
// Run: node --test tests/gatewaySettlementImport.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const GSI = require('../server/lib/gatewaySettlementImport');

const row = (o = {}) => ({ provider_transaction_id: 'TX-1', gross_amount: 100000, fee_amount: 2500, ...o });
const batch = (o = {}) => ({ provider: 'midtrans', provider_settlement_id: 'STL-1', currency: 'IDR', rows: [row()], ...o });
const ok = (b) => { const r = GSI.validateSettlementBatch(b); assert.strictEqual(r.ok, true, `expected ok, got ${r.error}`); return r.value; };
const bad = (b) => { const r = GSI.validateSettlementBatch(b); assert.strictEqual(r.ok, false, 'expected a rejection'); return r; };

// ── Provider-agnostic ────────────────────────────────────────────────────────────────────
test('every named provider imports', () => {
  for (const provider of ['midtrans', 'doku', 'xendit', 'hitpay', 'duitku', 'ipaymu', 'manual_gateway']) {
    const v = ok(batch({ provider }));
    assert.strictEqual(v.provider, provider);
    assert.strictEqual(v.provider_known, true);
  }
});

test('an UNKNOWN provider is imported, not refused — the list is not an allow-list', () => {
  // The whole design point: a new Indonesian gateway must not need a code change.
  const v = ok(batch({ provider: 'BrandNewPay' }));
  assert.strictEqual(v.provider, 'brandnewpay');
  assert.strictEqual(v.provider_known, false, 'the caller should still be told it is unrecognised');
});

test('provider is case-folded so one gateway is one provider', () => {
  assert.strictEqual(ok(batch({ provider: 'MidTrans' })).provider, 'midtrans');
  assert.strictEqual(GSI.isKnownProvider('  MIDTRANS '), true);
});

test('provider is required', () => {
  assert.strictEqual(bad(batch({ provider: null })).error, 'missing_provider');
  assert.strictEqual(bad(batch({ provider: '   ' })).error, 'missing_provider');
});

test('no gateway gets a privileged code path', () => {
  // Same input, different provider name, byte-identical result apart from the name itself.
  const a = ok(batch({ provider: 'midtrans' }));
  const b = ok(batch({ provider: 'xendit' }));
  assert.deepStrictEqual({ ...a.rows[0], provider: null }, { ...b.rows[0], provider: null });
});

// ── Batch shape ──────────────────────────────────────────────────────────────────────────
test('a batch needs at least one row', () => {
  assert.strictEqual(bad(batch({ rows: [] })).error, 'missing_rows');
  assert.strictEqual(bad(batch({ rows: null })).error, 'missing_rows');
  assert.strictEqual(bad({ provider: 'midtrans' }).error, 'missing_rows');
});

test('an oversized batch is refused', () => {
  assert.strictEqual(bad(batch({ rows: new Array(GSI.MAX_ROWS + 1).fill(row()) })).error, 'too_many_rows');
});

test('a non-object body or row is refused', () => {
  assert.strictEqual(bad(null).error, 'invalid_body');
  assert.strictEqual(bad([]).error, 'invalid_body');
  assert.strictEqual(bad(batch({ rows: ['nope'] })).error, 'invalid_row');
});

test('the source type is manual_gateway_import — not a direct gateway feed', () => {
  // `gateway_settlement` is reserved for a live feed from the gateway, which does not exist.
  assert.strictEqual(ok(batch()).rows[0].source_type, 'manual_gateway_import');
  assert.strictEqual(GSI.SETTLEMENT_SOURCE_TYPE, 'manual_gateway_import');
});

// ── Settlement-level inheritance ─────────────────────────────────────────────────────────
test('rows inherit settlement-level fields but may override them', () => {
  const v = ok(batch({
    provider_settlement_id: 'STL-1', settlement_batch_reference: 'BATCH-A', currency: 'IDR',
    provider_account_id: 'ACCT-1',
    rows: [row(), row({ provider_transaction_id: 'TX-2', provider_settlement_id: 'STL-OTHER', currency: 'USD' })],
  }));
  assert.strictEqual(v.rows[0].provider_settlement_id, 'STL-1');
  assert.strictEqual(v.rows[0].settlement_batch_reference, 'BATCH-A');
  assert.strictEqual(v.rows[0].provider_account_id, 'ACCT-1');
  assert.strictEqual(v.rows[0].currency, 'IDR');
  assert.strictEqual(v.rows[1].provider_settlement_id, 'STL-OTHER');
  assert.strictEqual(v.rows[1].currency, 'USD');
});

test('the three-level structure is expressible on every row', () => {
  const v = ok(batch({ rows: [row({ provider_order_id: 'ORDER-7', payment_method: 'qris' })] }));
  const p = v.rows[0];
  assert.strictEqual(p.provider_transaction_id, 'TX-1');   // gateway transaction
  assert.strictEqual(p.provider_settlement_id, 'STL-1');   // settlement batch
  assert.strictEqual(p.provider_order_id, 'ORDER-7');
  assert.strictEqual(p.payment_method, 'qris');
});

// ── Money ────────────────────────────────────────────────────────────────────────────────
test('gross, fee and net stay separate and net is derived', () => {
  const p = ok(batch({ rows: [row({ gross_amount: 100000, fee_amount: 2500 })] })).rows[0];
  assert.strictEqual(p.gross_amount, 100000);
  assert.strictEqual(p.fee_amount, 2500);
  assert.strictEqual(p.net_amount, 97500);
});

test('withholding is carried separately from the gateway fee', () => {
  const p = ok(batch({ rows: [row({ gross_amount: 100000, fee_amount: 2500, tax_or_withholding_amount: 500 })] })).rows[0];
  assert.strictEqual(p.tax_or_withholding_amount, 500);
  assert.strictEqual(p.net_amount, 97000);
});

test('an omitted fee is UNKNOWN on a settlement row, never a confirmed zero', () => {
  // Settlement rows go through the same validator as everything else, so the gateway fee
  // rule holds here for free.
  const p = ok(batch({ rows: [row({ fee_amount: undefined, net_amount: 967810, gross_amount: 1000000 })] })).rows[0];
  assert.strictEqual(p.fee_amount, null);
  assert.strictEqual(p.net_amount, 967810);
});

test('a settlement row with an unknown fee and no net is refused with its index', () => {
  const r = bad(batch({ rows: [row(), row({ provider_transaction_id: 'TX-2', fee_amount: undefined })] }));
  assert.strictEqual(r.error, 'missing_net_amount');
  assert.strictEqual(r.row_index, 1, 'the caller must be told WHICH row failed');
});

test('a net contradicting gross minus fee rejects the whole batch', () => {
  // A partially-imported settlement is worse than a refused one: it looks complete.
  const r = bad(batch({ rows: [row({ gross_amount: 100000, fee_amount: 2500, net_amount: 100000 })] }));
  assert.strictEqual(r.error, 'net_amount_mismatch');
  assert.strictEqual(r.row_index, 0);
});

test('bad amounts are refused', () => {
  assert.strictEqual(bad(batch({ rows: [row({ gross_amount: -1 })] })).error, 'invalid_gross_amount');
  assert.strictEqual(bad(batch({ rows: [row({ gross_amount: 'abc' })] })).error, 'invalid_gross_amount');
});

// ── Idempotency ──────────────────────────────────────────────────────────────────────────
test('the provider transaction id becomes the idempotency key', () => {
  const p = ok(batch({ rows: [row({ provider_transaction_id: 'TX-ABC' })] })).rows[0];
  assert.match(p.idempotency_key, /TX-ABC/);
});

test('the same provider transaction twice IN ONE upload is refused by index', () => {
  const r = bad(batch({ rows: [row({ provider_transaction_id: 'TX-DUP' }), row({ provider_transaction_id: 'TX-DUP' })] }));
  assert.strictEqual(r.error, 'duplicate_row_reference');
  assert.strictEqual(r.row_index, 1);
});

test('the same settlement re-parsed produces the same keys, so a re-upload collides', () => {
  const a = ok(batch()).rows[0].idempotency_key;
  const b = ok(batch()).rows[0].idempotency_key;
  assert.strictEqual(a, b);
});

test('different gateway transactions get different keys', () => {
  const v = ok(batch({ rows: [row({ provider_transaction_id: 'TX-1' }), row({ provider_transaction_id: 'TX-2' })] }));
  assert.notStrictEqual(v.rows[0].idempotency_key, v.rows[1].idempotency_key);
});

// ── Ledger-inert ─────────────────────────────────────────────────────────────────────────
test('every imported row is draft and unmatched', () => {
  const p = ok(batch()).rows[0];
  assert.strictEqual(p.status, 'draft');
  assert.strictEqual(p.reconciliation_status, 'unmatched');
});

test('a settlement row cannot arrive pre-linked to the ledger', () => {
  assert.strictEqual(bad(batch({ rows: [row({ linked_transaction_id: 5 })] })).error, 'linking_not_supported');
});

test('the raw settlement payload is preserved when supplied', () => {
  const p = ok(batch({ rows: [row({ raw: { settlement_time: '2026-08-01', gross: '100000' } })] })).rows[0];
  assert.deepStrictEqual(p.raw_provider_payload, { settlement_time: '2026-08-01', gross: '100000' });
});
