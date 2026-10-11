// Invoice Payment Matching V1 — partial settlement and closeout.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
// The arithmetic and the rules behind "is this invoice unpaid, partly paid, or
// settled, and may it be closed?". Pure: no DB, no network, no side effects.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//   * NOT an extractor. It does not read PDFs and does not do OCR. It takes values
//     that a human entered or that a real extraction pipeline produced, normalises
//     them, and says plainly which ones are missing. `needsReview` is a real answer.
//   * NOT an auto-closer. Nothing here closes an invoice. It reports whether the
//     conditions for closing are met; a person still has to act.
//   * NOT a payer. It never moves money, never contacts a bank, never files tax.
//
// The closeout rule that matters: a payment existing is NOT sufficient. Money,
// documents and review are three separate gates, and all three are reported.
'use strict';

/* ── amount parsing ────────────────────────────────────────────────────────
   Indonesian invoices write Rp129.600.000 — "." groups thousands. Anglo formats
   write 129,600,000. Guessing wrong by a factor of 1000 on an invoice total is a
   serious error, so the rule is explicit rather than clever: whichever separator
   appears LAST and is followed by exactly two digits is the decimal point; every
   other separator is a grouping mark. */
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/(rp|idr|usd|\$|\s| )/gi, '');
  if (!/^-?[\d.,]+$/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);
  let intPart = cleaned;
  let decPart = '';
  if (lastSep !== -1) {
    const tail = cleaned.slice(lastSep + 1);
    // Exactly two trailing digits after the final separator = decimals.
    if (/^\d{2}$/.test(tail)) { intPart = cleaned.slice(0, lastSep); decPart = tail; }
  }
  const digits = intPart.replace(/[.,]/g, '');
  if (!/^-?\d+$/.test(digits)) return null;
  const n = Number(decPart ? `${digits}.${decPart}` : digits);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ── document field models ─────────────────────────────────────────────────
   The fields V1 understands. Anything absent is reported in `missing`, never
   invented, and any document with missing required fields is needs_review. */
const INVOICE_FIELDS = [
  'invoice_number', 'vendor_name', 'vendor_npwp', 'buyer_name', 'buyer_npwp',
  'invoice_date', 'due_date', 'description', 'period_start', 'period_end',
  'base_amount', 'tax_type', 'tax_amount', 'total_amount', 'currency',
  'bank_account', 'document_reference',
];
const PAYMENT_PROOF_FIELDS = [
  'bank_name', 'transfer_date', 'from_account_name', 'from_account_number',
  'to_account_name', 'to_account_number', 'amount', 'fee', 'status',
  'reference_number', 'currency',
];
const INVOICE_REQUIRED = ['invoice_number', 'vendor_name', 'total_amount'];
const PROOF_REQUIRED = ['amount', 'reference_number'];

function normalizeInvoice(raw = {}) {
  const out = { document_type: 'invoice' };
  for (const f of INVOICE_FIELDS) out[f] = raw[f] === undefined ? null : raw[f];
  out.base_amount = parseAmount(raw.base_amount);
  out.tax_amount = parseAmount(raw.tax_amount);
  out.total_amount = parseAmount(raw.total_amount);
  out.currency = (raw.currency || 'IDR').toString().trim().toUpperCase() || 'IDR';

  // A total that contradicts base + tax is a reading error, not something to average.
  const warnings = [];
  if (out.base_amount !== null && out.tax_amount !== null) {
    const sum = round2(out.base_amount + out.tax_amount);
    if (out.total_amount === null) out.total_amount = sum;
    else if (Math.abs(round2(out.total_amount) - sum) > 0.5) {
      warnings.push(`Invoice total ${out.total_amount} does not equal base ${out.base_amount} + tax ${out.tax_amount} (${sum}). Confirm which figure is correct.`);
    }
  }
  const missing = INVOICE_REQUIRED.filter((f) => out[f] === null || out[f] === '');
  return { ...out, missing, warnings, needs_review: missing.length > 0 || warnings.length > 0 };
}

function normalizePaymentProof(raw = {}) {
  const out = { document_type: 'payment_proof' };
  for (const f of PAYMENT_PROOF_FIELDS) out[f] = raw[f] === undefined ? null : raw[f];
  out.amount = parseAmount(raw.amount);
  out.fee = parseAmount(raw.fee);
  out.currency = (raw.currency || 'IDR').toString().trim().toUpperCase() || 'IDR';
  out.reference_number = raw.reference_number ? String(raw.reference_number).trim() : null;

  const missing = PROOF_REQUIRED.filter((f) => out[f] === null || out[f] === '');
  const warnings = [];
  // "Pending" or "failed" money has not moved. It must never settle anything.
  const ok = out.status === null || /success|berhasil|complete|settled/i.test(String(out.status));
  if (!ok) warnings.push(`Payment status is "${out.status}" — only a successful transfer can settle an invoice.`);
  return { ...out, settled_ok: ok, missing, warnings, needs_review: missing.length > 0 || !ok };
}

/* ── direction ─────────────────────────────────────────────────────────────
   Who issued the document and who received it — never what the user called it.
   A user saying "client invoice" about a bill they must pay is exactly the case
   this exists to get right. */
const norm = (s) => String(s || '').toLowerCase().replace(/\b(pt|cv|persero|tbk|ltd|inc)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function nameMatches(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  return shorter.length >= 4 && longer.includes(shorter);
}

function classifyDirection({ issuer_name, recipient_name, business_name } = {}) {
  const issuerIsUs = nameMatches(issuer_name, business_name);
  const buyerIsUs = nameMatches(recipient_name, business_name);
  if (buyerIsUs && !issuerIsUs) {
    return { direction: 'payable', confidence: 'High',
      reason: `${issuer_name} issued the document to ${recipient_name} (this business), so this business owes the money.` };
  }
  if (issuerIsUs && !buyerIsUs) {
    return { direction: 'receivable', confidence: 'High',
      reason: `${issuer_name} (this business) issued the document to ${recipient_name}, so this business is owed the money.` };
  }
  return { direction: 'unknown', confidence: 'Needs accountant review',
    reason: 'Issuer and recipient could not be matched against this business. Confirm which party issued the invoice.' };
}

/* ── settlement maths ──────────────────────────────────────────────────────
   Tolerance absorbs rounding only. It is deliberately tiny: a "close enough"
   window wide enough to hide a real shortfall would defeat the whole feature. */
const DEFAULT_TOLERANCE = 1;

function settlementOf({ invoice_total, base_amount = null, tax_amount = null,
                        allocations = [], tolerance = DEFAULT_TOLERANCE } = {}) {
  const total = parseAmount(invoice_total);
  const valid = (allocations || []).filter((a) => Number(a && a.allocated_amount) > 0);
  const paid = round2(valid.reduce((s, a) => s + Number(a.allocated_amount), 0));

  if (total === null) {
    return {
      invoice_total: null, paid_amount: paid, remaining_amount: null,
      status: 'needs_review', payment_count: valid.length,
      base_view: null, tolerance,
      blockers: ['Invoice total is unknown, so the remaining balance cannot be calculated.'],
    };
  }

  const remaining = round2(total - paid);
  let status;
  if (paid <= 0) status = 'unpaid';
  else if (remaining > tolerance) status = 'partially_paid';
  else if (remaining < -tolerance) status = 'overpaid';
  else status = 'paid';

  // Context only. Closeout is measured against the TOTAL including tax, because that
  // is what the vendor is owed — the base-only figure is shown so a user comparing
  // against the DPP line on the faktur is not confused, never as the target.
  const base = parseAmount(base_amount);
  const base_view = base === null ? null : {
    base_amount: base,
    paid_against_base: paid,
    base_remaining: round2(base - paid),
    note: 'Context only. Settlement is measured against the invoice total including tax.',
  };

  return {
    invoice_total: total,
    tax_amount: parseAmount(tax_amount),
    paid_amount: paid,
    remaining_amount: Math.abs(remaining) <= tolerance ? 0 : remaining,
    over_paid_amount: remaining < -tolerance ? round2(-remaining) : 0,
    status,
    payment_count: valid.length,
    base_view,
    tolerance,
    blockers: status === 'overpaid'
      ? [`Allocated payments exceed the invoice total by ${round2(-remaining)}. Review before closing.`]
      : [],
  };
}

/* ── payment ↔ invoice matching ────────────────────────────────────────────
   A score with its reasons attached. Anything that cannot be verified lowers
   confidence rather than being assumed true, and a blocker means "do not offer
   this match at all", not "offer it quietly". */
function matchPaymentToInvoice(proof = {}, invoice = {}, opts = {}) {
  const outstanding = opts.outstanding !== undefined ? parseAmount(opts.outstanding)
    : parseAmount(invoice.total_amount);
  const reasons = [];
  const blockers = [];
  let score = 0;

  const amt = parseAmount(proof.amount);
  const cur = (proof.currency || 'IDR').toUpperCase();
  const invCur = (invoice.currency || 'IDR').toUpperCase();

  if (cur !== invCur) blockers.push(`Payment is in ${cur} but the invoice is in ${invCur}.`);
  else { score += 1; reasons.push(`Currency matches (${cur}).`); }

  if (proof.settled_ok === false) blockers.push(`Payment status is "${proof.status}".`);

  if (amt === null) blockers.push('Payment amount is unknown.');
  else if (outstanding !== null && amt > outstanding + DEFAULT_TOLERANCE) {
    blockers.push(`Payment ${amt} is larger than the outstanding balance ${outstanding}.`);
  } else if (outstanding !== null) {
    score += 2;
    reasons.push(amt === outstanding
      ? `Payment settles the full outstanding balance (${amt}).`
      : `Payment ${amt} fits within the outstanding balance ${outstanding}.`);
  }

  // The vendor being paid should be the vendor who billed.
  if (nameMatches(proof.to_account_name, invoice.vendor_name)) {
    score += 2; reasons.push(`Paid to ${proof.to_account_name}, which matches the invoice vendor.`);
  } else if (proof.to_account_name && invoice.vendor_name) {
    reasons.push(`Payee "${proof.to_account_name}" does not clearly match vendor "${invoice.vendor_name}".`);
  }

  // And the payer should be us.
  if (opts.business_name && nameMatches(proof.from_account_name, opts.business_name)) {
    score += 1; reasons.push(`Paid from ${proof.from_account_name}, which matches this business.`);
  }

  const pDate = proof.transfer_date ? new Date(proof.transfer_date) : null;
  const iDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;
  if (pDate && iDate && !Number.isNaN(pDate.getTime()) && !Number.isNaN(iDate.getTime())) {
    if (pDate >= iDate) { score += 1; reasons.push('Payment date is on or after the invoice date.'); }
    else blockers.push('Payment is dated before the invoice.');
  }

  if (proof.reference_number) { score += 1; reasons.push(`Bank reference ${proof.reference_number} present.`); }
  else reasons.push('No bank reference on the payment proof.');

  const confidence = blockers.length ? 'Blocked' : score >= 7 ? 'High' : score >= 5 ? 'Medium' : 'Low';
  return {
    matched: blockers.length === 0 && score >= 5,
    confidence, score, max_score: 8, reasons, blockers,
    suggested_allocation: blockers.length === 0 && amt !== null
      ? Math.min(amt, outstanding === null ? amt : outstanding) : null,
    // Every match is a suggestion. Allocation happens only on an explicit action.
    requires_confirmation: true,
  };
}

/* ── duplicate protection ──────────────────────────────────────────────────
   The bank reference is the strongest natural key a transfer has. The DB also
   holds a UNIQUE(debt_id, transaction_id) index on debt_settlement_allocations,
   so this layer catches the case that index cannot see: the SAME transfer
   arriving again as a NEW document/transaction. */
function duplicateKeyOf(proof = {}) {
  const ref = proof.reference_number ? String(proof.reference_number).trim() : null;
  if (!ref) return null;
  return `${(proof.bank_name || 'bank').toString().trim().toUpperCase()}:${ref}`;
}

function findDuplicateProof(proof, existing = []) {
  const key = duplicateKeyOf(proof);
  if (!key) return { duplicate: false, reason: 'No bank reference — duplicates cannot be detected automatically.' };
  const hitRow = (existing || []).find((e) => duplicateKeyOf(e) === key);
  return hitRow
    ? { duplicate: true, key, match: hitRow,
        reason: `Bank reference ${proof.reference_number} has already been recorded. Allocating it again would double-count the payment.` }
    : { duplicate: false, key };
}

/* ── closeout ──────────────────────────────────────────────────────────────
   Money, documents and review are separate gates. A payment existing satisfies
   exactly one of them. */
const REQUIRED_DOCUMENTS = [
  { key: 'invoice', label: 'Invoice', required: true },
  { key: 'tax_invoice', label: 'Faktur Pajak', required: false,
    required_when: 'the invoice carries PPN' },
  { key: 'payment_proof', label: 'Payment proof', required: true },
  { key: 'contract', label: 'Contract / agreement / TAC', required: false },
  { key: 'accountant_confirmation', label: 'Accountant confirmation', required: true },
];

function closeoutState({ settlement, documents = {}, accountant_review = null,
                         duplicates = [], has_tax = false } = {}) {
  const s = settlement || {};
  const missing_documents = [];
  const checklist = REQUIRED_DOCUMENTS.map((d) => {
    const present = !!documents[d.key];
    // A faktur pajak is only required when the invoice actually carries tax.
    const required = d.key === 'tax_invoice' ? !!has_tax : d.required;
    if (required && !present) missing_documents.push(d.label);
    return { ...d, required, present };
  });

  const reviewDone = accountant_review === 'accountant_approved' || accountant_review === 'confirmed';
  const blockers = [...(s.blockers || [])];

  if (s.status === 'unpaid') blockers.push('No payment has been allocated to this invoice.');
  if (s.status === 'partially_paid') blockers.push(`Cannot close yet. Remaining balance: ${s.remaining_amount}.`);
  if (s.status === 'overpaid') blockers.push('Allocated payments exceed the invoice total.');
  if (s.status === 'needs_review') blockers.push('Invoice total is unknown.');
  if (missing_documents.length) blockers.push(`Missing documents: ${missing_documents.join(', ')}.`);
  if (!reviewDone) blockers.push('Accountant review is not complete.');
  if (duplicates && duplicates.length) blockers.push(`${duplicates.length} possible duplicate payment proof(s) need review.`);

  const fullyPaid = s.status === 'paid';
  let state;
  if (s.status === 'needs_review' || s.status === 'overpaid') state = 'Needs review';
  else if (s.status === 'unpaid') state = 'Open';
  else if (s.status === 'partially_paid') state = 'Partially paid';
  else if (fullyPaid && missing_documents.length) state = 'Fully paid — documents incomplete';
  else if (fullyPaid && !reviewDone) state = 'Ready for accountant review';
  else state = 'Closed / accountant confirmed';

  return {
    state,
    // Closing is never automatic. This says the gates are open, not that it happened.
    can_close: blockers.length === 0,
    blockers,
    checklist,
    missing_documents,
    accountant_review_complete: reviewDone,
  };
}

module.exports = {
  parseAmount, round2,
  INVOICE_FIELDS, PAYMENT_PROOF_FIELDS, REQUIRED_DOCUMENTS, DEFAULT_TOLERANCE,
  normalizeInvoice, normalizePaymentProof,
  classifyDirection, nameMatches,
  settlementOf, matchPaymentToInvoice,
  duplicateKeyOf, findDuplicateProof,
  closeoutState,
};
