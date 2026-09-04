// Reading the Document Intake Orchestrator's summary in the Document Center.
//
// The backend runs the intake pipeline after every upload and stores its conclusion in
// extracted_json.ai_intake_v2 (whitelisted by server/lib/documentPublicView.js). The
// document's own `document_type` COLUMN is deliberately NOT overwritten by that pipeline —
// intake suggests, a human confirms — which is why a correctly recognised invoice used to
// sit in the inbox labelled "Unclassified" with no next step.
//
// This module is the view model that fixes that. It is pure and free of React so the
// wording, the badges and — more importantly — the rules about what may be OFFERED can be
// tested directly (tests/documentIntakeView.test.mjs).
//
// Two rules run through all of it:
//   1. A suggestion is never a fact. Stored type and AI suggestion are shown side by side,
//      never merged, and nothing here writes anything.
//   2. An unreadable document is not a dead document. A scan with no text layer still gets
//      a full set of manual next steps.

/* ── reading the summary ───────────────────────────────────────────────────── */

export const intakeOf = (d) => d?.extracted_json?.ai_intake_v2 || null;

/** What the user said they were uploading, kept from the screen they used. */
export const uploadIntentOf = (d) => d?.extracted_json?.upload_intent || null;

/** How the fields in front of us were obtained. */
export const READ_SOURCE_LABEL = {
  embedded_text: 'Read from the document text',
  ocr_vision: 'Read by OCR/Vision',
  filename_only: 'Not read — file name only',
  manual: 'Set by a person',
};
export const readSourceLabel = (v2) => READ_SOURCE_LABEL[v2?.source] || null;
export const wasReadByOcr = (v2) => v2?.source === 'ocr_vision';

/** Legacy intake (documentIntake.js). Still shown for vault classification; distinct thing. */
export const legacyIntakeOf = (d) => d?.extracted_json?.ai_intake || null;

/** "No text to read" — a scan or a photo. Not the same as "read it and understood nothing". */
export const isUnsupported = (v2) => !!v2 && v2.status === 'unsupported';

export const TYPE_LABEL = {
  invoice: 'Invoice',
  faktur_pajak: 'Faktur Pajak',
  payment_proof: 'Payment proof',
  receipt: 'Receipt',
  contract: 'Contract',
  bank_statement: 'Bank statement',
  tax_document: 'Tax document',
  payroll_document: 'Payroll document',
  bank_fee: 'Bank fee',
  asset_purchase: 'Asset purchase',
  funding_document: 'Funding document',
  unknown: 'Unrecognised',
};
export const typeLabelOf = (t) => TYPE_LABEL[t] || (t ? String(t).replace(/_/g, ' ') : null);

export const DIRECTION_LABEL = {
  payable: 'Payable',
  receivable: 'Receivable',
  incoming_payment: 'Incoming payment',
  outgoing_payment: 'Outgoing payment',
  supporting: 'Supporting document',
  unknown: null,
};
export const directionLabelOf = (d) => DIRECTION_LABEL[d] ?? null;

const STATUS_LABEL = {
  ready_to_confirm: 'Ready to confirm',
  needs_missing_fields: 'Needs fields',
  needs_counterparty: 'Needs counterparty',
  needs_accountant_review: 'Accountant review',
  linked: 'Linked',
  unsupported: 'Unsupported',
};
export const statusLabelOf = (s) => STATUS_LABEL[s] || 'Needs review';

/** The label actually shown, which depends on HOW the document was read.
 *
 *  "Ready to confirm" is honest for values parsed out of a document's own text. For a
 *  page read by vision it overstates the case: those values came from pixels and must be
 *  checked before anything is built on them. The status ENUM is unchanged — only the
 *  word the user sees. */
export function statusLabelFor(v2) {
  if (wasReadByOcr(v2) && v2?.status === 'ready_to_confirm') return 'Ready for review';
  return statusLabelOf(v2?.status);
}

/* ── badges ────────────────────────────────────────────────────────────────── */

/** Badges for a row or panel header: what it is, which way it points, where it stands. */
export function intakeBadges(v2) {
  if (!v2) return [];
  const out = [];
  const t = typeLabelOf(v2.document_type);
  if (t && v2.document_type !== 'unknown') out.push({ key: 'type', label: t, tone: 'info' });
  const dir = directionLabelOf(v2.direction);
  if (dir) out.push({ key: 'direction', label: dir, tone: v2.direction === 'supporting' ? 'neutral' : 'info' });
  out.push({
    key: 'status',
    label: statusLabelFor(v2),
    tone: v2.status === 'ready_to_confirm' || v2.status === 'linked' ? 'success'
      : v2.status === 'unsupported' ? 'neutral' : 'warning',
  });
  if (v2.ppn_detected || v2.tax_status === 'tax_not_confirmed') out.push({ key: 'ppn', label: taxBadgeLabel(v2), tone: v2.ppn_detected ? 'info' : 'neutral' });
  if (v2.accountant_review_required) out.push({ key: 'acct', label: 'Accountant review', tone: 'warning' });
  return out;
}

/* ── one-line summary for a list row ───────────────────────────────────────── */

const money = (n, ccy) => `${ccy || 'IDR'} ${Number(n).toLocaleString('de-DE')}`;

/* ── how tax may be described ──────────────────────────────────────────────
   What we are allowed to SAY about a tax figure depends on who read it. Text
   parsed off the document is a reading; a figure a vision model produced is a
   value to verify — production returned a PPN on one run and none on the next
   for the same page, at a number equal to 11/111 of the total. Nothing here
   ever presents a computed figure as printed. */
export function taxBadgeLabel(v2) {
  if (!v2?.ppn_detected) return 'Tax not confirmed';
  return wasReadByOcr(v2) ? 'PPN — verify OCR value' : 'PPN detected';
}

export function taxLine(v2) {
  if (!v2?.ppn_detected) return 'Not confirmed from the document';
  const amt = v2.ppn_amount != null ? money(v2.ppn_amount, v2.currency) : 'amount not read';
  return wasReadByOcr(v2)
    ? `PPN may be present — verify ${amt}`
    : `PPN ${amt}`;
}

/** "Invoice · Payable · Needs counterparty" — the row's headline. */
export function intakeHeadline(v2) {
  if (!v2) return null;
  return [
    typeLabelOf(v2.document_type),
    directionLabelOf(v2.direction),
    statusLabelFor(v2),
  ].filter(Boolean).join(' · ');
}

/** The row's secondary lines: amount, tax, what is missing. Only what is actually known. */
export function intakeRowLines(v2) {
  if (!v2) return [];
  const lines = [];
  if (v2.amount !== null && v2.amount !== undefined) lines.push(`Amount: ${money(v2.amount, v2.currency)}`);
  if (v2.ppn_detected && v2.ppn_amount != null) lines.push(`Tax: ${taxLine(v2)}`);
  else if (v2.tax_status === 'tax_not_confirmed') lines.push('Tax: Not confirmed from the document');
  else if (v2.accountant_review_required) lines.push('Tax: Needs review');
  if (v2.missing_fields?.length) lines.push(`Missing: ${v2.missing_fields.join(', ')}`);
  return lines;
}

/* ── the copy ──────────────────────────────────────────────────────────────── */

export const UNSUPPORTED_COPY = 'This looks like a scanned document. OCR/Vision is not enabled yet. '
  + 'Enter fields manually or request accountant review.';
export const OCR_READ_COPY = 'OCR/Vision read this document. Please review before creating records.';

/** The sentence at the top of the intake result. Never states a fact it does not have. */
export function intakeCopy(v2) {
  if (!v2) return 'This document has not been analysed yet.';
  if (isUnsupported(v2)) return UNSUPPORTED_COPY;
  const t = typeLabelOf(v2.document_type);
  if (!t || v2.document_type === 'unknown') return 'CFO AI could not tell what this document is. Please review it.';
  // A vision reading is disclosed as one: the user should weigh a photographed page
  // differently from text the document actually carries.
  if (wasReadByOcr(v2)) return OCR_READ_COPY;
  const article = /^[aeiou]/i.test(t) ? 'an' : 'a';
  return `AI thinks this is ${article} ${t.toLowerCase()}. Please review before creating records.`;
}

/** Shown when the stored column and the suggestion disagree — both, never merged.
 *
 *  Three separate concepts, deliberately never collapsed into one label:
 *    · stored     — the column a person owns. Only a human writes it.
 *    · uploadedAs — what the user believed when they chose the upload screen.
 *    · suggested  — what the reader made of the document itself.
 *  Any of the three can be right, so the UI shows whichever are known. */
export function storedVsSuggested(doc, storedLabel) {
  const v2 = intakeOf(doc);
  const intent = uploadIntentOf(doc);
  const suggested = v2 ? typeLabelOf(v2.document_type) : null;
  const storedIsBlank = !doc?.document_type || doc.document_type === 'other';
  const uploadedAs = intent?.label || null;
  return {
    storedLabel,
    uploadedAs,
    suggestedLabel: suggested,
    conflict: !!v2?.intent_conflict,
    // Only worth showing the pair when the AI actually adds something the column lacks.
    showPair: !!(storedIsBlank && suggested && v2.document_type !== 'unknown'),
    // The upload intent is worth showing whenever the column is still blank — including
    // for a scan the reader could not classify, where it is the only thing known.
    showUploadedAs: !!(uploadedAs && storedIsBlank),
  };
}

/** The sentence for a disagreement. Names both readings; decides nothing. */
export function conflictMessage(doc) {
  const v2 = intakeOf(doc);
  const intent = uploadIntentOf(doc);
  if (!v2?.intent_conflict || !intent) return null;
  return `Uploaded as ${intent.label}, but CFO AI reads this as ${typeLabelOf(v2.document_type)}. `
    + 'Please confirm the correct workflow before anything is created.';
}

/** What the suggested record actually means, in words. The raw enum leaked into the
 *  panel as "Create supporting_document draft" — an underscore, and the word "Create"
 *  for the one kind that is never created. */
export const RECORD_LABEL = {
  payable: 'Create payable draft',
  receivable: 'Create receivable draft',
  transaction: 'Record as a transaction',
  supporting_document: 'Save as supporting document',
  tax_review: 'Send for tax review',
  none: 'None suggested',
};
export const recordLabelOf = (t) => RECORD_LABEL[t] || String(t || '').replace(/_/g, ' ');

/* ── next actions ──────────────────────────────────────────────────────────── */

// The stored summary keeps action KEYS, not labels, so the vocabulary lives here.
export const NEXT_ACTION_LABEL = {
  review_fields: 'Review missing fields',
  create_counterparty: 'Create counterparty',
  review_counterparty_match: 'Review possible counterparty match',
  view_counterparty: 'View counterparty',
  create_payable_draft: 'Create payable draft',
  create_receivable_draft: 'Create receivable draft',
  link_to_existing_record: 'Link to an existing record',
  create_transaction_draft: 'Record as a transaction',
  save_document_only: 'Save as supporting document',
  request_accountant_review: 'Send to accountant review',
  enter_manually: 'Enter the values manually',
};
export const nextActionLabels = (v2) =>
  (v2?.next_action_keys || []).map((k) => ({ key: k, label: NEXT_ACTION_LABEL[k] || k.replace(/_/g, ' ') }));

/* ── what the panel may OFFER ──────────────────────────────────────────────── */

// A draft may be offered only when intake actually suggests that record type, the amount
// is known, and the document is not already on a record. Missing fields block it — the
// user is sent to the review form first, exactly as Phase 6/8 require.
export function draftOffer(v2, { alreadyLinked = false } = {}) {
  const type = v2?.suggested_record_type;
  if (!v2 || (type !== 'payable' && type !== 'receivable')) return { show: false };
  if (alreadyLinked) return { show: false, reason: 'already_linked' };
  const amountKnown = v2.amount !== null && v2.amount !== undefined;
  const blocking = (v2.missing_fields || []).filter((f) => f !== 'counterparty');
  const enabled = amountKnown && blocking.length === 0;
  return {
    show: true,
    type,
    enabled,
    reason: enabled ? null
      : !amountKnown ? 'Enter the amount before creating a draft.'
        : `Enter ${blocking.join(', ')} before creating a draft.`,
  };
}

// Writing issuer_counterparty_id says "this document was issued by them". On an invoice
// that is true. On a bank payment proof both sides are named and the issuer is the BANK,
// so a link there would record something false — offer it, but say why it is held back.
const ISSUER_IS_COUNTERPARTY = ['invoice', 'faktur_pajak', 'receipt', 'contract'];
// Documents that genuinely name both sides, so picking one as "the issuer" would be a guess.
const NAMES_BOTH_PARTIES = ['payment_proof', 'bank_statement'];

// Why a counterparty cannot be attached automatically. Three DIFFERENT situations that
// were previously collapsed into one sentence — which is how an unreadable scan came to
// claim it "names more than one party", when in fact nothing was read at all. Each
// sentence is now only said where it is true.
const CP_LIMITATION = {
  unreadable: 'CFO AI could not read who the parties are. Enter the counterparty yourself, '
    + 'or send it to accountant review.',
  multiple_parties: 'This document names more than one party, so CFO AI will not attach a '
    + 'counterparty to it automatically. Link it from the record it belongs to instead.',
  not_an_issuer_document: 'CFO AI does not attach a counterparty to this kind of document '
    + 'automatically. Link it from the record it belongs to instead.',
};

export function counterpartyOffer(v2) {
  if (!v2) return { show: false };
  const linkable = ISSUER_IS_COUNTERPARTY.includes(v2.document_type);
  // Nothing was read: a scan with no text layer, or text that identified nothing.
  const unreadable = isUnsupported(v2) || v2.document_type === 'unknown' || !v2.document_type;
  const reason = linkable ? null
    : unreadable ? 'unreadable'
      : NAMES_BOTH_PARTIES.includes(v2.document_type) ? 'multiple_parties'
        : 'not_an_issuer_document';
  return {
    show: true,
    status: v2.counterparty_status || 'needs_review',
    matchedId: v2.matched_counterparty_id || null,
    canLink: linkable,
    reason,
    limitation: reason ? CP_LIMITATION[reason] : null,
  };
}

/* ── analyze button ────────────────────────────────────────────────────────── */

// `stored:false` means the summary was already up to date — an unchanged re-run. It must
// never read as though something was created.
export const analyzeMessage = (r) =>
  (r && r.stored ? 'Analysis updated.' : 'Analysis is already up to date.');
