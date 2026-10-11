// Performance (design v2) — Profit / Cash / Forecast and the drill-down.
// Pure; tested in tests/design/v2Performance.test.mjs. Follows specs/PERFORMANCE_METRICS.md
// as far as existing data allows, and says where it cannot:
//
//  * Profit: the spec asks for ACCRUAL figures from a category→group mapping. That mapping
//    does not exist (PROPOSALS P-10), so the Profit tab shows the server classifier's monthly
//    series (GET /api/pulse/advanced-insights → series: revenue, direct_costs, opex, …) as an
//    ESTIMATE, labelled "counted when money moved". Depreciation needs the asset register
//    (P-11) and is shown as not available — never as zero.
//  * Cash: operating cash flow = revenue − (direct + operating costs + tax + interest paid)
//    from the same classifier. A month with unclassified money ("needs review") is flagged
//    `incomplete`, because the true figure may be lower or higher. Equipment = capex.
//    Funding is SIGNED, from the transactions themselves (lib/cashClass.js mirrors the
//    server classifier): money in (loans, owner money) is +, repayments, withdrawals and
//    dividends are −. Month-end cash walks back from today's balance over recorded
//    transactions with the cash-impact rules /api/pulse uses.
//  * Burn = average of (operating cash flow + equipment) over the last 3 full months, as a
//    positive number when cash is going out. Runway = cash ÷ burn × 30.
//  * Forecast: the Radar 30-day series (lib/radarSeries.js); after that, the average burn.
//    Loan repayments are not known (no funding register, P-03) and are said to be missing.
import { csvCell } from './csv.js'
import { txDate } from './obligations.js'
import { classOf, COST_CLASSES } from './cashClass.js'

const pad = (n) => String(n).padStart(2, '0')
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** Last n month keys, oldest first, ending with the current month. */
export function lastMonths(n = 12, today = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  return out
}
export const monthStart = (key) => `${key}-01`
export const monthEnd = (key) => { const [y, m] = key.split('-').map(Number); const e = new Date(y, m, 0); return `${y}-${pad(m)}-${pad(e.getDate())}` }
export const prevMonth = (key) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }

/** Profit rows (estimate) per month from the classifier series; missing months are zeros-with-flag. */
export function profitRows(series = [], months) {
  const by = Object.fromEntries((series || []).map((s) => [s.period, s]))
  return months.map((k) => {
    const s = by[k]
    if (!s) return { month: k, empty: true, revenue: 0, direct: 0, gross: 0, opex: 0, ebitda: 0, tax: 0, interest: 0, net: 0, margin: null }
    const revenue = num(s.revenue), direct = num(s.direct_costs), opex = num(s.opex)
    const gross = revenue - direct
    const ebitda = gross - opex
    const tax = num(s.tax_expense), interest = num(s.interest_expense)
    return { month: k, empty: false, revenue, direct, gross, opex, ebitda, tax, interest,
      net: ebitda - interest - (ebitda - interest > 0 ? tax : 0), margin: revenue > 0 ? gross / revenue : null }
  })
}

// Cash-impact rules — the same split /api/pulse uses for the balance.
const CASH_IN = ['income']
const CASH_OUT = ['expense', 'payroll']
export function txCashDelta(t) {
  const a = num(t.amount_idr != null ? t.amount_idr : t.amount_original)
  if (CASH_IN.includes(t.type)) return a
  if (CASH_OUT.includes(t.type)) return -a
  if (t.type === 'correction') return a
  return 0
}

// Scope labels: inside a company every row the server returns belongs to that company (it
// filters by business_id). The `scope` column is only a label — the database default is
// 'personal', so most company payments carry it — and is not ownership. Personal money lives
// in the separate Personal workspace and never reaches these endpoints. So no row is dropped
// for its label (same rule as _specs/accounts-personal-scope-ambiguity.md).
const isBizIdr = (t) => !(t.currency_original && t.currency_original !== 'IDR' && t.amount_idr == null)

/** Cash rows per month: operating, equipment, signed funding and month-end cash (walk-back). */
export function cashRows({ series = [], transactions = [], balance = 0, months }) {
  const by = Object.fromEntries((series || []).map((s) => [s.period, s]))
  const deltaBy = {}
  const fundIn = {}, fundOut = {}
  for (const t of transactions) {
    if (!isBizIdr(t)) continue
    const k = txDate(t).slice(0, 7)
    const d = txCashDelta(t)
    deltaBy[k] = num(deltaBy[k]) + d
    if (classOf(t) === 'financing') {
      if (d > 0) fundIn[k] = num(fundIn[k]) + d
      else if (d < 0) fundOut[k] = num(fundOut[k]) - d
    }
  }
  // End-of-month cash: today's balance minus everything that moved after that month.
  const allKeys = Object.keys(deltaBy).sort()
  const endCash = {}
  for (const k of months) endCash[k] = num(balance) - allKeys.filter((x) => x > k).reduce((s, x) => s + deltaBy[x], 0)
  return months.map((k) => {
    const s = by[k] || {}
    const costs = num(s.direct_costs) + num(s.opex) + num(s.tax_expense) + num(s.interest_expense)
    const operating = num(s.revenue) - costs
    const fIn = num(fundIn[k]), fOut = num(fundOut[k])
    return { month: k, operating, equipment: num(s.capex), funding: fIn - fOut, fundingIn: fIn, fundingOut: fOut,
      endCash: endCash[k], free: operating - num(s.capex), empty: !by[k],
      unclassified: num(s.other_cash_movement?.needs_review), incomplete: num(s.other_cash_movement?.needs_review) > 0 }
  })
}

/** Burn over the last 3 FULL months (excludes the current month). Positive = cash going out. */
export function burn3(rows, currentKey) {
  const full = rows.filter((r) => r.month !== currentKey && !r.empty).slice(-3)
  if (!full.length) return null
  const avg = full.reduce((s, r) => s + (r.operating - r.equipment), 0) / full.length
  return { monthly: -avg, months: full.map((r) => r.month), incomplete: full.some((r) => r.incomplete),
    perMonth: full.map((r) => ({ month: r.month, value: r.operating - r.equipment, incomplete: !!r.incomplete })) }
}

export function runwayFrom(cash, burnMonthly) {
  if (!(burnMonthly > 0)) return null
  return Math.max(0, Math.round((num(cash) / burnMonthly) * 30))
}

/** Radar items grouped by week (days 0–6, 7–13, …) for the next horizon. */
export function weekBuckets(items = [], { horizon = 30, today = new Date() } = {}) {
  const weeks = []
  for (let s = 0; s <= horizon; s += 7) {
    const e = Math.min(s + 6, horizon)
    const from = new Date(today); from.setDate(from.getDate() + s)
    const to = new Date(today); to.setDate(to.getDate() + e)
    weeks.push({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), in: 0, out: 0 })
  }
  for (const it of items) {
    const w = weeks[Math.floor(it.day / 7)]
    if (!w) continue
    if (it.dir === 'in') w.in += it.amount; else w.out += it.amount
  }
  return weeks
}

/**
 * Cash-out date: walk the Radar series; if cash stays above zero for 30 days, continue
 * from day 30 at the average burn. Null when there is no burn (cash is not running out).
 */
export function cashOutDate({ days = [], burnMonthly, today = new Date() }) {
  const hit = days.find((d) => d.expected < 0)
  if (hit) return { date: hit.date, from: 'radar' }
  if (!(burnMonthly > 0) || !days.length) return null
  const last = days[days.length - 1]
  const more = Math.ceil(last.expected / (burnMonthly / 30))
  const d = new Date(today); d.setDate(d.getDate() + last.day + more)
  return { date: d.toISOString().slice(0, 10), from: 'burn' }
}

/** Month-end cash for the next 3 months: Radar for this month's end, then the average burn. */
export function threeMonths({ days = [], burnMonthly, today = new Date() }) {
  const out = []
  if (!days.length) return out
  const end0 = monthEnd(`${today.getFullYear()}-${pad(today.getMonth() + 1)}`)
  const at = days.find((d) => d.date === end0) || days[days.length - 1]
  let cash = at.expected
  out.push({ month: end0.slice(0, 7), cash, source: 'radar' })
  for (let i = 1; i < 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    cash -= burnMonthly > 0 ? burnMonthly : 0
    out.push({ month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, cash, source: 'burn' })
  }
  return out
}

/**
 * Drill-down: what changed in `month` vs `compare`, from transactions.
 * Revenue counts only rows the classifier calls revenue; costs only direct and operating
 * costs. Everything else (opening balances, loans, owner money, transfers, tax, interest,
 * equipment, unclassified) is listed separately as `excluded`, by class and signed.
 */
export function monthCompare(transactions = [], month, compare) {
  const pick = (k) => transactions.filter((t) => txDate(t).slice(0, 7) === k && isBizIdr(t))
  const split = (rows) => {
    const costs = {}, excluded = {}
    let revenue = 0
    for (const t of rows) {
      const d = txCashDelta(t)
      if (!d) continue
      const cls = classOf(t)
      if (cls === 'revenue') revenue += d
      else if (COST_CLASSES.includes(cls)) {
        const c = String(t.category || '').trim() || '—'
        costs[c] = num(costs[c]) - d
      } else excluded[cls] = num(excluded[cls]) + d
    }
    return { costs, excluded, revenue }
  }
  const a = pick(month), b = compare ? pick(compare) : []
  const A = split(a), B = split(b)
  const cats = [...new Set([...Object.keys(A.costs), ...Object.keys(B.costs)])]
  const changes = cats.map((c) => ({ category: c, now: num(A.costs[c]), before: num(B.costs[c]), delta: num(A.costs[c]) - num(B.costs[c]) }))
    .filter((x) => x.delta !== 0).sort((x, y) => y.delta - x.delta)
  const total = (m) => Object.values(m).reduce((s, v) => s + v, 0)
  const excluded = Object.entries(A.excluded).map(([cls, amount]) => ({ cls, amount })).filter((x) => x.amount !== 0)
    .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
  const payments = [...a].filter((t) => txCashDelta(t) < 0 && COST_CLASSES.includes(classOf(t))).sort((x, y) => txCashDelta(x) - txCashDelta(y)).slice(0, 8)
  return { changes, costsNow: total(A.costs), costsBefore: total(B.costs), revenueNow: A.revenue, revenueBefore: B.revenue, excluded, payments, count: a.length }
}

/** CSV of the monthly rows shown on a Performance tab (Export). Numbers as they are shown. */
export function rowsCsv(rows = [], columns = []) {
  const esc = csvCell
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n')
}
