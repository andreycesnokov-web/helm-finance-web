// Where an upload came from, and what that does — and does not — imply.
//
// A user who uploads from the Payables screen has told us something real: they believe
// this is a bill they owe. That belief is worth keeping. It is NOT worth trusting over
// the document itself — a scanned kwitansi uploaded through the invoice flow is still a
// receipt, and filing it as an invoice because of the button that was clicked would put
// a payment record where evidence belongs.
//
// So intent is stored as REVIEW METADATA next to the AI's reading, never merged into it,
// and never written to the document_type column. When the two disagree the user is asked.
'use strict';

// Every source the client may declare. An unknown value is discarded rather than stored,
// so this list is the whole vocabulary and a typo cannot invent a new one.
const UPLOAD_SOURCES = {
  invoice_upload: { label: 'Invoice', document_type: 'invoice', direction: null },
  payable_upload: { label: 'Payable', document_type: 'invoice', direction: 'payable' },
  receivable_upload: { label: 'Receivable', document_type: 'invoice', direction: 'receivable' },
  payment_proof_upload: { label: 'Payment proof', document_type: 'payment_proof', direction: null },
  settlement_upload: { label: 'Invoice settlement', document_type: null, direction: null },
  accountant_upload: { label: 'AI Accountant', document_type: null, direction: null },
  document_center_upload: { label: 'Documents', document_type: null, direction: null },
};

const isKnownSource = (s) => Object.prototype.hasOwnProperty.call(UPLOAD_SOURCES, s);

/**
 * Build the stored intent record, or null when the client declared nothing useful.
 * Shape is fixed and small: it is review metadata, not a second document record.
 */
function buildUploadIntent(source, opts = {}) {
  if (typeof source !== 'string' || !isKnownSource(source)) return null;
  const s = UPLOAD_SOURCES[source];
  return {
    source,
    label: s.label,
    // What the SOURCE implies. A declared document_type on the upload itself (the payment
    // proof flow sets one) is the stronger statement of intent, so it wins here.
    suggested_document_type: (opts.declaredType && opts.declaredType !== 'other')
      ? opts.declaredType : s.document_type,
    suggested_direction: s.direction,
    created_at: opts.createdAt || new Date().toISOString(),
  };
}

// Which AI readings are compatible with an intent. An invoice flow that receives a faktur
// pajak has not been contradicted — a faktur is part of the same billing event. A receipt
// or a bank statement IS a contradiction: different document, different workflow.
const COMPATIBLE = {
  invoice: ['invoice', 'faktur_pajak'],
  faktur_pajak: ['faktur_pajak', 'invoice'],
  payment_proof: ['payment_proof', 'receipt'],
  receipt: ['receipt', 'payment_proof'],
};

/**
 * Does the AI's reading contradict what the user said they were uploading?
 *
 * Only a CONFIDENT, POSITIVE reading can contradict anything. "unknown" and an
 * unsupported scan mean the document was not read — that is a gap, not a disagreement,
 * and reporting it as a conflict would tell the user their upload was wrong on no
 * evidence at all.
 */
function detectIntentConflict(intent, aiType, opts = {}) {
  const expected = intent?.suggested_document_type;
  if (!expected || !aiType || aiType === 'unknown') return false;
  if (opts.unsupported) return false;
  const ok = COMPATIBLE[expected] || [expected];
  return !ok.includes(aiType);
}

/** One sentence naming both readings. The user decides; nothing is filed on this. */
function intentConflictMessage(intent, aiType, labelOf = (t) => t) {
  if (!intent) return null;
  return `Uploaded as ${intent.label}, but CFO AI reads this as ${labelOf(aiType)}. `
    + 'Please confirm the correct workflow before anything is created.';
}

module.exports = {
  UPLOAD_SOURCES, isKnownSource, buildUploadIntent, detectIntentConflict, intentConflictMessage,
};
