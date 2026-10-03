// Pulse (design v2) — what the hero, "Needs your decision", "Next 7 days" and the
// four tiles show. Pure and tested (tests/design/v2PulseModel.test.mjs).
//
// Cash view only (DESIGN_SPEC rule 4). Every input is an existing response:
//   pulse     GET /api/pulse?scope=business      (cash now, burn, runway, debts)
//   insights  GET /api/pulse/advanced-insights   (last-30-day in/out, server classifier)
//   forecast  radarSeries.forecast()              (existing Radar rules, per day)
// Pulse totals are NOT changed: pending_approval items stay out of the figures the
// server computes; they appear here only as decisions (rule 2, open question).

// Product default until a per-business runway target exists (PROPOSALS.md P-01).
export const RUNWAY_TARGET_DAYS = 60
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
 *   warn  runway below target
 *   good  otherwise (including "no burn measured")
 */
export function pulseStatus({ runway, lowestExpected, target = RUNWAY_TARGET_DAYS }) {
  if ((runway != null && runway <= 14) || (lowestExpected != null && lowestExpected < 0)) return 'crit'
  if (runway != null && runway < target) return 'warn'
  return 'good'
}

/** Headline copy key for the hero. */
export function headlineKey(status, { runway, lowestExpected }) {
  if (status === 'crit') return lowestExpected != null && lowestExpected < 0 ? 'pulse.head.short' : 'pulse.head.critical'
  if (status === 'warn') return 'pulse.head.belowTarget'
  return runway == null ? 'pulse.head.noBurn' : 'pulse.head.covered'
}

const OPEN = (d) => d && !['paid', 'cancelled'].includes(d.status)
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
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0)
  for (const o of obligations) {
    if (!o || o.status !== 'calculated' || !o.due_date) continue
    const days = Math.round((new Date(o.due_date) - t0) / 86400000)
    if (days > 31) continue
    out.push({ kind: 'tax', id: `${o.obligation_type}:${o.period}`, label: o.title, period: o.period,
      amount: Number(o.amount), due_date: o.due_date, days })
  }
  return out
}

/** Next 7 days from the dated forecast items and the measured burn. */
export function nextDays(items, { burnRate = 0, forecastDays = [], days = 7 } = {}) {
  const within = items.filter((it) => it.day <= days)
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

/** Percentage change, or null when there is no base to compare with. */
export function pctChange(now, before) {
  if (!(Number(before) > 0)) return null
  return Math.round(((Number(now) - Number(before)) / Number(before)) * 100)
}

/** Owed to you / You owe tiles from the server's confirmed totals and the debt list. */
export function obligationTiles(pulse) {
  const debts = Array.isArray(pulse?.debts) ? pulse.debts : []
  const confirmed = debts.filter((d) => OPEN(d) && (d.approval_status === 'approved' || !d.approval_status))
  const rec = confirmed.filter((d) => d.type === 'receivable')
  const pay = confirmed.filter((d) => d.type === 'payable')
  const lateSum = (xs) => xs.filter((d) => d.status === 'overdue').reduce((s, d) => s + amt(d), 0)
  return {
    owedToYou: Number(pulse?.receivables ?? 0), owedLate: lateSum(rec),
    youOwe: Number(pulse?.payables ?? 0), oweCount: pay.length, oweLate: lateSum(pay),
    oweLateCount: pay.filter((d) => d.status === 'overdue').length,
  }
}
