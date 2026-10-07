// Test bank reconciliation difference handling in accounting.js
// Run: node tests/bankReconciliationDifference.test.mjs
import assert from 'node:assert';
import { closeReadiness } from '../client/src/v2/lib/accounting.js';

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
  { id: 'w-bca', name: 'BCA Operasional', type: 'bank', is_active: true },
  { id: 'w-cash', name: 'Kas Kecil (Cash)', type: 'cash', is_active: true },
];

const transactions = [
  { id: 1, transaction_date: '2026-09-10', category: 'Operations', amount_original: 1000 },
];
const debts = [];

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

console.log(`\nALL PASS — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
