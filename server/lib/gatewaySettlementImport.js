// Gateway settlement import — provider-agnostic validation (pure, no I/O, no network).
//
// A settlement report is uploaded and parsed by the client (exactly as bank statements
// already are), and arrives here as a batch: one settlement header plus N transaction rows.
// This module validates the batch and produces `incoming_payments` row shapes.
//
// NO PROVIDER IS PRIVILEGED. There is no Midtrans path, no DOKU path. A provider is a string
// on the row, and adding Xendit, HitPay, Duitku, iPaymu, or a gateway that does not exist yet
// requires no code change here — only a client-side column mapping. KNOWN_GATEWAY_PROVIDERS
// exists to normalise spelling and to tell the caller when it is using something unrecognised;
// it is NOT an allow-list, and an unknown provider is imported, not refused.
//
// NOTHING IN THIS MODULE CALLS AN EXTERNAL API OR HOLDS A CREDENTIAL. Settlement data comes
// from a file a human exported from their gateway dashboard.

const IP = require('./incomingPayments');

const KNOWN_GATEWAY_PROVIDERS = [
  'midtrans', 'doku', 'xendit', 'hitpay', 'duitku', 'ipaymu', 'manual_gateway',
];

// A settlement report is a human-supplied export, so it is `manual_gateway_import`, not
// `gateway_settlement` — the latter is reserved for a direct feed from the gateway itself,
// which does not exist and is not built here.
const SETTLEMENT_SOURCE_TYPE = 'manual_gateway_import';

const MAX_ROWS = 2000;
const MAX_TEXT = 255;

function fail(error, message, extra = {}) { return { ok: false, error, message, ...extra }; }
function cleanText(raw, max = MAX_TEXT) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s ? s.slice(0, max) : null;
}

function isKnownProvider(provider) {
  return KNOWN_GATEWAY_PROVIDERS.includes(String(provider || '').trim().toLowerCase());
}

/**
 * Validate one settlement batch.
 *
 * Returns { ok:true, value:{ provider, provider_known, settlement, rows:[paymentValue] } }
 * or { ok:false, error, message, row_index? }.
 *
 * Every row is validated through the SAME validator the single-create endpoint uses, so the
 * gateway fee rule holds automatically: an omitted fee on a gateway row means "not known
 * yet", never a confirmed zero, and such a row must state its net explicitly.
 *
 * The batch is all-or-nothing at validation time: one bad row rejects the batch, naming its
 * index. A partially-imported settlement is worse than a refused one — it looks complete.
 */
function validateSettlementBatch(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected a settlement batch object.');
  }

  const provider = cleanText(body.provider)?.toLowerCase() || null;
  if (!provider) return fail('missing_provider', 'provider is required (for example: midtrans, doku, xendit).');

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return fail('missing_rows', 'A settlement batch must contain at least one row.');
  }
  if (rows.length > MAX_ROWS) {
    return fail('too_many_rows', `A settlement batch is limited to ${MAX_ROWS} rows.`);
  }

  // Settlement-level fields are inherited by every row that does not state its own. This is
  // what makes the three-level structure (transaction → settlement → bank credit) expressible
  // without a separate settlements table in this PR.
  const settlement = {
    provider_account_id: cleanText(body.provider_account_id),
    provider_settlement_id: cleanText(body.provider_settlement_id ?? body.settlement_id),
    settlement_batch_reference: cleanText(body.settlement_batch_reference),
    currency: cleanText(body.currency),
    settled_at: body.settled_at ?? null,
  };

  const built = [];
  const seenRefs = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return fail('invalid_row', 'Each settlement row must be an object.', { row_index: i });
    }

    const providerTxnId = cleanText(r.provider_transaction_id);

    // Catch duplicates INSIDE one upload. The DB index catches them across uploads, but a
    // report containing the same transaction twice should be refused with a clear reason
    // rather than surfacing as an opaque constraint violation mid-insert.
    if (providerTxnId) {
      if (seenRefs.has(providerTxnId)) {
        return fail('duplicate_row_reference',
          `provider_transaction_id "${providerTxnId}" appears more than once in this batch.`,
          { row_index: i });
      }
      seenRefs.add(providerTxnId);
    }

    const candidate = {
      source_type: SETTLEMENT_SOURCE_TYPE,
      provider,
      provider_account_id: r.provider_account_id ?? settlement.provider_account_id,
      provider_transaction_id: providerTxnId,
      provider_order_id: r.provider_order_id,
      provider_settlement_id: r.provider_settlement_id ?? settlement.provider_settlement_id,
      settlement_batch_reference: r.settlement_batch_reference ?? settlement.settlement_batch_reference,
      payment_method: r.payment_method,
      gross_amount: r.gross_amount,
      fee_amount: r.fee_amount,
      tax_or_withholding_amount: r.tax_or_withholding_amount,
      net_amount: r.net_amount,
      currency: r.currency ?? settlement.currency,
      transaction_at: r.transaction_at,
      settled_at: r.settled_at ?? settlement.settled_at,
      payer_name: r.payer_name,
      payer_reference: r.payer_reference,
      description: r.description,
      raw_provider_payload: r.raw_provider_payload ?? r.raw ?? null,
      idempotency_key: r.idempotency_key,
      // Passed through deliberately so the validator REFUSES them. Dropping them here would
      // silently accept a batch that asked for something the layer does not allow.
      linked_transaction_id: r.linked_transaction_id,
      linked_debt_id: r.linked_debt_id,
      status: r.status,
    };

    const parsed = IP.validateCreate(candidate);
    if (!parsed.ok) return fail(parsed.error, parsed.message, { row_index: i });
    built.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      provider,
      provider_known: isKnownProvider(provider),
      settlement,
      rows: built,
    },
  };
}

module.exports = {
  KNOWN_GATEWAY_PROVIDERS,
  SETTLEMENT_SOURCE_TYPE,
  MAX_ROWS,
  isKnownProvider,
  validateSettlementBatch,
};
