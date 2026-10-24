// Payroll on its pay dates, for the cash forecast (financial integrity audit 2026-10-24). Pure;
// tested in tests/payrollSchedule.test.js.
//
// Radar used to spread salaries over the month as part of the measured day-to-day spending, so a
// gap on pay day (payroll and a loan repayment the same day) could stay hidden until weeks later.
// GET /api/pulse now returns this schedule; the client takes `burn_daily` out of the spending and
// puts the payroll back on its dates (client/src/v2/lib/radarSeries.js, payrollItems).
//
//   payments        unpaid payroll per date: 'scheduled' (confirmed) and 'draft' (an estimate), IDR
//                   net pay, totals only — no names, no per-person rows
//   last_confirmed  the latest month with a confirmed run (paid or scheduled payments): its total
//                   net pay and pay day, which the forecast repeats for later months as an estimate
//   tx_ids          operations that paid a payroll payment — their share of the burn window is
//                   burn_daily (computeBurnAndRunway, payrollTxIds)
// Cancelled payments and non-IDR payments are left out (never mixed into IDR without a rate).
'use strict';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isIdr = (p) => !p.currency || String(p.currency).toUpperCase() === 'IDR';
const day = (d) => String(d || '').slice(0, 10);
const pay = (p) => num(p.net_amount ?? p.amount);

function payrollSchedule(rows = []) {
  const live = (rows || []).filter((p) => p && p.status !== 'cancelled');
  const txIds = new Set(live.filter((p) => p.status === 'paid' && p.transaction_id != null).map((p) => String(p.transaction_id)));
  const groups = new Map();
  for (const p of live) {
    if (!['scheduled', 'draft'].includes(p.status) || !isIdr(p) || !(pay(p) > 0) || !day(p.payment_date)) continue;
    const k = `${day(p.payment_date)}|${p.status}|${p.period_month || ''}`;
    const g = groups.get(k) || { date: day(p.payment_date), status: p.status, period: p.period_month || null, amount: 0, count: 0 };
    g.amount += pay(p); g.count += 1;
    groups.set(k, g);
  }
  const confirmed = live.filter((p) => ['paid', 'scheduled'].includes(p.status) && isIdr(p) && /^\d{4}-\d{2}$/.test(p.period_month || ''));
  const period = confirmed.map((p) => p.period_month).sort().pop() || null;
  let last = null;
  if (period) {
    const inMonth = confirmed.filter((p) => p.period_month === period);
    const latestDate = inMonth.map((p) => day(p.payment_date)).filter(Boolean).sort().pop();
    last = { period, amount: inMonth.reduce((s, p) => s + pay(p), 0), pay_day: latestDate ? Number(latestDate.slice(8, 10)) : null, date: latestDate || null, count: inMonth.length };
  }
  return {
    payments: [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    last_confirmed: last,
    tx_ids: txIds,
  };
}

module.exports = { payrollSchedule };
