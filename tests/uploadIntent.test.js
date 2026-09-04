// Upload intent — what the screen a user uploaded from does, and does not, decide.
// Run: node tests/uploadIntent.test.js
const assert = require('node:assert');
const I = require('../server/lib/uploadIntent');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

console.log('\n1. preserving the intent');
t('1. an invoice upload records what the user believed they were filing', () => {
  const i = I.buildUploadIntent('invoice_upload', { createdAt: '2026-09-04T10:00:00.000Z' });
  assert.strictEqual(i.source, 'invoice_upload');
  assert.strictEqual(i.label, 'Invoice');
  assert.strictEqual(i.suggested_document_type, 'invoice');
  assert.strictEqual(i.created_at, '2026-09-04T10:00:00.000Z');
});

t('a payable upload also carries the direction that screen implies', () => {
  assert.strictEqual(I.buildUploadIntent('payable_upload').suggested_direction, 'payable');
  assert.strictEqual(I.buildUploadIntent('receivable_upload').suggested_direction, 'receivable');
});

t('a declared document type is the stronger statement of intent', () => {
  const i = I.buildUploadIntent('payable_upload', { declaredType: 'payment_proof' });
  assert.strictEqual(i.suggested_document_type, 'payment_proof',
    'the payment-proof flow says exactly what it is sending');
});

t('"other" is not a statement of intent', () => {
  assert.strictEqual(I.buildUploadIntent('invoice_upload', { declaredType: 'other' }).suggested_document_type, 'invoice');
});

t('an unknown source is discarded, not stored', () => {
  assert.strictEqual(I.buildUploadIntent('hacker_upload'), null);
  assert.strictEqual(I.buildUploadIntent(''), null);
  assert.strictEqual(I.buildUploadIntent(null), null);
  assert.strictEqual(I.buildUploadIntent({ source: 'invoice_upload' }), null);
});

t('the stored shape is exactly five fields', () => {
  assert.deepStrictEqual(Object.keys(I.buildUploadIntent('invoice_upload')).sort(),
    ['created_at', 'label', 'source', 'suggested_direction', 'suggested_document_type']);
});

t('the Document Center itself implies nothing about the document', () => {
  const i = I.buildUploadIntent('document_center_upload');
  assert.strictEqual(i.suggested_document_type, null);
  assert.strictEqual(i.suggested_direction, null);
});

console.log('\n9. conflict');
t('9. uploaded as an invoice but read as a receipt IS a conflict', () => {
  const intent = I.buildUploadIntent('invoice_upload');
  assert.strictEqual(I.detectIntentConflict(intent, 'receipt'), true);
  const msg = I.intentConflictMessage(intent, 'receipt', () => 'a Receipt / Kwitansi');
  assert.ok(/Uploaded as Invoice/.test(msg), msg);
  assert.ok(/Receipt/.test(msg), msg);
  assert.ok(/confirm/i.test(msg), 'and it asks the user rather than deciding');
});

t('a faktur pajak through the invoice flow is NOT a conflict', () => {
  // Same billing event, different paper. Flagging it would be noise.
  assert.strictEqual(I.detectIntentConflict(I.buildUploadIntent('invoice_upload'), 'faktur_pajak'), false);
});

t('a payment proof and a receipt are compatible with each other', () => {
  assert.strictEqual(I.detectIntentConflict(I.buildUploadIntent('payment_proof_upload'), 'receipt'), false);
});

t('an unread document is a GAP, never a disagreement', () => {
  const intent = I.buildUploadIntent('invoice_upload');
  assert.strictEqual(I.detectIntentConflict(intent, 'unknown'), false,
    'nothing was recognised, so nothing contradicts the user');
  assert.strictEqual(I.detectIntentConflict(intent, 'receipt', { unsupported: true }), false,
    'an unreadable scan must not tell the user their upload was wrong');
});

t('with no intent there is nothing to conflict with', () => {
  assert.strictEqual(I.detectIntentConflict(null, 'receipt'), false);
  assert.strictEqual(I.detectIntentConflict(I.buildUploadIntent('document_center_upload'), 'receipt'), false);
  assert.strictEqual(I.intentConflictMessage(null, 'receipt'), null);
});

t('a bank statement through the payable flow is a conflict', () => {
  assert.strictEqual(I.detectIntentConflict(I.buildUploadIntent('payable_upload'), 'bank_statement'), true);
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
