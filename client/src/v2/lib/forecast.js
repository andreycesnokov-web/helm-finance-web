// Radar / Pulse cash forecast for design v2 — pure, no React, tested in
// tests/design/v2/forecast.test.mjs.
//
// THE MODEL IS THE EXISTING RADAR MODEL (client/src/lib/radarFigures.js), only
// laid out day by day so it can be drawn as a line:
//   expected = balance + receivables − payables − burn × days
//   best     = balance + receivables − payables × 0.5          (no burn, as today)
//   worst    = balance − payables − burn × days                 (no receivable lands)
// with each receivable/payable landing on its due date instead of all at once.
// At the horizon, with every item due inside it, the three end values equal
// radarFigures' proj30 / projBest / projWorst exactly (asserted in the test).
//
// Which items count (open question Q2, reported to the owner):
//   - paid, cancelled and rejected debts are NOT counted (the existing Radar sums
//     every debt the API returns, settled ones included);
//   - the open amount is remaining_amount (amount − paid), as Pulse uses;
//   - items still waiting for approval ARE counted, tagged "Waiting for approval",
//     as the approved design shows them on Radar. Pulse totals are unchanged.
//   - an overdue item is assumed to land tomorrow (day 1);
//   - in the worst case no receivable lands — unless a what-if says the owner
//     collects it (overrides), which is the action the what-if is testing;
//   - items with no due date, or due after the horizon, are not in the line.
import { remainingOf } from './counts.js'

/** Key dates list only items at or above this amount (DESIGN_SPEC §3 · Radar). */
export const KEY_DATE_MIN = 1_000_000

const DAY = 86400000
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

export function dayIndex(date, now = new Date()) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((midnight(d) - midnight(now)) / DAY)
}

/** Live debts as forecast items. */
export function forecastItems(debts, { now = new Date(), horizon = 30 } = {}) {
  const out = []
  for (const d of Array.isArray(debts) ? debts : []) {
    if (['paid', 'cancelled'].includes(d.status) || d.approval_status === 'rejected') continue
    const amount = remainingOf(d)
    if (!(amount > 0)) continue
    const due = dayIndex(d.due_date, now)
    if (due === null) continue
    const overdue = due < 0 || d.status === 'overdue'
    const day = overdue ? 1 : due
    if (day > horizon) continue
    out.push({
      id: d.id, dir: d.type === 'receivable' ? 'in' : 'out', amount, day, dueDay: due,
      overdue, daysLate: overdue ? Math.max(0, -due) : 0,
      pending: d.approval_status === 'pending_approval',
      counterparty: d.counterparty || '', description: d.description || '', due_date: d.due_date, raw: d,
    })
  }
  return out.sort((a, b) => a.day - b.day || (a.dir === b.dir ? b.amount - a.amount : a.dir === 'out' ? -1 : 1))
}

/**
 * Build the series. `overrides` lets a what-if move one item: { [id]: { day } }.
 * Returns { days: [{ day, date, expected, best, worst }], items, end, lowest, worstLow, ... }.
 */
export function buildForecast(pulse, { now = new Date(), horizon = 30, overrides = {} } = {}) {
  const p = pulse || {}
  const balance = Number(p.totalBalance || 0)
  const burn = Number(p.burnRate || 0)
  const items = forecastItems(p.debts, { now, horizon }).map((it) =>
    overrides[it.id] ? { ...it, ...overrides[it.id], moved: true } : it)

  const days = []
  let inE = 0, outE = 0, inW = 0
  const byDay = new Map()
  for (const it of items) { if (!byDay.has(it.day)) byDay.set(it.day, []); byDay.get(it.day).push(it) }
  for (let d = 0; d <= horizon; d++) {
    for (const it of byDay.get(d) || []) {
      if (it.dir === 'in') { inE += it.amount; if (it.moved) inW += it.amount } else outE += it.amount
    }
    const date = new Date(midnight(now).getTime() + d * DAY)
    days.push({
      day: d, date,
      expected: balance + inE - outE - burn * d,
      best: balance + inE - outE * 0.5,
      worst: balance + inW - outE - burn * d,
    })
  }
  const lowOf = (key) => days.reduce((m, x) => (x[key] < m[key] ? x : m), days[0])
  const end = days[days.length - 1]
  const lowest = lowOf('expected')
  const worstLow = lowOf('worst')
  return {
    balance, burn, horizon, days, items,
    end, lowest, worstLow,
    totalIn: items.filter((i) => i.dir === 'in').reduce((s, i) => s + i.amount, 0),
    totalOut: items.filter((i) => i.dir === 'out').reduce((s, i) => s + i.amount, 0),
    cashAfter: (day) => (days[Math.max(0, Math.min(horizon, day))] || end).expected,
  }
}

/** Largest overdue receivable — the "collect it this week" what-if. */
export function collectCandidate(forecast) {
  return (forecast.items || []).filter((i) => i.dir === 'in' && i.overdue)
    .sort((a, b) => b.amount - a.amount)[0] || null
}

/**
 * Key dates: items ≥ KEY_DATE_MIN, filtered by direction. Returns the rows and
 * the counts the footer needs ("Showing N of M · K smaller…").
 */
export function keyDates(forecast, { filter = 'all', min = KEY_DATE_MIN } = {}) {
  const all = (forecast.items || []).filter((i) => filter === 'all' || i.dir === filter)
  const rows = all.filter((i) => i.amount >= min)
  const small = all.filter((i) => i.amount < min)
  return {
    rows: rows.map((i) => ({ ...i, cashAfter: forecast.cashAfter(i.day) })),
    total: all.length,
    shown: rows.length,
    smallCount: small.length,
    smallSum: small.reduce((s, i) => s + i.amount, 0),
  }
}

/** Next-N-days summary for Pulse. */
export function nextDays(forecast, n = 7) {
  const items = (forecast.items || []).filter((i) => i.day <= n)
  return {
    items,
    inSum: items.filter((i) => i.dir === 'in').reduce((s, i) => s + i.amount, 0),
    outSum: items.filter((i) => i.dir === 'out').reduce((s, i) => s + i.amount, 0),
    cashOnDay: forecast.cashAfter(n),
    date: (forecast.days[Math.min(n, forecast.horizon)] || {}).date,
  }
}
