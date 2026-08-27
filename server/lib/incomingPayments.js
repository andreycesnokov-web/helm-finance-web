// Incoming payments — pure validation/normalisation (no I/O, unit-tested).
//
// PR1 is a LEDGER-INERT staging layer: nothing here books revenue, creates a transaction, or
// finalises accounting or tax (decision D22). This module only decides whether a submitted
// receipt is well-formed and what its canonical stored shape is.
//
// Provider-agnostic on purpose. Midtrans is one of many (DOKU, Xendit, HitPay, Duitku,
// iPaymu, …) and a new Indonesian provider must not require a code change to be recorded —
// KNOWN_PROVIDERS is a normalisation aid, not an allow-list.

const SOURCE_TYPES = [
  'manual_bank_entry',
  'manual_gateway_import',
  'gateway_settlement',
  'bank_statement_import',
  'future_gateway_api',
  'future_bank_api',
];

// Sources reserved for integrations that do not exist yet. Accepting a row from one of these
// in PR1 would mean fabricating provenance for a feed nobody is running.
const NOT_YET_INGESTIBLE_SOURCE_TYPES = ['future_gateway_api', 'future_bank_api'];

const KNOWN_PROVIDERS = ['midtrans', 'doku', 'xendit', 'hitpay', 'duitku', 'ipaymu', 'bank', 'manual'];

// Sources where the fee is charged by a third party and is therefore NOT knowable from the
// receipt alone. Omitting the fee here means "I don't know yet", never "no fee was charged".
const GATEWAY_SOURCE_TYPES = ['gateway_settlement', 'manual_gateway_import'];

// `status` is the REVIEW axis only. matched/unmatched live in reconciliation_status — one
// fact, one column, so the two can never disagree.
const STATUSES = ['draft', 'reviewed', 'rejected'];
const RECONCILIATION_STATUSES = ['unmatched', 'candidate', 'matched', 'ignored'];

// A payment is always born unreviewed.
const CREATABLE_STATUSES = ['draft'];
// A review decision is one-way: there is no client path back to 'draft', because that would
// erase reviewed_by/reviewed_at from the row. Spec §7 prefers compensating records to erasure.
const CLIENT_SETTABLE_STATUSES = ['reviewed', 'rejected'];

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_TEXT = 255;
const MAX_DESCRIPTION = 2000;

function fail(error, message) { return { ok: false, error, message }; }

// Money is handled in integer CENTS internally. `transactionClass.js` opens by banning float
// arithmetic on money for this codebase; at IDR magnitudes float64 would survive, but the
// arithmetic below (gross − fee − withholding) is exactly where drift would appear, and
// there is no reason to be the one module that reintroduces it.
const toCents = (n) => Math.round(n * 100);
const fromCents = (c) => c / 100;

// Accept a number or a numeric string, reject NaN/Infinity/negative, round to 2dp.
// Returns { present:false } for absent and value:null for an explicit null (= not known yet).
function parseAmount(raw) {
  if (raw === undefined) return { present: false };
  if (raw === null) return { present: true, value: null };
  if (typeof raw === 'boolean') return { present: true, invalid: true };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return { present: true, invalid: true };
  return { present: true, value: fromCents(toCents(n)) };
}

function cleanText(raw, max = MAX_TEXT) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function parseTimestamp(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { invalid: true };
  return { value: d.toISOString() };
}

// Case-folded so 'Midtrans' and 'midtrans' are one provider. Unknown names are kept as
// given (folded) rather than rejected — see KNOWN_PROVIDERS above.
function normalizeProvider(raw) {
  const s = cleanText(raw);
  return s ? s.toLowerCase() : null;
}

/**
 * Deterministic fallback idempotency key.
 *
 * Used only when the caller supplies none. Built from the fields that identify the receipt at
 * its source, so re-submitting the same provider record collides instead of duplicating. For
 * manual entry (no provider ids) it falls back to the economic shape of the receipt, which
 * makes an accidental double-submit of the same form collide — deliberate: a genuine second
 * identical receipt must be recorded with an explicit distinct idempotency_key.
 */
function buildIdempotencyKey(v) {
  const parts = [
    v.provider_transaction_id, v.provider_settlement_id, v.provider_order_id,
    v.settlement_batch_reference, v.payer_reference,
  ].filter(Boolean);
  if (parts.length) return parts.join('|').slice(0, MAX_TEXT);
  return [
    v.source_type, v.provider || '', v.gross_amount, v.currency,
    v.transaction_at || v.settled_at || '', v.payer_name || '',
  ].join('|').slice(0, MAX_TEXT);
}

/**
 * Validate + normalise a create request body.
 * Returns { ok:true, value } or { ok:false, error, message }.
 *
 * `value` never contains business_id (the server sets it from the ACTIVE workspace — never
 * from the body) and never contains a link to a ledger row.
 */
function validateCreate(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected an incoming payment object.');
  }

  // ── Source ────────────────────────────────────────────────────────────────────────────
  const source_type = cleanText(body.source_type);
  if (!source_type) return fail('missing_source_type', 'source_type is required.');
  if (!SOURCE_TYPES.includes(source_type)) {
    return fail('invalid_source_type', 'That source type is not recognised.');
  }
  if (NOT_YET_INGESTIBLE_SOURCE_TYPES.includes(source_type)) {
    return fail('source_type_not_available', 'Direct gateway and bank API sources are not implemented yet.');
  }

  // ── Money ─────────────────────────────────────────────────────────────────────────────
  const gross = parseAmount(body.gross_amount);
  if (!gross.present || gross.value === null || gross.invalid) {
    return fail('invalid_gross_amount', 'gross_amount must be a number of 0 or more.');
  }
  const fee = parseAmount(body.fee_amount);
  if (fee.invalid) return fail('invalid_fee_amount', 'fee_amount must be a number of 0 or more, or null if unknown.');
  const tax = parseAmount(body.tax_or_withholding_amount);
  if (tax.invalid) return fail('invalid_tax_amount', 'tax_or_withholding_amount must be a number of 0 or more, or null if unknown.');

  // What an OMITTED fee means depends on who charges it.
  //
  // On a bank transfer the person recording the receipt sees the whole movement, so omitting
  // the fee is a statement: nothing was deducted. On a gateway settlement the fee is deducted
  // by a third party and is simply not knowable from the receipt — omitting it there means
  // "not known yet", and storing 0 would be the system asserting, on the caller's behalf,
  // that the gateway charged nothing. That is the mirror image of booking net as gross.
  // This applies to the FEE only. Withholding is our own tax treatment of the receipt, not a
  // third party's deduction from it: absent withholding means none applies, on every source.
  const feeUnknownWhenAbsent = GATEWAY_SOURCE_TYPES.includes(source_type);
  const fee_amount = fee.present ? fee.value : (feeUnknownWhenAbsent ? null : 0);
  const tax_or_withholding_amount = tax.present ? tax.value : 0;

  const net = parseAmount(body.net_amount);
  if (net.present && (net.value === null || net.invalid)) {
    return fail('invalid_net_amount', 'net_amount must be a number of 0 or more.');
  }

  // Net is derivable only when every component is known. If a component is unknown, the
  // caller MUST state net explicitly rather than have the system guess it.
  const componentsKnown = fee_amount !== null && tax_or_withholding_amount !== null;
  let net_amount;
  if (net.present) {
    net_amount = net.value;
    if (componentsKnown) {
      const expectedCents = toCents(gross.value) - toCents(fee_amount) - toCents(tax_or_withholding_amount);
      if (expectedCents !== toCents(net_amount)) {
        return fail('net_amount_mismatch',
          'net_amount must equal gross_amount minus fee_amount and tax_or_withholding_amount. '
          + 'If the fee is not known yet, send fee_amount: null instead of omitting it.');
      }
    }
  } else if (componentsKnown) {
    net_amount = fromCents(toCents(gross.value) - toCents(fee_amount) - toCents(tax_or_withholding_amount));
  } else {
    return fail('missing_net_amount',
      'net_amount is required when the fee or withholding is not known. '
      + 'Send the amount that actually landed as net_amount, and fee_amount: null.');
  }
  if (net_amount < 0) {
    return fail('invalid_net_amount', 'net_amount cannot be negative — check the fee and withholding.');
  }

  // ── Currency ──────────────────────────────────────────────────────────────────────────
  const currency = (cleanText(body.currency) || 'IDR').toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    return fail('invalid_currency', 'currency must be a 3-letter code such as IDR.');
  }

  // ── Time ──────────────────────────────────────────────────────────────────────────────
  const transaction_at = parseTimestamp(body.transaction_at);
  if (transaction_at.invalid) return fail('invalid_transaction_at', 'transaction_at is not a valid date.');
  const settled_at = parseTimestamp(body.settled_at);
  if (settled_at.invalid) return fail('invalid_settled_at', 'settled_at is not a valid date.');

  // ── Lifecycle ─────────────────────────────────────────────────────────────────────────
  const status = cleanText(body.status) || 'draft';
  if (!STATUSES.includes(status)) return fail('invalid_status', 'That status is not recognised.');
  if (!CREATABLE_STATUSES.includes(status)) {
    return fail('status_not_creatable', 'A new incoming payment can only be created as draft or unmatched.');
  }

  // Reconciliation state is derived, never client-chosen: PR1 performs no matching, so every
  // new row is unmatched by definition.
  const reconciliation_status = 'unmatched';

  // ── Ledger links are refused outright, not ignored ─────────────────────────────────────
  if (body.linked_transaction_id !== undefined && body.linked_transaction_id !== null) {
    return fail('linking_not_supported', 'Linking a payment to a transaction is not available yet.');
  }
  if (body.linked_debt_id !== undefined && body.linked_debt_id !== null) {
    return fail('linking_not_supported', 'Linking a payment to a receivable is not available yet.');
  }

  // ── Payload ───────────────────────────────────────────────────────────────────────────
  let raw_provider_payload = null;
  if (body.raw_provider_payload !== undefined && body.raw_provider_payload !== null) {
    if (typeof body.raw_provider_payload !== 'object' || Array.isArray(body.raw_provider_payload)) {
      return fail('invalid_payload', 'raw_provider_payload must be an object.');
    }
    raw_provider_payload = body.raw_provider_payload;
  }

  const value = {
    source_type,
    provider: normalizeProvider(body.provider),
    provider_account_id: cleanText(body.provider_account_id),
    provider_transaction_id: cleanText(body.provider_transaction_id),
    provider_order_id: cleanText(body.provider_order_id),
    provider_settlement_id: cleanText(body.provider_settlement_id),
    settlement_batch_reference: cleanText(body.settlement_batch_reference),
    payment_method: cleanText(body.payment_method),
    gross_amount: gross.value,
    fee_amount,
    tax_or_withholding_amount,
    net_amount,
    currency,
    transaction_at: transaction_at.value,
    settled_at: settled_at.value,
    payer_name: cleanText(body.payer_name),
    payer_reference: cleanText(body.payer_reference),
    description: cleanText(body.description, MAX_DESCRIPTION),
    status,
    reconciliation_status,
    raw_provider_payload,
  };

  const suppliedKey = cleanText(body.idempotency_key);
  value.idempotency_key = suppliedKey || buildIdempotencyKey(value);

  return { ok: true, value };
}

/**
 * Validate a review decision. Only 'reviewed' and 'rejected' are settable: a payment cannot
 * be pushed back to 'draft', because that would erase reviewed_by/reviewed_at from the row.
 * Matching is not a status change at all — it moves reconciliation_status, and only the
 * reconciliation path may write it.
 */
function validateStatusChange(current, next) {
  const to = cleanText(next);
  if (!to) return fail('missing_status', 'status is required.');
  if (!STATUSES.includes(to)) {
    return fail('invalid_status', 'That status is not recognised. Matching is not a status change.');
  }
  if (!CLIENT_SETTABLE_STATUSES.includes(to)) {
    return fail('status_not_settable',
      'A payment can only be moved to reviewed or rejected; it cannot be returned to draft.');
  }
  if (current === to) return fail('status_unchanged', `This payment is already ${to}.`);
  return { ok: true, value: to };
}

module.exports = {
  SOURCE_TYPES,
  NOT_YET_INGESTIBLE_SOURCE_TYPES,
  GATEWAY_SOURCE_TYPES,
  KNOWN_PROVIDERS,
  STATUSES,
  RECONCILIATION_STATUSES,
  CREATABLE_STATUSES,
  CLIENT_SETTABLE_STATUSES,
  validateCreate,
  validateStatusChange,
  buildIdempotencyKey,
};
