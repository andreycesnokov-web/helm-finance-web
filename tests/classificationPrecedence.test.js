// AC-0 / I-1 (24 Oct 2026): a bank's wording must not overrule recorded facts or the category a person chose.
// The ten owner acceptance scenarios at the classifier level, plus the real production pattern (statement rows whose
// confirmed-at-import category was overruled by "TRANSFER OR VIA IB …"). Red before / green after:
//   FININ_PATH=<old financialInsights.js> node tests/classificationPrecedence.test.js   → fails on the old order
//   node tests/classificationPrecedence.test.js                                         → passes
// Run: node tests/classificationPrecedence.test.js
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { classifyTransaction } = require(process.env.FININ_PATH ? path.resolve(process.env.FININ_PATH) : '../server/lib/financialInsights.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const cls = (tx, ev) => classifyTransaction(tx, ev || null);
const confirmed = (group) => ({ categoryOf: () => ({ pnl_group: group }), fundingTx: new Map(), purposeOf: () => null });
const register = (id) => ({ categoryOf: () => null, fundingTx: new Map([[String(id), null]]), purposeOf: () => null });

t('1. customer payment described "TRANSFER FROM CUSTOMER", confirmed revenue group → revenue', () => {
  const r = cls({ id: 1, type: 'income', description: 'TRANSFER FROM CUSTOMER PT KLIEN INV-001' }, confirmed('revenue'));
  assert.equal(r.class, 'revenue'); assert.equal(r.matched_on, 'confirmed_category_group');
});
t('1b. same payment with only a chosen category name "Sales" → revenue (category beats the bank text)', () => {
  assert.equal(cls({ type: 'income', category: 'Sales', description: 'TRANSFER OR VIA IB PT KLIEN ABADI INV-091' }).class, 'revenue');
});
t('2. a genuine transfer between own accounts (transfer record) stays a transfer, whatever the category says', () => {
  const r = cls({ type: 'income', transfer_id: 'a7b0e1f2-0000-4000-8000-000000000001', category: 'Sales', description: 'Pindah dana' }, confirmed('revenue'));
  assert.equal(r.class, 'transfer'); assert.equal(r.needs_review, false);
});
t('3. owner capital injection in the funding register → financing, even when the bank says TRANSFER', () => {
  assert.equal(cls({ id: 7, type: 'income', description: 'TRANSFER FROM DIRECTOR SETORAN MODAL' }, register(7)).class, 'financing');
});
t('3b. owner funding by its chosen category (no register yet) → financing, not transfer', () => {
  assert.equal(cls({ type: 'income', category: 'Owner funding (loan)', description: 'TRANSFER OR VIA IB DIREKTUR' }).class, 'financing');
});
t('4. loan disbursement in the funding register → financing, never revenue', () => {
  assert.equal(cls({ id: 9, type: 'income', category: 'Sales', description: 'LOAN DISBURSEMENT BANK' }, register(9)).class, 'financing');
});
t('5. supplier refund (inflow in a cost category) is not revenue and asks for review', () => {
  const a = cls({ type: 'income', category: 'Software and subscriptions', description: 'REFUND FROM SUPPLIER SAAS' });
  const b = cls({ type: 'income', category: 'Software and subscriptions', description: 'REFUND FROM SUPPLIER SAAS' }, confirmed('operating_cost'));
  for (const r of [a, b]) { assert.notEqual(r.class, 'revenue'); assert.equal(r.needs_review, true); }
});
t('6. payment with a confirmed income category and a plain description → revenue', () => {
  assert.equal(cls({ type: 'income', description: 'Pembayaran jasa INV-002' }, confirmed('revenue')).class, 'revenue');
});
t('7. ambiguous imported line with only the word TRANSFER → kept out of revenue, marked for review', () => {
  const r = cls({ type: 'income', description: 'TRANSFER 0937 NO REF', bank_import_row_id: 'r1' });
  assert.equal(r.class, 'transfer'); assert.equal(r.needs_review, true); assert.equal(r.matched_on, 'keyword');
});
t('7b. ambiguous imported line with no recognisable words → unknown, needs review (never revenue)', () => {
  const r = cls({ type: 'income', description: 'TRF 1188 BCA' });
  assert.equal(r.class, 'unknown'); assert.equal(r.needs_review, true);
});
t('8. the same statement row re-imported classifies identically (deterministic; import source is not evidence)', () => {
  const row = { type: 'income', category: 'Sales', description: 'TRANSFER OR VIA IB PT KLIEN 5' };
  assert.deepEqual(cls({ ...row, bank_import_row_id: 'a' }), cls({ ...row, bank_import_row_id: 'b' }));
  assert.deepEqual(cls({ ...row, source: 'bank_import' }), cls({ ...row, source: 'manual' }));
});
t('9. a row reclassified by an authorized person follows the new category / purpose', () => {
  const before = cls({ id: 3, type: 'income', description: 'TRANSFER MASUK 7781' });
  const recategorised = cls({ id: 3, type: 'income', category: 'Sales', description: 'TRANSFER MASUK 7781' });
  const personal = cls({ id: 3, type: 'expense', category: 'Office supplies', description: 'TRANSFER KE TOKO' }, { categoryOf: () => null, fundingTx: new Map(), purposeOf: () => 'personal' });
  assert.equal(before.class, 'transfer'); assert.equal(recategorised.class, 'revenue'); assert.equal(personal.class, 'personal');
});
t('10. a missing supporting document does not change the class (documents are evidence for the accountant, not for cash)', () => {
  const row = { type: 'income', category: 'Sales', description: 'Penjualan jasa' };
  assert.equal(cls({ ...row, document_count: 0 }).class, 'revenue'); assert.equal(cls({ ...row, document_status: 'missing' }).class, 'revenue');
});

// The production pattern (24 Oct, prod 64746eb): statement rows confirmed at import with a category, overruled by text.
t('prod pattern: salary paid by bank transfer → operating expense (it was dropped from burn and OPEX)', () => {
  assert.equal(cls({ type: 'expense', category: 'Salary and wages', description: 'TRANSFER OR VIA IB KARYAWAN 01' }).class, 'operating_expense');
});
t('prod pattern: software paid by bank transfer → operating expense', () => {
  assert.equal(cls({ type: 'expense', category: 'Software and subscriptions', description: 'TRANSFER OR VIA IB SAAS' }).class, 'operating_expense');
});
t('prod pattern: loan repayment by bank transfer → financing', () => {
  assert.equal(cls({ type: 'expense', category: 'Loan repayments', description: 'TRANSFER OR VIA IB ANGSURAN' }).class, 'financing');
});

// Ledger facts stay first; nothing else moved.
t('opening balance flag on the row wins over a revenue category', () => {
  assert.equal(cls({ type: 'income', is_opening_balance: true, category: 'Sales', description: 'x' }).class, 'opening_balance');
});
t('opening anchor sources and the correction type are facts', () => {
  assert.equal(cls({ type: 'income', source: 'opening_reanchor', category: 'Sales' }).class, 'opening_balance');
  assert.equal(cls({ type: 'income', source: 'wallet_opening_balance', category: 'Sales' }).class, 'opening_balance');
  assert.equal(cls({ type: 'correction', category: 'Sales' }).class, 'balance_correction');
});
t('rows with no category keep the old keyword result (only the review flag is added on transfer wording)', () => {
  assert.equal(cls({ type: 'expense', description: 'PPh 25 pajak' }).class, 'tax');
  assert.equal(cls({ type: 'expense', description: 'Office rent October' }).class, 'operating_expense');
  assert.equal(cls({ type: 'income', description: 'Customer payment INV 3' }).class, 'revenue');
  assert.equal(cls({ type: 'expense', description: 'New machine purchase' }).class, 'capex');
});
t('a payroll-type row is an operating cost by what it is, whatever the bank wording', () => {
  assert.equal(cls({ type: 'payroll', description: 'TRANSFER GAJI' }).class, 'operating_expense');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
