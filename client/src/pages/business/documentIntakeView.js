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

/* ── the single workflow decision ──────────────────────────────────────────
   Every action the panel offers comes from HERE, so the page can no longer say two
   things at once. It used to: "Actions & Routing" keyed off the stored document_type
   column alone, so a document whose OCR reading said *direction unknown, no record
   suggested* still had "Create payable draft" as its primary button — because a human
   had once filed it as a supplier invoice.

   The ordering below is the whole point. A stored type only drives the workflow once
   nothing more urgent is outstanding: an unreviewed machine reading, a disagreement
   between the two, a missing direction, a missing counterparty, a missing amount. */

const HAS = (v) => v !== null && v !== undefined && v !== '';

export function documentWorkflowState(doc) {
  const v2 = intakeOf(doc);
  const stored = doc?.document_type || null;
  // The column is only written by a person, so a real value in it IS a human decision.
  const manuallyConfirmed = !!stored && stored !== 'other';
  const links = Array.isArray(doc?.links) ? doc.links : [];
  const alreadyLinked = links.some((l) => l.target_type === 'debt');
  const linkedToTx = links.some((l) => l.target_type === 'transaction');
  const fromOcr = wasReadByOcr(v2);
  const aiType = v2?.document_type || null;
  const direction = v2?.direction || null;
  const hasCounterparty = !!doc?.issuer_counterparty_id || v2?.counterparty_status === 'matched';
  const amount = HAS(v2?.amount) ? v2.amount : (HAS(doc?.gross_amount) ? Number(doc.gross_amount) : null);
  const missing = v2?.missing_fields || [];

  const out = {
    canShowCreatePayable: false,
    canShowCreateReceivable: false,
    canShowLinkTransaction: false,
    canShowSaveSupporting: false,
    mustReviewFirst: false,
    canCreateCounterparty: false,
    recommendedPrimaryAction: 'review_fields',
    warningReason: null,
  };

  if (alreadyLinked) {
    return { ...out, recommendedPrimaryAction: 'open_record',
      warningReason: 'This document is already attached to a record.' };
  }

  // No reading at all: fall back to the stored column, exactly as before intake existed.
  if (!v2) {
    if (stored === 'vendor_invoice') return { ...out, canShowCreatePayable: true, canShowLinkTransaction: true, recommendedPrimaryAction: 'create_payable' };
    if (stored === 'customer_invoice') return { ...out, canShowCreateReceivable: true, canShowLinkTransaction: true, recommendedPrimaryAction: 'create_receivable' };
    if (stored === 'payment_proof' || stored === 'bank_document') return { ...out, canShowLinkTransaction: true, recommendedPrimaryAction: 'link_transaction' };
    return { ...out, recommendedPrimaryAction: manuallyConfirmed ? 'review_fields' : 'analyze' };
  }

  // 1 — a machine reading is not a decision. Until a person confirms the type, an
  //     OCR-read document may not put a record-creating button in front of them.
  if (fromOcr && !manuallyConfirmed) {
    return { ...out, mustReviewFirst: true, canCreateCounterparty: true,
      canShowSaveSupporting: true, recommendedPrimaryAction: 'review_confirm',
      warningReason: 'This document was read by OCR/Vision. Confirm the type, direction and '
        + 'figures before any record is created from it.' };
  }

  // 2 — the stored column and the reading disagree. Both are shown; neither acts.
  if (v2.intent_conflict || (manuallyConfirmed && aiType && aiType !== 'unknown'
      && !storedMatchesAi(stored, aiType))) {
    return { ...out, mustReviewFirst: true, canCreateCounterparty: true,
      canShowSaveSupporting: true, recommendedPrimaryAction: 'review_confirm',
      warningReason: 'Stored type and AI reading disagree. Review & confirm before creating records.' };
  }

  // 3 — a receipt is settled money. It never becomes a bill.
  if (aiType === 'receipt') {
    return { ...out, canShowSaveSupporting: true, canShowLinkTransaction: !linkedToTx,
      canCreateCounterparty: true, recommendedPrimaryAction: 'save_supporting',
      warningReason: 'A receipt is evidence that money moved. It is not a bill.' };
  }

  // 4 — a payment proof explains a transaction; it does not create a bill.
  if (aiType === 'payment_proof') {
    return { ...out, canShowLinkTransaction: !linkedToTx, canCreateCounterparty: true,
      canShowSaveSupporting: true, recommendedPrimaryAction: 'link_transaction' };
  }

  // 5 — no direction means we do not know who owes whom. Nothing may be drafted.
  if (!direction || direction === 'unknown') {
    return { ...out, mustReviewFirst: true, canCreateCounterparty: true,
      canShowSaveSupporting: true, recommendedPrimaryAction: 'review_fields',
      warningReason: 'The direction of this document could not be determined. '
        + 'Review it or send it to accountant review.' };
  }

  if (direction === 'supporting_document' || v2.suggested_record_type === 'supporting_document') {
    return { ...out, canShowSaveSupporting: true, canCreateCounterparty: true,
      canShowLinkTransaction: !linkedToTx, recommendedPrimaryAction: 'save_supporting' };
  }

  // 6 — a bill, pointed the right way. What is still missing decides the button.
  const wantsPayable = direction === 'payable' || v2.suggested_record_type === 'payable';
  const wantsReceivable = direction === 'receivable' || v2.suggested_record_type === 'receivable';
  if (wantsPayable || wantsReceivable) {
    const blocking = missing.filter((f) => f !== 'counterparty');
    if (!HAS(amount) || blocking.length) {
      return { ...out, mustReviewFirst: true, canCreateCounterparty: true,
        recommendedPrimaryAction: 'review_fields',
        warningReason: !HAS(amount)
          ? 'No amount could be read, so no record can be drafted yet.'
          : `Enter ${blocking.join(', ')} before creating a record.` };
    }
    if (!hasCounterparty) {
      return { ...out, canCreateCounterparty: true, canShowSaveSupporting: true,
        recommendedPrimaryAction: 'create_counterparty',
        warningReason: 'The counterparty is not in your directory yet. Create or link it first.' };
    }
    return { ...out,
      canShowCreatePayable: wantsPayable, canShowCreateReceivable: wantsReceivable,
      canShowLinkTransaction: !linkedToTx, canCreateCounterparty: true,
      recommendedPrimaryAction: wantsPayable ? 'create_payable' : 'create_receivable' };
  }

  return { ...out, canShowSaveSupporting: true, canCreateCounterparty: true,
    recommendedPrimaryAction: 'review_fields' };
}

// Which stored column values a given AI reading is consistent with. A stored
// "tax_invoice" and an AI "faktur_pajak" are the same thing under two names.
const STORED_FOR_AI = {
  invoice: ['vendor_invoice', 'customer_invoice'],
  faktur_pajak: ['tax_invoice'],
  payment_proof: ['payment_proof', 'bank_document'],
  receipt: ['payment_proof', 'other'],
  bank_statement: ['bank_document'],
  tax_document: ['tax_billing', 'bukti_potong', 'filing_confirmation', 'tax_invoice'],
};
export function storedMatchesAi(stored, aiType) {
  if (!stored || stored === 'other') return true;   // nothing to disagree with
  const ok = STORED_FOR_AI[aiType];
  return ok ? ok.includes(stored) : true;           // unmapped kinds never raise a conflict
}

/** The label for whatever the workflow decided should happen first. */
export const PRIMARY_ACTION_LABEL = {
  review_confirm: 'Review & confirm',
  review_fields: 'Review fields',
  create_payable: 'Create payable draft',
  create_receivable: 'Create receivable draft',
  create_counterparty: 'Create or link counterparty',
  link_transaction: 'Link to transaction',
  save_supporting: 'Save as supporting document',
  open_record: 'Open record',
  analyze: 'Analyze document',
};
export const primaryActionLabel = (k) => PRIMARY_ACTION_LABEL[k] || 'Review fields';

/* ── v3: the native-vision reading, presented for confirmation ─────────────
   The rule this encodes: a model match is NOT a human decision. Every row below
   separates what a person stored on the document from what the reader suggested, and
   says plainly which is which. Where both exist and differ, that is a conflict for the
   user to settle — the UI never picks a winner. */

export const intakeV3Of = (d) => d?.extracted_json?.ai_intake_v3 || null;

/** v3 supersedes v2 as the visible suggestion. v2 stays stored for compatibility. */
export const primaryIntakeSource = (d) => (intakeV3Of(d) ? 'v3' : (intakeOf(d) ? 'v2' : null));

export const FIELD_STATUS = {
  CONFIRMED: 'confirmed',           // a person stored this value
  SUGGESTED: 'suggested',           // the reader proposed it; nobody has confirmed
  CONFLICT: 'conflict',             // both exist and disagree
  NEEDS_CONFIRMATION: 'needs_confirmation',
  NOT_FOUND: 'not_found',
};
export const FIELD_STATUS_LABEL = {
  confirmed: 'Confirmed', suggested: 'AI suggestion', conflict: 'Conflict',
  needs_confirmation: 'Needs confirmation', not_found: 'Not found',
};

const sameValue = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
};

/** One row of the confirmation table. */
function fieldRow(label, confirmed, suggested, opts = {}) {
  const hasC = confirmed !== null && confirmed !== undefined && confirmed !== '';
  const hasS = suggested !== null && suggested !== undefined && suggested !== '';
  let status;
  if (hasC && hasS) status = sameValue(confirmed, suggested) ? FIELD_STATUS.CONFIRMED : FIELD_STATUS.CONFLICT;
  else if (hasC) status = FIELD_STATUS.CONFIRMED;
  else if (hasS) status = opts.needsConfirmation ? FIELD_STATUS.NEEDS_CONFIRMATION : FIELD_STATUS.SUGGESTED;
  else status = FIELD_STATUS.NOT_FOUND;
  return { key: opts.key || label, label, confirmed: hasC ? confirmed : null,
    suggested: hasS ? suggested : null, status, hint: opts.hint || null };
}

const moneyOrNull = (n, ccy) => (n === null || n === undefined ? null : money(n, ccy));

/**
 * The confirmation table for a document.
 * `confirmed` values come from the document row — the columns a person owns.
 * `suggested` values come from ai_intake_v3 — never written anywhere by themselves.
 */
export function v3FieldRows(doc, cpName = null) {
  const v3 = intakeV3Of(doc);
  const f = v3?.fields || {};
  const ccy = f.currency || doc?.currency || 'IDR';
  const storedType = doc?.document_type && doc.document_type !== 'other' ? doc.document_type : null;
  // A counterparty is only "confirmed" once it is actually attached to the document.
  const confirmedCp = doc?.issuer_counterparty_id ? (cpName?.(doc.issuer_counterparty_id) || 'Linked counterparty') : null;
  const needsCp = v3?.counterparty_status === 'needs_confirmation' || v3?.counterparty_status === 'self_match';

  return [
    fieldRow('Document type', storedType ? TYPE_LABEL[storedType] || storedType : null,
      f.document_type ? typeLabelOf(f.document_type) : null, { key: 'document_type' }),
    fieldRow('Document number', doc?.document_number || null, f.document_number, { key: 'document_number' }),
    fieldRow('Document date', doc?.document_date || null, f.document_date, { key: 'document_date' }),
    fieldRow('Due date', null, f.due_date, { key: 'due_date' }),
    fieldRow('Payment date', null, f.payment_date, { key: 'payment_date' }),
    fieldRow('Counterparty', confirmedCp, f.counterparty?.legal_name || null,
      { key: 'counterparty', needsConfirmation: needsCp,
        hint: v3?.counterparty_status === 'self_match'
          ? 'CFO AI may have identified your own company. Review the parties before continuing.' : null }),
    fieldRow('Counterparty NPWP', null, f.counterparty?.npwp || null, { key: 'counterparty_npwp' }),
    fieldRow('DPP', moneyOrNull(doc?.commercial_base_amount, ccy), moneyOrNull(f.dpp, ccy), { key: 'dpp' }),
    fieldRow('PPN', moneyOrNull(doc?.commercial_tax_amount, ccy), moneyOrNull(f.ppn, ccy), { key: 'ppn' }),
    fieldRow('Total', moneyOrNull(doc?.gross_amount, ccy), moneyOrNull(f.total, ccy), { key: 'total' }),
    fieldRow('Currency', doc?.currency || null, f.currency, { key: 'currency' }),
  ];
}

/** The one-line summary above the table. */
export function v3Headline(doc) {
  const v3 = intakeV3Of(doc);
  if (!v3) return null;
  const t = typeLabelOf(v3.fields?.document_type);
  return `${t || 'Document'} · read by ${v3.source === 'native_image_vision' ? 'image analysis' : 'document analysis'}`;
}

/** Operational facts. Deliberately NOT shown in the normal panel — cost and model are
 *  an operator's concern, not something a user reviewing an invoice needs. */
export function v3Diagnostics(doc) {
  const v3 = intakeV3Of(doc);
  if (!v3) return null;
  return {
    model: v3.model, schema_version: v3.schema_version, source: v3.source,
    processed_at: v3.processed_at, duration_ms: v3.duration_ms,
    pages_analyzed: v3.pages_analyzed, page_count: v3.page_count,
    validation_status: v3.validation_status,
  };
}

export const v3Warnings = (doc) => intakeV3Of(doc)?.warnings || [];
export const v3Blockers = (doc) => intakeV3Of(doc)?.blockers || [];

/* ── analyze button ────────────────────────────────────────────────────────── */

// `stored:false` means the summary was already up to date — an unchanged re-run. It must
// never read as though something was created.
export const analyzeMessage = (r) =>
  (r && r.stored ? 'Analysis updated.' : 'Analysis is already up to date.');
