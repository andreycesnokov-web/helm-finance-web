// Document Center intake view model — what the card and panel are allowed to say
// and to offer. Pure functions, no React.
// Run: node tests/documentIntakeView.test.mjs
import assert from 'node:assert';
import * as V from '../client/src/pages/business/documentIntakeView.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const INVOICE = {
  version: 'intake-v1', status: 'needs_counterparty', document_type: 'invoice',
  confidence: 'high', direction: 'payable', business_meaning: 'A supplier invoice.',
  counterparty_status: 'not_found', matched_counterparty_id: null,
  suggested_record_type: 'payable', amount: 13320000, currency: 'IDR',
  ppn_detected: true, ppn_amount: 1320000, tax_status: 'tax_detected',
  withholding_status: 'needs_rule', accountant_review_required: true,
  missing_fields: ['counterparty'], blockers: [],
  next_action_keys: ['create_counterparty', 'save_document_only'],
  processed_at: '2026-09-04T09:00:00.000Z',
};
const SCAN = {
  version: 'intake-v1', status: 'unsupported', document_type: 'unknown', confidence: 'needs_review',
  direction: 'unknown', business_meaning: null, counterparty_status: 'needs_review',
  matched_counterparty_id: null, suggested_record_type: 'none', amount: null, currency: null,
  ppn_detected: false, ppn_amount: null, tax_status: 'tax_not_detected', withholding_status: 'unknown',
  accountant_review_required: true, missing_fields: [],
  blockers: ['Automatic extraction needs OCR/Vision for a scanned document.'],
  next_action_keys: ['enter_manually', 'request_accountant_review'],
  processed_at: '2026-09-04T09:00:00.000Z',
};
const doc = (v2, extra = {}) => ({ document_type: 'other', extracted_json: v2 ? { ai_intake_v2: v2 } : {}, ...extra });

/* ── 3. the card no longer looks dead ───────────────────────────────────────── */
t('3. a stored type of "other" still shows the AI suggestion beside it', () => {
  const p = V.storedVsSuggested(doc(INVOICE), 'Unclassified');
  assert.strictEqual(p.showPair, true);
  assert.strictEqual(p.storedLabel, 'Unclassified');
  assert.strictEqual(p.suggestedLabel, 'Invoice');
});

t('a confirmed stored type does not get second-guessed on the card', () => {
  const p = V.storedVsSuggested(doc(INVOICE, { document_type: 'vendor_invoice' }), 'Supplier invoice');
  assert.strictEqual(p.showPair, false, 'no pair once a human has classified it');
});

t('an unrecognised document does not manufacture a suggestion', () => {
  assert.strictEqual(V.storedVsSuggested(doc(SCAN), 'Unclassified').showPair, false);
});

t('the row headline reads type · direction · status', () => {
  assert.strictEqual(V.intakeHeadline(INVOICE), 'Invoice · Payable · Needs counterparty');
});

t('the row lines carry amount, tax and what is missing', () => {
  const lines = V.intakeRowLines(INVOICE);
  assert.ok(lines.some((l) => /IDR 13\.320\.000/.test(l)), lines.join(' | '));
  assert.ok(lines.some((l) => /PPN IDR 1\.320\.000/.test(l)), lines.join(' | '));
  assert.ok(lines.some((l) => /Missing: counterparty/.test(l)), lines.join(' | '));
});

t('a document with no summary yields nothing to show', () => {
  assert.strictEqual(V.intakeOf(doc(null)), null);
  assert.strictEqual(V.intakeHeadline(null), null);
  assert.deepStrictEqual(V.intakeRowLines(null), []);
  assert.deepStrictEqual(V.intakeBadges(null), []);
});

t('badges name the type, direction, status and tax signal', () => {
  const keys = V.intakeBadges(INVOICE).map((b) => b.key);
  assert.deepStrictEqual(keys, ['type', 'direction', 'status', 'ppn', 'acct']);
  const labels = V.intakeBadges(INVOICE).map((b) => b.label);
  assert.deepStrictEqual(labels, ['Invoice', 'Payable', 'Needs counterparty', 'PPN detected', 'Accountant review']);
});

/* ── 4. unsupported is a fallback, not a dead end ───────────────────────────── */
t('4. a scanned document says OCR is needed and offers manual routes', () => {
  assert.strictEqual(V.isUnsupported(SCAN), true);
  assert.strictEqual(V.intakeCopy(SCAN), V.UNSUPPORTED_COPY);
  assert.ok(/OCR\/Vision/.test(V.intakeCopy(SCAN)));
  const next = V.nextActionLabels(SCAN).map((a) => a.label);
  assert.ok(next.includes('Enter the values manually'), next.join(' | '));
  assert.ok(next.includes('Send to accountant review'), next.join(' | '));
});

t('the readable-document copy asks for review before records are created', () => {
  assert.strictEqual(V.intakeCopy(INVOICE), 'AI thinks this is an invoice. Please review before creating records.');
  // the article tracks the noun, so "a faktur pajak" does not become "an"
  assert.ok(/this is a faktur pajak\./.test(V.intakeCopy({ ...INVOICE, document_type: 'faktur_pajak' })));
});

/* ── 11/12. what may be offered ─────────────────────────────────────────────── */
t('11. a payable draft is offered only when intake suggests payable', () => {
  assert.strictEqual(V.draftOffer(INVOICE).show, true);
  assert.strictEqual(V.draftOffer(INVOICE).type, 'payable');
  assert.strictEqual(V.draftOffer(SCAN).show, false, 'nothing is suggested for an unreadable scan');
  assert.strictEqual(V.draftOffer({ ...INVOICE, suggested_record_type: 'none' }).show, false);
  assert.strictEqual(V.draftOffer(null).show, false);
});

t('a receivable suggestion offers a receivable, never a payable', () => {
  const o = V.draftOffer({ ...INVOICE, suggested_record_type: 'receivable', direction: 'receivable' });
  assert.strictEqual(o.type, 'receivable');
});

t('12. missing fields block draft creation and say which', () => {
  const o = V.draftOffer({ ...INVOICE, missing_fields: ['amount', 'date'], amount: null });
  assert.strictEqual(o.show, true, 'still offered, so the user can see why it is held');
  assert.strictEqual(o.enabled, false);
  assert.ok(/amount/i.test(o.reason), o.reason);
});

t('a missing counterparty alone does not block the draft — it is prefilled later', () => {
  assert.strictEqual(V.draftOffer(INVOICE).enabled, true);
});

t('a document already on a record is not offered a second draft', () => {
  assert.strictEqual(V.draftOffer(INVOICE, { alreadyLinked: true }).show, false);
});

/* ── 9/10. counterparty offer ───────────────────────────────────────────────── */
t('9/10. an invoice can be linked to a counterparty; a payment proof cannot', () => {
  const inv = V.counterpartyOffer(INVOICE);
  assert.strictEqual(inv.canLink, true);
  assert.strictEqual(inv.limitation, null);
  assert.strictEqual(inv.reason, null);
  assert.strictEqual(inv.status, 'not_found');

  const proof = V.counterpartyOffer({ ...INVOICE, document_type: 'payment_proof' });
  assert.strictEqual(proof.show, true, 'the section still appears');
  assert.strictEqual(proof.canLink, false, 'the issuer is the bank, not the counterparty');
  assert.strictEqual(proof.reason, 'multiple_parties');
  assert.ok(/more than one party/i.test(proof.limitation), proof.limitation);
});

// Production found this: an unreadable scan claimed it "names more than one party",
// when in fact no party — and no text — had been read at all.
t('an unsupported scan says nothing could be READ, not that parties conflicted', () => {
  const scan = V.counterpartyOffer(SCAN);
  assert.strictEqual(scan.show, true, 'the section still appears, with manual routes');
  assert.strictEqual(scan.canLink, false);
  assert.strictEqual(scan.reason, 'unreadable');
  assert.ok(/could not read who the parties are/i.test(scan.limitation), scan.limitation);
  assert.ok(!/more than one party/i.test(scan.limitation),
    'must not claim it read parties it never read');
  assert.ok(/accountant review/i.test(scan.limitation), 'and it must offer a way forward');
});

t('an unrecognised but readable document is also treated as unreadable parties', () => {
  // document_type 'unknown' means the text identified nothing — same honest answer.
  const r = V.counterpartyOffer({ ...INVOICE, status: 'needs_accountant_review', document_type: 'unknown' });
  assert.strictEqual(r.reason, 'unreadable');
});

t('a document that simply is not issued by a counterparty claims neither', () => {
  const payroll = V.counterpartyOffer({ ...INVOICE, document_type: 'payroll_document' });
  assert.strictEqual(payroll.reason, 'not_an_issuer_document');
  assert.ok(!/more than one party/i.test(payroll.limitation), payroll.limitation);
  assert.ok(!/could not read/i.test(payroll.limitation), payroll.limitation);
});

t('a matched counterparty is reported without being linked', () => {
  const m = V.counterpartyOffer({ ...INVOICE, counterparty_status: 'matched', matched_counterparty_id: 'cp-1' });
  assert.strictEqual(m.status, 'matched');
  assert.strictEqual(m.matchedId, 'cp-1');
});

/* ── 19. stored type / uploaded as / AI suggestion, as three things ─────────── */
const intent = (source = 'invoice_upload', label = 'Invoice', type = 'invoice') => ({
  source, label, suggested_document_type: type, suggested_direction: null,
  created_at: '2026-09-04T10:00:00.000Z',
});
const docWith = (v2, up, extra = {}) => ({
  document_type: 'other',
  extracted_json: { ...(v2 ? { ai_intake_v2: v2 } : {}), ...(up ? { upload_intent: up } : {}) },
  ...extra,
});

t('19. all three readings are shown separately, never merged', () => {
  const p = V.storedVsSuggested(docWith({ ...INVOICE, document_type: 'receipt' }, intent()), 'Unclassified');
  assert.strictEqual(p.storedLabel, 'Unclassified');
  assert.strictEqual(p.uploadedAs, 'Invoice');
  assert.strictEqual(p.suggestedLabel, 'Receipt');
  assert.strictEqual(p.showUploadedAs, true);
  assert.strictEqual(p.showPair, true);
});

t('1/2. the upload intent is read back and never becomes the stored type', () => {
  const d = docWith(INVOICE, intent());
  assert.strictEqual(V.uploadIntentOf(d).source, 'invoice_upload');
  assert.strictEqual(d.document_type, 'other', 'the column is untouched by intent');
});

t('an unreadable scan still shows what it was uploaded as', () => {
  // The only thing known about the document — so it is exactly when intent matters most.
  const p = V.storedVsSuggested(docWith(SCAN, intent()), 'Unclassified');
  assert.strictEqual(p.showUploadedAs, true);
  assert.strictEqual(p.uploadedAs, 'Invoice');
  assert.strictEqual(p.showPair, false, 'and no AI suggestion is invented');
});

t('once a person has classified it, neither hint second-guesses them', () => {
  const p = V.storedVsSuggested(docWith(INVOICE, intent(), { document_type: 'vendor_invoice' }), 'Supplier invoice');
  assert.strictEqual(p.showPair, false);
  assert.strictEqual(p.showUploadedAs, false);
});

/* ── 9. the conflict ────────────────────────────────────────────────────────── */
t('9. uploaded as Invoice but read as Receipt is surfaced as a conflict', () => {
  const d = docWith({ ...INVOICE, document_type: 'receipt', intent_conflict: true }, intent());
  assert.strictEqual(V.storedVsSuggested(d, 'Unclassified').conflict, true);
  const msg = V.conflictMessage(d);
  assert.ok(/Uploaded as Invoice/.test(msg), msg);
  assert.ok(/reads this as Receipt/.test(msg), msg);
  assert.ok(/confirm/i.test(msg), 'the user decides, the system does not');
});

t('no conflict flag means no conflict sentence', () => {
  assert.strictEqual(V.conflictMessage(docWith(INVOICE, intent())), null);
  assert.strictEqual(V.conflictMessage(docWith(INVOICE, null)), null);
});

/* ── 5/6. OCR disclosure ────────────────────────────────────────────────────── */
t('5. a document read by vision says so, rather than claiming it read text', () => {
  const v2 = { ...INVOICE, source: 'ocr_vision', document_type: 'receipt' };
  assert.strictEqual(V.wasReadByOcr(v2), true);
  assert.strictEqual(V.intakeCopy(v2), V.OCR_READ_COPY);
  assert.ok(/OCR\/Vision read this document/.test(V.intakeCopy(v2)));
  assert.strictEqual(V.readSourceLabel(v2), 'Read by OCR/Vision');
});

t('6. with OCR off, a scan says so and points at the manual routes', () => {
  const copy = V.intakeCopy({ ...SCAN, source: 'filename_only' });
  assert.strictEqual(copy, V.UNSUPPORTED_COPY);
  assert.ok(/OCR\/Vision is not enabled yet/.test(copy), copy);
  assert.ok(/manually|accountant review/i.test(copy), copy);
});

t('embedded text is still labelled as the source it is', () => {
  assert.strictEqual(V.readSourceLabel({ ...INVOICE, source: 'embedded_text' }), 'Read from the document text');
  assert.strictEqual(V.readSourceLabel(INVOICE), null, 'an older summary without a source says nothing');
});

/* ── the receipt card, and OCR wording ──────────────────────────────────────── */
const OCR_RECEIPT = {
  ...INVOICE, source: 'ocr_vision', document_type: 'receipt', direction: 'outgoing_payment',
  status: 'ready_to_confirm', suggested_record_type: 'supporting_document',
  amount: 11322000, missing_fields: [], ppn_detected: false, ppn_amount: null,
};

t('the card never reads "Receipt · Payable"', () => {
  const head = V.intakeHeadline(OCR_RECEIPT);
  assert.ok(!/Payable/.test(head), head);
  assert.ok(!/Receivable/.test(head), head);
  assert.ok(/^Receipt · Outgoing payment/.test(head), head);
});

t('a vision reading is labelled for review, not for confirmation', () => {
  assert.strictEqual(V.statusLabelFor(OCR_RECEIPT), 'Ready for review');
  assert.ok(/Ready for review/.test(V.intakeHeadline(OCR_RECEIPT)), V.intakeHeadline(OCR_RECEIPT));
  assert.ok(V.intakeBadges(OCR_RECEIPT).some((b) => b.label === 'Ready for review'));
});

t('the same status read from document text keeps its confident wording', () => {
  const fromText = { ...OCR_RECEIPT, source: 'embedded_text' };
  assert.strictEqual(V.statusLabelFor(fromText), 'Ready to confirm');
  // the enum itself is untouched either way
  assert.strictEqual(V.statusLabelOf('ready_to_confirm'), 'Ready to confirm');
});

t('a receipt offers no payable or receivable draft', () => {
  assert.strictEqual(V.draftOffer(OCR_RECEIPT).show, false);
});

/* ── tax wording by reader ──────────────────────────────────────────────────── */
t('a vision-read PPN is offered for verification, never as a plain reading', () => {
  const v2 = { ...OCR_RECEIPT, ppn_detected: true, ppn_amount: 1122000, tax_status: 'tax_needs_review' };
  assert.strictEqual(V.taxBadgeLabel(v2), 'PPN — verify OCR value');
  assert.ok(/verify/i.test(V.taxLine(v2)), V.taxLine(v2));
  assert.ok(!/^PPN IDR/.test(V.taxLine(v2)), 'must not read like a printed figure');
});

t('a PPN parsed from document text keeps the plain wording', () => {
  const v2 = { ...OCR_RECEIPT, source: 'embedded_text', ppn_detected: true, ppn_amount: 1320000 };
  assert.strictEqual(V.taxBadgeLabel(v2), 'PPN detected');
  assert.strictEqual(V.taxLine(v2), 'PPN IDR 1.320.000');
});

t('an unconfirmed tax figure says exactly that, on the card too', () => {
  const v2 = { ...OCR_RECEIPT, ppn_detected: false, ppn_amount: null, tax_status: 'tax_not_confirmed' };
  assert.strictEqual(V.taxBadgeLabel(v2), 'Tax not confirmed');
  assert.strictEqual(V.taxLine(v2), 'Not confirmed from the document');
  assert.ok(V.intakeRowLines(v2).some((l) => /Tax: Not confirmed from the document/.test(l)),
    V.intakeRowLines(v2).join(' | '));
  assert.ok(V.intakeBadges(v2).some((b) => b.label === 'Tax not confirmed'));
});

t('7. the suggested record reads in words, not as an enum', () => {
  assert.strictEqual(V.recordLabelOf('supporting_document'), 'Save as supporting document');
  assert.strictEqual(V.recordLabelOf('payable'), 'Create payable draft');
  assert.strictEqual(V.recordLabelOf('transaction'), 'Record as a transaction');
  assert.ok(!/_/.test(V.recordLabelOf('supporting_document')), 'no underscores reach the user');
  assert.ok(!/^Create/.test(V.recordLabelOf('supporting_document')),
    'nothing is "created" for a kind that is never created');
});

/* ── the single workflow decision ───────────────────────────────────────────
   Production showed the panel saying two things at once: the reading said
   "direction unknown, no record suggested" while Actions & Routing offered
   "Create payable draft", because that column keyed off the stored column alone. */
const wfDoc = (v2, extra = {}) => ({ document_type: 'other', links: [], extracted_json: v2 ? { ai_intake_v2: v2 } : {}, ...extra });

t('5. an OCR document does not offer Create payable before confirmation', () => {
  const w = V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'ocr_vision' }));
  assert.strictEqual(w.canShowCreatePayable, false);
  assert.strictEqual(w.mustReviewFirst, true);
  assert.strictEqual(w.recommendedPrimaryAction, 'review_confirm');
  assert.ok(/OCR\/Vision/.test(w.warningReason), w.warningReason);
});

t('6. OCR plus an unknown direction still offers no draft', () => {
  const w = V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'ocr_vision', direction: 'unknown', suggested_record_type: 'none' }));
  assert.strictEqual(w.canShowCreatePayable, false);
  assert.strictEqual(w.canShowCreateReceivable, false);
});

t('an unknown direction from EMBEDDED text also blocks a draft', () => {
  const w = V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'embedded_text', direction: 'unknown' }));
  assert.strictEqual(w.canShowCreatePayable, false);
  assert.strictEqual(w.mustReviewFirst, true);
  assert.ok(/direction/i.test(w.warningReason), w.warningReason);
});

t('7. a stored supplier invoice that AI reads as a faktur asks for review first', () => {
  // exactly the production KWT state
  const w = V.documentWorkflowState(wfDoc(
    { ...INVOICE, source: 'ocr_vision', document_type: 'faktur_pajak', direction: 'unknown', suggested_record_type: 'none' },
    { document_type: 'vendor_invoice' }));
  assert.strictEqual(w.canShowCreatePayable, false, 'the stored column alone may not drive this');
  assert.strictEqual(w.mustReviewFirst, true);
  assert.strictEqual(w.recommendedPrimaryAction, 'review_confirm');
  assert.ok(/disagree|OCR/i.test(w.warningReason), w.warningReason);
});

t('a stored type consistent with the reading raises no conflict', () => {
  assert.strictEqual(V.storedMatchesAi('vendor_invoice', 'invoice'), true);
  assert.strictEqual(V.storedMatchesAi('tax_invoice', 'faktur_pajak'), true);
  assert.strictEqual(V.storedMatchesAi('vendor_invoice', 'receipt'), false);
  assert.strictEqual(V.storedMatchesAi('other', 'receipt'), true, 'an unset column cannot disagree');
});

t('8. a receipt never offers Create payable, whatever the column says', () => {
  for (const stored of ['other', 'vendor_invoice']) {
    const w = V.documentWorkflowState(wfDoc(
      { ...INVOICE, source: 'embedded_text', document_type: 'receipt', direction: 'outgoing_payment',
        suggested_record_type: 'supporting_document' }, { document_type: stored }));
    assert.strictEqual(w.canShowCreatePayable, false, `stored ${stored} must not create a payable`);
    assert.strictEqual(w.canShowCreateReceivable, false);
  }
});

t('a receipt read from text offers supporting evidence and a transaction link', () => {
  const w = V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'embedded_text', document_type: 'receipt',
    direction: 'outgoing_payment', suggested_record_type: 'supporting_document' }));
  assert.strictEqual(w.recommendedPrimaryAction, 'save_supporting');
  assert.strictEqual(w.canShowSaveSupporting, true);
  assert.strictEqual(w.canShowLinkTransaction, true);
});

t('a payment proof links rather than bills', () => {
  const w = V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'embedded_text', document_type: 'payment_proof',
    direction: 'outgoing_payment', suggested_record_type: 'transaction' }));
  assert.strictEqual(w.recommendedPrimaryAction, 'link_transaction');
  assert.strictEqual(w.canShowCreatePayable, false);
});

t('9. an embedded-text invoice with everything known still offers the draft', () => {
  const w = V.documentWorkflowState(wfDoc(
    { ...INVOICE, source: 'embedded_text', counterparty_status: 'matched', missing_fields: [] },
    { issuer_counterparty_id: 'cp-1' }));
  assert.strictEqual(w.canShowCreatePayable, true);
  assert.strictEqual(w.recommendedPrimaryAction, 'create_payable');
  assert.strictEqual(w.mustReviewFirst, false);
});

t('10. a missing amount blocks the draft and says so', () => {
  const w = V.documentWorkflowState(wfDoc(
    { ...INVOICE, source: 'embedded_text', amount: null, counterparty_status: 'matched', missing_fields: ['amount'] },
    { issuer_counterparty_id: 'cp-1' }));
  assert.strictEqual(w.canShowCreatePayable, false);
  assert.strictEqual(w.mustReviewFirst, true);
  assert.ok(/amount/i.test(w.warningReason), w.warningReason);
});

t('11. a missing counterparty reroutes to creating one, not to a payable', () => {
  const w = V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'embedded_text', counterparty_status: 'not_found', missing_fields: [] }));
  assert.strictEqual(w.canShowCreatePayable, false);
  assert.strictEqual(w.canCreateCounterparty, true);
  assert.strictEqual(w.recommendedPrimaryAction, 'create_counterparty');
  assert.ok(/counterparty/i.test(w.warningReason), w.warningReason);
});

t('a document already on a record points at the record', () => {
  const w = V.documentWorkflowState(wfDoc(INVOICE, { links: [{ target_type: 'debt', target_id: 7 }] }));
  assert.strictEqual(w.recommendedPrimaryAction, 'open_record');
  assert.strictEqual(w.canShowCreatePayable, false, 'never a second record from one document');
});

t('a document with no reading falls back to the stored column, as before', () => {
  assert.strictEqual(V.documentWorkflowState(wfDoc(null, { document_type: 'vendor_invoice' })).recommendedPrimaryAction, 'create_payable');
  assert.strictEqual(V.documentWorkflowState(wfDoc(null, { document_type: 'customer_invoice' })).recommendedPrimaryAction, 'create_receivable');
  assert.strictEqual(V.documentWorkflowState(wfDoc(null)).recommendedPrimaryAction, 'analyze');
});

t('17. no workflow state creates anything — they are all offers', () => {
  const states = [
    V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'ocr_vision' })),
    V.documentWorkflowState(wfDoc({ ...INVOICE, source: 'embedded_text' })),
    V.documentWorkflowState(wfDoc(SCAN)),
  ];
  for (const w of states) {
    assert.ok('canShowCreatePayable' in w && typeof w.canShowCreatePayable === 'boolean');
    assert.ok(!('created' in w) && !('payable_id' in w), 'a decision is never a record');
  }
});

/* ── 5/6. the analyze button ────────────────────────────────────────────────── */
t('5. a stored run says the analysis was updated', () => {
  assert.strictEqual(V.analyzeMessage({ stored: true }), 'Analysis updated.');
});

t('6. an unchanged re-run never reads as though something was created', () => {
  const msg = V.analyzeMessage({ stored: false });
  assert.strictEqual(msg, 'Analysis is already up to date.');
  assert.ok(!/creat|new|added/i.test(msg), msg);
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
