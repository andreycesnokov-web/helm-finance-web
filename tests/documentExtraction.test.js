// Document Extraction V1 — parser rules over embedded text.
// Fixtures mirror the real Circleka invoice and BCA transfer receipt.
// Run: node tests/documentExtraction.test.js
const assert = require('node:assert');
const X = require('../server/lib/documentExtraction');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

// Text as pdfText.js yields it: labels and values, whitespace unreliable.
const FAKTUR_TEXT = `
Faktur Pajak
Kode dan Nomor Seri Faktur Pajak: 040.026-00.313616020
Pengusaha Kena Pajak
Nama : PT Circleka Indonesia Utama
NPWP : 01.234.567.8-091.000
Pembeli Barang Kena Pajak
Nama : PT Helm Care Indonesia
NPWP : 09.876.543.2-101.000
Uraian : Rent space / placement of Helm Care machines in 36 Circle K stores
Periode 15 April 2026 s/d 14 Juli 2026
Harga Jual / Penggantian 129.600.000
Dasar Pengenaan Pajak 129.600.000
Jumlah PPN (Pajak Pertambahan Nilai) 14.256.000
Netto 143.856.000
No. Invoice X2610001139
`;

const BCA_TEXT = `
BCA
Transfer ke Rekening BCA - Other BCA Account
04/09/2026 09:35:02
Dari 772-1538064 / HELM CARE INDONESIA PT
Ke 075-3020192 / CIRCLEKA INDONESIA UTAMA
Amount Rp 29.600.000
Fee Rp 0
Status Successful
Reference No. 26090400308936
`;

// ── 1 & 2. invoice / faktur pajak ──────────────────────────────────────────
t('1. Circleka invoice: reference, DPP, PPN and gross', () => {
  const r = X.extractFromText(FAKTUR_TEXT, { document_type: 'tax_invoice' });
  assert.strictEqual(r.fields.document_number, 'X2610001139');
  assert.strictEqual(r.fields.commercial_base_amount, 129600000);
  assert.strictEqual(r.fields.commercial_tax_amount, 14256000);
  assert.strictEqual(r.fields.gross_amount, 143856000);
  assert.strictEqual(r.fields.currency, 'IDR');
  // base + tax must reconcile to the total actually printed
  assert.strictEqual(r.fields.commercial_base_amount + r.fields.commercial_tax_amount, r.fields.gross_amount);
});

t('2. Faktur Pajak serial is read and normalised, separate from the invoice number', () => {
  const r = X.extractFromText(FAKTUR_TEXT, { document_type: 'tax_invoice' });
  assert.strictEqual(r.fields.tax_invoice_serial, '04002600313616020');
  assert.notStrictEqual(r.fields.tax_invoice_serial, r.fields.document_number);
});

t('identifies the document as a faktur pajak and names both parties', () => {
  const r = X.extractFromText(FAKTUR_TEXT, {});
  assert.strictEqual(r.document_type, 'faktur_pajak');
  assert.ok(/Circleka/i.test(r.fields.issuer_name), `issuer was ${r.fields.issuer_name}`);
  assert.ok(/Helm Care/i.test(r.fields.buyer_name), `buyer was ${r.fields.buyer_name}`);
  assert.ok(r.fields.issuer_npwp);
});

t('a total that contradicts base + tax is warned about, not silently preferred', () => {
  const bad = FAKTUR_TEXT.replace('Netto 143.856.000', 'Netto 999.999.999');
  const r = X.extractFromText(bad, {});
  assert.ok(r.warnings.some((w) => /does not equal base/i.test(w)), JSON.stringify(r.warnings));
});

t('a missing total is derived from base + tax and flagged as derived', () => {
  const noTotal = FAKTUR_TEXT.replace('Netto 143.856.000', '');
  const r = X.extractFromText(noTotal, {});
  assert.strictEqual(r.fields.gross_amount, 143856000);
  assert.ok(r.warnings.some((w) => /derived from base \+ tax/i.test(w)));
});

// ── 3. bank payment proof ──────────────────────────────────────────────────
t('3. BCA proof: amount, status and reference number', () => {
  const r = X.extractFromText(BCA_TEXT, { document_type: 'payment_proof' });
  assert.strictEqual(r.document_type, 'payment_proof');
  assert.strictEqual(r.fields.amount, 29600000);
  assert.strictEqual(r.fields.payment_status, 'Successful');
  assert.strictEqual(r.fields.payment_reference_number, '26090400308936');
  assert.strictEqual(r.fields.bank_name, 'BCA');
  assert.strictEqual(r.fields.fee, 0);
});

t('BCA proof: both account sides and the transfer timestamp', () => {
  const r = X.extractFromText(BCA_TEXT, { document_type: 'payment_proof' });
  assert.strictEqual(r.fields.from_account_number, '772-1538064');
  assert.ok(/HELM CARE/i.test(r.fields.from_account_name));
  assert.strictEqual(r.fields.to_account_number, '075-3020192');
  assert.ok(/CIRCLEKA/i.test(r.fields.to_account_name));
  assert.strictEqual(r.fields.transfer_date_text, '04/09/2026 09:35:02');
});

t('a failed transfer is read and warned about', () => {
  const failed = BCA_TEXT.replace('Status Successful', 'Status Failed');
  const r = X.extractFromText(failed, { document_type: 'payment_proof' });
  assert.strictEqual(r.fields.payment_status, 'Failed');
  assert.ok(r.warnings.some((w) => /only a successful transfer/i.test(w)));
});

// ── 4. no text: the honest fallback ────────────────────────────────────────
t('4. a scanned page with no embedded text returns needs_manual_review', () => {
  const r = X.extractFromText('', { text_available: false, extraction_reason: 'no_embedded_text' });
  assert.strictEqual(r.status, 'needs_manual_review');
  assert.strictEqual(r.confidence, 'needs_review');
  assert.ok(r.warnings.some((w) => /not available for a scanned image/i.test(w)));
  // and it must invent nothing
  assert.strictEqual(r.fields.gross_amount, null);
  assert.strictEqual(r.fields.amount, null);
  assert.strictEqual(r.raw_text_excerpt, '');
});

t('whitespace-only text is treated as no text', () => {
  const r = X.extractFromText('   \n\t  ', {});
  assert.strictEqual(r.status, 'needs_manual_review');
});

// ── confidence discipline ──────────────────────────────────────────────────
t('confidence is earned: high needs anchors AND the required fields', () => {
  const full = X.extractFromText(FAKTUR_TEXT, {});
  assert.strictEqual(full.confidence, 'high');

  const thin = X.extractFromText('Faktur Pajak\nPengusaha Kena Pajak\nNama : PT X', {});
  assert.notStrictEqual(thin.confidence, 'high');
  assert.ok(thin.missing_fields.length > 0);
  assert.ok(thin.warnings.some((w) => /Review every value/i.test(w)));
});

t('an unrecognised document claims nothing', () => {
  const r = X.extractFromText('Lorem ipsum dolor sit amet, nothing financial here at all.', {});
  assert.strictEqual(r.document_type, 'unknown');
  assert.strictEqual(r.confidence, 'needs_review');
  assert.strictEqual(r.fields.gross_amount, null);
});

t('the declared upload type is used only when the text has no anchors', () => {
  const r = X.extractFromText('some unrelated words', { document_type: 'payment_proof' });
  assert.strictEqual(r.document_type, 'payment_proof');
  assert.strictEqual(r.detection.from, 'declared_type');
  // a declared type must not manufacture confidence
  assert.notStrictEqual(r.confidence, 'high');
});

t('never returns a field outside the stable shape', () => {
  const r = X.extractFromText(FAKTUR_TEXT, {});
  for (const k of Object.keys(r.fields)) assert.ok(k in X.EMPTY_FIELDS, `unexpected field ${k}`);
});

// ── 12. duplicate detection ────────────────────────────────────────────────
t('12. a repeated bank reference is detected as a duplicate', () => {
  const proof = X.extractFromText(BCA_TEXT, { document_type: 'payment_proof' }).fields;
  assert.strictEqual(X.findDuplicateDocument(proof, []).duplicate, false);
  const again = X.findDuplicateDocument(proof, [proof]);
  assert.strictEqual(again.duplicate, true);
  assert.ok(/already recorded/i.test(again.reason));
});

t('same reference but a different amount is not silently called a duplicate', () => {
  const proof = X.extractFromText(BCA_TEXT, { document_type: 'payment_proof' }).fields;
  const other = { ...proof, amount: 1 };
  assert.strictEqual(X.findDuplicateDocument(proof, [other]).duplicate, false);
});

t('no reference means duplicates cannot be claimed', () => {
  const r = X.findDuplicateDocument({ amount: 1 }, [{ amount: 1 }]);
  assert.strictEqual(r.duplicate, false);
  assert.ok(/cannot be detected automatically/i.test(r.reason));
});

console.log(`\n${pass} passed`);
