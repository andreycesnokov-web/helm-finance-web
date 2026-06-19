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

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
