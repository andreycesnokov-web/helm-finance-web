// Which documents may LEAVE the Evidence Inbox.
//
// Production bug this pins: two byte-identical invoices were uploaded in one click and
// only their file names differed. The one named "…npwp….pdf" was routed to the Company
// Vault and disappeared from the inbox — upload, storage, both rows and the API response
// were all fine. A regex over the file name had moved it, with "high confidence".
//
// Run: node tests/companyVaultRouting.test.mjs
import assert from 'node:assert';
import * as V from '../client/src/pages/business/companyVault.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const doc = (id, fileName, intake = null, extra = {}) => ({
  id, document_type: 'other', file: { file_name: fileName },
  extracted_json: intake ? { ai_intake: intake } : {}, ...extra,
});

// The two real production files, by name.
const A = doc('a', 'TEST-uploadtrace-A-plain-904221.pdf');
const B = doc('b', 'TEST-uploadtrace-B-npwp-904221.pdf',
  { doc_type: 'npwp', confidence: 'high', classification_status: 'auto_classified' });

console.log('\n1/2. a classification is a hint, never a move');
t('1. an invoice whose FILE NAME mentions npwp stays in the Evidence Inbox', () => {
  const { evidence, vault } = V.partitionDocuments([A, B]);
  assert.strictEqual(evidence.length, 2, 'both invoices belong in the inbox');
  assert.strictEqual(vault.length, 0, 'a file name may not move anything');
  assert.ok(evidence.some((d) => d.id === 'b'), 'the npwp-named invoice must be here');
});

t('2. a CONTENT/OCR classification is also only a suggestion', () => {
  const scanned = doc('c', 'invoice-scan.pdf',
    { doc_type: 'pkp_certificate', confidence: 'high', classification_status: 'auto_classified' });
  const { evidence, vault } = V.partitionDocuments([scanned]);
  assert.strictEqual(vault.length, 0, 'AI may recommend, never move');
  assert.strictEqual(evidence.length, 1);
});

t('the suggestion is still surfaced — the row says it needs review', () => {
  assert.strictEqual(V.needsClassificationReview(B), true);
  assert.strictEqual(V.CLASSIFICATION_REVIEW_LABEL, 'Needs classification review');
  assert.strictEqual(V.needsClassificationReview(A), false, 'no suggestion, no badge');
});

console.log('\n3/4. only a person moves a document');
t('3. a human-confirmed vault type DOES move the document', () => {
  const confirmed = doc('d', 'npwp-card.pdf',
    { doc_type: 'npwp', confidence: 'high', classification_status: 'manually_confirmed' });
  const { evidence, vault } = V.partitionDocuments([confirmed]);
  assert.strictEqual(vault.length, 1, 'a confirmed classification is a decision');
  assert.strictEqual(evidence.length, 0);
  assert.strictEqual(V.isConfirmedCompanyDoc(confirmed), true);
  assert.strictEqual(V.needsClassificationReview(confirmed), false, 'confirmed needs no review');
});

t('4. a previously confirmed vault document is NOT dragged back to the inbox', () => {
  const existing = doc('e', 'akta-pendirian.pdf',
    { doc_type: 'akta', confidence: 'high', classification_status: 'manually_confirmed' });
  assert.strictEqual(V.partitionDocuments([existing]).vault.length, 1);
});

t('a confirmed NON-vault classification keeps the document in the inbox', () => {
  const confirmedInvoice = doc('f', 'npwp-in-the-name.pdf',
    { doc_type: 'invoice', confidence: 'high', classification_status: 'manually_confirmed' });
  assert.strictEqual(V.partitionDocuments([confirmedInvoice]).vault.length, 0);
  assert.strictEqual(V.needsClassificationReview(confirmedInvoice), false);
});

console.log('\nNothing is lost either way');
t('every document lands in exactly one of the two views', () => {
  const all = [A, B,
    doc('g', 'nib.pdf', { doc_type: 'nib', classification_status: 'manually_confirmed' }),
    doc('h', 'random.pdf'),
    doc('i', 'kontrak-akta.pdf', { doc_type: 'akta', classification_status: 'auto_classified' })];
  const { evidence, vault } = V.partitionDocuments(all);
  assert.strictEqual(evidence.length + vault.length, all.length);
  const ids = new Set([...evidence, ...vault].map((d) => d.id));
  assert.strictEqual(ids.size, all.length, 'no row is duplicated or dropped');
});

t('a stored accounting type still wins over any guess', () => {
  const filed = doc('j', 'npwp-name.pdf', null, { document_type: 'vendor_invoice' });
  assert.strictEqual(V.vaultVerdictOf(filed), null);
  assert.strictEqual(V.partitionDocuments([filed]).vault.length, 0);
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
