// AI Accountant Phase 2 — CONTENT-based classification.
//
// The point of Phase 2: a document named `scan.pdf` must still be identified from what it
// says. These tests pin the Indonesian markers, the confidence model, the filename/content
// conflict rule, and the guarantee that no document text is exposed.
//
//   Run: node --test tests/integration/documentContent.test.js
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const dc = require('../../server/lib/documentContent');
const { extractPdfText } = require('../../server/lib/pdfText');

const pdf = (name, text, extra = {}) => dc.classifyDocument({
  file_name: name, mime_type: 'application/pdf', text,
  text_available: !!text, method: text ? 'pdf_text' : 'filename_only', ...extra,
});

// ── the owner's real case: a generic file name, a real document ──────────────
test('SK Kemenkumham is identified from content alone, whatever the file name', () => {
  const text = 'KEPUTUSAN MENTERI HUKUM REPUBLIK INDONESIA NOMOR AHU-0012345.AH.01.01.TAHUN 2024 ' +
    'TENTANG PENGESAHAN PENDIRIAN BADAN HUKUM PERSEROAN TERBATAS PT HELM CARE INDONESIA';
  for (const name of ['scan.pdf', 'document.pdf', 'WhatsApp Image 2026-08-18.pdf']) {
    const r = pdf(name, text);
    assert.strictEqual(r.doc_type, 'sk_kemenkumham', name);
    assert.strictEqual(r.confidence, 'high', name);
    assert.strictEqual(r.classification_status, 'auto_classified', name);
    assert.ok(r.signals.strong_matches.includes('KEPUTUSAN MENTERI HUKUM'));
    assert.ok(r.signals.strong_matches.includes('PENGESAHAN PENDIRIAN BADAN HUKUM'));
  }
});

test('the explanation names the markers, not the document text', () => {
  const r = pdf('scan.pdf', 'KEPUTUSAN MENTERI HUKUM PENGESAHAN PENDIRIAN BADAN HUKUM PT SECRET NAME');
  const why = dc.explain(r);
  assert.match(why, /KEPUTUSAN MENTERI HUKUM/);
  assert.ok(!why.includes('PT SECRET NAME'), 'must not quote document content');
});

// ── the required Indonesian rules ────────────────────────────────────────────
test('Akta is identified from AKTA PENDIRIAN + NOTARIS', () => {
  const r = pdf('doc.pdf', 'AKTA PENDIRIAN PERSEROAN TERBATAS Nomor 12 dibuat di hadapan NOTARIS di Jakarta');
  assert.strictEqual(r.doc_type, 'akta');
  assert.strictEqual(r.confidence, 'high');
});

test('NPWP is identified from Nomor Pokok Wajib Pajak / NPWP / number format', () => {
  const r = pdf('scan.pdf', 'NOMOR POKOK WAJIB PAJAK NPWP 01.234.567.8-901.000 DIREKTORAT JENDERAL PAJAK');
  assert.strictEqual(r.doc_type, 'npwp');
  assert.strictEqual(r.confidence, 'high');
  assert.ok(r.signals.strong_matches.includes('NPWP number format'));
});

test('NIB is identified from Nomor Induk Berusaha / OSS language', () => {
  const r = pdf('scan.pdf', 'NOMOR INDUK BERUSAHA NIB 91234567890 Lembaga OSS KBLI perizinan berusaha berbasis risiko');
  assert.strictEqual(r.doc_type, 'nib');
  assert.strictEqual(r.confidence, 'high');
});

test('PKP certificate is identified from Pengusaha Kena Pajak / SPPKP', () => {
  const r = pdf('scan.pdf', 'SURAT PENGUKUHAN PENGUSAHA KENA PAJAK SPPKP');
  assert.strictEqual(r.doc_type, 'pkp_certificate');
  assert.strictEqual(r.confidence, 'high');
});

test('KPP registration, BPJS, payroll and bank statement are identified from content', () => {
  for (const [text, expected] of [
    ['KANTOR PELAYANAN PAJAK SURAT KETERANGAN TERDAFTAR KPP Pratama', 'kpp_registration'],
    ['BPJS KETENAGAKERJAAN dan BPJS KESEHATAN jaminan sosial', 'bpjs_document'],
    ['SLIP GAJI karyawan DAFTAR GAJI net pay tunjangan', 'payroll_document'],
    ['REKENING KORAN MUTASI REKENING saldo awal saldo akhir', 'bank_statement'],
  ]) {
    const r = pdf('scan.pdf', text);
    assert.strictEqual(r.doc_type, expected, text.slice(0, 30));
    assert.strictEqual(r.confidence, 'high', text.slice(0, 30));
  }
});

// ── confidence model ─────────────────────────────────────────────────────────
test('a single strong marker without filename support is medium → needs_review', () => {
  const r = pdf('scan.pdf', 'dokumen ini menyebut NOTARIS satu kali saja tanpa penanda lain');
  assert.strictEqual(r.doc_type, 'akta');
  assert.strictEqual(r.confidence, 'medium');
  assert.strictEqual(r.classification_status, 'needs_review');
});

test('a single strong marker corroborated by the file name reaches high', () => {
  const r = pdf('akta.pdf', 'dokumen ini menyebut NOTARIS satu kali saja tanpa penanda lain');
  assert.strictEqual(r.doc_type, 'akta');
  assert.strictEqual(r.confidence, 'high');
  assert.strictEqual(r.matched_on, 'content_and_file_name');
});

test('only weak wording is low confidence → needs_review', () => {
  const r = pdf('scan.pdf', 'dokumen menyebut perseroan terbatas dan republik indonesia');
  assert.ok(['low', 'medium'].includes(r.confidence));
  assert.strictEqual(r.classification_status, 'needs_review');
});

test('generic text with no marker is unknown → needs_review', () => {
  const r = pdf('scan.pdf', 'halaman ini hanya berisi teks umum tanpa penanda dokumen apa pun');
  assert.strictEqual(r.doc_type, 'unknown');
  assert.strictEqual(r.confidence, 'unknown');
  assert.strictEqual(r.classification_status, 'needs_review');
});

test('no confidence value ever claims certainty', () => {
  for (const text of ['KEPUTUSAN MENTERI HUKUM PENGESAHAN PENDIRIAN BADAN HUKUM', 'nothing here', '']) {
    const r = pdf('scan.pdf', text);
    assert.ok(['high', 'medium', 'low', 'unknown'].includes(r.confidence), r.confidence);
    assert.ok(!/100|certain|valid|official/i.test(JSON.stringify(r.confidence)));
  }
});

// ── conflict: file name says one thing, content says another ─────────────────
test('content wins over a conflicting file name, but never silently', () => {
  const r = pdf('NPWP_perusahaan.pdf',
    'KEPUTUSAN MENTERI HUKUM REPUBLIK INDONESIA PENGESAHAN PENDIRIAN BADAN HUKUM PERSEROAN TERBATAS');
  assert.strictEqual(r.doc_type, 'sk_kemenkumham', 'content must win');
  assert.strictEqual(r.classification_status, 'needs_review', 'a conflict must be reviewed');
  assert.strictEqual(r.confidence, 'medium');
  assert.deepStrictEqual(r.signals.conflict, { file_name_suggests: 'npwp', content_suggests: 'sk_kemenkumham' });
  assert.match(dc.explain(r), /file name suggests a different type/i);
});

// ── no text available → Phase 1 behaviour, unchanged ─────────────────────────
test('a scanned document with no embedded text degrades to the file-name verdict', () => {
  const r = dc.classifyDocument({ file_name: 'NPWP_test_company.pdf', mime_type: 'application/pdf',
    text: '', text_available: false, extraction_reason: 'no_embedded_text' });
  assert.strictEqual(r.doc_type, 'npwp');
  assert.strictEqual(r.extraction.text_available, false);
  assert.strictEqual(r.extraction.method, 'filename_only');
  assert.strictEqual(r.extraction.reason, 'no_embedded_text');
});

test('a readable document whose text says nothing downgrades a filename-only verdict', () => {
  const r = pdf('NPWP_test_company.pdf', 'teks umum yang tidak menyebut penanda dokumen sama sekali');
  assert.strictEqual(r.doc_type, 'npwp');
  assert.strictEqual(r.confidence, 'medium', 'the content did not corroborate the file name');
  assert.strictEqual(r.classification_status, 'needs_review');
});

// ── privacy ──────────────────────────────────────────────────────────────────
test('the stored sample is short and masks long digit runs', () => {
  const secret = 'RAHASIA nomor 9876543210123 ' + 'x'.repeat(500);
  const r = pdf('scan.pdf', 'NPWP ' + secret);
  assert.ok(r.extraction.text_sample_safe.length <= 160);
  assert.ok(!r.extraction.text_sample_safe.includes('9876543210123'), 'long digit runs must be masked');
});

test('signals carry marker labels, never raw document text', () => {
  const r = pdf('scan.pdf', 'KEPUTUSAN MENTERI HUKUM PENGESAHAN PENDIRIAN BADAN HUKUM RAHASIA-INTERNAL-XYZ');
  assert.ok(!JSON.stringify(r.signals).includes('RAHASIA-INTERNAL-XYZ'));
});

// ── PDF text extraction ──────────────────────────────────────────────────────
// A minimal but real PDF: one Flate-compressed content stream with a Tj operator.
function makePdf(text) {
  const content = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`);
  const z = zlib.deflateSync(content);
  const head = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + z.length + ' /Filter /FlateDecode >>\nstream\n');
  const tail = Buffer.from('\nendstream\nendobj\n%%EOF\n');
  return Buffer.concat([head, z, tail]);
}

test('embedded PDF text is extracted', () => {
  const r = extractPdfText(makePdf('KEPUTUSAN MENTERI HUKUM PENGESAHAN PENDIRIAN BADAN HUKUM'));
  assert.strictEqual(r.text_available, true);
  assert.match(r.text, /KEPUTUSAN MENTERI HUKUM/);
  assert.strictEqual(r.method, 'pdf_text');
});

test('extraction of a PDF end to end classifies correctly', () => {
  const ex = extractPdfText(makePdf('KEPUTUSAN MENTERI HUKUM REPUBLIK INDONESIA PENGESAHAN PENDIRIAN BADAN HUKUM'));
  const r = dc.classifyDocument({ file_name: 'scan.pdf', mime_type: 'application/pdf',
    text: ex.text, text_available: ex.text_available, method: ex.method });
  assert.strictEqual(r.doc_type, 'sk_kemenkumham');
  assert.strictEqual(r.confidence, 'high');
});

test('non-PDF, empty and garbage inputs fail closed', () => {
  for (const [buf, reason] of [
    [Buffer.from(''), 'empty_file'],
    [Buffer.from('this is a plain text file, not a pdf'), 'not_a_pdf'],
    [Buffer.from('%PDF-1.4\nno streams here at all\n%%EOF'), 'no_embedded_text'],
  ]) {
    const r = extractPdfText(buf);
    assert.strictEqual(r.text_available, false);
    assert.strictEqual(r.reason, reason);
    assert.strictEqual(r.text, '');
  }
  assert.strictEqual(extractPdfText(null).text_available, false);
});

test('a scanned-image PDF yields no text rather than garbage', () => {
  // An image XObject stream must be skipped, not decoded as text.
  const img = zlib.deflateSync(Buffer.from('\x00\x01\x02binary-pixels'));
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Filter /FlateDecode /Length ' + img.length + ' >>\nstream\n'),
    img, Buffer.from('\nendstream\nendobj\n%%EOF\n')]);
  const r = extractPdfText(buf);
  assert.strictEqual(r.text_available, false);
});
