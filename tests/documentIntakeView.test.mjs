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
  assert.strictEqual(inv.status, 'not_found');

  const proof = V.counterpartyOffer({ ...INVOICE, document_type: 'payment_proof' });
  assert.strictEqual(proof.show, true, 'the section still appears');
  assert.strictEqual(proof.canLink, false, 'the issuer is the bank, not the counterparty');
  assert.ok(/more than one party/i.test(proof.limitation), proof.limitation);
});

t('a matched counterparty is reported without being linked', () => {
  const m = V.counterpartyOffer({ ...INVOICE, counterparty_status: 'matched', matched_counterparty_id: 'cp-1' });
  assert.strictEqual(m.status, 'matched');
  assert.strictEqual(m.matchedId, 'cp-1');
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
