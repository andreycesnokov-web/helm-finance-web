// Test bank reconciliation difference handling and readiness validation in accounting.js
// Run: node tests/bankReconciliationDifference.test.mjs
import assert from 'node:assert';
import { closeReadiness, packageExportData } from '../client/src/v2/lib/accounting.js';

let pass = 0;
let fail = 0;
const ok = (msg, cond) => {
  if (cond) {
    console.log('OK  ' + msg);
    pass++;
  } else {
    console.error('FAIL ' + msg);
    fail++;
  }
};

const month = '2026-09';
const wallets = [
  { id: 'w-bca', name: 'BCA Operasional', currency: 'IDR', type: 'bank', is_active: true },
  { id: 'w-cash', name: 'Kas Kecil (Cash)', currency: 'IDR', type: 'cash', is_active: true },
];

const transactions = [
  { id: 1, transaction_date: '2026-09-10', category: 'Operations', amount_original: 1000 },
];
const debts = [
  { id: 10, due_date: '2026-09-15', counterparty: 'Supplier X', amount: 500, attachment_url: 'https://storage/doc.pdf' },
];

// 1. Non-zero difference leaves reconciliation unconfirmed (status unbalanced, diff = 5000)
{
  const batches = [
    {
      id: 'b-1',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 5000,
      reconciliation_status: 'unbalanced',
    },
  ];

  const r = closeReadiness({ month, transactions, debts, batches, wallets });
  const stmt = r.checks.find((c) => c.key === 'statements');
  const recon = r.checks.find((c) => c.key === 'reconciliation');

  ok('Non-zero difference: statements uploaded is true', stmt.done === true);
  ok('Non-zero difference: reconciliation check is false (unconfirmed)', recon.done === false);
  ok('Non-zero difference: reconciled banks count is 0', r.banks.reconciled === 0);
  ok('Non-zero difference: BCA Operasional listed in missing reconciliation', recon.missing.includes('BCA Operasional'));
}

// 2. Zero difference confirms reconciliation (status balanced, diff = 0)
{
  const batches = [
    {
      id: 'b-2',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0,
      reconciliation_status: 'balanced',
    },
  ];

  const r = closeReadiness({ month, transactions, debts, batches, wallets });
  const stmt = r.checks.find((c) => c.key === 'statements');
  const recon = r.checks.find((c) => c.key === 'reconciliation');

  ok('Zero difference: statements uploaded is true', stmt.done === true);
  ok('Zero difference: reconciliation check is true', recon.done === true);
  ok('Zero difference: reconciled banks count is 1', r.banks.reconciled === 1);
  ok('Zero difference: missing reconciliation is empty', recon.missing.length === 0);
  ok('Zero difference: automated_checks_passed is true', r.automated_checks_passed === true);
  ok('Zero difference: is_closed remains false without accountant sign-off', r.is_closed === false);
}

// 3. Nested reconciliation object with non-zero difference leaves reconciliation unconfirmed
{
  const batches = [
    {
      id: 'b-3',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      reconciliation: {
        difference: -250,
        status: 'unbalanced',
      },
    },
  ];

  const r = closeReadiness({ month, transactions, debts, batches, wallets });
  const recon = r.checks.find((c) => c.key === 'reconciliation');

  ok('Nested non-zero difference: reconciliation check is false', recon.done === false);
  ok('Nested non-zero difference: reconciled banks count is 0', r.banks.reconciled === 0);
}

// 4. Nested bank_reconciliations array with non-zero difference leaves reconciliation unconfirmed
{
  const batches = [
    {
      id: 'b-4',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      bank_reconciliations: [
        { difference: 120, status: 'unbalanced' },
      ],
    },
  ];

  const r = closeReadiness({ month, transactions, debts, batches, wallets });
  const recon = r.checks.find((c) => c.key === 'reconciliation');

  ok('bank_reconciliations array non-zero difference: reconciliation check is false', recon.done === false);
}

// 5. Difference is NaN or null/missing leaves reconciliation unconfirmed
{
  const batchesNaN = [
    {
      id: 'b-nan',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: NaN,
      reconciliation_status: 'balanced',
    },
  ];
  const rNaN = closeReadiness({ month, transactions, debts, batches: batchesNaN, wallets });
  ok('NaN difference: reconciliation check is false', rNaN.checks.find((c) => c.key === 'reconciliation').done === false);

  const batchesMissing = [
    {
      id: 'b-missing-diff',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: null,
      reconciliation_status: 'balanced',
    },
  ];
  const rMissing = closeReadiness({ month, transactions, debts, batches: batchesMissing, wallets });
  ok('Missing difference: reconciliation check is false', rMissing.checks.find((c) => c.key === 'reconciliation').done === false);
}

// 6. Closing balance is non-finite or missing leaves reconciliation unconfirmed
{
  const batchesNoBal = [
    {
      id: 'b-nobal',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: null,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0,
      reconciliation_status: 'balanced',
    },
  ];
  const rNoBal = closeReadiness({ month, transactions, debts, batches: batchesNoBal, wallets });
  ok('Null closing balance: reconciliation check is false', rNoBal.checks.find((c) => c.key === 'reconciliation').done === false);

  const batchesNaNBal = [
    {
      id: 'b-nanbal',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: NaN,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0,
      reconciliation_status: 'balanced',
    },
  ];
  const rNaNBal = closeReadiness({ month, transactions, debts, batches: batchesNaNBal, wallets });
  ok('NaN closing balance: reconciliation check is false', rNaNBal.checks.find((c) => c.key === 'reconciliation').done === false);
}

// 7. Statement coverage: partial month does NOT confirm statements or reconciliation
{
  const batchesPartial = [
    {
      id: 'b-partial',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-10', // starts late!
      statement_end: '2026-09-30',
      difference: 0,
      reconciliation_status: 'balanced',
    },
  ];
  const rPartial = closeReadiness({ month, transactions, debts, batches: batchesPartial, wallets });
  ok('Partial start date: statements is false', rPartial.checks.find((c) => c.key === 'statements').done === false);
  ok('Partial start date: reconciliation is false', rPartial.checks.find((c) => c.key === 'reconciliation').done === false);

  const batchesEarlyEnd = [
    {
      id: 'b-early-end',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-20', // ends early!
      difference: 0,
      reconciliation_status: 'balanced',
    },
  ];
  const rEarlyEnd = closeReadiness({ month, transactions, debts, batches: batchesEarlyEnd, wallets });
  ok('Partial end date: statements is false', rEarlyEnd.checks.find((c) => c.key === 'statements').done === false);
  ok('Partial end date: reconciliation is false', rEarlyEnd.checks.find((c) => c.key === 'reconciliation').done === false);
}

// 8. Currency precision tolerance
{
  const usdWallets = [
    { id: 'w-usd', name: 'Wise USD', currency: 'USD', type: 'bank', is_active: true },
  ];
  // 0.05 discrepancy on USD is >= 0.01 tolerance -> unconfirmed
  const batchesUsdFail = [
    {
      id: 'b-usd-1',
      wallet_id: 'w-usd',
      currency: 'USD',
      status: 'imported',
      closing_balance: 2000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0.05,
      reconciliation_status: 'balanced',
    },
  ];
  const rUsdFail = closeReadiness({ month, transactions, debts, batches: batchesUsdFail, wallets: usdWallets });
  ok('USD 0.05 difference exceeds 0.01 tolerance: reconciliation is false', rUsdFail.checks.find((c) => c.key === 'reconciliation').done === false);

  // 0.005 discrepancy on USD is < 0.01 tolerance -> confirmed
  const batchesUsdPass = [
    {
      id: 'b-usd-2',
      wallet_id: 'w-usd',
      currency: 'USD',
      status: 'imported',
      closing_balance: 2000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0.004,
      reconciliation_status: 'balanced',
    },
  ];
  const rUsdPass = closeReadiness({ month, transactions, debts, batches: batchesUsdPass, wallets: usdWallets });
  ok('USD 0.004 difference within 0.01 tolerance: reconciliation is true', rUsdPass.checks.find((c) => c.key === 'reconciliation').done === true);
}

// 9. Unreviewed / unconfirmed reconciliation status leaves reconciliation unconfirmed
{
  const batchesUnreviewed = [
    {
      id: 'b-unreviewed',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0,
      reconciliation_status: 'review_required', // Not confirmed!
    },
  ];
  const rUnreviewed = closeReadiness({ month, transactions, debts, batches: batchesUnreviewed, wallets });
  ok('Unreviewed status: reconciliation check is false', rUnreviewed.checks.find((c) => c.key === 'reconciliation').done === false);
}

// 10. Separation of completeness (percent) and month close (is_closed)
{
  // Record completeness is 100% (tx categorized, debt documented), but NO bank statements or reconciliation
  const rNoBank = closeReadiness({ month, transactions, debts, batches: [], wallets });
  ok('100% completeness without bank recon: percent is 100', rNoBank.percent === 100);
  ok('100% completeness without bank recon: is_closed MUST be false', rNoBank.is_closed === false);

  const expNoBank = packageExportData({ month, transactions, debts, batches: [], wallets });
  ok('packageExportData reflects is_closed: false when checks are incomplete', expNoBank.readiness.is_closed === false);

  // When all checks are done and percent is 100%
  const validBatch = [
    {
      id: 'b-valid',
      wallet_id: 'w-bca',
      status: 'imported',
      closing_balance: 50000,
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      difference: 0,
      reconciliation_status: 'balanced',
    },
  ];
  // Case A: All automated checks pass (percent 100, statements & recon ok)
  // Hard rule: Without explicit accountant confirmation, is_closed MUST be false,
  // automated_checks_passed MUST be true, status MUST be 'prepared_for_review'.
  const rAllDone = closeReadiness({ month, transactions, debts, batches: validBatch, wallets });
  ok('All automated checks done: automated_checks_passed is true', rAllDone.automated_checks_passed === true);
  ok('Without accountant signoff: is_closed MUST remain false', rAllDone.is_closed === false);
  ok('Status reflects prepared_for_review', rAllDone.status === 'prepared_for_review');

  const expAllDone = packageExportData({ month, transactions, debts, batches: validBatch, wallets });
  ok('packageExportData reflects is_closed: false', expAllDone.readiness.is_closed === false);
  ok('packageExportData reflects automated_checks_passed: true', expAllDone.readiness.automated_checks_passed === true);
  ok('packageExportData reflects bank_reconciliation_status: reconciled', expAllDone.readiness.bank_reconciliation_status === 'reconciled');
  ok('packageExportData contains awaiting accountant signoff limitation', expAllDone.limitations.some(l => l.includes('awaiting accountant sign-off')));

  // Case B: When bank recon is done, but bills lack docs (percent < 100)
  const undocDebts = [
    { id: 20, due_date: '2026-09-15', counterparty: 'Supplier Y', amount: 500, attachments: [] },
  ];
  const rMissingDocs = closeReadiness({ month, transactions, debts: undocDebts, batches: validBatch, wallets });
  ok('Bills without docs: percent < 100', rMissingDocs.percent < 100);
  ok('Bills without docs: automated_checks_passed is false', rMissingDocs.automated_checks_passed === false);
  ok('Bills without docs: is_closed MUST be false', rMissingDocs.is_closed === false);
  ok('Bills without docs: status is in_progress', rMissingDocs.status === 'in_progress');
}

// 11. Missing or invalid statement dates leave month coverage unconfirmed
{
  // Missing statement_start
  const bMissingStart = [{
    id: 'b-ms', wallet_id: 'w-bca', status: 'imported', closing_balance: 50000,
    statement_end: '2026-09-30', difference: 0, reconciliation_status: 'balanced',
  }];
  const rMS = closeReadiness({ month, transactions, debts, batches: bMissingStart, wallets });
  ok('Missing statement_start: statements is false', rMS.checks.find((c) => c.key === 'statements').done === false);
  ok('Missing statement_start: reconciliation is false', rMS.checks.find((c) => c.key === 'reconciliation').done === false);

  // Missing statement_end
  const bMissingEnd = [{
    id: 'b-me', wallet_id: 'w-bca', status: 'imported', closing_balance: 50000,
    statement_start: '2026-09-01', difference: 0, reconciliation_status: 'balanced',
  }];
  const rME = closeReadiness({ month, transactions, debts, batches: bMissingEnd, wallets });
  ok('Missing statement_end: statements is false', rME.checks.find((c) => c.key === 'statements').done === false);
  ok('Missing statement_end: reconciliation is false', rME.checks.find((c) => c.key === 'reconciliation').done === false);

  // Invalid date string
  const bInvalidDate = [{
    id: 'b-inv', wallet_id: 'w-bca', status: 'imported', closing_balance: 50000,
    statement_start: 'not-a-date', statement_end: '2026-09-30', difference: 0, reconciliation_status: 'balanced',
  }];
  const rInv = closeReadiness({ month, transactions, debts, batches: bInvalidDate, wallets });
  ok('Invalid date string: statements is false', rInv.checks.find((c) => c.key === 'statements').done === false);
  ok('Invalid date string: reconciliation is false', rInv.checks.find((c) => c.key === 'reconciliation').done === false);

  // Inverted date range (start > end)
  const bInverted = [{
    id: 'b-inv2', wallet_id: 'w-bca', status: 'imported', closing_balance: 50000,
    statement_start: '2026-09-30', statement_end: '2026-09-01', difference: 0, reconciliation_status: 'balanced',
  }];
  const rInv2 = closeReadiness({ month, transactions, debts, batches: bInverted, wallets });
  ok('Inverted dates (start > end): statements is false', rInv2.checks.find((c) => c.key === 'statements').done === false);
  ok('Inverted dates (start > end): reconciliation is false', rInv2.checks.find((c) => c.key === 'reconciliation').done === false);
}

// 12. Preservation of records and complete in closeReadiness
{
  const r = closeReadiness({ month, transactions, debts, batches: [], wallets });
  ok('records is present and a number', typeof r.records === 'number' && Number.isFinite(r.records));
  ok('complete is present and a number', typeof r.complete === 'number' && Number.isFinite(r.complete));
  ok('records matches transactions + bills', r.records === 2);
  ok('complete matches categorized + documented records', r.complete === 2);
}

// 13. Consistency of is_complete and presence of files_available flag across package
{
  const pkgData = packageExportData({ month, companyName: 'Test Co', businessId: 'b1', transactions, debts, batches: [], wallets });
  ok('packageExportData readiness preserves records and complete', pkgData.readiness.total_records === 2 && pkgData.readiness.complete_records === 2);
}

// 14. Validation of exported summary.json for the two key states:
// - Case 1: Unreconciled bank statement (is_closed: false, is_complete: false, limitations include unreconciled statements)
// - Case 2: Automated checks passed without accountant sign-off (is_closed: false, is_complete: false, status: 'prepared_for_review')
{
  // Case 1: Unreconciled
  const unrecBatch = [{
    id: 'b-unrec',
    wallet_id: 'w-bca',
    status: 'imported',
    closing_balance: 50000,
    statement_start: '2026-09-01',
    statement_end: '2026-09-30',
    difference: 5000,
    reconciliation_status: 'unbalanced',
    file_content: 'Date,Amount,Description\n2026-09-10,1000,Operations\n',
  }];
  const expUnrec = packageExportData({ month, companyName: 'Test Co', businessId: 'b1', transactions, debts, batches: unrecBatch, wallets });
  ok('Case 1 (Unreconciled): is_closed is false', expUnrec.readiness.is_closed === false);
  ok('Case 1 (Unreconciled): automated_checks_passed is false', expUnrec.readiness.automated_checks_passed === false);
  ok('Case 1 (Unreconciled): bank_reconciliation_status is unreconciled', expUnrec.readiness.bank_reconciliation_status === 'unreconciled');
  ok('Case 1 (Unreconciled): limitations contains unreconciled statement', expUnrec.limitations.some(l => l.includes('Unreconciled bank statements')));

  // Case 2: Automated checks passed, no accountant confirmation
  const balancedBatch = [{
    id: 'b-bal',
    wallet_id: 'w-bca',
    status: 'imported',
    closing_balance: 50000,
    statement_start: '2026-09-01',
    statement_end: '2026-09-30',
    difference: 0,
    reconciliation_status: 'balanced',
    file_content: 'Date,Amount,Description\n2026-09-10,1000,Operations\n',
  }];
  const expBal = packageExportData({ month, companyName: 'Test Co', businessId: 'b1', transactions, debts, batches: balancedBatch, wallets });
  ok('Case 2 (Automated checks passed): is_closed is false', expBal.readiness.is_closed === false);
  ok('Case 2 (Automated checks passed): automated_checks_passed is true', expBal.readiness.automated_checks_passed === true);
  ok('Case 2 (Automated checks passed): status is prepared_for_review', expBal.readiness.status === 'prepared_for_review');
  ok('Case 2 (Automated checks passed): bank_reconciliation_status is reconciled', expBal.readiness.bank_reconciliation_status === 'reconciled');
  ok('Case 2 (Automated checks passed): limitations explicitly states awaiting accountant sign-off', expBal.limitations.some(l => l.includes('awaiting accountant sign-off')));
}

// 15. Symmetric missing transactions (+1M, -1M) in ledger: batch is balanced (diff = 0) but unlinked ledger transactions keep reconciliation incomplete
{
  const txWithSymmetricUnlinked = [
    { id: 1, wallet_id: 'w-bca', transaction_date: '2026-09-10', category: 'Operations', amount_original: 1000, linked_statement_row_id: 101 },
    { id: 2, wallet_id: 'w-bca', transaction_date: '2026-09-25', category: 'Revenue', amount_original: 1000000, type: 'income', is_reconciled: false },
    { id: 3, wallet_id: 'w-bca', transaction_date: '2026-09-26', category: 'Supplies', amount_original: 1000000, type: 'expense', is_reconciled: false },
  ];
  const balancedBatch = [{
    id: 'b-bal-sym',
    wallet_id: 'w-bca',
    status: 'imported',
    closing_balance: 50000,
    statement_start: '2026-09-01',
    statement_end: '2026-09-30',
    difference: 0,
    reconciliation_status: 'balanced',
    file_content: 'Date,Amount,Description\n2026-09-10,1000,Operations\n',
  }];

  const rSym = closeReadiness({ month, transactions: txWithSymmetricUnlinked, debts, batches: balancedBatch, wallets });
  const reconCheck = rSym.checks.find((c) => c.key === 'reconciliation');

  ok('Symmetric unlinked transactions: reconciliation check is false', reconCheck.done === false);
  ok('Symmetric unlinked transactions: reconciled banks count is 0', rSym.banks.reconciled === 0);
  ok('Symmetric unlinked transactions: automated_checks_passed is false', rSym.automated_checks_passed === false);
  ok('Symmetric unlinked transactions: status is in_progress', rSym.status === 'in_progress');
  ok('Symmetric unlinked transactions: unlinked_transactions contains 2 records', rSym.unlinked_transactions.length === 2);

  const expSym = packageExportData({ month, companyName: 'Test Co', businessId: 'b1', transactions: txWithSymmetricUnlinked, debts, batches: balancedBatch, wallets });
  ok('Symmetric unlinked export: discrepancies.unlinked_transactions has 2 records', expSym.discrepancies.unlinked_transactions.length === 2);
  ok('Symmetric unlinked export: limitations mentions unreconciled ledger transactions', expSym.limitations.some(l => l.includes('Unreconciled ledger transactions')));
  ok('Symmetric unlinked export: status is in_progress (not prepared_for_review)', expSym.readiness.status === 'in_progress');
  ok('Symmetric unlinked export: bank_reconciliation_status is unreconciled', expSym.readiness.bank_reconciliation_status === 'unreconciled');
}

// 16. Missing/null linked_statement_row_id (without is_reconciled field) strictly treated as unreconciled
{
  const txWithNullLinks = [
    { id: 1, wallet_id: 'w-bca', transaction_date: '2026-09-10', category: 'Operations', amount_original: 1000, linked_statement_row_id: 101 },
    { id: 2, wallet_id: 'w-bca', transaction_date: '2026-09-25', category: 'Revenue', amount_original: 1000000, type: 'income', linked_statement_row_id: null },
    { id: 3, wallet_id: 'w-bca', transaction_date: '2026-09-26', category: 'Supplies', amount_original: 1000000, type: 'expense' }, // completely absent
    { id: 4, wallet_id: 'w-bca', transaction_date: '2026-09-01', category: 'Opening', amount_original: 45000000, source: 'wallet_opening_balance' }, // opening balance exempted
  ];
  const balancedBatch = [{
    id: 'b-bal-null',
    wallet_id: 'w-bca',
    status: 'imported',
    closing_balance: 50000,
    statement_start: '2026-09-01',
    statement_end: '2026-09-30',
    difference: 0,
    reconciliation_status: 'balanced',
    file_content: 'Date,Amount,Description\n2026-09-10,1000,Operations\n',
  }];

  const rNull = closeReadiness({ month, transactions: txWithNullLinks, debts, batches: balancedBatch, wallets });
  ok('Null/absent link is unreconciled: unlinked_transactions count is 2', rNull.unlinked_transactions.length === 2);
  ok('Null/absent link is unreconciled: opening balance not marked unlinked', !rNull.unlinked_transactions.some(t => t.id === 4));
  ok('Null/absent link is unreconciled: status is in_progress', rNull.status === 'in_progress');
  ok('Null/absent link is unreconciled: reconciliation check is false', rNull.checks.find(c => c.key === 'reconciliation').done === false);
}

console.log(`\nALL PASS — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);


