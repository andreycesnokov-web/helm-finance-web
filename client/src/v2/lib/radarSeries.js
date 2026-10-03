// Radar 30-day cash series. Pure, tested (tests/design/v2RadarSeries.test.mjs).
//
// NO NEW FORECASTING RULE. The scenario rules are the ones the existing Radar already
// uses (client/src/lib/radarFigures.js), applied day by day over the dated items instead
// of only at day 30:
//   expected  balance + every receivable − every payable − burnRate × days
//   best      balance + every receivable − half of every payable        (no burn)
//   worst     balance − every payable − burnRate × days                  (no receivable)
// Inputs are figures GET /api/pulse already returns (totalBalance, burnRate, debts) and,
// optionally, tax obligations the verified engine has CALCULATED
// (GET /api/accountant/obligations, status 'calculated'). Nothing is estimated here.
//
// Differences from radarFigures, on purpose and reported in the batch notes: only OPEN
// items with a remaining amount count (radarFigures sums every debt ever, including
// paid ones), an overdue item lands today, items due after the horizon are left out,
// and non-IDR items are excluded from the IDR line (never mixed without conversion).

export const KEY_DATE_MIN_IDR = 1_000_000
export const DEFAULT_HORIZON = 30
export const LATE_SHIFT_DAYS = 14

const DAY = 86400000
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const isoDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** Status tag for an item: approval | late | deadline | expected | scheduled. */
function tagOf(d, dir) {
  if (d.approval_status === 'pending_approval') return 'approval'
  if (d.status === 'overdue') return 'late'
  return dir === 'in' ? 'expected' : 'scheduled'
}

/**
 * Dated cash items inside the horizon.
 * @returns {{ items: Array, excluded: { foreign: number, undated: number } }}
 */
export function cashItems({ debts = [], obligations = [], today = new Date(), horizon = DEFAULT_HORIZON } = {}) {
  const t0 = startOfDay(today)
  const items = []
  const excluded = { foreign: 0, undated: 0 }
  for (const d of Array.isArray(debts) ? debts : []) {
    if (!d || ['paid', 'cancelled'].includes(d.status)) continue
    if (d.approval_status === 'rejected') continue
    const amount = num(d.remaining_amount ?? d.amount)
    if (amount <= 0) continue
    if (d.currency && d.currency !== 'IDR') { excluded.foreign++; continue }
    if (!d.due_date) { excluded.undated++; continue }
    const due = startOfDay(d.due_date)
    if (Number.isNaN(due.getTime())) { excluded.undated++; continue }
    const day = Math.max(0, Math.round((due - t0) / DAY))
    if (day > horizon) continue
    const dir = d.type === 'receivable' ? 'in' : 'out'
    items.push({
      key: `debt:${d.id}`, id: d.id, source: 'debt', dir, amount, day,
      date: isoDay(new Date(t0.getTime() + day * DAY)), due_date: d.due_date,
      label: d.counterparty || d.description || '', note: d.description || '',
      tag: tagOf(d, dir), days_overdue: num(d.days_overdue), type: d.type,
    })
  }
  for (const o of Array.isArray(obligations) ? obligations : []) {
    if (!o || o.status !== 'calculated' || !(num(o.amount) > 0) || !o.due_date) continue
    if (o.currency && o.currency !== 'IDR') { excluded.foreign++; continue }
    const day = Math.max(0, Math.round((startOfDay(o.due_date) - t0) / DAY))
    if (day > horizon) continue
    items.push({
      key: `tax:${o.obligation_type}:${o.period}`, source: 'tax', dir: 'out', amount: num(o.amount), day,
      date: isoDay(new Date(t0.getTime() + day * DAY)), label: o.title, note: o.period, tag: 'deadline',
    })
  }
  items.sort((a, b) => a.day - b.day || (a.dir === b.dir ? b.amount - a.amount : a.dir === 'out' ? -1 : 1))
  return { items, excluded }
}

/**
 * What-if transforms. Nothing is saved; they only change the dated items fed to the
 * same rules above.
 *   { kind: 'late', key }     the item arrives LATE_SHIFT_DAYS later
 *   { kind: 'collect', key }  the receivable is treated as certain (also in worst case)
 */
export function applyScenario(items, scenario) {
  if (!scenario || !scenario.key) return items
  return items.map((it) => {
    if (it.key !== scenario.key) return it
    if (scenario.kind === 'late') return { ...it, day: it.day + LATE_SHIFT_DAYS, shifted: true }
    if (scenario.kind === 'collect') return { ...it, day: Math.min(it.day, 6), certain: true }
    return it
  })
}

/** Day-by-day series and the headline figures. */
export function forecast({ balance = 0, burnRate = 0, items = [], horizon = DEFAULT_HORIZON, today = new Date() } = {}) {
  const t0 = startOfDay(today)
  const b = num(balance), burn = num(burnRate)
  const days = []
  let inAll = 0, outAll = 0, inCertain = 0
  const byDay = new Map()
  for (const it of items) { if (!byDay.has(it.day)) byDay.set(it.day, []); byDay.get(it.day).push(it) }
  for (let d = 0; d <= horizon; d++) {
    for (const it of byDay.get(d) || []) {
      if (it.dir === 'in') { inAll += it.amount; if (it.certain) inCertain += it.amount } else outAll += it.amount
    }
    days.push({
      day: d, date: isoDay(new Date(t0.getTime() + d * DAY)),
      expected: b + inAll - outAll - burn * d,
      best: b + inAll - outAll * 0.5,
      worst: b + inCertain - outAll - burn * d,
    })
  }
  const minBy = (k) => days.reduce((m, x) => (x[k] < m[k] ? x : m), days[0])
  const end = days[days.length - 1]
  const low = minBy('expected'), wlow = minBy('worst')
  return {
    days,
    start: b,
    end: { date: end.date, value: end.expected, change: end.expected - b },
    lowest: { date: low.date, value: low.expected, day: low.day },
    worstLowest: { date: wlow.date, value: wlow.worst, day: wlow.day },
    burnRate: burn,
  }
}

/** Running expected cash after each item, in list order (for "Cash after"). */
export function withCashAfter(items, { balance = 0, burnRate = 0 } = {}) {
  let running = num(balance)
  let lastDay = 0
  return items.map((it) => {
    running -= num(burnRate) * (it.day - lastDay)
    lastDay = it.day
    running += it.dir === 'in' ? it.amount : -it.amount
    return { ...it, cashAfter: running }
  })
}

/** Key dates: items ≥ the threshold, filtered All / In / Out, with the footer counts. */
export function keyDates(items, { filter = 'all', min = KEY_DATE_MIN_IDR } = {}) {
  const dirOk = (it) => filter === 'all' || it.dir === filter
  const all = items.filter(dirOk)
  const shown = all.filter((it) => it.amount >= min)
  const hidden = all.filter((it) => it.amount < min)
  return { shown, total: all.length, hiddenCount: hidden.length, hiddenSum: hidden.reduce((s, x) => s + x.amount, 0) }
}

/** Two data-driven what-if chips: the biggest receivable paying late, and collecting
 *  the biggest late one now. Returns [] when the data has neither. */
export function scenarioChips(items) {
  const ins = items.filter((it) => it.dir === 'in')
  const out = []
  const biggest = [...ins].sort((a, b) => b.amount - a.amount)[0]
  if (biggest) out.push({ kind: 'late', key: biggest.key, label: biggest.label, amount: biggest.amount })
  const late = ins.filter((it) => it.tag === 'late').sort((a, b) => b.amount - a.amount)[0]
  if (late) out.push({ kind: 'collect', key: late.key, label: late.label, amount: late.amount })
  return out
}
