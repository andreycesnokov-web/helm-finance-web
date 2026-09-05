// Document Intake Orchestrator V1 — one pipeline every uploaded document goes through.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
// The business logic that turns "a file was uploaded" into "here is what this
// document means, who it involves, what record it implies, what is missing, and
// what you should do next". Pure: no DB, no network, no writes.
//
// ── THE RULE IT ENFORCES ─────────────────────────────────────────────────────
//     AI suggests. User confirms. System creates/links. Accountant reviews.
//
// So: no result of this module ever creates a counterparty, a payable, a
// receivable, a transaction or a tax obligation. `can_create_draft` says the
// conditions for offering a button are met — never that anything happened.
//
// ── AND THE RULE ABOUT NOT KNOWING ───────────────────────────────────────────
// A document must never end up dead, and must never be guessed at. Every result
// carries a status from a closed set, and the ones that mean "I could not finish"
// carry blockers saying exactly what is missing. Silence is not an option and
// neither is invention.
//
// Nothing here is specific to one vendor, one bank or one file name.
'use strict';

const docExtract = require('./documentExtraction');
const CPI = require('./counterpartyIntelligence');
const { parseAmount } = require('./invoiceSettlement');
const INTENT = require('./uploadIntent');

/** Terminal states. Every document lands on exactly one. */
const STATUSES = [
  'ready_to_confirm',        // enough is known to offer a concrete action
  'needs_missing_fields',    // recognised, but a required value could not be read
  'needs_counterparty',      // recognised and priced, but we do not know who with
  'needs_accountant_review', // a judgement call a machine must not make
  'linked',                  // already connected to a financial record
  'unsupported',             // nothing readable (a scan, an image, no text layer)
];

/** What a document kind implies commercially, before direction is known. */
const MEANING = {
  invoice: 'A bill. Someone owes money because of it.',
  faktur_pajak: 'An Indonesian tax invoice. Carries PPN and supports a VAT claim.',
  payment_proof: 'Evidence that money actually moved.',
  receipt: 'Evidence that money was already handed over.',
  contract: 'The agreement behind other documents. Supporting evidence, not a transaction.',
  bank_statement: 'A period of account activity. Supporting evidence for reconciliation.',
  tax_document: 'A tax filing, payment slip or withholding certificate. Evidence for the tax package.',
  payroll_document: 'Payroll evidence. Supporting, not a payable on its own.',
  bank_fee: 'A bank charge. An operating cost.',
  asset_purchase: 'A purchase that may be a capital asset rather than an expense.',
  funding_document: 'Financing, not trading. Never operating revenue or expense.',
  unknown: 'Not recognised from the text available.',
};

// Plain words for the conflict sentence: "reads this as a Faktur Pajak", not "faktur_pajak".
const TYPE_WORD = {
  invoice: 'an Invoice', faktur_pajak: 'a Faktur Pajak', payment_proof: 'a Payment proof',
  receipt: 'a Receipt / Kwitansi', contract: 'a Contract', bank_statement: 'a Bank statement',
  tax_document: 'a Tax document', payroll_document: 'a Payroll document', bank_fee: 'a Bank fee',
  asset_purchase: 'an Asset purchase', funding_document: 'a Funding document', unknown: 'unrecognised',
};

const RECORD_BY_TYPE = {
  invoice: 'payable_or_receivable',
  faktur_pajak: 'payable_or_receivable',
  receipt: 'supporting_document',
  payment_proof: 'transaction',
  bank_fee: 'transaction',
  asset_purchase: 'payable_or_receivable',
  contract: 'supporting_document',
  bank_statement: 'supporting_document',
  tax_document: 'tax_review',
  payroll_document: 'supporting_document',
  funding_document: 'supporting_document',
  unknown: 'none',
};

/* ── direction ─────────────────────────────────────────────────────────────
   Who issued the document decides whether we owe or are owed. For a payment
   proof, whose account the money left decides it. Never the file name. */
function resolveDirection(type, fields, businessName) {
  if (type === 'payment_proof') {
    const fromUs = CPI.nameSimilarity(fields.from_account_name, businessName) >= 0.85;
    const toUs = CPI.nameSimilarity(fields.to_account_name, businessName) >= 0.85;
    if (fromUs && !toUs) return { direction: 'outgoing_payment', confidence: 'high',
      reason: 'Money left this business\'s account, so it is a payment we made.' };
    if (toUs && !fromUs) return { direction: 'incoming_payment', confidence: 'high',
      reason: 'Money arrived in this business\'s account, so it is a payment we received.' };
    return { direction: 'unknown', confidence: 'needs_review',
      reason: 'Neither account holder matches this business. Confirm which side is ours.' };
  }

  // A receipt records money that has ALREADY moved, so it points the way a payment
  // points — never the way a bill does. Running it through the invoice role check said
  // "they issued it to us, so we owe them", which is exactly backwards: the debt it
  // refers to is settled, and that is what the paper proves.
  //
  // On a kwitansi the roles are fixed by the form itself: the company printed at the top
  // RECEIVED the money (issuer_name), and the party after "Sudah terima dari" PAID it
  // (buyer_name). See extractReceiptFields in documentExtraction.js.
  if (type === 'receipt') {
    const weReceived = CPI.nameSimilarity(fields.issuer_name, businessName) >= 0.85;
    const wePaid = CPI.nameSimilarity(fields.buyer_name, businessName) >= 0.85;
    if (wePaid && !weReceived) return { direction: 'outgoing_payment', confidence: 'high',
      reason: 'This business paid the counterparty; the receipt is evidence of that payment.' };
    if (weReceived && !wePaid) return { direction: 'incoming_payment', confidence: 'high',
      reason: 'This business received the money; the receipt is evidence of an incoming payment.' };
    return { direction: 'supporting_document', confidence: 'needs_review',
      reason: 'Receipt detected, but which side is this business needs review.' };
  }

  if (docExtract.SUPPORTING_TYPES.includes(type)) {
    return { direction: 'supporting_document', confidence: 'high',
      reason: 'This kind of document is evidence, not a transaction.' };
  }

  if (['invoice', 'faktur_pajak', 'asset_purchase', 'bank_fee'].includes(type)) {
    const role = CPI.detectRole({
      issuer_name: fields.issuer_name, buyer_name: fields.buyer_name, business_name: businessName,
    });
    if (role.direction === 'payable' || role.direction === 'receivable') {
      return { direction: role.direction, confidence: role.confidence, reason: role.reason };
    }
    return { direction: 'unknown', confidence: 'needs_review', reason: role.reason };
  }

  return { direction: 'unknown', confidence: 'needs_review', reason: 'Document kind not recognised.' };
}

/* ── tax signals ───────────────────────────────────────────────────────────
   PPN present on the document is an OBSERVATION and can be reported plainly.
   Withholding is a JUDGEMENT and needs a rule. `taxRules` are rules the caller
   has already filtered to the verified-and-active set; anything else is quoted
   with its status and never treated as settled. */
function assessTax(type, fields, opts = {}) {
  const ppn = parseAmount(fields.commercial_tax_amount);
  const hasNumber = ppn !== null && ppn > 0;

  // WHERE THE NUMBER CAME FROM decides what we may say about it.
  //
  // The text parser sets commercial_tax_amount only after matching a real label
  // ("Jumlah PPN", "Dasar Pengenaan Pajak"), so for embedded text the number IS
  // evidence of itself. A vision reader has no such discipline: it can return a
  // plausible figure it worked out from the gross rather than one printed on the page.
  // Production proved it — the same kwitansi came back with no PPN on one run and
  // 1,122,000 on the next, a value equal to 11/111 of the total.
  //
  // So a vision number is only treated as a reading when the transcript actually
  // mentions tax. Otherwise it is a possibility for an accountant, not a figure.
  const fromVision = opts.readSource === 'ocr_vision';
  const evidence = !fromVision || !!opts.taxEvidence;
  const detected = hasNumber && evidence;

  const out = {
    ppn_detected: detected,
    ppn_amount: detected ? ppn : null,
    tax_status: detected ? (fromVision ? 'tax_needs_review' : 'tax_detected') : 'tax_not_detected',
    withholding_status: 'not_detected',
    withholding_suggestion: null,
    rule_citation: null,
    rule_status: null,
    // Nothing in V1 removes the accountant from the loop.
    accountant_review_required: true,
    notes: [],
  };

  if (detected && fromVision) {
    out.notes.push(`A PPN amount of ${ppn} was read by OCR/Vision. Verify it against the document before using it.`);
  } else if (detected) {
    out.notes.push(`PPN of ${ppn} is stated on the document.`);
  } else if (hasNumber) {
    // A number with nothing on the page to back it: never presented as read.
    out.tax_status = 'tax_not_confirmed';
    out.notes.push('Possible tax component needs accountant review. No PPN line could be '
      + 'confirmed on the document, so no tax amount is being claimed.');
  } else if (type === 'receipt') {
    // A kwitansi is a payment record; PPN is not implied by one and is never derived
    // from the total.
    out.tax_status = 'tax_not_confirmed';
    out.notes.push('No PPN is stated on this receipt. Tax treatment needs accountant review.');
  }
  if (type === 'faktur_pajak' && !detected) {
    out.notes.push('This looks like a Faktur Pajak but no PPN amount could be read. Confirm it manually.');
    out.tax_status = 'tax_needs_review';
  }

  const rules = Array.isArray(opts.taxRules) ? opts.taxRules : [];
  const verified = rules.filter((r) => r && r.effective_active === true);
  const underReview = rules.filter((r) => r && r.effective_active !== true);

  if (verified.length) {
    const r = verified[0];
    out.withholding_status = 'suggested';
    out.withholding_suggestion = { rule_code: r.rule_code || null, rate: r.rate ?? null };
    out.rule_citation = r.citation || r.rule_code || null;
    out.rule_status = 'active_verified';
    out.tax_status = 'tax_suggested';
    out.notes.push('A verified official rule was applied. Your accountant still confirms it.');
  } else if (underReview.length) {
    const r = underReview[0];
    out.withholding_status = 'needs_review';
    out.rule_citation = r.citation || r.rule_code || null;
    out.rule_status = r.status || 'under_review';
    out.tax_status = 'tax_needs_review';
    out.notes.push(`The closest rule is ${out.rule_status} and has not been activated or legally verified, so it cannot decide this. Accountant review required.`);
  } else if (detected || type === 'faktur_pajak') {
    out.withholding_status = 'needs_review';
    out.tax_status = detected ? out.tax_status : 'tax_needs_review';
    out.notes.push('No verified rule covers this document, so no withholding is suggested.');
  }
  return out;
}

/* Does the document itself mention tax? Only this licenses a vision-read PPN figure
   to be reported as a reading rather than a possibility. Deliberately generous about
   WHERE it looks — a label in the text, a DPP figure, or a faktur serial all count —
   and deliberately strict about what follows when none of them is present. */
const TAX_MARKERS = /\bppn\b|pajak\s+pertambahan\s+nilai|\bdpp\b|dasar\s+pengenaan\s+pajak|faktur\s+pajak|\bvat\b|\bpph\b/i;
function taxEvidenceIn(extraction = {}) {
  const f = extraction.fields || {};
  if (f.commercial_base_amount !== null && f.commercial_base_amount !== undefined) return true;
  if (f.tax_invoice_serial) return true;
  return TAX_MARKERS.test(String(extraction.raw_text_excerpt || ''));
}

/* Why a scan could not be read. The two cases need different sentences: if vision is
   simply switched off, saying "needs OCR/Vision" tells the operator what to turn on; if
   vision RAN and still failed, repeating that would be misleading. */
function ocrBlockerFor(input = {}) {
  // v3 is the primary reader now, so its failure is the one to report. Saying
  // "OCR/Vision is not enabled" about a document whose analysis was attempted and timed
  // out sends the operator to a setting that is already on, and tells the user nothing
  // about the retry that would actually help.
  const v3 = input.v3 || null;
  if (v3 && v3.ok === false && v3.reason !== 'vision_disabled' && v3.reason !== 'vision_not_configured') {
    return v3.user_message || 'CFO AI tried to read this document automatically and could not. '
      + 'Enter the values manually or request accountant review.';
  }

  const ocr = input.ocr || null;
  if (!ocr || ocr.reason === 'ocr_disabled' || ocr.reason === 'ocr_not_configured') {
    return 'This looks like a scanned document. OCR/Vision is not enabled yet. '
      + 'Enter fields manually or request accountant review.';
  }
  if (ocr.reason === 'file_too_large_for_ocr') {
    return 'This document is too large to read automatically. Enter the values manually.';
  }
  return 'CFO AI tried to read this document automatically and could not. '
    + 'Enter the values manually or request accountant review.';
}

/* ── the pipeline ──────────────────────────────────────────────────────────*/

/**
 * @param input {
 *   document:        the financial_documents row (id, document_type, archived_at, ...)
 *   extraction:      result of documentExtraction.extractFromText
 *   businessName:    the active business's name
 *   counterparties:  this business's directory (for matching)
 *   existingLinks:   { debt_ids: [], transaction_ids: [] } already linked to this document
 *   taxRules:        candidate rules, each with effective_active true|false
 * }
 */
function processDocument(input = {}) {
  const doc = input.document || {};
  const ex = input.extraction || {};
  const fields = ex.fields || {};
  const businessName = input.businessName || null;
  const links = input.existingLinks || {};
  const alreadyLinked = (links.debt_ids || []).length > 0 || (links.transaction_ids || []).length > 0;

  // How the fields in front of us were obtained. 'manual' outranks everything: once a
  // human has classified the document, no reader gets to contradict them.
  const readSource = doc.document_type && doc.document_type !== 'other' ? 'manual'
    : (input.readSource || (ex.reason || ex.text_available === false ? 'filename_only' : 'embedded_text'));
  const intent = input.uploadIntent || null;

  const warnings = [...(ex.warnings || [])];
  const blockers = [];
  const next = [];

  // ── unreadable ───────────────────────────────────────────────────────────
  // "unsupported" means there was NO TEXT TO READ — a scan, a photo, a non-PDF.
  // A document whose text was read but whose kind was not recognised is a different
  // thing entirely: that is a judgement call, and it goes to accountant review
  // further down. extractFromText sets `reason` only on the no-text path.
  const noTextAtAll = !!ex.reason || ex.text_available === false;
  if (noTextAtAll) {
    // Nothing was read, so nothing can contradict the upload intent — but the intent
    // itself is still worth carrying, because it is the only thing known about this
    // document and it is what the manual form should be pre-set to.
    return {
      document_id: doc.id || null,
      status: 'unsupported',
      source: readSource,
      upload_intent: intent,
      intent_conflict: false,
      document: { type: ex.document_type || 'unknown', confidence: 'needs_review',
        direction: 'unknown', business_meaning: MEANING.unknown },
      counterparty: { status: 'needs_review', suggested_role: null, matched_counterparty_id: null, suggested_counterparty: null },
      financial_record: { suggested_record_type: 'none', amount: null, currency: fields.currency || 'IDR',
        date: null, can_create_draft: false },
      tax: assessTax('unknown', {}, { ...input, readSource, taxEvidence: false }),
      next_actions: [
        { key: 'enter_manually', label: 'Enter the values manually', enabled: true },
        { key: 'request_accountant_review', label: 'Send to accountant review', enabled: true },
      ],
      blockers: [ocrBlockerFor(input)],
      warnings,
      requires_confirmation: true,
    };
  }

  const type = ex.document_type || 'unknown';
  const dir = resolveDirection(type, fields, businessName);
  const meaning = MEANING[type] || MEANING.unknown;

  // ── counterparty ─────────────────────────────────────────────────────────
  // The counterparty is whichever party is not us, decided from the direction.
  let cpResult = { status: 'needs_review', matched_counterparty_id: null, match_reasons: [], possible_matches: [], warnings: [] };
  let suggestedCp = null;
  let suggestedRole = null;

  if (!docExtract.SUPPORTING_TYPES.includes(type) && type !== 'unknown') {
    // Which parser finds the other party depends on the DOCUMENT, not on the direction.
    // A bank proof names two accounts; a kwitansi names an issuer and a payer. Keying
    // this off direction alone would send a receipt — now correctly an outgoing_payment —
    // to the account-name parser, which a kwitansi has no fields for.
    const isBankProof = type === 'payment_proof';
    const suggestion = isBankProof
      ? CPI.suggestFromPayment(fields, { direction: dir.direction === 'incoming_payment' ? 'incoming' : 'outgoing' })
      : CPI.suggestFromDocument({ fields }, { business_name: businessName });
    suggestedCp = suggestion.suggested_counterparty;
    suggestedRole = suggestedCp ? suggestedCp.role : null;
    warnings.push(...(suggestion.warnings || []));
    cpResult = CPI.matchCounterparty(suggestedCp || {}, input.counterparties || []);
    warnings.push(...(cpResult.warnings || []));
  }

  // ── the money ────────────────────────────────────────────────────────────
  const amount = parseAmount(
    type === 'payment_proof' ? fields.amount : (fields.gross_amount ?? fields.amount));
  const date = fields.transfer_date_text || fields.document_date || null;
  const currency = fields.currency || 'IDR';

  const recordKind = RECORD_BY_TYPE[type] || 'none';
  let suggestedRecordType = 'none';
  if (recordKind === 'payable_or_receivable') {
    suggestedRecordType = dir.direction === 'payable' ? 'payable'
      : dir.direction === 'receivable' ? 'receivable' : 'none';
  } else if (recordKind === 'transaction') suggestedRecordType = 'transaction';
  else if (recordKind === 'supporting_document') suggestedRecordType = 'supporting_document';
  else if (recordKind === 'tax_review') suggestedRecordType = 'tax_review';

  // The reader and the evidence travel with the request, so assessTax can tell a parsed
  // PPN line from a figure a vision model produced.
  const tax = assessTax(type, fields, { ...input, readSource, taxEvidence: taxEvidenceIn(ex) });

  // ── what is missing ──────────────────────────────────────────────────────
  const missing = [...(ex.missing_fields || [])];
  const needsMoney = ['payable', 'receivable', 'transaction'].includes(suggestedRecordType);
  if (needsMoney && amount === null) { missing.push('amount'); blockers.push('No amount could be read, so no record can be drafted.'); }
  if (needsMoney && !date) warnings.push('No date could be read; the draft will need one.');
  if (dir.direction === 'unknown' && !docExtract.SUPPORTING_TYPES.includes(type) && type !== 'unknown') {
    blockers.push(dir.reason);
  }

  // ── status ───────────────────────────────────────────────────────────────
  // Ordered by what a person would have to do first.
  let status;
  if (alreadyLinked) status = 'linked';
  else if (type === 'unknown') status = 'needs_accountant_review';
  else if (needsMoney && amount === null) status = 'needs_missing_fields';
  else if (dir.direction === 'unknown') status = 'needs_accountant_review';
  else if (needsMoney && cpResult.status === 'not_found') status = 'needs_counterparty';
  else if (needsMoney && cpResult.status === 'possible_match') status = 'needs_counterparty';
  else if (docExtract.SUPPORTING_TYPES.includes(type)) status = 'ready_to_confirm';
  else status = 'ready_to_confirm';

  const canCreateDraft = status === 'ready_to_confirm'
    && ['payable', 'receivable', 'transaction'].includes(suggestedRecordType)
    && amount !== null;

  // ── next actions ─────────────────────────────────────────────────────────
  // Enabled only where the preconditions genuinely hold; a disabled action still
  // appears so the user can see what is possible and why it is not yet.
  if (cpResult.status === 'not_found' && suggestedCp && suggestedCp.legal_name) {
    next.push({ key: 'create_counterparty', label: `Create counterparty "${suggestedCp.legal_name}"`, enabled: true });
  }
  if (cpResult.status === 'possible_match') {
    next.push({ key: 'review_counterparty_match', label: 'Review possible counterparty match', enabled: true });
  }
  if (cpResult.status === 'matched') {
    next.push({ key: 'view_counterparty', label: 'View linked counterparty', enabled: true,
      counterparty_id: cpResult.matched_counterparty_id });
  }
  if (suggestedRecordType === 'payable') {
    next.push({ key: 'create_payable_draft', label: 'Create payable draft', enabled: canCreateDraft,
      note: canCreateDraft ? null : (blockers[0] || 'Confirm the counterparty first.') });
  }
  if (suggestedRecordType === 'receivable') {
    next.push({ key: 'create_receivable_draft', label: 'Create receivable draft', enabled: canCreateDraft,
      note: canCreateDraft ? null : (blockers[0] || 'Confirm the counterparty first.') });
  }
  if (suggestedRecordType === 'transaction') {
    next.push({ key: 'link_to_existing_record', label: 'Link to an existing payable or receivable', enabled: amount !== null });
    next.push({ key: 'create_transaction_draft', label: 'Record as a transaction', enabled: canCreateDraft });
  }
  if (missing.length) {
    next.push({ key: 'review_fields', label: `Review ${missing.length} missing field${missing.length === 1 ? '' : 's'}`, enabled: true });
  }
  next.push({ key: 'save_document_only', label: 'Save as supporting document', enabled: true });
  next.push({ key: 'request_accountant_review', label: 'Send to accountant review', enabled: true });

  // The user said what they were uploading; the document says what it is. When those
  // disagree, BOTH are reported and neither is acted on — the upload button a person
  // pressed is not evidence about the paper in front of them.
  const conflict = INTENT.detectIntentConflict(intent, type, { unsupported: false });
  if (conflict) {
    blockers.push(INTENT.intentConflictMessage(intent, type, (t) => TYPE_WORD[t] || t));
    if (!next.some((a) => a.key === 'review_fields')) {
      next.unshift({ key: 'review_fields', label: 'Confirm what this document is', enabled: true });
    }
  }

  return {
    document_id: doc.id || null,
    status,
    source: readSource,
    upload_intent: intent,
    intent_conflict: conflict,
    document: {
      type,
      confidence: ex.confidence || 'needs_review',
      direction: dir.direction,
      direction_reason: dir.reason,
      business_meaning: meaning,
    },
    counterparty: {
      status: cpResult.status,
      suggested_role: suggestedRole,
      matched_counterparty_id: cpResult.matched_counterparty_id,
      match_reasons: cpResult.match_reasons || [],
      possible_matches: cpResult.possible_matches || [],
      suggested_counterparty: cpResult.status === 'matched' ? null : suggestedCp,
    },
    financial_record: {
      suggested_record_type: suggestedRecordType,
      amount, currency, date,
      // The gate for OFFERING a button. Never a statement that anything was created.
      can_create_draft: canCreateDraft,
      source_document_id: doc.id || null,
    },
    tax,
    missing_fields: [...new Set(missing)],
    next_actions: next,
    blockers,
    warnings: [...new Set(warnings)],
    requires_confirmation: true,
    version: 'intake-v1',
  };
}

/* ── persistable summary ───────────────────────────────────────────────────
   Only metadata and review state. Deliberately excludes anything that would
   amount to a financial record, and is stable across repeated runs so writing it
   twice is a no-op. */
function toStoredIntake(result, opts = {}) {
  return {
    version: 'intake-v1',
    status: result.status,
    // How the fields were obtained, and whether the reading contradicts the upload.
    // Both are review state, so they belong with the rest of the summary.
    source: result.source || null,
    intent_conflict: !!result.intent_conflict,
    document_type: result.document.type,
    confidence: result.document.confidence,
    direction: result.document.direction,
    business_meaning: result.document.business_meaning,
    counterparty_status: result.counterparty.status,
    matched_counterparty_id: result.counterparty.matched_counterparty_id,
    suggested_record_type: result.financial_record.suggested_record_type,
    amount: result.financial_record.amount,
    currency: result.financial_record.currency,
    ppn_detected: result.tax.ppn_detected,
    ppn_amount: result.tax.ppn_amount,
    tax_status: result.tax.tax_status,
    withholding_status: result.tax.withholding_status,
    accountant_review_required: result.tax.accountant_review_required,
    missing_fields: result.missing_fields || [],
    blockers: result.blockers || [],
    next_action_keys: (result.next_actions || []).filter((a) => a.enabled).map((a) => a.key),
    processed_at: opts.processedAt || new Date().toISOString(),
  };
}

/** Canonical serialisation: keys sorted at every level, arrays kept in order.
 *
 *  Needed because one side of the comparison has been through Postgres JSONB, which
 *  does NOT preserve object key order — it stores keys sorted by length then bytes.
 *  A plain JSON.stringify therefore reports "changed" on every re-read of identical
 *  data, which silently defeated the idempotency guard in production even though an
 *  in-memory test (where insertion order survives) passed. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** True when a re-run would store exactly the same thing (timestamp aside). */
function sameIntake(a, b) {
  if (!a || !b) return false;
  const strip = (x) => { const { processed_at, ...rest } = x || {}; return canonical(rest); };
  return strip(a) === strip(b);
}

module.exports = {
  STATUSES, MEANING, RECORD_BY_TYPE, resolveDirection, assessTax,
  processDocument, toStoredIntake, sameIntake, canonical,
};
