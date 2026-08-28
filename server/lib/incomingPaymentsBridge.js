// Bank import → incoming payments bridge (pure, unit-tested; no I/O).
//
// Turns a CONFIRMED CREDIT row from the bank-import pipeline (migration 021) into the row
// shape `incoming_payments` expects. It decides two things and nothing else: whether a
// statement line represents money ARRIVING, and what the resulting evidence row looks like.
//
// It never books anything. The bank-import confirm flow creates its own ledger transaction
// exactly as it always has — that behaviour is untouched. The payment produced here is
// evidence sitting alongside it, deliberately left `unmatched` so the (later) reconciliation
// step proposes the link for a human instead of this code asserting it.

const { toCents, fromCents } = require('./incomingPayments');

// A row counts as money arriving only on an explicit credit direction. `direction` is written
// by the parser ('in' = credit, 'out' = debit); when it is missing we fall back to the
// confirmed transaction type, and when that is missing too we refuse rather than guess.
// Guessing wrong in the permissive direction would record an EXPENSE as incoming revenue.
function isCreditRow(row = {}) {
  const direction = typeof row.direction === 'string' ? row.direction.trim().toLowerCase() : null;
  if (direction === 'in' || direction === 'credit') return true;
  if (direction === 'out' || direction === 'debit') return false;
  if (direction) return false;                       // an unrecognised direction is not a credit
  const txType = row.final_transaction_type || row.suggested_type || null;
  return txType === 'income';
}

// The row must also have been confirmed by a human in the review queue. This mirrors the
// `isConfirmed` predicate the confirm route already applies, so the bridge can never pick up
// a row the reviewer excluded or has not looked at.
function isConfirmedRow(row = {}) {
  if (row.review_status === 'excluded') return false;
  return row.review_status === 'confirmed' || row.review_status === 'imported'
    || row.match_status === 'confirmed';
}

/**
 * Stable idempotency key for a statement line.
 *
 * Prefers the parser's `dedup_hash` (date|amount|direction|deschash|wallet|ref), which is
 * already the pipeline's notion of "the same line", so re-uploading an overlapping statement
 * collides on content rather than on row identity. Falls back to the row id, which is stable
 * but only within one upload.
 */
function bridgeIdempotencyKey(row = {}) {
  const hash = typeof row.dedup_hash === 'string' ? row.dedup_hash.trim() : '';
  if (hash) return `bank_row:${hash}`.slice(0, 255);
  return `bank_row_id:${row.id}`.slice(0, 255);
}

/**
 * Map one confirmed credit row to an incoming_payments insert.
 *
 * Returns { ok:true, value } or { ok:false, reason } — `reason` is a skip explanation, not an
 * error: most rows are legitimately not credits.
 *
 * @param row    a bank_import_rows record
 * @param batch  its bank_import_batches record
 * @param ctx    { businessId, actingUserId }
 */
function buildPaymentFromBankRow(row, batch, ctx = {}) {
  if (!row || !batch) return { ok: false, reason: 'missing_row_or_batch' };
  if (!ctx.businessId) return { ok: false, reason: 'missing_business' };

  // Tenancy is checked on BOTH records, not inferred from the caller. A row whose batch
  // belongs to another workspace can never produce a payment in this one.
  if (row.business_id && row.business_id !== ctx.businessId) return { ok: false, reason: 'row_other_business' };
  if (batch.business_id && batch.business_id !== ctx.businessId) return { ok: false, reason: 'batch_other_business' };
  if (row.batch_id && batch.id && row.batch_id !== batch.id) return { ok: false, reason: 'row_batch_mismatch' };

  if (!isConfirmedRow(row)) return { ok: false, reason: 'not_confirmed' };
  if (!isCreditRow(row)) return { ok: false, reason: 'not_a_credit' };

  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
  // Integer cents via the shared helpers — this module must not be the one place that
  // reintroduces the float money arithmetic the validator just removed.
  const gross = fromCents(toCents(amount));

  return {
    ok: true,
    value: {
      business_id: ctx.businessId,
      wallet_id: batch.wallet_id || null,
      source_type: 'bank_statement_import',
      provider: 'bank',

      // A bank statement credit shows the amount that ACTUALLY LANDED, with any fee already
      // deducted upstream and not itemised. gross = net with a confirmed zero fee is the
      // honest reading: there is no separate fee on this line to know about. This is why
      // `bank_statement_import` is not in GATEWAY_SOURCE_TYPES.
      gross_amount: gross,
      fee_amount: 0,
      tax_or_withholding_amount: 0,
      net_amount: gross,
      currency: batch.currency || 'IDR',

      transaction_at: row.tx_date ? new Date(row.tx_date).toISOString() : null,
      settled_at: null,

      // The bank's reference goes to payer_reference, NOT provider_transaction_id: bank
      // exports repeat references across lines, and 048's provider-transaction unique index
      // would then reject legitimate rows as duplicates.
      payer_name: row.suggested_counterparty || null,
      payer_reference: row.bank_reference || null,
      description: row.description || null,

      status: 'draft',
      reconciliation_status: 'unmatched',
      // Left NULL on purpose. The confirm flow may have created a ledger transaction for this
      // same line, but writing that id here would assert a reviewed match this code never
      // performed. The matching step proposes it as a candidate instead.
      linked_transaction_id: null,
      linked_debt_id: null,

      bank_import_batch_id: batch.id || null,
      bank_import_row_id: row.id || null,
      raw_provider_payload: null,

      idempotency_key: bridgeIdempotencyKey(row),
      created_by_user_id: ctx.actingUserId ?? null,
    },
  };
}

module.exports = { isCreditRow, isConfirmedRow, bridgeIdempotencyKey, buildPaymentFromBankRow };
