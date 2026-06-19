// Guards the V1 invariant: document operations are evidence-only and can NEVER
// move cash. This asserts the runtime surface contains no ledger-mutating calls
// inside the document endpoints. Run: node tests/documentsNoCashImpact.test.js
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

// Isolate the documents runtime block.
const start = src.indexOf('TAX DOCUMENTS RUNTIME V1');
ok('documents runtime block present', start > -1);
const block = src.slice(start);

// The block must never write to the cash/ledger tables.
const FORBIDDEN = [
  /from\('transactions'\)\s*\.insert/, /from\('transactions'\)\s*\.update/, /from\('transactions'\)\s*\.delete/,
  /from\('wallets'\)\s*\.insert/, /from\('wallets'\)\s*\.update/,
  /from\('debts'\)\s*\.insert/, /from\('debts'\)\s*\.update/, /from\('debts'\)\s*\.delete/,
  /from\('debt_settlement_allocations'\)/, /from\('tax_deposit_allocations'\)/,
  /from\('intercompany_funding_records'\)/,
];
for (const re of FORBIDDEN) ok('no ledger mutation: ' + re.source.slice(0, 38), !re.test(block));

// The block reads the ledger only to verify business ownership for links.
ok('reads debts only via .select (ownership check)', !/from\('debts'\)\s*\.(insert|update|delete)/.test(block));

// Archive is a soft-delete (sets archived_at), never a hard DELETE of evidence.
ok('archive sets archived_at', /archived_at:\s*new Date/.test(block));
ok('no hard delete of financial_documents via endpoint', !/from\('financial_documents'\)\s*\.delete\(\)/.test(block) || /document_insert_failed/.test(block));

// Hardening: server-side hash verification (download + compute), storage gate,
// and the stored hash is the VERIFIED one (never the client-claimed value).
ok('downloads stored object for verification', /storage\.from\(DOC_BUCKET\)\.download\(/.test(block));
ok('computes server-side sha256', /crypto\.createHash\('sha256'\)/.test(block));
ok('stores verified hash, not client hash', /sha256_hash:\s*verifiedHash/.test(block) && !/sha256_hash:\s*b\.sha256/.test(block));
ok('rejects client/server hash mismatch', /hash_mismatch/.test(block));
ok('storage readiness gate on upload/signed-url', (block.match(/blockIfStorageNotReady\(res\)/g) || []).length >= 3);
ok('health endpoint reports degraded config', /getDocumentsHealth/.test(block) && /audit_table_missing/.test(block));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
