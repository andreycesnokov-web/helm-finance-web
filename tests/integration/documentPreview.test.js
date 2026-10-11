// Document Intake preview affordances.
//
// The user is asked to confirm the type of a row called `6.PDF`. They cannot answer that
// without seeing the file, so every row offers to open it — but the label must tell the truth:
// a browser renders a PDF or an image in a tab, and does not render a spreadsheet.
//
//   Run: node --test tests/integration/documentPreview.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'documentPreview.js')).href;
let P;
test.before(async () => { P = await import(MOD); });

// The owner's real intake list.
const REAL_ROWS = [
  { file_name: '6.PDF', mime_type: 'application/pdf' },
  { file_name: 'cetak_sp_2026.pdf', mime_type: 'application/pdf' },
  { file_name: 'symbol_white_on_navy_1024.png', mime_type: 'image/png' },
  { file_name: 'Helm-Care_2026.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
];

test('PDFs and images open inline; a spreadsheet is offered as a download', () => {
  assert.strictEqual(P.previewModeFor(REAL_ROWS[0]), 'view', '6.PDF');
  assert.strictEqual(P.previewModeFor(REAL_ROWS[1]), 'view');
  assert.strictEqual(P.previewModeFor(REAL_ROWS[2]), 'view', 'png');
  assert.strictEqual(P.previewModeFor(REAL_ROWS[3]), 'download', 'xlsx cannot render in a tab');
});

test('the action label never promises a preview it cannot deliver', () => {
  assert.strictEqual(P.previewActionLabel(REAL_ROWS[0]), 'View');
  assert.strictEqual(P.previewActionLabel(REAL_ROWS[3]), 'Open / download');
  // Every row gets SOME action — the user is never stuck with an unopenable file.
  for (const r of REAL_ROWS) assert.ok(P.previewActionLabel(r).length > 0);
});

test('a generic MIME falls back to the file extension before giving up', () => {
  assert.strictEqual(P.previewModeFor({ file_name: 'scan.pdf', mime_type: 'application/octet-stream' }), 'view');
  assert.strictEqual(P.previewModeFor({ file_name: 'scan.pdf', mime_type: '' }), 'view');
  assert.strictEqual(P.previewModeFor({ file_name: 'photo.JPG', mime_type: null }), 'view');
  assert.strictEqual(P.previewModeFor({ file_name: 'book.xlsx', mime_type: '' }), 'download');
});

test('unknown, empty and malformed inputs degrade to download, never to a broken tab', () => {
  for (const input of [{}, { file_name: '' }, { file_name: 'noext' }, { mime_type: 'application/zip' },
                       { file_name: null, mime_type: null }, undefined])
    assert.strictEqual(P.previewModeFor(input), 'download', JSON.stringify(input));
});

test('file size is human-readable, and unknown sizes are null rather than a fake 0 B', () => {
  assert.strictEqual(P.formatFileSize(512), '512 B');
  assert.strictEqual(P.formatFileSize(2048), '2 KB');
  assert.strictEqual(P.formatFileSize(5 * 1024 * 1024), '5.0 MB');
  assert.strictEqual(P.formatFileSize(0), '0 B');
  for (const bad of [null, undefined, 'abc', NaN, -1])
    assert.strictEqual(P.formatFileSize(bad), null, String(bad));
});

test('upload date is formatted, and an invalid date is null rather than "Invalid Date"', () => {
  assert.match(P.formatUploadedAt('2026-08-19T10:00:00Z'), /19 Aug 2026/);
  for (const bad of [null, undefined, '', 'not-a-date'])
    assert.strictEqual(P.formatUploadedAt(bad), null, String(bad));
});

test('the file kind tag comes from the extension, then the MIME type', () => {
  assert.strictEqual(P.fileKindLabel({ file_name: '6.PDF' }), 'PDF');
  assert.strictEqual(P.fileKindLabel({ file_name: 'Helm-Care_2026.xlsx' }), 'XLSX');
  assert.strictEqual(P.fileKindLabel({ file_name: 'noext', mime_type: 'application/pdf' }), 'PDF');
  assert.strictEqual(P.fileKindLabel({}), null);
});

// ── source guards: the UI must use the audited path, not raw internals ──────
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src',
  'pages', 'business', 'Accountant.jsx'), 'utf8');
const MODAL = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src',
  'components', 'ArchiveDocumentModal.jsx'), 'utf8');

test('the intake row opens files through the audited signed-URL endpoint only', () => {
  assert.match(PAGE, /getSignedUrl\(token, d\.id/, 'must use the signed-URL helper');
  assert.ok(!/storage_path/.test(PAGE), 'the storage path must never reach the page');
  assert.match(PAGE, /noopener/, 'a new tab must not get a handle on this one');
});

test('archive uses the existing soft-archive endpoint and never a delete', () => {
  assert.match(PAGE, /\/documents\/\$\{d\.id\}\/archive/);
  assert.ok(!/method: 'DELETE'/.test(PAGE), 'no hard delete from the intake UI');
  assert.ok(!/hard_delete/.test(PAGE + MODAL));
});

test('the archive modal states that the file is kept, and warns on a confirmed document', () => {
  assert.match(MODAL, /Archive document\?/);
  assert.match(MODAL, /removes the document from the AI Accountant checklist and intake/i);
  assert.match(MODAL, /kept for audit and history/i);
  assert.match(MODAL, /may make the checklist item missing again/i);
  // A confirmed compliance document requires the exact file name.
  assert.match(MODAL, /typed\.trim\(\) === fileName/);
});

test('archiving and confirming both refresh the checklist and the Workbench', () => {
  // One reload covers intake + checklist + readiness; the callback covers the Workbench.
  const archiveFn = PAGE.slice(PAGE.indexOf('const archiveDocument'), PAGE.indexOf('const set = (k, v)'));
  assert.match(archiveFn, /loadIntake\(\)/);
  assert.match(archiveFn, /onDocumentsChanged/);
  const confirmFn = PAGE.slice(PAGE.indexOf('const confirmType'), PAGE.indexOf('// Re-read an existing'));
  assert.match(confirmFn, /loadIntake\(\)/);
  assert.match(confirmFn, /onDocumentsChanged/);
});
