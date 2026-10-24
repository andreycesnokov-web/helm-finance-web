// Business purpose and accountant review of an operation (management vs accounting preparation, 24 Oct 2026).
// Pure helpers + one company-scoped loader; tested in tests/transactionClassifications.test.js.
// Storage: public.transaction_classifications (migration 20261024150000), one optional row per operation.
//
// Three separate things, never merged:
//   business purpose   what the money was for (management view): operating · personal · capital · non_pnl · needs_review
//   document status    from the operation documents engine (lib/operationDocuments.js), never from this table
//   accountant review  a mark a person with an accounting role sets; the server records who and when
// Tax treatment is NOT decided here: a receipt never makes an expense deductible. It stays "undetermined —
// accountant review" until a reviewed tax engine exists.
// The cash forecast (burn, Radar) never reads purposes: a personal payment from a company account still left it.
'use strict';

const PURPOSES = ['operating', 'personal', 'capital', 'non_pnl', 'needs_review'];
// Same roles as the bill accountant check (P-05, migration 061).
const REVIEW_ROLES = ['owner', 'ceo', 'admin', 'cfo', 'accountant'];
const canReview = (role) => REVIEW_ROLES.includes(role);
const TABLE = 'transaction_classifications';

// Management treatment of a purpose: the class the cash insights use. 'operating' adds no override (the category
// or keywords still decide between cost and revenue).
const PURPOSE_CLASS = { personal: 'personal', capital: 'capex', non_pnl: 'other', needs_review: 'unknown' };
// P&L treatment: excluded from operating profit with a reason, or held for review.
const PURPOSE_PNL = { personal: { exclude: 'personal_non_business' }, capital: { exclude: 'capital_purchase' },
  non_pnl: { exclude: 'non_pnl_movement' }, needs_review: { exception: 'purpose_needs_review' } };

/**
 * PUT /api/transactions/:id/classification body. Every key is optional; a key that is absent is left unchanged.
 *   business_purpose  one of PURPOSES, or null (back to "not set": the category decides again)
 *   accountant_reviewed  true / false — who and when are set by the server, never by the client
 *   note              text up to 500 characters, or null
 */
function bodyFrom(b = {}) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(b, 'business_purpose')) {
    const p = b.business_purpose;
    if (p !== null && !PURPOSES.includes(p)) return { error: 'invalid_business_purpose', allowed: PURPOSES };
    out.business_purpose = p;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'accountant_reviewed')) {
    if (typeof b.accountant_reviewed !== 'boolean') return { error: 'invalid_accountant_reviewed' };
    out.accountant_reviewed = b.accountant_reviewed;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'note')) {
    const n = b.note;
    if (n !== null && typeof n !== 'string') return { error: 'invalid_note' };
    const v = n == null ? null : n.trim().slice(0, 500) || null;
    out.note = v;
  }
  for (const k of ['accountant_reviewed_at', 'accountant_reviewed_by', 'purpose_set_by', 'purpose_set_at', 'business_id', 'transaction_id'])
    if (Object.prototype.hasOwnProperty.call(b, k)) return { error: 'server_controlled_field', field: k };
  if (!Object.keys(out).length) return { error: 'nothing_to_change' };
  return { value: out };
}

/**
 * The row to write, from the stored row (or null) and a validated body. A changed purpose clears an earlier
 * accountant review: the review was of the previous classification. Never sets a review the caller did not ask for.
 */
function nextRow(prev, body, { userId, businessId, transactionId, now = new Date().toISOString() }) {
  const row = {
    transaction_id: transactionId, business_id: businessId,
    business_purpose: prev?.business_purpose ?? null, purpose_set_by: prev?.purpose_set_by ?? null, purpose_set_at: prev?.purpose_set_at ?? null,
    accountant_reviewed_at: prev?.accountant_reviewed_at ?? null, accountant_reviewed_by: prev?.accountant_reviewed_by ?? null,
    note: prev?.note ?? null, updated_at: now,
  };
  const purposeChanged = 'business_purpose' in body && body.business_purpose !== row.business_purpose;
  if (purposeChanged) {
    row.business_purpose = body.business_purpose; row.purpose_set_by = userId; row.purpose_set_at = now;
    row.accountant_reviewed_at = null; row.accountant_reviewed_by = null;
  }
  if ('note' in body) row.note = body.note;
  if ('accountant_reviewed' in body) {
    if (body.accountant_reviewed) { row.accountant_reviewed_at = now; row.accountant_reviewed_by = userId; }
    else { row.accountant_reviewed_at = null; row.accountant_reviewed_by = null; }
  }
  return row;
}

const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(e.message || ''));

/** This company's rows as a Map(transaction id → row). No table yet → { available:false, byTx: empty }. */
async function loadClassifications(db, businessId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(TABLE).select('*').eq('business_id', businessId).order('transaction_id', { ascending: true }).range(from, from + 999);
    if (error) { if (isMissingTable(error)) return { available: false, byTx: new Map() }; throw error; }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { available: true, byTx: new Map(rows.filter((r) => r.business_id === businessId).map((r) => [String(r.transaction_id), r])) };
}

/** purposeOf(tx) for the insights classifier: the set purpose, or null (not set). */
const purposeResolver = (byTx) => (tx) => (tx && tx.id != null ? byTx.get(String(tx.id))?.business_purpose || null : null);

module.exports = { PURPOSES, REVIEW_ROLES, canReview, TABLE, PURPOSE_CLASS, PURPOSE_PNL, bodyFrom, nextRow, isMissingTable, loadClassifications, purposeResolver };
