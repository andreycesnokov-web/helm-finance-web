// Business purpose and accountant review of an operation (management vs accounting preparation, 24 Oct 2026).
// Run: node tests/transactionClassifications.test.js
const assert = require('node:assert');
const TC = require('../server/lib/transactionClassifications');
const { buildReport } = require('../server/lib/profitLoss');
const FI = require('../server/lib/financialInsights');
const { computeBurnAndRunway } = require('../server/lib/burnRunway');
const { B, OTHER, fixture } = require('./fixtures/profitLoss.cjs');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const report = (classifications = []) => { const f = fixture(); f.classifications = classifications; return buildReport(f, { businessId: B, month: '2026-08', currency: 'IDR' }); };
const mark = (id, purpose, extra = {}) => ({ transaction_id: id, business_id: B, business_purpose: purpose, ...extra });
console.log('\nOperation classification');

t('body: only purpose / review / note; who and when are never accepted from the client', () => {
  assert.deepStrictEqual(TC.bodyFrom({ business_purpose: 'personal' }).value, { business_purpose: 'personal' });
  assert.strictEqual(TC.bodyFrom({ business_purpose: 'deductible' }).error, 'invalid_business_purpose');
  assert.strictEqual(TC.bodyFrom({ accountant_reviewed: 'yes' }).error, 'invalid_accountant_reviewed');
  assert.strictEqual(TC.bodyFrom({ accountant_reviewed: true, accountant_reviewed_by: 7 }).error, 'server_controlled_field');
  assert.strictEqual(TC.bodyFrom({ business_purpose: 'operating', business_id: OTHER }).error, 'server_controlled_field');
  assert.strictEqual(TC.bodyFrom({}).error, 'nothing_to_change');
  assert.strictEqual(TC.bodyFrom({ note: '  ' }).value.note, null);
  assert.strictEqual(TC.bodyFrom({ note: 'x'.repeat(600) }).value.note.length, 500);
});

t('review: set by the server with actor and time; a changed purpose clears an earlier review', () => {
  const now = '2026-10-24T10:00:00.000Z', ctx = { userId: 9, businessId: B, transactionId: 3, now };
  const reviewed = TC.nextRow(null, { accountant_reviewed: true }, ctx);
  assert.deepStrictEqual([reviewed.accountant_reviewed_by, reviewed.accountant_reviewed_at, reviewed.business_purpose], [9, now, null]);
  const changed = TC.nextRow(reviewed, { business_purpose: 'personal' }, { ...ctx, userId: 5, now: '2026-10-25T00:00:00.000Z' });
  assert.deepStrictEqual([changed.business_purpose, changed.purpose_set_by, changed.accountant_reviewed_at, changed.accountant_reviewed_by], ['personal', 5, null, null]);
  // A note alone keeps the review; setting the same purpose again keeps it too.
  assert.strictEqual(TC.nextRow(reviewed, { note: 'receipt lost' }, ctx).accountant_reviewed_by, 9);
  const samePurpose = TC.nextRow({ ...reviewed, business_purpose: 'operating' }, { business_purpose: 'operating' }, ctx);
  assert.strictEqual(samePurpose.accountant_reviewed_by, 9);
  assert.ok(TC.canReview('accountant') && TC.canReview('owner') && !TC.canReview('manager') && !TC.canReview('employee') && !TC.canReview(null));
});

// Fixture, August 2026: operating cost 170.7 = rent 100.3 (operation 3) + salaries 80.4 (operation 4) − refund 10.
t('no mark = the previous report exactly', () => {
  const base = report(), same = report([mark(3, null)]);
  assert.deepStrictEqual(same.periods['2026-08'].totals, base.periods['2026-08'].totals);
  assert.strictEqual(base.periods['2026-08'].totals.operating_cost, '170.7');
});

t('personal money from a company account leaves operating profit, stays visible with its reason', () => {
  const r = report([mark(3, 'personal')]);
  assert.strictEqual(r.periods['2026-08'].totals.operating_cost, '70.4'); // 170.7 − 100.3
  const ex = r.excluded.find((e) => e.transaction_id === '3');
  assert.deepStrictEqual([ex.reason, ex.business_purpose, ex.native_amount], ['personal_non_business', 'personal', '100.30']);
});

t('capital purchase / other non-P&L / needs review: excluded or held, never dropped', () => {
  assert.strictEqual(report([mark(3, 'capital')]).excluded.find((e) => e.transaction_id === '3').reason, 'capital_purchase');
  assert.strictEqual(report([mark(3, 'non_pnl')]).excluded.find((e) => e.transaction_id === '3').reason, 'non_pnl_movement');
  const held = report([mark(3, 'needs_review')]);
  assert.strictEqual(held.exceptions.find((e) => e.transaction_id === '3').reason, 'purpose_needs_review');
  // Every operation of the period is in exactly one of entries / excluded / exceptions.
  const ids = (r) => [...r.entries, ...r.excluded, ...r.exceptions].map((e) => e.transaction_id).sort();
  assert.deepStrictEqual(ids(held), ids(report()));
});

t('a purpose never turns financing or an own-account transfer into profit', () => {
  const base = report(), fin = base.excluded.filter((e) => ['financing', 'own_account_transfer'].includes(e.reason));
  assert.ok(fin.length > 0, 'fixture has financing / transfer rows');
  const r = report(fin.map((e) => mark(Number(e.transaction_id), 'operating')));
  assert.deepStrictEqual(r.periods['2026-08'].totals, base.periods['2026-08'].totals);
});

t('another company\'s mark is ignored', () => {
  const r = report([{ transaction_id: 3, business_id: OTHER, business_purpose: 'personal' }]);
  assert.strictEqual(r.periods['2026-08'].totals.operating_cost, '170.7');
});

t('accountant review shows as a review mark only, never as approval of the books', () => {
  const r = report([mark(3, null, { accountant_reviewed_at: '2026-10-24T10:00:00Z', accountant_reviewed_by: 9 })]);
  const e = r.entries.find((x) => x.transaction_id === '3');
  assert.deepStrictEqual([e.review_status, e.accountant_reviewed_at], ['accountant_reviewed', '2026-10-24T10:00:00Z']);
  assert.strictEqual(r.accounting_ready, false);
  assert.strictEqual(r.entries.find((x) => x.transaction_id === '4').review_status, 'not_accountant_approved');
});

// Management figures follow the purpose; the cash forecast does not (every movement is still cash).
const rows = [
  { id: 1, type: 'expense', amount_idr: 4000000, amount_original: 4000000, category: 'Office expenses', transaction_date: '2026-10-10' },
  { id: 2, type: 'expense', amount_idr: 6000000, amount_original: 6000000, category: 'Office expenses', transaction_date: '2026-10-12' },
];
const purposeOf = TC.purposeResolver(new Map([['2', { business_purpose: 'personal' }]]));
t('month figures: a personal payment is "personal", not operating cash out', () => {
  const m = FI.computeInsights(rows, { evidence: { purposeOf } }).metrics;
  assert.deepStrictEqual([m.operating_cash_out, m.other_cash_movement.personal], [4000000, 6000000]);
  assert.strictEqual(FI.computeInsights(rows).metrics.operating_cash_out, 10000000);
});
t('the burn behind Radar and runway ignores purposes (10M of cash left either way)', () => {
  const r = computeBurnAndRunway(rows, 100000000, '2026-10-24');
  assert.strictEqual(r.operating_expenses, 10000000);
});

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
