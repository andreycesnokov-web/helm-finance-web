// OCR/Vision fallback — the flag, the guards, the fail-open contract, and the merge.
// No network: the Anthropic client is a stub, so these run everywhere.
// Run: node tests/documentOcr.test.js
const assert = require('node:assert');
const OCR = require('../server/lib/documentOcr');
const X = require('../server/lib/documentExtraction');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const PDF = Buffer.from('%PDF-1.4 scanned page');
const stub = (payload, opts = {}) => ({
  calls: [],
  messages: {
    create(args) {
      this.calls = this.calls || [];
      stubCalls.push(args);
      if (opts.throws) return Promise.reject(new Error(opts.throws));
      if (opts.hang) return new Promise(() => {});
      return Promise.resolve({ content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] });
    },
  },
});
let stubCalls = [];

const KWITANSI_ANSWER = {
  text: 'KWITANSI PT Sumber Alfaria Trijaya Tbk Sudah terima dari HELM CARE INDONESIA '
    + 'Berupa TRANSFER Untuk pembayaran Sewa Jumlah Rp 11.322.000 Tanggal 04-08-2026',
  document_type: 'receipt',
  confidence: 'high',
  fields: {
    document_number: 'KWT/TC-2607/0342', issuer_name: 'PT Sumber Alfaria Trijaya Tbk',
    buyer_name: null, counterparty_name: 'HELM CARE INDONESIA', date: '2026-08-04',
    currency: 'IDR', amount: 11322000, gross_amount: 11322000,
    commercial_base_amount: null, commercial_tax_amount: null,
    payment_method: 'TRANSFER', period_start: null, period_end: null,
    reference_number: null, npwp: null,
  },
  warnings: [],
};

(async () => {
  console.log('\nThe flag');
  await t('6. disabled by default — nothing is read and no call is made', async () => {
    delete process.env.DOCUMENT_OCR_VISION_ENABLED;
    stubCalls = [];
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    assert.strictEqual(OCR.ocrEnabled(), false);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'ocr_disabled');
    assert.strictEqual(stubCalls.length, 0, 'a disabled feature must not call a paid API');
  });

  process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';

  await t('with no client configured it refuses rather than throwing', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: null });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'ocr_not_configured');
  });

  console.log('\nGuards');
  await t('an oversized file is refused before it is sent', async () => {
    stubCalls = [];
    const big = Buffer.alloc(OCR.MAX_OCR_BYTES + 1);
    const r = await OCR.readDocumentWithVision(big, { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    assert.strictEqual(r.reason, 'file_too_large_for_ocr');
    assert.strictEqual(stubCalls.length, 0);
    assert.ok(/manually/i.test(r.warnings[0]), 'and it says what to do instead');
  });

  await t('an unsupported media type is refused', async () => {
    const r = await OCR.readDocumentWithVision(Buffer.from('a,b,c'), { mime_type: 'text/csv', file_name: 'x.csv', client: stub(KWITANSI_ANSWER) });
    assert.strictEqual(r.reason, 'unsupported_media_type_for_ocr');
  });

  await t('an empty buffer is refused', async () => {
    const r = await OCR.readDocumentWithVision(Buffer.alloc(0), { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    assert.strictEqual(r.reason, 'empty_file');
  });

  console.log('\n10. fail-open');
  await t('10. a provider error never throws — it returns a reason', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub(null, { throws: 'overloaded' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'ocr_request_failed');
    assert.strictEqual(r.document_type, 'unknown');
    assert.strictEqual(r.fields.amount, null, 'a failure invents nothing');
  });

  await t('unparseable output is a reason, not a crash', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub('I think this is a receipt!') });
    assert.strictEqual(r.reason, 'ocr_unparseable_response');
  });

  await t('an empty answer is a reason, not a crash', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub('') });
    assert.strictEqual(r.reason, 'ocr_empty_response');
  });

  console.log('\n7/8. reading a kwitansi');
  await t('7. a KWITANSI is classified as a receipt', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.source, 'ocr_vision');
    assert.strictEqual(r.document_type, 'receipt');
  });

  await t('8. its amount, date and the party who paid are read', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    assert.strictEqual(r.fields.amount, 11322000);
    assert.strictEqual(r.fields.gross_amount, 11322000);
    assert.strictEqual(r.fields.date, '2026-08-04');
    assert.strictEqual(r.fields.counterparty_name, 'HELM CARE INDONESIA');
    assert.strictEqual(r.fields.currency, 'IDR');
  });

  await t('a fenced answer is still parsed', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub('```json\n' + JSON.stringify(KWITANSI_ANSWER) + '\n```') });
    assert.strictEqual(r.document_type, 'receipt');
  });

  await t('a formatted amount is still read as a number', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub({
      ...KWITANSI_ANSWER, fields: { ...KWITANSI_ANSWER.fields, amount: 'Rp 11.322.000' } }) });
    assert.strictEqual(r.fields.amount, 11322000);
  });

  console.log('\nDiscipline');
  await t('an invented document type is rejected, not passed through', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub({
      ...KWITANSI_ANSWER, document_type: 'kwitansi_sakti' }) });
    assert.strictEqual(r.document_type, 'unknown');
  });

  await t('an invented FIELD cannot enter the pipeline', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub({
      ...KWITANSI_ANSWER, fields: { ...KWITANSI_ANSWER.fields, approve_payment: true, bank_password: 'x' } }) });
    assert.ok(!('approve_payment' in r.fields));
    assert.ok(!('bank_password' in r.fields));
    assert.deepStrictEqual(Object.keys(r.fields).sort(), OCR.FIELD_KEYS.slice().sort());
  });

  await t('a confident type with no amount is downgraded and warned about', async () => {
    const r = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub({
      ...KWITANSI_ANSWER, confidence: 'high',
      fields: { ...KWITANSI_ANSWER.fields, amount: null, gross_amount: null } }) });
    assert.notStrictEqual(r.confidence, 'high');
    assert.ok(r.warnings.some((w) => /no amount/i.test(w)), r.warnings.join(' | '));
  });

  console.log('\n5. merging into the normal extraction shape');
  await t('5. a vision reading becomes an ordinary extraction result', async () => {
    const ocr = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    const base = X.extractFromText(ocr.text, { text_available: true });
    const merged = OCR.mergeIntoExtraction(base, ocr);
    assert.strictEqual(merged.document_type, 'receipt');
    assert.strictEqual(merged.gross_amount, undefined, 'shape is unchanged — fields live under .fields');
    assert.strictEqual(merged.fields.gross_amount, 11322000);
    assert.strictEqual(merged.read_source, 'ocr_vision');
    assert.strictEqual(merged.text_available, true);
    assert.ok(merged.warnings.some((w) => /OCR\/Vision/i.test(w)), 'the reader is disclosed');
  });

  await t('vision never earns high confidence', async () => {
    const ocr = await OCR.readDocumentWithVision(PDF, { mime_type: 'application/pdf', client: stub(KWITANSI_ANSWER) });
    const base = X.extractFromText(ocr.text, { text_available: true });
    assert.strictEqual(base.confidence, 'high', 'the transcript alone would parse as high');
    const merged = OCR.mergeIntoExtraction(base, ocr);
    assert.notStrictEqual(merged.confidence, 'high', 'but a photographed page is not that certain');
  });

  await t('the parser wins where it found something; OCR only fills gaps', async () => {
    const base = X.extractFromText('KWITANSI Sudah terima dari : PT Real Payer Jumlah : Rp 500.000', { text_available: true });
    const merged = OCR.mergeIntoExtraction(base, {
      ok: true, document_type: 'receipt', confidence: 'medium', text: '', warnings: [],
      fields: { ...KWITANSI_ANSWER.fields, buyer_name: 'PT Model Guess', gross_amount: 999 },
    });
    assert.strictEqual(merged.fields.buyer_name, 'PT Real Payer', 'the read text wins');
    assert.strictEqual(merged.fields.gross_amount, 500000);
    assert.strictEqual(merged.fields.payment_method, 'TRANSFER', 'and the gap is filled');
  });

  await t('a failed reading leaves the extraction untouched', () => {
    const base = X.extractFromText('', { text_available: false, extraction_reason: 'no_embedded_text' });
    const merged = OCR.mergeIntoExtraction(base, { ok: false, reason: 'ocr_timeout' });
    assert.strictEqual(merged, base, 'same object — nothing was merged');
    assert.strictEqual(merged.status, 'needs_manual_review');
  });

  delete process.env.DOCUMENT_OCR_VISION_ENABLED;
  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
