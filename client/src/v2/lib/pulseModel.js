// Pulse (design v2) — what the hero, "Needs your decision", "Next 7 days" and the
// four tiles show. Pure and tested (tests/design/v2PulseModel.test.mjs).
//
// Cash view only (DESIGN_SPEC rule 4). Every input is an existing response:
//   pulse     GET /api/pulse      (cash now, burn, runway, debts)
//   tx        GET /api/transactions (money in/out for the last 30 days, cashFlow)
//   insights  GET /api/pulse/advanced-insights   (last-30-day in/out, server classifier)
//   forecast  radarSeries.forecast()              (existing Radar rules, per day)
// Pending approval (DECISIONS.md, open question 2): items with approval_status
// 'pending_approval' are NOT in any Pulse total — not the server figures, not the
// forecast, not "Next 7 days". They appear here only as decisions; Radar lists them
// with a "Waiting for approval" tag.

import { classOf } from './cashClass.js'
import { txDate } from './obligations.js'

// Product default; a business may set its own (P-01, businesses.runway_target_days).
export const RUNWAY_TARGET_DAYS = 60

/** The runway target in days: the business setting when it is a sane number, else 60. */
export function runwayTarget(targets) {
  const n = Number(targets?.runway_target_days)
  return Number.isInteger(n) && n >= 1 && n <= 730 ? n : RUNWAY_TARGET_DAYS
}

/** Minimum cash (P-08) when set, else null. */
export function minCash(targets) {
  const v = targets?.min_cash_idr
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
// The server returns 999 when there is no burn to measure runway against.
export const RUNWAY_UNKNOWN = 999

/** Runway in days, or null when the server could not measure it. */
export function runwayDays(pulse) {
  const r = Number(pulse?.runway)
  if (!Number.isFinite(r) || r >= RUNWAY_UNKNOWN || r < 0) return null
  return Math.round(r)
}

/**
 * Overall status from runway and the 30-day forecast.
 *   crit  runway ≤ 14 days, or expected cash below zero inside 30 days
 *   warn  runway below the target, or expected cash dips under the minimum cash (P-08)
 *   good  otherwise (including "no burn measured")
 */
export function pulseStatus({ runway, lowestExpected, target = RUNWAY_TARGET_DAYS, floor = null }) {
  if ((runway != null && runway <= 14) || (lowestExpected != null && lowestExpected < 0)) return 'crit'
  if (runway != null && runway < target) return 'warn'
  if (floor != null && lowestExpected != null && lowestExpected < floor) return 'warn'
  return 'good'
}

/** Headline copy key for the hero. */
export function headlineKey(status, { runway, lowestExpected, target = RUNWAY_TARGET_DAYS, floor = null }) {
  if (status === 'crit') return lowestExpected != null && lowestExpected < 0 ? 'pulse.head.short' : 'pulse.head.critical'
  if (status === 'warn') return runway != null && runway < target ? 'pulse.head.belowTarget' : (floor != null ? 'pulse.head.belowFloor' : 'pulse.head.belowTarget')
  return runway == null ? 'pulse.head.noBurn' : 'pulse.head.covered'
}

const OPEN = (d) => d && !['paid', 'cancelled'].includes(d.status)
// A date-only 'YYYY-MM-DD' is that LOCAL day (new Date() would read it as UTC midnight).
const localDay = (v) => {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  const x = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v)
  x.setHours(0, 0, 0, 0); return x
}
const amt = (d) => Number(d.remaining_amount ?? d.amount ?? 0)

/**
 * "Needs your decision" rows, most urgent first:
 *   approval  open items waiting for approval (Review → bill, Approve → Approvals)
 *   late      overdue receivables (Send reminder → Bills & invoices)
 *   tax       obligations the verified engine CALCULATED, due within 31 days
 */
export function decisions({ debts = [], obligations = [], today = new Date() } = {}) {
  const out = []
  for (const d of debts) {
    if (!OPEN(d) || d.approval_status !== 'pending_approval') continue
    out.push({ kind: 'approval', id: d.id, type: d.type, label: d.counterparty || d.description || '',
      note: d.description || '', amount: amt(d), due_date: d.due_date || null, channel: d.source || d.created_via || null })
  }
  for (const d of debts) {
    if (!OPEN(d) || d.type !== 'receivable' || d.status !== 'overdue') continue
    if (d.approval_status && d.approval_status !== 'approved') continue
    out.push({ kind: 'late', id: d.id, label: d.counterparty || '', note: d.description || '',
      amount: amt(d), due_date: d.due_date, days: Number(d.days_overdue) || 0 })
  }
  const t0 = localDay(today)
  for (const o of obligations) {
    if (!o || o.status !== 'calculated' || !o.due_date) continue
    const due = localDay(o.due_date)
    if (Number.isNaN(due.getTime())) continue
    const days = Math.round((Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) - Date.UTC(t0.getFullYear(), t0.getMonth(), t0.getDate())) / 86400000)
    if (days > 31) continue
    // Past the due date: overdue by -days, never "0 days left".
    out.push({ kind: 'tax', id: `${o.obligation_type}:${o.period}`, label: o.title, period: o.period,
      amount: Number(o.amount), due_date: o.due_date, days, overdue: days < 0 })
  }
  return out
}

/** Next 7 days from the dated forecast items and the measured burn. */
export function nextDays(items, { burnRate = 0, forecastDays = [], days = 7 } = {}) {
  const within = items.filter((it) => it.day <= days && it.counted !== false)
  const comingIn = within.filter((it) => it.dir === 'in').reduce((s, x) => s + x.amount, 0)
  const goingOutItems = within.filter((it) => it.dir === 'out').reduce((s, x) => s + x.amount, 0)
  const dayToDay = Math.max(0, Number(burnRate) || 0) * days
  const at = forecastDays.find((x) => x.day === days) || null
  return {
    comingIn, goingOut: goingOutItems + dayToDay, dayToDay,
    list: within.filter((it) => it.day > 0 || it.tag !== 'late'),
    cashOn: at ? { date: at.date, value: at.expected } : null,
  }
}

/** Cash in/out for a window, from the server classifier's metrics. Funding, transfers,
 *  opening balances and corrections are not money in or out of operations. */
export function flowOf(metrics) {
  if (!metrics) return null
  const m = metrics
  const moneyIn = Number(m.operating_revenue ?? m.revenue ?? 0)
  const moneyOut = Number(m.operating_cash_out ?? 0) + Number(m.capex ?? 0)
    + Number(m.tax_expense ?? 0) + Number(m.interest_expense ?? 0)
  return { moneyIn, moneyOut, net: moneyIn - moneyOut, capex: Number(m.capex ?? 0) }
}

/**
 * Money that actually moved through the company's accounts in [from, to] (inclusive ISO dates),
 * from its transactions — every row of this company, whatever its scope label. Opening
 * balances, transfers between own accounts and balance corrections are not money in or out.
 * Unlike flowOf it does not drop rows the classifier cannot name ("Payment: …" without a
 * category): they are real cash, so they count, and `unclassified` says how many there are.
 */
const NOT_A_MOVE = ['opening_balance', 'transfer', 'balance_correction']
export function cashFlow(transactions = [], { from, to }) {
  let moneyIn = 0, moneyOut = 0, capex = 0, unclassified = 0, count = 0
  for (const t of Array.isArray(transactions) ? transactions : []) {
    if (!t) continue
    if (t.currency_original && t.currency_original !== 'IDR' && t.amount_idr == null) continue
    const d = txDate(t).slice(0, 10)
    if (!d || d < from || d > to) continue
    const sign = t.type === 'income' ? 1 : (t.type === 'expense' || t.type === 'payroll') ? -1 : 0
    if (!sign) continue
    const cls = classOf(t)
    if (NOT_A_MOVE.includes(cls)) continue
    const a = Math.abs(Number(t.amount_idr != null ? t.amount_idr : (t.amount_original ?? t.amount ?? 0))) || 0
    if (sign > 0) moneyIn += a; else moneyOut += a
    if (cls === 'capex' && sign < 0) capex += a
    if (cls === 'unknown') unclassified++
    count++
  }
  return { moneyIn, moneyOut, net: moneyIn - moneyOut, capex, unclassified, count }
}

/** Percentage change, or null when there is no base to compare with. */
export function pctChange(now, before) {
  if (!(Number(before) > 0)) return null
  return Math.round(((Number(now) - Number(before)) / Number(before)) * 100)
}

/**
 * Owed to you / You owe tiles. Totals, counts and late amounts all come from ONE filter —
 * open, confirmed (approved or no approval step), IDR — so a tile never shows a total that
 * its own count or "late" line does not add up to. Pending approval stays out (DECISIONS q2);
 * other currencies are not added to IDR without conversion.
 */
export function obligationTiles(pulse) {
  const debts = Array.isArray(pulse?.debts) ? pulse.debts : []
  const confirmed = debts.filter((d) => OPEN(d) && (d.approval_status === 'approved' || !d.approval_status) && ((d.currency || 'IDR') === 'IDR' || d.amount_idr != null))
  const rec = confirmed.filter((d) => d.type === 'receivable')
  const pay = confirmed.filter((d) => d.type === 'payable')
  const sum = (xs) => xs.reduce((s, d) => s + (d.amount_idr != null ? Number(d.amount_idr) : amt(d)), 0)
  const late = (xs) => xs.filter((d) => d.status === 'overdue')
  return {
    owedToYou: sum(rec), owedLate: sum(late(rec)), owedCount: rec.length,
    youOwe: sum(pay), oweCount: pay.length, oweLate: sum(late(pay)), oweLateCount: late(pay).length,
  }
}
