// Unit tests for incoming payment validation/normalisation (pure, no I/O).
// Run: node --test tests/incomingPayments.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const IP = require('../server/lib/incomingPayments');

const base = () => ({ source_type: 'manual_bank_entry', gross_amount: 100000, net_amount: 100000 });
const ok = (body) => { const r = IP.validateCreate(body); assert.strictEqual(r.ok, true, `expected ok, got ${r.error}`); return r.value; };
const err = (body) => { const r = IP.validateCreate(body); assert.strictEqual(r.ok, false, 'expected a rejection'); return r.error; };

// ── Shape ────────────────────────────────────────────────────────────────────────────────
test('a minimal manual receipt validates', () => {
  const v = ok(base());
  assert.strictEqual(v.gross_amount, 100000);
  assert.strictEqual(v.net_amount, 100000);
  assert.strictEqual(v.currency, 'IDR');
  assert.strictEqual(v.status, 'draft');
  assert.strictEqual(v.reconciliation_status, 'unmatched');
});

test('a non-object body is refused', () => {
  assert.strictEqual(IP.validateCreate(null).ok, false);
  assert.strictEqual(IP.validateCreate([]).ok, false);
  assert.strictEqual(IP.validateCreate('x').ok, false);
});

test('the validated value never carries a business_id from the body', () => {
  const v = ok({ ...base(), business_id: 'attacker-supplied' });
  assert.ok(!('business_id' in v), 'business_id must come from the active workspace, never the body');
});

// ── Source types ─────────────────────────────────────────────────────────────────────────
test('every implemented source type is accepted', () => {
  for (const s of ['manual_bank_entry', 'manual_gateway_import', 'gateway_settlement', 'bank_statement_import']) {
    assert.strictEqual(ok({ ...base(), source_type: s }).source_type, s);
  }
});

test('future_* source types are refused — the feed does not exist yet', () => {
  assert.strictEqual(err({ ...base(), source_type: 'future_gateway_api' }), 'source_type_not_available');
  assert.strictEqual(err({ ...base(), source_type: 'future_bank_api' }), 'source_type_not_available');
});

test('an unknown source type is refused', () => {
  assert.strictEqual(err({ ...base(), source_type: 'carrier_pigeon' }), 'invalid_source_type');
  assert.strictEqual(err({ gross_amount: 1, net_amount: 1 }), 'missing_source_type');
});

// ── Provider-agnostic ────────────────────────────────────────────────────────────────────
test('any Indonesian provider is recordable, case-folded, without a code change', () => {
  for (const p of ['midtrans', 'DOKU', 'Xendit', 'hitpay', 'duitku', 'ipaymu']) {
    assert.strictEqual(ok({ ...base(), provider: p }).provider, p.toLowerCase());
  }
  // A provider nobody has integrated yet must still be storable — the point of the design.
  assert.strictEqual(ok({ ...base(), provider: 'BrandNewPay' }).provider, 'brandnewpay');
});

test('provider is optional', () => {
  assert.strictEqual(ok(base()).provider, null);
});

// ── Money ────────────────────────────────────────────────────────────────────────────────
test('net is derived from gross minus fee and withholding when omitted', () => {
  const v = ok({ source_type: 'gateway_settlement', provider: 'midtrans', gross_amount: 100000, fee_amount: 2500 });
  assert.strictEqual(v.net_amount, 97500);
});

test('a net that contradicts gross minus fee is REJECTED, not silently corrected', () => {
  // Booking a gateway payout as if no fee were charged is the headline accounting error.
  assert.strictEqual(err({ ...base(), gross_amount: 100000, fee_amount: 2500, net_amount: 100000 }), 'net_amount_mismatch');
});

test('gross, fee and net stay three separate values', () => {
  const v = ok({ source_type: 'gateway_settlement', gross_amount: 100000, fee_amount: 2500, tax_or_withholding_amount: 500 });
  assert.strictEqual(v.gross_amount, 100000);
  assert.strictEqual(v.fee_amount, 2500);
  assert.strictEqual(v.tax_or_withholding_amount, 500);
  assert.strictEqual(v.net_amount, 97000);
});

test('an explicitly UNKNOWN fee (null) is preserved and forces an explicit net', () => {
  const v = ok({ ...base(), fee_amount: null, net_amount: 97000 });
  assert.strictEqual(v.fee_amount, null, 'unknown must not be coerced to a confirmed zero');
  assert.strictEqual(v.net_amount, 97000);
  // With a component unknown there is nothing to derive net from, so it must be supplied.
  assert.strictEqual(err({ source_type: 'manual_bank_entry', gross_amount: 100000, fee_amount: null }), 'missing_net_amount');
});

test('an omitted fee on a BANK receipt means zero — the recorder saw the whole movement', () => {
  assert.strictEqual(ok(base()).fee_amount, 0);
  assert.strictEqual(ok({ ...base(), source_type: 'bank_statement_import' }).fee_amount, 0);
});

// ── B1 regression: the fee default is source-aware ───────────────────────────────────────
test('an omitted fee on a GATEWAY receipt is UNKNOWN, never a confirmed zero', () => {
  // Storing 0 here would be the system asserting, on the caller's behalf, that Midtrans
  // charged nothing — and setting net = gross. That is booking net as gross in reverse.
  for (const source_type of ['gateway_settlement', 'manual_gateway_import']) {
    const v = ok({ source_type, provider: 'midtrans', gross_amount: 1000000, net_amount: 967810 });
    assert.strictEqual(v.fee_amount, null, `${source_type}: omitted fee was coerced to a confirmed zero`);
    assert.strictEqual(v.net_amount, 967810, `${source_type}: net was overwritten`);
  }
});

test('a gateway receipt with an omitted fee and no net is refused, not guessed', () => {
  const r = IP.validateCreate({ source_type: 'gateway_settlement', provider: 'midtrans', gross_amount: 1000000 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'missing_net_amount');
  // The escape hatch must be discoverable from the error itself.
  assert.match(r.message, /fee_amount: null/);
});

test('the honest gross+net caller is no longer blocked on a gateway receipt', () => {
  // Before the fix this was rejected with net_amount_mismatch: the validator had already
  // decided the fee was 0, so a true net could never agree with it.
  const v = ok({ source_type: 'gateway_settlement', provider: 'midtrans',
                 gross_amount: 1000000, net_amount: 967810 });
  assert.strictEqual(v.gross_amount, 1000000);
  assert.strictEqual(v.net_amount, 967810);
});

test('a mismatch message names the fee_amount: null escape hatch', () => {
  const r = IP.validateCreate({ ...base(), gross_amount: 100000, fee_amount: 2500, net_amount: 100000 });
  assert.strictEqual(r.error, 'net_amount_mismatch');
  assert.match(r.message, /fee_amount: null/);
});

test('an explicit fee on a gateway receipt still wins over the unknown default', () => {
  const v = ok({ source_type: 'gateway_settlement', provider: 'xendit', gross_amount: 100000, fee_amount: 2500 });
  assert.strictEqual(v.fee_amount, 2500);
  assert.strictEqual(v.net_amount, 97500);
});

test('money arithmetic runs in integer cents, not floats', () => {
  // 0.1 + 0.2 territory: the classic float artefact must not reach a stored amount.
  const v = ok({ source_type: 'manual_bank_entry', gross_amount: 0.3, fee_amount: 0.1 });
  assert.strictEqual(v.net_amount, 0.2);
  const w = ok({ source_type: 'manual_bank_entry', gross_amount: 1000000.15, fee_amount: 0.05 });
  assert.strictEqual(w.net_amount, 1000000.1);
});

test('bad amounts are refused', () => {
  assert.strictEqual(err({ ...base(), gross_amount: -1 }), 'invalid_gross_amount');
  assert.strictEqual(err({ ...base(), gross_amount: 'abc' }), 'invalid_gross_amount');
  assert.strictEqual(err({ ...base(), gross_amount: null }), 'invalid_gross_amount');
  assert.strictEqual(err({ source_type: 'manual_bank_entry', net_amount: 1 }), 'invalid_gross_amount');
  assert.strictEqual(err({ ...base(), fee_amount: -5 }), 'invalid_fee_amount');
  // A fee larger than the gross derives a negative net — refused rather than stored as debt.
  assert.strictEqual(err({ source_type: 'manual_bank_entry', gross_amount: 100, fee_amount: 200 }), 'invalid_net_amount');
});

test('numeric strings are accepted and rounded to 2dp', () => {
  const v = ok({ ...base(), gross_amount: '100.005', net_amount: '100.01' });
  assert.strictEqual(v.gross_amount, 100.01);
});

test('currency is normalised and validated', () => {
  assert.strictEqual(ok({ ...base(), currency: 'idr' }).currency, 'IDR');
  assert.strictEqual(ok({ ...base(), currency: 'usd' }).currency, 'USD');
  assert.strictEqual(err({ ...base(), currency: 'RUPIAH' }), 'invalid_currency');
});

// ── Ledger-inert ─────────────────────────────────────────────────────────────────────────
test('a client may NOT attach a ledger transaction or debt', () => {
  assert.strictEqual(err({ ...base(), linked_transaction_id: 42 }), 'linking_not_supported');
  assert.strictEqual(err({ ...base(), linked_debt_id: 42 }), 'linking_not_supported');
});

test('reconciliation_status is derived, never client-chosen', () => {
  assert.strictEqual(ok({ ...base(), reconciliation_status: 'matched' }).reconciliation_status, 'unmatched');
});

test('a payment cannot be CREATED as reviewed or rejected — it is born unreviewed', () => {
  assert.strictEqual(err({ ...base(), status: 'reviewed' }), 'status_not_creatable');
  assert.strictEqual(err({ ...base(), status: 'rejected' }), 'status_not_creatable');
  assert.strictEqual(ok({ ...base(), status: 'draft' }).status, 'draft');
});

test('status no longer carries a match state — that lives in reconciliation_status alone', () => {
  // Two columns able to express the same fact can disagree; only one may hold it.
  assert.ok(!IP.STATUSES.includes('matched'));
  assert.ok(!IP.STATUSES.includes('unmatched'));
  assert.strictEqual(err({ ...base(), status: 'matched' }), 'invalid_status');
  assert.ok(IP.RECONCILIATION_STATUSES.includes('matched'));
});

// ── Idempotency key ──────────────────────────────────────────────────────────────────────
test('a supplied idempotency key wins', () => {
  assert.strictEqual(ok({ ...base(), idempotency_key: 'mine' }).idempotency_key, 'mine');
});

test('a provider transaction id becomes the key — a replayed webhook collides', () => {
  const a = ok({ source_type: 'gateway_settlement', provider: 'midtrans', gross_amount: 1, net_amount: 1, provider_transaction_id: 'TX-9' });
  const b = ok({ source_type: 'gateway_settlement', provider: 'midtrans', gross_amount: 1, net_amount: 1, provider_transaction_id: 'TX-9' });
  assert.strictEqual(a.idempotency_key, b.idempotency_key);
});

test('two economically different manual receipts get different keys', () => {
  const a = ok({ ...base(), gross_amount: 100, net_amount: 100 });
  const b = ok({ ...base(), gross_amount: 200, net_amount: 200 });
  assert.notStrictEqual(a.idempotency_key, b.idempotency_key);
});

test('the fallback key never exceeds the column bound', () => {
  const v = ok({ ...base(), payer_name: 'x'.repeat(4000) });
  assert.ok(v.idempotency_key.length <= 255);
});

// ── Timestamps and text ──────────────────────────────────────────────────────────────────
test('timestamps are parsed or refused', () => {
  assert.strictEqual(ok({ ...base(), transaction_at: '2026-08-01T10:00:00Z' }).transaction_at, '2026-08-01T10:00:00.000Z');
  assert.strictEqual(ok(base()).transaction_at, null);
  assert.strictEqual(err({ ...base(), transaction_at: 'yesterday-ish' }), 'invalid_transaction_at');
  assert.strictEqual(err({ ...base(), settled_at: 'nope' }), 'invalid_settled_at');
});

test('text fields are trimmed, emptied to null, and bounded', () => {
  assert.strictEqual(ok({ ...base(), payer_name: '  Budi  ' }).payer_name, 'Budi');
  assert.strictEqual(ok({ ...base(), payer_name: '   ' }).payer_name, null);
  assert.strictEqual(ok({ ...base(), payer_name: 'x'.repeat(9999) }).payer_name.length, 255);
  assert.strictEqual(ok({ ...base(), description: 'x'.repeat(9999) }).description.length, 2000);
});

test('raw_provider_payload must be an object when present', () => {
  assert.deepStrictEqual(ok({ ...base(), raw_provider_payload: { a: 1 } }).raw_provider_payload, { a: 1 });
  assert.strictEqual(ok(base()).raw_provider_payload, null);
  assert.strictEqual(err({ ...base(), raw_provider_payload: 'blob' }), 'invalid_payload');
  assert.strictEqual(err({ ...base(), raw_provider_payload: [1] }), 'invalid_payload');
});

// ── Status changes ───────────────────────────────────────────────────────────────────────
test('review decisions are allowed', () => {
  assert.strictEqual(IP.validateStatusChange('draft', 'reviewed').value, 'reviewed');
  assert.strictEqual(IP.validateStatusChange('draft', 'rejected').value, 'rejected');
  assert.strictEqual(IP.validateStatusChange('reviewed', 'rejected').value, 'rejected');
});

test('a client cannot declare a payment matched — matching is not a status change', () => {
  assert.strictEqual(IP.validateStatusChange('draft', 'matched').error, 'invalid_status');
});

test('a reviewed payment cannot be pushed back to draft — that would erase the review stamp', () => {
  assert.strictEqual(IP.validateStatusChange('reviewed', 'draft').error, 'status_not_settable');
});

test('a no-op status change is refused rather than restamping the reviewer', () => {
  assert.strictEqual(IP.validateStatusChange('reviewed', 'reviewed').error, 'status_unchanged');
});

test('an unknown or missing status is refused', () => {
  assert.strictEqual(IP.validateStatusChange('draft', 'booked').error, 'invalid_status');
  assert.strictEqual(IP.validateStatusChange('draft', null).error, 'missing_status');
});
