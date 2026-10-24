// Financial integrity audit 2026-10-24 — cash gap scenarios. Every expected figure below was worked
// out by hand from the stated inputs (the comment above each case shows the arithmetic) and is then
// compared with the existing engine: radarSeries (Radar / Pulse / Forecast), pulseModel and
// performance. Run: node tests/design/v2CashGapScenarios.test.mjs
import assert from 'node:assert'
import { cashItems, forecast, forecastBurn, applyScenario, withoutLateInflows, LATE_SHIFT_DAYS } from '../../client/src/v2/lib/radarSeries.js'
import { pulseStatus, headlineKey, runwayGap } from '../../client/src/v2/lib/pulseModel.js'
import { cashOutDate, threeMonths } from '../../client/src/v2/lib/performance.js'
import { money } from '../../client/src/v2/lib/format.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
const M = 1e6
const today = new Date(2026, 10, 2, 10) // Monday 2 November 2026, local time
const D = (n) => { const d = new Date(2026, 10, 2 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const bill = (id, type, amount, day, extra = {}) => ({ id, type, counterparty: `${type}-${id}`, amount, remaining_amount: amount, due_date: D(day), status: day < 0 ? 'overdue' : 'open', approval_status: 'approved', ...extra })
const run = ({ balance, burn, debts = [], repayments = [], payroll = null, horizon = 30, pulse = null }) => {
  const { items, excluded } = cashItems({ debts, repayments, payroll, horizon, today })
  const burnRate = pulse ? forecastBurn(pulse) : burn
  return { items, excluded, f: forecast({ balance, burnRate, items, horizon, today }), burnRate }
}
const day = (f, n) => f.days[n].expected

console.log('\nCash gap scenarios (independent expectations)')

// 1. B 100M, burn 1M/day, +20M on day 10, −15M on day 20, 90 days.
//    day 90 = 100 − 90 + 20 − 15 = 15M (the lowest); never below zero.
t('1 positive balance for all 90 days', () => {
  const { f } = run({ balance: 100 * M, burn: 1 * M, debts: [bill(1, 'receivable', 20 * M, 10), bill(2, 'payable', 15 * M, 20)], horizon: 90 })
  assert.strictEqual(f.end.value, 15 * M)
  assert.deepStrictEqual([f.lowest.value, f.lowest.day], [15 * M, 90])
  assert.strictEqual(f.firstShortfall, null)
  // Cash-out: 15M left at 1M/day (30M a month) → 15 more days → day 105.
  assert.strictEqual(cashOutDate({ days: f.days, burnMonthly: 30 * M, today }).date, new Date(Date.UTC(2026, 10, 2 + 105)).toISOString().slice(0, 10))
})

// 2. B 30M, burn 1M, −25M on day 12, +40M on day 20.
//    day 11 = 19M; day 12 = 30 − 12 − 25 = −7M (first shortfall); day 19 = −14M (lowest); day 20 = +25M.
t('2 a cash gap on day 12 is found, with its depth and the day it ends', () => {
  const { f } = run({ balance: 30 * M, burn: 1 * M, debts: [bill(1, 'payable', 25 * M, 12), bill(2, 'receivable', 40 * M, 20)] })
  assert.strictEqual(day(f, 11), 19 * M)
  assert.deepStrictEqual([f.firstShortfall.date, f.firstShortfall.value], [D(12), -7 * M])
  assert.deepStrictEqual([f.lowest.date, f.lowest.value], [D(19), -14 * M])
  assert.strictEqual(f.firstShortfall.recovers.date, D(20))
  assert.strictEqual(day(f, 20), 25 * M)
  const s = pulseStatus({ runway: 90, lowestExpected: f.lowest.value })
  assert.strictEqual(s, 'crit'); assert.strictEqual(headlineKey(s, { runway: 90, lowestExpected: f.lowest.value }), 'pulse.head.short')
  assert.strictEqual(cashOutDate({ days: f.days, burnMonthly: 30 * M, today }).date, D(12))
})

// 3. B 10M, burn 0.5M, −15M overdue (lands today), +20M on day 5.
//    day 0 = −5M; day 4 = −7M (lowest); day 5 = 10 − 15 + 20 − 2.5 = 12.5M.
t('3 a negative balance today that recovers after a customer payment', () => {
  const { f } = run({ balance: 10 * M, burn: 0.5 * M, debts: [bill(1, 'payable', 15 * M, -3), bill(2, 'receivable', 20 * M, 5)] })
  assert.deepStrictEqual([f.firstShortfall.day, f.firstShortfall.value], [0, -5 * M])
  assert.deepStrictEqual([f.lowest.day, f.lowest.value], [4, -7 * M])
  assert.deepStrictEqual([f.firstShortfall.recovers.day, day(f, 5)], [5, 12.5 * M])
})

// 4. Case 2 with the customer 30 days late (due day 50), 90 days.
//    day 49 = 30 − 49 − 25 = −44M; day 50 = −5M; day 90 = 30 − 90 − 25 + 40 = −45M (lowest, no recovery).
t('4 a customer paying 30 days late: the gap never closes inside 90 days', () => {
  const { f } = run({ balance: 30 * M, burn: 1 * M, debts: [bill(1, 'payable', 25 * M, 12), bill(2, 'receivable', 40 * M, 50)], horizon: 90 })
  assert.deepStrictEqual([day(f, 49), day(f, 50), f.lowest.value, f.lowest.day], [-44 * M, -5 * M, -45 * M, 90])
  assert.strictEqual(f.firstShortfall.recovers, null)
  // The Radar "pays late" chip moves a payment by LATE_SHIFT_DAYS (14), not 30: the receipt lands on
  // day 34 — day 33 = 30 − 33 − 25 = −28M, day 34 = −29 + 40 = 11M, day 90 = −45M. A 30-day delay
  // needs the due date changed.
  const { items } = cashItems({ debts: [bill(1, 'payable', 25 * M, 12), bill(2, 'receivable', 40 * M, 20)], horizon: 90, today })
  const late = forecast({ balance: 30 * M, burnRate: 1 * M, items: applyScenario(items, { kind: 'late', key: 'debt:2' }), horizon: 90, today })
  assert.strictEqual(LATE_SHIFT_DAYS, 14)
  assert.deepStrictEqual([day(late, 33), day(late, 34), late.lowest.value], [-28 * M, 11 * M, -45 * M])
})

// 5. B 80M; measured spend 2.5M/day of which salaries 2M/day; payroll 60M and a loan repayment 26.8M
//    both on day 10. Correct: day 10 = 80 − 0.5×10 − 60 − 26.8 = −11.8M (first shortfall);
//    day 30 = −11.8 − 0.5×20 = −21.8M (lowest).
const payroll5 = { available: true, burn_daily: 2 * M, last_confirmed: { period: '2026-10', amount: 60 * M, pay_day: 12, date: '2026-10-12' },
  payments: [{ date: D(10), status: 'scheduled', period: '2026-11', amount: 60 * M, count: 5 }] }
const loan5 = [{ id: 'r1', due_on: D(10), amount: 26.8 * M }]
t('5 payroll and a loan repayment on the same day: the gap is on that day', () => {
  const { f, burnRate } = run({ balance: 80 * M, repayments: loan5, payroll: payroll5, pulse: { burnRate: 2.5 * M, payroll_schedule: payroll5 } })
  assert.strictEqual(burnRate, 0.5 * M)
  assert.strictEqual(day(f, 9), 75.5 * M)
  assert.deepStrictEqual([f.firstShortfall.date, Math.round(f.firstShortfall.value)], [D(10), -11.8 * M])
  assert.deepStrictEqual([f.lowest.day, Math.round(f.lowest.value)], [30, -21.8 * M])
})
// Before the fix (no payroll schedule): salaries spread over the month, so the first shortfall was
// day 22 (80 − 26.8 − 2.5×22 = −1.8M) — twelve days after the real one.
t('5 regression: without the schedule the same company shows the gap only on day 22', () => {
  const { f } = run({ balance: 80 * M, burn: 2.5 * M, repayments: loan5 })
  assert.deepStrictEqual([f.firstShortfall.day, Math.round(f.firstShortfall.value)], [22, -1.8 * M])
})
t('5 later months repeat the last confirmed payroll on its pay day (estimate), 90 days', () => {
  const { items } = run({ balance: 80 * M, repayments: loan5, payroll: payroll5, horizon: 90, pulse: { burnRate: 2.5 * M, payroll_schedule: payroll5 } })
  const pay = items.filter((i) => i.source === 'payroll')
  assert.deepStrictEqual(pay.map((i) => [i.date, i.amount, i.tag]), [[D(10), 60 * M, 'scheduled'], ['2026-12-12', 60 * M, 'estimated'], ['2027-01-12', 60 * M, 'estimated']])
})

// Found by the live reconciliation (PT Contoh Kas Ketat): October's salary is PAID on 5 November. The
// estimates must follow pay dates — 5 Dec and 5 Jan — and never add a second payroll on 5 Nov.
t('5 a payroll period paid in the next month is not counted twice', () => {
  const p = { available: true, burn_daily: 1.5 * M, last_confirmed: { period: '2026-10', amount: 45 * M, pay_day: 5, date: '2026-11-05' },
    payments: [{ date: '2026-11-05', status: 'scheduled', period: '2026-10', amount: 45 * M, count: 3 }] }
  const { items } = cashItems({ payroll: p, horizon: 90, today: new Date(2026, 9, 24, 10) })
  assert.deepStrictEqual(items.map((i) => [i.date, i.amount, i.tag]), [['2026-11-05', 45 * M, 'scheduled'], ['2026-12-05', 45 * M, 'estimated'], ['2027-01-05', 45 * M, 'estimated']])
})

// 6. B 10M, burn 0.5M, a receivable 30M overdue 60 days, a bill 12M on day 8.
//    Counted as paid today: day 30 = 40 − 15 − 12 = 13M (lowest, never below zero).
//    Without it: day 8 = 10 − 4 − 12 = −6M; day 30 = 10 − 15 − 12 = −17M.
t('6 an overdue receivable that may never be paid: Pulse warns instead of "covered"', () => {
  const { items, f } = run({ balance: 10 * M, burn: 0.5 * M, debts: [bill(1, 'receivable', 30 * M, -60, { days_overdue: 60 }), bill(2, 'payable', 12 * M, 8)] })
  assert.deepStrictEqual([f.lowest.value, f.firstShortfall], [13 * M, null])
  const noLate = forecast({ balance: 10 * M, burnRate: 0.5 * M, items: withoutLateInflows(items), today })
  assert.deepStrictEqual([noLate.firstShortfall.date, noLate.lowest.value], [D(8), -17 * M])
  const judged = { runway: 100, lowestExpected: f.lowest.value, lowestWithoutLate: noLate.lowest.value }
  assert.strictEqual(pulseStatus(judged), 'warn')
  assert.strictEqual(headlineKey('warn', judged), 'pulse.head.dependsOnLate')
  // Before: the same inputs were 'good' / "You're covered".
  assert.strictEqual(pulseStatus({ runway: 100, lowestExpected: f.lowest.value }), 'good')
})

// 7. A large financing inflow is never revenue — server side (burn), see tests/financialIntegrityAudit.test.js.

// 8. Empty company: no history, no items. B 0 → flat 0; runway not measured.
t('8 an empty company is "not enough data", never "covered"', () => {
  const { f } = run({ balance: 0, burn: 0 })
  assert.deepStrictEqual([f.lowest.value, f.end.value, f.firstShortfall], [0, 0, null])
  const gap = runwayGap({ runway: null, runway_reason: 'insufficient_data' })
  assert.strictEqual(gap, 'no_data')
  const s = pulseStatus({ runway: null, lowestExpected: 0, gap })
  assert.strictEqual(s, 'unknown'); assert.strictEqual(headlineKey(s, { runway: null, gap }), 'pulse.head.noData')
  assert.strictEqual(runwayGap({ has_unvalued_tx: true }), 'incomplete')
  assert.strictEqual(headlineKey('unknown', { gap: 'incomplete' }), 'pulse.head.incomplete')
  // Positive cash flow is a real answer, not missing data.
  assert.strictEqual(pulseStatus({ runway: null, lowestExpected: 5 * M, gap: runwayGap({ runway_reason: 'positive_cash_flow' }) }), 'good')
  // No burn measured: no cash-out date, and the caller shows "not measured" (burnMonthly == null).
  assert.strictEqual(cashOutDate({ days: f.days, burnMonthly: undefined, today }), null)
})

// 9. Missing or partly confirmed obligations.
t('9 pending, draft, undated, foreign and uncalculated items are handled as documented', () => {
  const draftPay = { available: true, burn_daily: 0, last_confirmed: null, payments: [{ date: D(5), status: 'draft', period: '2026-11', amount: 40 * M, count: 4 }] }
  const { items, excluded, f } = run({ balance: 100 * M, burn: 0, payroll: draftPay, debts: [
    bill(1, 'payable', 50 * M, 5, { approval_status: 'pending_approval' }),
    bill(2, 'payable', 7 * M, 5, { due_date: null }),
    bill(3, 'payable', 300, 5, { currency: 'USD' }),
  ] })
  // pending: listed, not counted; draft payroll: counted as an estimate; undated / foreign: left out with a count.
  // Same day: the larger outflow first (50M bill, then the 40M payroll).
  assert.deepStrictEqual(items.map((i) => [i.key, i.counted, i.tag]), [['debt:1', false, 'approval'], ['payroll:2026-11:draft:' + D(5), true, 'estimated']])
  assert.deepStrictEqual(excluded, { foreign: 1, undated: 1 })
  assert.strictEqual(f.end.value, 60 * M) // 100 − 40 (draft payroll); the pending 50M is not counted
  // A tax obligation counts only when the engine CALCULATED it.
  const tax = cashItems({ obligations: [{ status: 'estimated', due_date: D(3), amount: 5 * M, obligation_type: 'pph21', period: '2026-10' }], today }).items
  assert.strictEqual(tax.length, 0)
})

// 10. B 5M, burn 0.2M, −20M day 3, loan −10M day 35, +60M day 70, 90 days.
//     day 3 = 5 − 0.6 − 20 = −15.6M; day 69 = 5 − 13.8 − 30 = −38.8M (lowest); day 70 = 21M; day 90 = 17M.
t('10 negative for weeks, then a later recovery — and the month ends agree with the series', () => {
  const { f } = run({ balance: 5 * M, burn: 0.2 * M, debts: [bill(1, 'payable', 20 * M, 3), bill(2, 'receivable', 60 * M, 70)], repayments: [{ id: 'l', due_on: D(35), amount: 10 * M }], horizon: 90 })
  const r = (v) => Math.round(v)
  assert.deepStrictEqual([f.firstShortfall.day, r(f.firstShortfall.value)], [3, -15.6 * M])
  assert.deepStrictEqual([f.lowest.day, r(f.lowest.value), f.firstShortfall.recovers.day], [69, -38.8 * M, 70])
  assert.deepStrictEqual([r(day(f, 70)), r(f.end.value)], [21 * M, 17 * M])
  // Month ends from 2 Nov: 30 Nov = day 28 → 5 − 5.6 − 20 = −20.6M; 31 Dec = day 59 → 5 − 11.8 − 30 = −36.8M;
  // 31 Jan = day 90 → 17M. Before the fix months 2–3 were "minus the burn" and missed the 10M loan.
  assert.deepStrictEqual(threeMonths({ days: f.days, burnMonthly: 6 * M, today }).map((m) => [m.month, r(m.cash), m.source]),
    [['2026-11', -20.6 * M, 'radar'], ['2026-12', -36.8 * M, 'radar'], ['2027-01', 17 * M, 'radar']])
})

// Dates, rounding and formatting.
t('a date-only due date is the local day, late at night and just after midnight', () => {
  for (const now of [new Date(2026, 10, 2, 23, 59), new Date(2026, 10, 2, 0, 1)]) {
    const { items } = cashItems({ debts: [{ id: 1, type: 'payable', amount: 1, remaining_amount: 1, due_date: '2026-11-03', status: 'open' }], today: now })
    assert.strictEqual(items[0].day, 1)
  }
})
t('IDR shortfalls are shown with a true minus sign and no rounding to zero', () => {
  assert.strictEqual(money(-11.8 * M), '−Rp 11.8M')
  assert.strictEqual(money(-21_800_000), '−Rp 21.8M')
  assert.strictEqual(money(26_800_000, { full: true }), 'Rp 26,800,000')
  assert.strictEqual(money(-40_000), '−Rp 40K')
})

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
