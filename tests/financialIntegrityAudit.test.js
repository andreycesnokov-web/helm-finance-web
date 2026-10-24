// Financial integrity audit 2026-10-24 — server-side regressions. Each case states the defect it
// proves and its hand-worked figures. Run: node tests/financialIntegrityAudit.test.js
const assert = require('node:assert');
const { computeBurnAndRunway } = require('../server/lib/burnRunway');
const { payrollSchedule } = require('../server/lib/payrollSchedule');
const F = require('../server/lib/businessFunding');
const { taxStages } = require('../server/lib/taxDeadlines');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const M = 1e6;
const asOf = '2026-10-24';
const tx = (id, type, amount, date, category, description = category) => ({ id, type, amount_original: amount, amount_idr: amount, currency_original: 'IDR', transaction_date: date, category, description });
console.log('\nFinancial integrity audit (server)');

// Scenario 7. 30-day window 25 Sep – 24 Oct: operating spend 30M (rent 15M, salaries 15M) and one
// 500M inflow the owner booked under a sales-like category but recorded in the funding register.
// Correct: operating inflow 0 → net burn 30M/30 = 1M/day, runway = 530M / 1M = 530 days.
const window7 = [tx(1, 'expense', 15 * M, '2026-09-25', 'Rent'), tx(2, 'expense', 15 * M, '2026-10-20', 'Salary and wages'),
  tx(3, 'income', 500 * M, '2026-10-10', 'Penjualan', 'Dana masuk PT Investor')];
t('7 a financing inflow in the funding register is never operating inflow in the burn', () => {
  const evidence = { fundingTx: new Map([['3', null]]), categoryOf: () => null };
  const r = computeBurnAndRunway(window7, 530 * M, asOf, { evidence });
  assert.deepStrictEqual([r.operating_inflows, r.net_burn_daily, r.runway_days, r.runway_reason], [0, 1 * M, 530, 'depleting']);
});
t('7 regression: without the evidence the same inflow was revenue and hid the burn', () => {
  const r = computeBurnAndRunway(window7, 530 * M, asOf);
  assert.strictEqual(r.operating_inflows, 500 * M);
  assert.strictEqual(r.runway_reason, 'positive_cash_flow');
});

// Payroll share of the burn: of the 30M spent in the window, 15M paid payroll payment tx 2 →
// payroll_spend_daily = 15M / 30 = 500,000; the daily spend stays 1M.
t('the salaries inside the burn window are measured exactly (payroll_payments.transaction_id)', () => {
  const r = computeBurnAndRunway(window7.slice(0, 2), 100 * M, asOf, { payrollTxIds: new Set(['2']) });
  assert.deepStrictEqual([r.daily_spend, r.payroll_spend_daily], [1 * M, 0.5 * M]);
  assert.strictEqual(computeBurnAndRunway(window7.slice(0, 2), 100 * M, asOf).payroll_spend_daily, 0);
  assert.strictEqual(computeBurnAndRunway([], 0, asOf).payroll_spend_daily, 0);
});

t('payroll schedule: unpaid payments per date, last confirmed month, no names', () => {
  const rows = [
    { id: 'a', status: 'paid', period_month: '2026-09', payment_date: '2026-09-25', net_amount: 20 * M, transaction_id: 11, employee_name: 'X' },
    { id: 'b', status: 'paid', period_month: '2026-09', payment_date: '2026-09-25', net_amount: 19.5 * M, transaction_id: 12 },
    { id: 'c', status: 'scheduled', period_month: '2026-09', payment_date: '2026-09-25', net_amount: 20 * M },
    { id: 'd', status: 'draft', period_month: '2026-10', payment_date: '2026-10-25', net_amount: 30 * M },
    { id: 'e', status: 'draft', period_month: '2026-10', payment_date: '2026-10-25', net_amount: 29.5 * M },
    { id: 'f', status: 'cancelled', period_month: '2026-10', payment_date: '2026-10-25', net_amount: 99 * M },
    { id: 'g', status: 'scheduled', period_month: '2026-10', payment_date: '2026-10-25', net_amount: 5000, currency: 'USD' },
  ];
  const s = payrollSchedule(rows);
  assert.deepStrictEqual(s.payments, [
    { date: '2026-09-25', status: 'scheduled', period: '2026-09', amount: 20 * M, count: 1 },
    { date: '2026-10-25', status: 'draft', period: '2026-10', amount: 59.5 * M, count: 2 },
  ]);
  // The latest month with confirmed (paid or scheduled) IDR payments: September, 59.5M, paid on the 25th.
  assert.deepStrictEqual(s.last_confirmed, { period: '2026-09', amount: 59.5 * M, pay_day: 25, date: '2026-09-25', count: 3 });
  assert.deepStrictEqual([...s.tx_ids].sort(), ['11', '12']);
  assert.ok(!JSON.stringify(s.payments).includes('X'), 'no employee names');
});

// Financing. A 250M loan with 10 instalments of 25M (250M) plus an extra 25M row: 275M scheduled.
t('a loan schedule cannot promise more principal than was borrowed', () => {
  const sched = Array.from({ length: 10 }, (_, n) => ({ due_on: `2027-${String(n + 1).padStart(2, '0')}-05`, principal: 25 * M, interest: 0 }));
  const base = { source_kind: 'bank', instrument: 'loan', lender_name: 'Bank', amount: 250 * M, received_on: '2026-12-01' };
  assert.ok(!F.recordFromBody({ ...base, schedule: sched }).error);
  assert.strictEqual(F.recordFromBody({ ...base, schedule: [...sched, { due_on: '2027-11-05', principal: 25 * M }] }).error, 'schedule_exceeds_loan');
  assert.strictEqual(F.principalFits(250 * M, sched.map((r) => r.principal), 0), true);
  assert.strictEqual(F.principalFits(250 * M, sched.map((r) => r.principal), 25 * M), false);
  assert.strictEqual(F.principalFits(250 * M, [100 * M], 0.01), true);
});
// The clean company's state: 11 rows of 25M, 4 paid. Outstanding = 250 − 100 = 150M, but the 7 unpaid
// rows schedule 175M → schedule_excess 25M, shown on Funding instead of the two figures disagreeing silently.
t('Funding reports the gap between scheduled principal and what is owed', () => {
  const rec = { id: 'L', instrument: 'loan', status: 'active', amount: 250 * M };
  const reps = Array.from({ length: 11 }, (_, n) => ({ funding_record_id: 'L', due_on: `2026-${String(n + 1).padStart(2, '0')}-05`, principal: 25 * M, interest: 0, paid_on: n < 4 ? '2026-01-01' : null }));
  const s = F.summarize([rec], reps, { today: '2026-10-24' });
  assert.deepStrictEqual([s.totals.loans_outstanding, s.records[0].unpaid_principal, s.totals.schedule_excess], [150 * M, 175 * M, 25 * M]);
  const ok = F.summarize([rec], reps.slice(0, 10), { today: '2026-10-24' });
  assert.strictEqual(ok.totals.schedule_excess, 0);
});

// Tax calendar. PPh 21 for September: pay by 15 Oct, file by 20 Oct; today 24 Oct.
t('tax: money paid is not a filed return, and nothing is "done" without a recorded filing', () => {
  const d = { due: '2026-10-20', payBy: '2026-10-15', today: '2026-10-24' };
  assert.deepStrictEqual(taxStages(null, d), { payment_stage: 'overdue', filing_stage: 'overdue', stage: 'overdue' });
  assert.deepStrictEqual(taxStages({ payment_status: 'paid' }, d), { payment_stage: 'recorded', filing_stage: 'overdue', stage: 'overdue' });
  assert.deepStrictEqual(taxStages({ payment_status: 'paid' }, { ...d, today: '2026-10-18' }), { payment_stage: 'recorded', filing_stage: 'due', stage: 'paid' });
  assert.deepStrictEqual(taxStages({ payment_status: 'paid', filing_status: 'filed' }, d), { payment_stage: 'recorded', filing_stage: 'filed', stage: 'done' });
  // Before: payment_status 'paid' alone made the obligation 'done' ("Paid or filed").
  assert.strictEqual(taxStages(null, { ...d, today: '2026-10-16' }).stage, 'overdue'); // pay-by passed, nothing recorded
  assert.strictEqual(taxStages(null, { ...d, today: '2026-10-16', nilReturn: true }).stage, 'todo'); // nil return: nothing to pay
});

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
