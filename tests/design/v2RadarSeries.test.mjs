// Radar series: the existing scenario rules, per day. Run: node tests/design/v2RadarSeries.test.mjs
import assert from 'node:assert'
import { cashItems, forecast, keyDates, applyScenario, withCashAfter, scenarioChips, pendingSummary, KEY_DATE_MIN_IDR } from '../../client/src/v2/lib/radarSeries.js'
import { radarFigures } from '../../client/src/lib/radarFigures.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
const today = new Date('2026-10-03T10:00:00')
const D = (n) => { const d = new Date('2026-10-03T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const debts = [
  { id: 1, type: 'receivable', counterparty: 'A', amount: 10e6, remaining_amount: 10e6, due_date: D(5), status: 'open', approval_status: 'approved' },
  { id: 2, type: 'payable', counterparty: 'B', amount: 4e6, remaining_amount: 4e6, due_date: D(2), status: 'open' },
  { id: 3, type: 'payable', counterparty: 'C', amount: 600e3, remaining_amount: 600e3, due_date: D(9), status: 'open' },
  { id: 4, type: 'receivable', counterparty: 'D', amount: 3e6, remaining_amount: 3e6, due_date: D(-4), status: 'overdue', days_overdue: 4 },
  { id: 5, type: 'payable', counterparty: 'paid', amount: 9e6, remaining_amount: 0, due_date: D(1), status: 'paid' },
  { id: 6, type: 'payable', counterparty: 'far', amount: 9e6, remaining_amount: 9e6, due_date: D(45), status: 'open' },
  { id: 7, type: 'payable', counterparty: 'usd', amount: 100, remaining_amount: 100, due_date: D(3), status: 'open', currency: 'USD' },
  { id: 8, type: 'payable', counterparty: 'draft', amount: 2e6, remaining_amount: 2e6, due_date: D(4), status: 'open', approval_status: 'pending_approval' },
]
console.log('\nDesign v2 radar series')

t('only open, dated, IDR items inside the horizon; overdue lands today', () => {
  const { items, excluded } = cashItems({ debts, today })
  assert.deepStrictEqual(items.map((i) => i.id).sort(), [1, 2, 3, 4, 8])
  assert.strictEqual(items.find((i) => i.id === 4).day, 0)
  assert.strictEqual(excluded.foreign, 1)
})

t('pending approval items are tagged, never silently treated as confirmed', () => {
  const { items } = cashItems({ debts, today })
  assert.strictEqual(items.find((i) => i.id === 8).tag, 'approval')
  assert.strictEqual(items.find((i) => i.id === 4).tag, 'late')
})

t('day 30 equals the existing radarFigures rules over the same open items', () => {
  const { items } = cashItems({ debts, today })
  // Pending approval is not counted (DECISIONS.md), so it is not in the legacy input either.
  const open = debts.filter((d) => items.some((i) => i.id === d.id && i.counted)).map((d) => ({ ...d, amount: d.remaining_amount }))
  const legacy = radarFigures({ totalBalance: 50e6, burnRate: 200e3, debts: open })
  const f = forecast({ balance: 50e6, burnRate: 200e3, items, today })
  const last = f.days[30]
  assert.strictEqual(last.expected, legacy.proj30)
  assert.strictEqual(last.best, legacy.projBest)
  assert.strictEqual(last.worst, legacy.projWorst)
})

t('lowest points are real days of the series', () => {
  const { items } = cashItems({ debts, today })
  const f = forecast({ balance: 5e6, burnRate: 200e3, items, today })
  assert.strictEqual(f.lowest.value, Math.min(...f.days.map((d) => d.expected)))
  assert.strictEqual(f.worstLowest.value, Math.min(...f.days.map((d) => d.worst)))
  assert.ok(f.worstLowest.value <= f.lowest.value)
})

t('key dates: ≥ Rp 1M only, All/In/Out, footer counts what is hidden', () => {
  assert.strictEqual(KEY_DATE_MIN_IDR, 1_000_000)
  const { items } = cashItems({ debts, today })
  const all = keyDates(items)
  assert.ok(all.shown.every((i) => i.amount >= 1e6))
  assert.strictEqual(all.total, 5); assert.strictEqual(all.hiddenCount, 1); assert.strictEqual(all.hiddenSum, 600e3)
  assert.ok(keyDates(items, { filter: 'in' }).shown.every((i) => i.dir === 'in'))
  assert.ok(keyDates(items, { filter: 'out' }).shown.every((i) => i.dir === 'out'))
})

t('cash after follows burn and items in order', () => {
  const rows = withCashAfter([{ day: 0, dir: 'in', amount: 10 }, { day: 2, dir: 'out', amount: 5 }], { balance: 100, burnRate: 1 })
  assert.deepStrictEqual(rows.map((r) => r.cashAfter), [110, 103])
})

t('what-if: late shifts the item, collect makes it count in the worst case', () => {
  const { items } = cashItems({ debts, today })
  const late = applyScenario(items, { kind: 'late', key: 'debt:1' })
  assert.strictEqual(late.find((i) => i.id === 1).day, 19)
  const base = forecast({ balance: 5e6, burnRate: 0, items, today })
  const col = forecast({ balance: 5e6, burnRate: 0, items: applyScenario(items, { kind: 'collect', key: 'debt:4' }), today })
  assert.strictEqual(col.worstLowest.value - base.worstLowest.value >= 0, true)
  assert.strictEqual(col.days[30].worst - base.days[30].worst, 3e6)
  assert.strictEqual(applyScenario(items, null), items)
})

t('chips come from the data', () => {
  const { items } = cashItems({ debts, today })
  const c = scenarioChips(items)
  assert.deepStrictEqual(c.map((x) => [x.kind, x.key]), [['late', 'debt:1'], ['collect', 'debt:4'], ['approve', 'debt:8']])
  assert.deepStrictEqual(scenarioChips([]), [])
})

t('pending approval: listed, not in any line, cash after or total (DECISIONS.md q2)', () => {
  const { items } = cashItems({ debts, today })
  const pend = items.find((i) => i.id === 8)
  assert.strictEqual(pend.counted, false)
  const without = forecast({ balance: 50e6, burnRate: 0, items: items.filter((i) => i.id !== 8), today })
  const withIt = forecast({ balance: 50e6, burnRate: 0, items, today })
  assert.deepStrictEqual(withIt.days, without.days)
  const rows = withCashAfter([...items].sort((a, b) => a.day - b.day), { balance: 50e6, burnRate: 0 })
  const i8 = rows.findIndex((r) => r.id === 8)
  assert.strictEqual(rows[i8].cashAfter, rows[i8 - 1].cashAfter)
  assert.deepStrictEqual(pendingSummary(items), { count: 1, sum: 2e6 })
  assert.ok(keyDates(items).shown.some((i) => i.id === 8), 'still listed on Radar')
})

t('what-if approve counts the pending item on screen only', () => {
  const { items } = cashItems({ debts, today })
  const a = applyScenario(items, { kind: 'approve', key: 'debt:8' })
  assert.strictEqual(a.find((i) => i.id === 8).counted, true)
  assert.strictEqual(items.find((i) => i.id === 8).counted, false, 'original untouched')
  const base = forecast({ balance: 50e6, burnRate: 0, items, today })
  const f = forecast({ balance: 50e6, burnRate: 0, items: a, today })
  assert.strictEqual(base.days[30].expected - f.days[30].expected, 2e6)
})

t('engine-calculated tax obligations become deadline items; uncalculated ones do not', () => {
  const { items } = cashItems({ today, obligations: [
    { obligation_type: 'pph_21_26', title: 'PPH 21/26', period: '2026-09', due_date: D(7), status: 'calculated', amount: 1.2e6, currency: 'IDR' },
    { obligation_type: 'pph_23', title: 'PPH 23', period: '2026-09', due_date: D(7), status: 'insufficient_data', amount: null },
  ] })
  assert.strictEqual(items.length, 1); assert.strictEqual(items[0].tag, 'deadline')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
