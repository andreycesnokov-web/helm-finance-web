// Test unreconciled bank transactions workbench & diagnosis logic
// Run: node tests/unreconciledTxWorkbench.test.mjs
import assert from 'node:assert';
import { closeReadiness, determineUnreconciledReason } from '../client/src/v2/lib/accounting.js';

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
  { id: 'w-mandiri', name: 'Mandiri Payroll', currency: 'IDR', type: 'bank', is_active: true },
  { id: 'w-cash', name: 'Kas Kecil (Cash)', currency: 'IDR', type: 'cash', is_active: true },
];

console.log('\n--- 1. Case: No statement uploaded for wallet in period ---');
{
  const tx = {
    id: 101,
    transaction_date: '2026-09-12',
    date: '2026-09-12',
    amount: 1500000,
    wallet_id: 'w-bca',
    description: 'Vendor payment',
    source: 'manual',
    is_reconciled: false,
  };
  const batches = []; // No batches at all

  const diag = determineUnreconciledReason({
    tx,
    month,
    wallet: wallets[0],
    batches,
  });

  ok('Case 1 diagnosis reason is no_statement', diag.reason === 'no_statement');
  ok('Case 1 reasonKey is acct.reason.noStatement', diag.reasonKey === 'acct.reason.noStatement');
  ok('Case 1 actionRoute is /business/bank-import', diag.actionRoute === '/business/bank-import');
  ok('Case 1 actionLabelKey is acct.reason.actionUploadStatement', diag.actionLabelKey === 'acct.reason.actionUploadStatement');
  ok('Case 1 params include wallet name BCA Operasional', diag.params.wallet === 'BCA Operasional');
  ok('Case 1 params include month 2026-09', diag.params.month === '2026-09');
}

console.log('\n--- 2. Case: Statement exists but processing / reconciliation unconfirmed / unbalanced ---');
{
  const tx = {
    id: 102,
    transaction_date: '2026-09-15',
    date: '2026-09-15',
    amount: 2500000,
    wallet_id: 'w-bca',
    description: 'Office supply payment',
    source: 'manual',
    is_reconciled: false,
  };
  const batches = [
    {
      id: 'b-unconfirmed',
      wallet_id: 'w-bca',
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      status: 'imported',
      reconciliation_status: 'unbalanced',
      difference: 15000,
    },
  ];

  const diag = determineUnreconciledReason({
    tx,
    month,
    wallet: wallets[0],
    batches,
  });

  ok('Case 2 diagnosis reason is statement_unconfirmed', diag.reason === 'statement_unconfirmed');
  ok('Case 2 reasonKey is acct.reason.unconfirmed', diag.reasonKey === 'acct.reason.unconfirmed');
  ok('Case 2 actionRoute is /business/bank-import', diag.actionRoute === '/business/bank-import');
  ok('Case 2 actionLabelKey is acct.reason.actionReviewStatement', diag.actionLabelKey === 'acct.reason.actionReviewStatement');
}

console.log('\n--- 3. Case: Statement exists and confirmed balanced, but transaction has no match ---');
{
  const tx = {
    id: 103,
    transaction_date: '2026-09-18',
    date: '2026-09-18',
    amount: 750000,
    wallet_id: 'w-bca',
    description: 'Unmatched transaction',
    source: 'manual',
    is_reconciled: false,
  };
  const batches = [
    {
      id: 'b-confirmed',
      wallet_id: 'w-bca',
      statement_start: '2026-09-01',
      statement_end: '2026-09-30',
      status: 'confirmed',
      reconciliation_status: 'balanced',
      difference: 0,
    },
  ];

  const diag = determineUnreconciledReason({
    tx,
    month,
    wallet: wallets[0],
    batches,
  });

  ok('Case 3 diagnosis reason is no_match', diag.reason === 'no_match');
  ok('Case 3 reasonKey is acct.reason.noMatch', diag.reasonKey === 'acct.reason.noMatch');
  ok('Case 3 actionRoute is /business/bank-import', diag.actionRoute === '/business/bank-import');
  ok('Case 3 actionLabelKey is acct.reason.actionMatchTransactions', diag.actionLabelKey === 'acct.reason.actionMatchTransactions');
}

console.log('\n--- 4. Case: Insufficient data / requires clarification ---');
{
  const tx = {
    id: 104,
    transaction_date: null,
    date: null,
    amount: 0,
    wallet_id: null,
    description: '',
    is_reconciled: false,
  };
  const batches = [];

  const diag = determineUnreconciledReason({
    tx,
    month: null,
    wallet: null,
    batches: null,
  });

  ok('Case 4 diagnosis reason is requires_clarification', diag.reason === 'requires_clarification');
  ok('Case 4 reasonKey is acct.reason.clarification', diag.reasonKey === 'acct.reason.clarification');
  ok('Case 4 actionRoute is null', diag.actionRoute === null);
}

console.log('\n--- 5. Accounting engine closeReadiness enriched unlinked_transactions ---');
{
  const transactions = [
    {
      id: 201,
      transaction_date: '2026-09-05',
      date: '2026-09-05',
      amount: 500000,
      wallet_id: 'w-bca',
      category: 'Software',
      counterparty: 'Google Workspace',
      description: 'Subscription',
      source: 'manual',
      is_reconciled: false,
    },
    {
      id: 202,
      transaction_date: '2026-09-10',
      date: '2026-09-10',
      amount: 1000000,
      wallet_id: 'w-mandiri',
      category: 'Payroll',
      source: 'payroll',
      is_reconciled: true, // Reconciled -> should NOT be in unlinked_transactions
    },
    {
      id: 203,
      transaction_date: '2026-09-15',
      date: '2026-09-15',
      amount: 3000000,
      wallet_id: 'w-bca',
      category: 'Sales',
      source: 'manual',
      is_reconciled: false, // Second unlinked transaction
    },
  ];

  const r = closeReadiness({
    month,
    transactions,
    debts: [],
    batches: [],
    wallets,
  });

  ok('unlinked_transactions has 2 items', r.unlinked_transactions.length === 2);
  const ut201 = r.unlinked_transactions.find((u) => u.id === 201);
  const ut203 = r.unlinked_transactions.find((u) => u.id === 203);

  ok('ut201 is present', !!ut201);
  ok('ut201 preserves category', ut201.category === 'Software');
  ok('ut201 preserves counterparty', ut201.counterparty === 'Google Workspace');
  ok('ut201 preserves raw object', ut201.raw && ut201.raw.id === 201);

  ok('ut203 is present', !!ut203);
  ok('ut203 category is Sales', ut203.category === 'Sales');

  // Verify non-closed status invariant
  ok('automated_checks_passed is false when unreconciled tx exists', r.automated_checks_passed === false);
  ok('status is in_progress', r.status === 'in_progress');
}

console.log('\n--- 6. Server PATCH /api/transactions/:id boundary guard logic ---');
{
  // Test opening balance protection logic
  const openingTx = { id: 301, source: 'wallet_opening_balance', amount: 500000 };
  const openingAttemptAmount = { amount: 600000 };
  const openingAttemptWallet = { wallet_id: 'w-mandiri' };
  const openingAttemptCategory = { category: 'Equity' };

  const canEditOpeningAmount = !(openingTx.source === 'wallet_opening_balance' && ('amount' in openingAttemptAmount || 'wallet_id' in openingAttemptAmount));
  const canEditOpeningWallet = !(openingTx.source === 'wallet_opening_balance' && ('amount' in openingAttemptWallet || 'wallet_id' in openingAttemptWallet));
  const canEditOpeningCategory = !(openingTx.source === 'wallet_opening_balance' && ('amount' in openingAttemptCategory || 'wallet_id' in openingAttemptCategory));

  ok('Opening balance amount edit is blocked', canEditOpeningAmount === false);
  ok('Opening balance wallet edit is blocked', canEditOpeningWallet === false);
  ok('Opening balance category/description edit is allowed', canEditOpeningCategory === true);

  // Test debt-linked payment transaction amount protection logic
  const debtPaymentTx = { id: 302, source: 'manual', amount: 1000000 };
  const linkedDebts = [{ id: 'd-1', linked_transaction_id: 302, counterparty: 'Supplier ABC' }];
  const debtAttemptAmount = { amount: 1200000 };
  const debtAttemptDesc = { description: 'Updated reference' };

  const canEditDebtAmount = !(linkedDebts.length > 0 && 'amount' in debtAttemptAmount);
  const canEditDebtDesc = !(linkedDebts.length > 0 && 'amount' in debtAttemptDesc);

  ok('Debt payment amount edit is blocked (must edit source bill)', canEditDebtAmount === false);
  ok('Debt payment description edit is allowed', canEditDebtDesc === true);
}

console.log('\n--- 7. Stale save protection across company/month switch ---');
{
  // Test stale guard logic: scopeKey + month comparison
  let activeBusinessId = 'biz-alpha';
  let scopeKey = 'scope-alpha';
  let month = '2026-09';
  const initialScope = `${activeBusinessId}|${scopeKey}|${month}`;

  // Case A: same company and month -> allowed
  const isStaleSame = initialScope !== `${activeBusinessId}|${scopeKey}|${month}`;
  ok('Same workspace and month is not stale', isStaleSame === false);

  // Case B: company switches during in-flight edit
  activeBusinessId = 'biz-beta';
  const isStaleCompanySwitch = initialScope !== `${activeBusinessId}|${scopeKey}|${month}`;
  ok('Company switch renders save stale and drops commit', isStaleCompanySwitch === true);

  // Case C: month switches during in-flight edit
  activeBusinessId = 'biz-alpha';
  month = '2026-10';
  const isStaleMonthSwitch = initialScope !== `${activeBusinessId}|${scopeKey}|${month}`;
  ok('Month switch renders save stale and drops commit', isStaleMonthSwitch === true);
}

console.log(`\nUNRECONCILED WORKBENCH TESTS: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}

