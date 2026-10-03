// Performance metrics. Run: node tests/design/v2Performance.test.mjs
import assert from 'node:assert'
import { lastMonths, monthEnd, prevMonth, profitRows, cashRows, burn3, runwayFrom, weekBuckets, cashOutDate, threeMonths, monthCompare, txCashDelta } from '../../client/src/v2/lib/performance.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 performance')
const today = new Date('2026-10-03T10:00:00')

t('months', () => {
  assert.deepStrictEqual(lastMonths(3, today), ['2026-08', '2026-09', '2026-10'])
  assert.strictEqual(monthEnd('2026-02'), '2026-02-28')
  assert.strictEqual(prevMonth('2026-01'), '2025-12')
})

t('profit: gross, EBITDA, net; no income tax on a loss', () => {
  const [a, b, c] = profitRows([
    { period: '2026-08', revenue: 100, direct_costs: 40, opex: 30, tax_expense: 5, interest_expense: 2 },
    { period: '2026-09', revenue: 100, direct_costs: 60, opex: 70, tax_expense: 5, interest_expense: 2 },
  ], ['2026-08', '2026-09', '2026-10'])
  assert.deepStrictEqual([a.gross, a.ebitda, a.net, a.margin], [60, 30, 23, 0.6])
  assert.deepStrictEqual([b.ebitda, b.net], [-30, -32])
  assert.strictEqual(c.empty, true)
})

t('cash rows: operating, equipment, funding, month-end walk-back', () => {
  const rows = cashRows({
    months: ['2026-08', '2026-09'],
    series: [{ period: '2026-09', revenue: 100, operating_cash_out: 150, capex: 20, other_cash_movement: { funding: 50 } }],
    transactions: [{ type: 'income', amount_original: 10, transaction_date: '2026-09-02' }, { type: 'expense', amount_original: 4, transaction_date: '2026-10-01' },
      { type: 'transfer', amount_original: 999, transaction_date: '2026-10-01' }, { type: 'expense', amount_original: 7, transaction_date: '2026-10-02', currency_original: 'USD' }],
    balance: 1000,
  })
  assert.deepStrictEqual([rows[1].operating, rows[1].equipment, rows[1].funding, rows[1].free], [-50, 20, 50, -70])
  assert.strictEqual(rows[1].endCash, 1004, 'transfers neutral, non-IDR ignored')
  assert.strictEqual(rows[0].endCash, 994)
  assert.strictEqual(txCashDelta({ type: 'correction', amount_original: -3 }), -3)
})

t('burn uses the last 3 full months; runway = cash ÷ burn × 30', () => {
  const rows = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) => ({ month: m, operating: -30 - i, equipment: i === 2 ? 30 : 0, empty: false }))
  const b = burn3(rows, '2026-10')
  assert.deepStrictEqual(b.months, ['2026-07', '2026-08', '2026-09'])
  assert.strictEqual(b.monthly, (31 + 62 + 33) / 3)
  assert.strictEqual(runwayFrom(84, 42), 60)
  assert.strictEqual(runwayFrom(84, -5), null)
  assert.strictEqual(burn3([{ month: '2026-10', operating: 0, equipment: 0 }], '2026-10'), null)
})

t('weeks, cash-out date and three months', () => {
  const w = weekBuckets([{ day: 0, dir: 'in', amount: 5 }, { day: 8, dir: 'out', amount: 3 }, { day: 30, dir: 'out', amount: 1 }], { today })
  assert.deepStrictEqual(w.map((x) => [x.in, x.out]), [[5, 0], [0, 3], [0, 0], [0, 0], [0, 1]])
  const days = Array.from({ length: 31 }, (_, d) => ({ day: d, date: new Date(2026, 9, 3 + d).toISOString().slice(0, 10), expected: 100 - d }))
  assert.strictEqual(cashOutDate({ days, burnMonthly: 0, today }), null)
  const out = cashOutDate({ days, burnMonthly: 30, today })
  assert.strictEqual(out.from, 'burn')
  const neg = days.map((d) => ({ ...d, expected: 10 - d.day }))
  assert.strictEqual(cashOutDate({ days: neg, burnMonthly: 30, today }).from, 'radar')
  const m3 = threeMonths({ days, burnMonthly: 30, today })
  assert.strictEqual(m3.length, 3)
  assert.strictEqual(m3[1].cash, m3[0].cash - 30)
})

t('drill-down compares by category and lists the payments', () => {
  const tx = [
    { id: 1, type: 'expense', category: 'Fees', amount_original: 30, transaction_date: '2026-04-10' },
    { id: 2, type: 'expense', category: 'Fees', amount_original: 20, transaction_date: '2026-03-10' },
    { id: 3, type: 'income', category: 'Sales', amount_original: 58, transaction_date: '2026-04-11' },
    { id: 4, type: 'income', category: 'Sales', amount_original: 53, transaction_date: '2026-03-11' },
    { id: 5, type: 'expense', category: '', amount_original: 5, transaction_date: '2026-04-12' },
  ]
  const c = monthCompare(tx, '2026-04', '2026-03')
  assert.deepStrictEqual(c.changes.map((x) => [x.category, x.delta]), [['Fees', 10], ['—', 5]])
  assert.deepStrictEqual([c.costsNow, c.costsBefore, c.revenueNow, c.revenueBefore], [35, 20, 58, 53])
  assert.deepStrictEqual(c.payments.map((p) => p.id), [1, 5])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
