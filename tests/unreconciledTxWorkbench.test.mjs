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
  ok('Case 1 actionRoute includes /business/bank-import', diag.actionRoute.startsWith('/business/bank-import'));
  ok('Case 1 actionRoute contains wallet_id=w-bca', diag.actionRoute.includes('wallet_id=w-bca'));
  ok('Case 1 actionRoute contains month=2026-09', diag.actionRoute.includes('month=2026-09'));
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
  ok('Case 2 actionRoute includes /business/bank-import', diag.actionRoute.startsWith('/business/bank-import'));
  ok('Case 2 actionRoute includes batchId=b-unconfirmed', diag.actionRoute.includes('batchId=b-unconfirmed'));
  ok('Case 2 actionRoute contains wallet_id=w-bca', diag.actionRoute.includes('wallet_id=w-bca'));
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
  ok('Case 3 actionRoute includes /business/bank-import', diag.actionRoute.startsWith('/business/bank-import'));
  ok('Case 3 actionRoute includes batchId=b-confirmed', diag.actionRoute.includes('batchId=b-confirmed'));
  ok('Case 3 actionRoute contains wallet_id=w-bca', diag.actionRoute.includes('wallet_id=w-bca'));
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

console.log('\n--- 6. Server PATCH /api/transactions/:id boundary guard HTTP endpoint tests ---');
{
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const mem = require('./integration/_memorySupabase.js');
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (r) { return r === '@supabase/supabase-js' ? mem : orig.apply(this, arguments); };

  const PORT = '5812';
  process.env.PORT = PORT;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'unreconciled-test-secret-32-chars!';
  process.env.SUPABASE_URL = 'http://localhost:0/fake';
  process.env.SUPABASE_SECRET_KEY = 'fake';
  process.env.BOT_TOKEN = 'fake-bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'fake-webhook-secret';

  const BIZ_A = '11111111-2222-4333-8444-555555555555';
  const USER = 9991;

  mem.__seed('businesses', [
    { id: BIZ_A, name: 'PT Alpha Test', type: 'company', owner_user_id: USER, base_currency: 'IDR' }
  ]);
  mem.__seed('business_members', [
    { id: 1, user_id: USER, business_id: BIZ_A, role: 'owner', status: 'active' }
  ]);
  mem.__seed('wallets', [
    { id: 'w-idr-main', business_id: BIZ_A, name: 'BCA IDR', currency: 'IDR', is_active: true },
    { id: 'w-usd-main', business_id: BIZ_A, name: 'Wise USD', currency: 'USD', is_active: true }
  ]);
  mem.__seed('transactions', [
    {
      id: 301,
      business_id: BIZ_A,
      wallet_id: 'w-idr-main',
      amount_original: 500000,
      currency_original: 'IDR',
      source: 'wallet_opening_balance',
      description: 'Opening balance',
      category: 'Equity',
      transaction_date: '2026-09-01',
    },
    {
      id: 302,
      business_id: BIZ_A,
      wallet_id: 'w-idr-main',
      amount_original: 1000000,
      currency_original: 'IDR',
      source: 'manual',
      description: 'Invoice #INV-001 Payment',
      category: 'Operating Expense',
      transaction_date: '2026-09-10',
    },
    {
      id: 303,
      business_id: BIZ_A,
      wallet_id: 'w-idr-main',
      amount_original: 300000,
      currency_original: 'IDR',
      source: 'manual',
      description: 'Office Supplies',
      category: 'Office',
      transaction_date: '2026-09-15',
    }
  ]);
  mem.__seed('debts', [
    {
      id: 'debt-inv-1',
      business_id: BIZ_A,
      linked_transaction_id: 302,
      invoice_number: 'INV-001',
      counterparty: 'Supplier ABC',
      amount: 1000000,
      paid_amount: 1000000,
      currency: 'IDR',
      status: 'paid',
    }
  ]);

  require('../server/index.js');
  await new Promise((r) => setTimeout(r, 600));

  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ userId: USER }, process.env.JWT_SECRET);
  const patchApi = async (txId, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/transactions/${txId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + token,
        'x-business-id': BIZ_A,
      },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };

  // Test 1: Opening balance amount/wallet/date mutation is blocked (HTTP 400)
  const r1Amount = await patchApi(301, { amount: 600000 });
  ok('Opening balance amount edit returns 400 opening_balance_cannot_be_modified',
    r1Amount.status === 400 && r1Amount.data?.error === 'opening_balance_cannot_be_modified');

  const r1Wallet = await patchApi(301, { wallet_id: 'w-usd-main' });
  ok('Opening balance wallet edit returns 400 opening_balance_cannot_be_modified',
    r1Wallet.status === 400 && r1Wallet.data?.error === 'opening_balance_cannot_be_modified');

  const r1Date = await patchApi(301, { date: '2026-09-02' });
  ok('Opening balance date edit returns 400 opening_balance_cannot_be_modified',
    r1Date.status === 400 && r1Date.data?.error === 'opening_balance_cannot_be_modified');

  // Test 2: Opening balance non-financial edit (description/category) succeeds (HTTP 200)
  const r1Desc = await patchApi(301, { description: 'Opening balance verified', category: 'Capital' });
  ok('Opening balance description/category edit succeeds with 200', r1Desc.status === 200 && r1Desc.data?.id === 301);

  // Test 3: Debt payment financial mutation is blocked (HTTP 400)
  const r2Amount = await patchApi(302, { amount: 1500000 });
  ok('Debt-linked payment amount edit returns 400 debt_payment_amount_immutable',
    r2Amount.status === 400 && r2Amount.data?.error === 'debt_payment_amount_immutable');

  const r2Wallet = await patchApi(302, { wallet_id: 'w-idr-main' });
  ok('Debt-linked payment wallet edit returns 400 debt_payment_amount_immutable',
    r2Wallet.status === 400 && r2Wallet.data?.error === 'debt_payment_amount_immutable');

  const r2Date = await patchApi(302, { date: '2026-09-12' });
  ok('Debt-linked payment date edit returns 400 debt_payment_amount_immutable',
    r2Date.status === 400 && r2Date.data?.error === 'debt_payment_amount_immutable');

  // Test 4: Debt payment non-financial edit succeeds (HTTP 200)
  const r2Desc = await patchApi(302, { description: 'Updated invoice note' });
  ok('Debt-linked payment description edit succeeds with 200', r2Desc.status === 200 && r2Desc.data?.id === 302);

  // Test 5: Cross-currency wallet transfer is blocked (IDR tx -> USD wallet) (HTTP 400)
  const r3Cross = await patchApi(303, { wallet_id: 'w-usd-main' });
  ok('Moving IDR transaction to USD wallet returns 400 currency_mismatch',
    r3Cross.status === 400 && r3Cross.data?.error === 'currency_mismatch');

  // Test 6: Description update does not mutate currency
  const r3Desc = await patchApi(303, { description: 'Office Supplies - Paper & Pens' });
  ok('Updating description preserves 200 without currency mutation', r3Desc.status === 200 && r3Desc.data?.id === 303);
  const tx303 = (mem.__db['transactions'] || []).find((t) => t.id === 303);
  ok('Transaction currency_original remains IDR', tx303 && tx303.currency_original === 'IDR');
}

console.log('\n--- 7. Stale save protection with delayed response and unmount/scope switch ---');
{
  // Simulates the exact UnreconciledTxDrawer save lifecycle and stale protection guard
  class DrawerSaveSession {
    constructor({ activeBusinessId, scopeKey, month, tx, onSaved, onTxUpdated }) {
      this.activeBusinessId = activeBusinessId;
      this.scopeKey = scopeKey;
      this.month = month;
      this.tx = tx;
      this.currentScope = `${activeBusinessId}|${scopeKey}|${month}|${tx?.id}`;
      this.scopeRef = { current: this.currentScope };
      this.isMountedRef = { current: true };
      this.onSaved = onSaved;
      this.onTxUpdated = onTxUpdated;
      this.saveState = { saving: false, success: false, error: null };
    }

    unmount() {
      this.isMountedRef.current = false;
      this.scopeRef.current = null; // Unmount cleanup as in useEffect return
    }

    switchCompany(newBizId) {
      this.activeBusinessId = newBizId;
      this.currentScope = `${newBizId}|${this.scopeKey}|${this.month}|${this.tx?.id}`;
      this.scopeRef.current = this.currentScope; // Scope changes as in useEffect([currentScope])
    }

    switchMonth(newMonth) {
      this.month = newMonth;
      this.currentScope = `${this.activeBusinessId}|${this.scopeKey}|${newMonth}|${this.tx?.id}`;
      this.scopeRef.current = this.currentScope;
    }

    switchTx(newTx) {
      this.tx = newTx;
      this.currentScope = `${this.activeBusinessId}|${this.scopeKey}|${this.month}|${newTx?.id}`;
      this.scopeRef.current = this.currentScope;
    }

    async handleSave(apiCallPromise) {
      const capturedScope = this.currentScope;
      this.saveState.saving = true;

      // Stale check before in-flight mutation
      if (!this.isMountedRef.current || this.scopeRef.current !== capturedScope) {
        this.saveState.saving = false;
        return;
      }

      try {
        const updated = await apiCallPromise;

        // Stale check after in-flight response arrives
        if (!this.isMountedRef.current || this.scopeRef.current !== capturedScope) {
          return;
        }

        this.saveState.success = true;
        this.onSaved?.(updated);
        this.onTxUpdated?.(updated);
      } catch (err) {
        if (!this.isMountedRef.current || this.scopeRef.current !== capturedScope) {
          return;
        }
        this.saveState.error = err.message;
      } finally {
        if (this.isMountedRef.current && this.scopeRef.current === capturedScope) {
          this.saveState.saving = false;
        }
      }
    }
  }

  // Case A: Normal save without interruption -> callbacks invoked
  let savedA = false;
  const sessionA = new DrawerSaveSession({
    activeBusinessId: 'biz-1',
    scopeKey: 'scope-1',
    month: '2026-09',
    tx: { id: 501 },
    onSaved: () => { savedA = true; },
  });
  const delayedApiSuccess = new Promise((resolve) => setTimeout(() => resolve({ id: 501, updated: true }), 50));
  await sessionA.handleSave(delayedApiSuccess);
  ok('Normal save completes and calls onSaved', savedA === true && sessionA.saveState.success === true);

  // Case B: Drawer unmounts while request is in-flight -> late response dropped, onSaved NOT called
  let savedB = false;
  const sessionB = new DrawerSaveSession({
    activeBusinessId: 'biz-1',
    scopeKey: 'scope-1',
    month: '2026-09',
    tx: { id: 502 },
    onSaved: () => { savedB = true; },
  });
  const delayedApiB = new Promise((resolve) => setTimeout(() => resolve({ id: 502, updated: true }), 60));
  const savePromiseB = sessionB.handleSave(delayedApiB);
  // User closes / unmounts drawer after 10ms
  setTimeout(() => { sessionB.unmount(); }, 10);
  await savePromiseB;
  ok('Unmounted drawer drops in-flight response without calling onSaved', savedB === false && sessionB.saveState.success === false);

  // Case C: User switches company while request is in-flight -> late response dropped
  let savedC = false;
  const sessionC = new DrawerSaveSession({
    activeBusinessId: 'biz-1',
    scopeKey: 'scope-1',
    month: '2026-09',
    tx: { id: 503 },
    onSaved: () => { savedC = true; },
  });
  const delayedApiC = new Promise((resolve) => setTimeout(() => resolve({ id: 503, updated: true }), 60));
  const savePromiseC = sessionC.handleSave(delayedApiC);
  // Workspace switches to biz-2 after 10ms
  setTimeout(() => { sessionC.switchCompany('biz-2'); }, 10);
  await savePromiseC;
  ok('Company switch renders save stale and drops commit', savedC === false && sessionC.saveState.success === false);

  // Case D: User switches month while request is in-flight -> late response dropped
  let savedD = false;
  const sessionD = new DrawerSaveSession({
    activeBusinessId: 'biz-1',
    scopeKey: 'scope-1',
    month: '2026-09',
    tx: { id: 504 },
    onSaved: () => { savedD = true; },
  });
  const delayedApiD = new Promise((resolve) => setTimeout(() => resolve({ id: 504, updated: true }), 60));
  const savePromiseD = sessionD.handleSave(delayedApiD);
  // Month switches to 2026-10 after 10ms
  setTimeout(() => { sessionD.switchMonth('2026-10'); }, 10);
  await savePromiseD;
  ok('Month switch renders save stale and drops commit', savedD === false && sessionD.saveState.success === false);

  // Case E: User selects a different transaction while request is in-flight -> late response dropped
  let savedE = false;
  const sessionE = new DrawerSaveSession({
    activeBusinessId: 'biz-1',
    scopeKey: 'scope-1',
    month: '2026-09',
    tx: { id: 505 },
    onSaved: () => { savedE = true; },
  });
  const delayedApiE = new Promise((resolve) => setTimeout(() => resolve({ id: 505, updated: true }), 60));
  const savePromiseE = sessionE.handleSave(delayedApiE);
  // Transaction switches to 506 after 10ms
  setTimeout(() => { sessionE.switchTx({ id: 506 }); }, 10);
  await savePromiseE;
  ok('Switching transaction renders in-flight save stale and drops commit', savedE === false && sessionE.saveState.success === false);
}

console.log(`\nUNRECONCILED WORKBENCH TESTS: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

