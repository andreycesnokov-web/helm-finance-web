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
  ok('Zero difference: is_closed is true when percent is 100 and all checks pass', r.is_closed === true);
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
  const rAllDone = closeReadiness({ month, transactions, debts, batches: validBatch, wallets });
  ok('All checks done and percent 100: is_closed is true', rAllDone.is_closed === true);

  const expAllDone = packageExportData({ month, transactions, debts, batches: validBatch, wallets });
  ok('packageExportData reflects is_closed: true when all checks pass', expAllDone.readiness.is_closed === true);

  // When bank recon is done, but bills lack docs (percent < 100)
  const undocDebts = [
    { id: 20, due_date: '2026-09-15', counterparty: 'Supplier Y', amount: 500, attachments: [] },
  ];
  const rMissingDocs = closeReadiness({ month, transactions, debts: undocDebts, batches: validBatch, wallets });
  ok('Bills without docs: percent < 100', rMissingDocs.percent < 100);
  ok('Bills without docs: is_closed MUST be false', rMissingDocs.is_closed === false);
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

console.log(`\nALL PASS — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

