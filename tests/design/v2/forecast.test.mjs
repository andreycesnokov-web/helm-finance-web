// Design v2 — Radar/Pulse forecast model. The day-by-day line must be the existing
// Radar model (client/src/lib/radarFigures.js), only spread over due dates.
// Run: node tests/design/v2/forecast.test.mjs
import assert from 'node:assert'
import { t, done, code } from './_t.mjs'
import { radarFigures } from '../../../client/src/lib/radarFigures.js'
import { buildForecast, forecastItems, keyDates, nextDays, collectCandidate, KEY_DATE_MIN, dayIndex } from '../../../client/src/v2/lib/forecast.js'
import { pulseStatus as pulseStatusForTest } from '../../../client/src/v2/lib/pulseStatus.js'

const NOW = new Date(2026, 9, 3, 10, 0, 0)
const on = (n) => { const d = new Date(2026, 9, 3); d.setDate(d.getDate() + n); return d.toISOString() }
const debt = (id, type, amount, due, extra = {}) => ({ id, type, amount, remaining_amount: amount, due_date: on(due), status: 'open', approval_status: 'approved', counterparty: id, ...extra })

console.log('\nModel parity with the existing Radar')
await t('with every item open and inside 30 days, end values equal radarFigures', () => {
  const pulse = { totalBalance: 100_000_000, burnRate: 1_000_000, debts: [
    debt('a', 'receivable', 20_000_000, 5), debt('b', 'payable', 8_000_000, 10), debt('c', 'payable', 4_000_000, 29),
  ] }
  const old = radarFigures(pulse)
  const fc = buildForecast(pulse, { now: NOW })
  assert.strictEqual(fc.end.expected, old.proj30)
  assert.strictEqual(fc.end.best, old.projBest)
  assert.strictEqual(fc.end.worst, old.projWorst)
})

await t('settled, cancelled and rejected debts are not counted (Q2)', () => {
  const items = forecastItems([
    debt('p', 'payable', 5, 3, { status: 'paid' }), debt('c', 'payable', 5, 3, { status: 'cancelled' }),
    debt('r', 'payable', 5, 3, { approval_status: 'rejected' }), debt('ok', 'payable', 5, 3),
  ], { now: NOW })
  assert.deepStrictEqual(items.map((i) => i.id), ['ok'])
})

await t('open amount is remaining_amount; pending items are counted and tagged', () => {
  const [it] = forecastItems([debt('x', 'payable', 10, 3, { remaining_amount: 4, approval_status: 'pending_approval' })], { now: NOW })
  assert.strictEqual(it.amount, 4)
  assert.strictEqual(it.pending, true)
})

await t('overdue items land tomorrow; worst case never counts a receivable', () => {
  const pulse = { totalBalance: 50, burnRate: 0, debts: [debt('late', 'receivable', 10, -9, { status: 'overdue' })] }
  const fc = buildForecast(pulse, { now: NOW })
  assert.strictEqual(fc.items[0].day, 1)
  assert.strictEqual(fc.items[0].daysLate, 9)
  assert.strictEqual(fc.days[0].expected, 50)
  assert.strictEqual(fc.days[1].expected, 60)
  assert.strictEqual(fc.end.worst, 50)
})

await t('items after the horizon or without a date stay out of the line', () => {
  const items = forecastItems([debt('far', 'payable', 1, 45), { ...debt('nodate', 'payable', 1, 1), due_date: null }], { now: NOW })
  assert.strictEqual(items.length, 0)
})

await t('lowest point and worst-case low are found with their day', () => {
  const pulse = { totalBalance: 100, burnRate: 0, debts: [debt('o', 'payable', 60, 4), debt('i', 'receivable', 80, 10)] }
  const fc = buildForecast(pulse, { now: NOW })
  assert.strictEqual(fc.lowest.day, 4); assert.strictEqual(fc.lowest.expected, 40)
  assert.strictEqual(fc.worstLow.worst, 40)
})

console.log('\nWhat-if: collect the largest late receivable')
await t('moving it lifts the worst-case low by its amount', () => {
  const pulse = { totalBalance: 100, burnRate: 1, debts: [
    debt('late1', 'receivable', 30, -3, { status: 'overdue' }), debt('late2', 'receivable', 10, -1, { status: 'overdue' }), debt('o', 'payable', 50, 20)] }
  const base = buildForecast(pulse, { now: NOW })
  const c = collectCandidate(base)
  assert.strictEqual(c.id, 'late1')
  const moved = buildForecast(pulse, { now: NOW, overrides: { [c.id]: { day: 3 } } })
  assert.strictEqual(moved.worstLow.worst - base.worstLow.worst, 30)
})

console.log('\nKey dates')
await t(`only items ≥ ${KEY_DATE_MIN} are listed; the footer counts the rest`, () => {
  assert.strictEqual(KEY_DATE_MIN, 1_000_000)
  const pulse = { totalBalance: 0, burnRate: 0, debts: [
    debt('big', 'payable', 2_000_000, 2), debt('small', 'payable', 200_000, 3), debt('in', 'receivable', 5_000_000, 4)] }
  const fc = buildForecast(pulse, { now: NOW })
  const all = keyDates(fc)
  assert.deepStrictEqual(all.rows.map((r) => r.id), ['big', 'in'])
  assert.strictEqual(all.total, 3); assert.strictEqual(all.shown, 2)
  assert.strictEqual(all.smallCount, 1); assert.strictEqual(all.smallSum, 200_000)
  assert.deepStrictEqual(keyDates(fc, { filter: 'in' }).rows.map((r) => r.id), ['in'])
  assert.deepStrictEqual(keyDates(fc, { filter: 'out' }).rows.map((r) => r.id), ['big'])
  assert.strictEqual(all.rows[0].cashAfter, -2_000_000)
})
await t('the threshold is a constant, not a literal in the page', () => {
  const page = code('client/src/v2/pages/Radar.jsx')
  assert.match(page, /KEY_DATE_MIN/)
  assert.ok(!/1_?000_?000/.test(page))
})

console.log('\nPulse next 7 days and status')
await t('next 7 days sums in/out and reads cash on day 7', () => {
  const pulse = { totalBalance: 100, burnRate: 1, debts: [debt('i', 'receivable', 30, 2), debt('o', 'payable', 10, 6), debt('later', 'payable', 99, 9)] }
  const nd = nextDays(buildForecast(pulse, { now: NOW }), 7)
  assert.strictEqual(nd.inSum, 30); assert.strictEqual(nd.outSum, 10)
  assert.strictEqual(nd.cashOnDay, 100 + 30 - 10 - 7)
})
await t('status follows the server aiStatus; unknown runway says so', () => {
  assert.strictEqual(pulseStatusForTest({ runway: 999, burnRate: 0, aiStatus: 'healthy' }).key, 'unknown')
  assert.strictEqual(pulseStatusForTest({ runway: 5, burnRate: 10, aiStatus: 'critical' }).key, 'critical')
  assert.strictEqual(pulseStatusForTest({ runway: 12, burnRate: 10, aiStatus: 'attention' }).tone, 'warning')
  assert.strictEqual(pulseStatusForTest({ runway: 80, burnRate: 10, aiStatus: 'healthy' }).tone, 'good')
})
await t('Pulse never writes: no POST/PATCH/DELETE in the v2 Pulse or Radar page', () => {
  for (const f of ['client/src/v2/pages/Pulse.jsx', 'client/src/v2/pages/Radar.jsx']) {
    assert.ok(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(code(f)), f)
  }
})
await t('dayIndex is calendar days, not 24h blocks', () => {
  assert.strictEqual(dayIndex(new Date(2026, 9, 4, 1), NOW), 1)
  assert.strictEqual(dayIndex(new Date(2026, 9, 3, 23), NOW), 0)
})

done()
