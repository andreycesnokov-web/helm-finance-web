// Phase 2 hardening — extraction MUST fail closed and MUST NOT be a DoS vector.
//
// The extractor inflates attacker-supplied streams. Three independent bounds (per stream,
// cumulative, expansion ratio) plus a wall-clock guard; breaching any of them aborts the whole
// extraction with text_available:false so classification degrades to the file name and the
// UPLOAD still succeeds.
//
//   Run: node --test tests/integration/documentContentSafety.test.js
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { extractPdfText } = require('../../server/lib/pdfText');
const dc = require('../../server/lib/documentContent');

const stream = (payload, dict = '/Filter /FlateDecode') =>
  Buffer.concat([Buffer.from(`\n1 0 obj\n<< ${dict} /Length ${payload.length} >>\nstream\n`),
    payload, Buffer.from('\nendstream\nendobj\n')]);
const wrap = (...parts) => Buffer.concat([Buffer.from('%PDF-1.4'), ...parts, Buffer.from('\n%%EOF\n')]);
const textStream = (t) => stream(zlib.deflateSync(Buffer.from(`BT /F1 12 Tf 72 720 Td (${t}) Tj ET`)));

test('a compression bomb in ONE stream is refused, fail closed', () => {
  // ~40 MB of zeros compresses to a few KB — far past the 4 MB per-stream cap.
  const bomb = zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024));
  assert.ok(bomb.length < 200 * 1024, 'the bomb must actually be small on disk');
  const t0 = Date.now();
  const r = extractPdfText(wrap(stream(bomb)));
  assert.strictEqual(r.text_available, false);
  assert.strictEqual(r.reason, 'decompression_limit_exceeded');
  assert.strictEqual(r.text, '');
  assert.ok(Date.now() - t0 < 2000, 'must abort quickly, not inflate 40 MB');
});

test('many medium streams that together exceed the cumulative cap are refused', () => {
  // Each under the per-stream cap; together far past the 24 MB total.
  const chunk = zlib.deflateSync(Buffer.alloc(3 * 1024 * 1024));
  const parts = Array.from({ length: 20 }, () => stream(chunk));
  const r = extractPdfText(wrap(...parts));
  assert.strictEqual(r.text_available, false);
  assert.strictEqual(r.reason, 'decompression_limit_exceeded');
});

test('a high expansion ratio from a tiny stream is refused', () => {
  // A few hundred bytes expanding to megabytes exceeds MAX_INFLATE_RATIO.
  const tiny = zlib.deflateSync(Buffer.alloc(8 * 1024 * 1024));
  const r = extractPdfText(wrap(stream(tiny)));
  assert.strictEqual(r.text_available, false);
  assert.strictEqual(r.reason, 'decompression_limit_exceeded');
});

test('an uncompressed stream larger than the per-stream cap is refused', () => {
  const big = Buffer.alloc(5 * 1024 * 1024, 0x41);
  const r = extractPdfText(wrap(stream(big, '')));
  assert.strictEqual(r.text_available, false);
  assert.strictEqual(r.reason, 'decompression_limit_exceeded');
});

test('a malformed Flate stream is skipped, not fatal', () => {
  const bad = Buffer.from('this is not zlib data at all, not even close');
  const r = extractPdfText(wrap(stream(bad), textStream('KEPUTUSAN MENTERI HUKUM PENGESAHAN PENDIRIAN BADAN HUKUM')));
  assert.strictEqual(r.text_available, true, 'a broken stream must not lose the good one');
  assert.match(r.text, /KEPUTUSAN MENTERI HUKUM/);
});

test('a normal Flate PDF still extracts after the caps were added', () => {
  const r = extractPdfText(wrap(textStream('NOMOR INDUK BERUSAHA NIB perizinan berusaha berbasis risiko')));
  assert.strictEqual(r.text_available, true);
  assert.match(r.text, /NOMOR INDUK BERUSAHA/);
});

test('a refused extraction degrades to the file-name verdict, never to an error', () => {
  const bomb = zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024));
  const ex = extractPdfText(wrap(stream(bomb)));
  const r = dc.classifyDocument({ file_name: 'NPWP_test_company.pdf', mime_type: 'application/pdf',
    text: ex.text, text_available: ex.text_available, method: ex.method, extraction_reason: ex.reason });
  assert.strictEqual(r.doc_type, 'npwp', 'Phase 1 still classifies');
  assert.strictEqual(r.extraction.text_available, false);
  assert.strictEqual(r.extraction.method, 'filename_only');
  assert.strictEqual(r.extraction.reason, 'decompression_limit_exceeded');
});

test('extraction never returns document text on any failure path', () => {
  for (const buf of [null, Buffer.alloc(0), Buffer.from('not a pdf'),
                     wrap(stream(zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024))))]) {
    const r = extractPdfText(buf);
    if (!r.text_available) assert.strictEqual(r.text, '');
  }
});
