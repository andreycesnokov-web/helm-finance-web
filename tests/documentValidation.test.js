// Unit tests for the Tax Documents validation helpers.
// Run: node tests/documentValidation.test.js
const V = require('../server/lib/documentValidation');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { console.log(`OK  ${name}`); pass++; } else { console.log(`XX  ${name}`); fail++; } };
const eq = (name, got, exp) => ok(`${name} -> ${got}`, got === exp);

// ── safeFilename: path traversal + normalization ────────────────────────────
eq('strip dir component', V.safeFilename('a/b/c/invoice.pdf'), 'invoice.pdf');
eq('strip windows path', V.safeFilename('C:\\Users\\x\\bill.PDF'), 'bill.PDF');
eq('block ../ traversal', V.safeFilename('../../etc/passwd'), 'passwd');
eq('leading dots removed', V.safeFilename('...hidden.png'), 'hidden.png');
eq('collapse unsafe chars', V.safeFilename('my inv #12!.pdf'), 'my_inv_12_.pdf');
eq('empty -> file', V.safeFilename(''), 'file');
ok('long name truncated', V.safeFilename('x'.repeat(300) + '.pdf').length <= 120);

// ── validateUpload ──────────────────────────────────────────────────────────
const base = { file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 1000, document_type: 'vendor_invoice' };
ok('valid pdf', V.validateUpload(base).ok);
ok('valid png', V.validateUpload({ ...base, file_name: 'a.png', mime_type: 'image/png' }).ok);
ok('valid xlsx', V.validateUpload({ ...base, file_name: 'a.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).ok);
ok('null document_type allowed', V.validateUpload({ ...base, document_type: null }).ok);
eq('oversized rejected', V.validateUpload({ ...base, file_size: V.MAX_FILE_BYTES + 1 }).error, 'file_too_large');
eq('bad mime rejected', V.validateUpload({ ...base, file_name: 'a.exe', mime_type: 'application/x-msdownload' }).error, 'extension_not_allowed');
eq('mime mismatch rejected', V.validateUpload({ ...base, mime_type: 'application/zip' }).error, 'mime_not_allowed');
eq('no extension rejected', V.validateUpload({ ...base, file_name: 'noext' }).error, 'invalid_filename');
eq('zero size rejected', V.validateUpload({ ...base, file_size: 0 }).error, 'invalid_size');
eq('bad doc type rejected', V.validateUpload({ ...base, document_type: 'receipt' }).error, 'invalid_document_type');

// ── buildStoragePath: business-scoped, never bare name ──────────────────────
ok('path carries business + doc id', V.buildStoragePath('biz-1', 'doc-9', 'My Bill.pdf') === 'businesses/biz-1/documents/doc-9/My_Bill.pdf');
ok('path safe against traversal', !V.buildStoragePath('biz-1', 'doc-9', '../../x.pdf').includes('..'));

// ── sameBusinessLink: 3-way isolation ───────────────────────────────────────
ok('same business link ok', V.sameBusinessLink('A', 'A', 'A'));
ok('doc other business rejected', !V.sameBusinessLink('A', 'B', 'A'));
ok('target other business rejected', !V.sameBusinessLink('A', 'A', 'B'));
ok('null active rejected', !V.sameBusinessLink(null, null, null));

// ── sha256 shape ────────────────────────────────────────────────────────────
ok('valid sha accepted', V.isValidSha256('a'.repeat(64)));
ok('short sha rejected', !V.isValidSha256('abc'));
ok('non-hex sha rejected', !V.isValidSha256('z'.repeat(64)));

// ── link target registry ────────────────────────────────────────────────────
ok('debt target maps to debts ledger', V.LINK_TARGETS.debt.ledger === 'debts');
ok('transaction target maps to transactions', V.LINK_TARGETS.transaction.ledger === 'transactions');
ok('unknown target undefined', V.LINK_TARGETS.invoice === undefined);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
