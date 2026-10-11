// Pulse (design v2) model. Run: node tests/design/v2PulseModel.test.mjs
import assert from 'node:assert'
import { cashFlow, runwayDays, pulseStatus, headlineKey, decisions, nextDays, flowOf, pctChange, obligationTiles, RUNWAY_TARGET_DAYS, runwayTarget, minCash } from '../../client/src/v2/lib/pulseModel.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 pulse model')

t('runway: server 999 means unknown, never "999 days"', () => {
  assert.strictEqual(runwayDays({ runway: 999 }), null)
  assert.strictEqual(runwayDays({ runway: 41.6 }), 42)
  assert.strictEqual(runwayDays({}), null)
})

t('status follows runway vs target and the forecast low', () => {
  assert.strictEqual(RUNWAY_TARGET_DAYS, 60)
  assert.strictEqual(pulseStatus({ runway: 90, lowestExpected: 1 }), 'good')
  assert.strictEqual(pulseStatus({ runway: 45, lowestExpected: 1 }), 'warn')
  assert.strictEqual(pulseStatus({ runway: 10, lowestExpected: 1 }), 'crit')
  assert.strictEqual(pulseStatus({ runway: 90, lowestExpected: -5 }), 'crit')
  assert.strictEqual(pulseStatus({ runway: null, lowestExpected: 5 }), 'good')
  assert.strictEqual(headlineKey('crit', { lowestExpected: -1 }), 'pulse.head.short')
  assert.strictEqual(headlineKey('good', { runway: null }), 'pulse.head.noBurn')
})

t('decisions: approvals, late receivables, engine-calculated tax only', () => {
  const today = new Date('2026-10-03')
  const rows = decisions({ today,
    debts: [
      { id: 1, type: 'payable', status: 'open', approval_status: 'pending_approval', amount: 5, counterparty: 'X' },
      { id: 2, type: 'receivable', status: 'overdue', approval_status: 'approved', amount: 7, days_overdue: 3 },
      { id: 3, type: 'payable', status: 'overdue', amount: 7 },
      { id: 4, type: 'payable', status: 'paid', approval_status: 'pending_approval', amount: 1 },
    ],
    obligations: [
      { obligation_type: 'pph_21_26', period: '2026-09', title: 'PPH 21/26', status: 'calculated', amount: 9, due_date: '2026-10-10' },
      { obligation_type: 'pph_23', period: '2026-09', title: 'PPH 23', status: 'insufficient_data', amount: null, due_date: '2026-10-10' },
    ] })
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.id]), [['approval', 1], ['late', 2], ['tax', 'pph_21_26:2026-09']])
})

t('next 7 days adds measured day-to-day spending to money going out', () => {
  const n = nextDays([{ day: 1, dir: 'in', amount: 10 }, { day: 3, dir: 'out', amount: 4 }, { day: 9, dir: 'out', amount: 99 }],
    { burnRate: 2, forecastDays: [{ day: 7, date: 'd7', expected: 50 }] })
  assert.deepStrictEqual([n.comingIn, n.goingOut, n.dayToDay], [10, 18, 14])
  assert.deepStrictEqual(n.cashOn, { date: 'd7', value: 50 })
})

t('next 7 days leaves pending approval out of sums and list (DECISIONS.md q2)', () => {
  const n = nextDays([{ day: 1, dir: 'in', amount: 10 }, { day: 2, dir: 'out', amount: 40, counted: false, tag: 'approval' }], { burnRate: 0 })
  assert.deepStrictEqual([n.comingIn, n.goingOut, n.list.length], [10, 0, 1])
})

t('runway target and minimum cash: business setting when valid, documented default otherwise (P-01, P-08)', () => {
  assert.strictEqual(runwayTarget(null), RUNWAY_TARGET_DAYS)
  assert.strictEqual(runwayTarget({ runway_target_days: null }), 60)
  assert.strictEqual(runwayTarget({ runway_target_days: 90 }), 90)
  assert.strictEqual(runwayTarget({ runway_target_days: 0 }), 60)
  assert.strictEqual(runwayTarget({ runway_target_days: 12.5 }), 60)
  assert.strictEqual(minCash(null), null)
  assert.strictEqual(minCash({ min_cash_idr: '25000000.00' }), 25e6)
  assert.strictEqual(minCash({ min_cash_idr: -1 }), null)
  assert.strictEqual(pulseStatus({ runway: 100, lowestExpected: 10e6, target: 60, floor: 20e6 }), 'warn')
  assert.strictEqual(headlineKey('warn', { runway: 100, lowestExpected: 10e6, target: 60, floor: 20e6 }), 'pulse.head.belowFloor')
  assert.strictEqual(pulseStatus({ runway: 70, lowestExpected: 10e6, target: 90 }), 'warn')
  assert.strictEqual(pulseStatus({ runway: 70, lowestExpected: 10e6 }), 'good')
})

t('money in/out excludes funding, transfers and opening balances', () => {
  const f = flowOf({ operating_revenue: 100, operating_cash_out: 60, capex: 10, tax_expense: 5, interest_expense: 1,
    other_cash_movement: { funding: 1000, transfers: 500 } })
  assert.deepStrictEqual(f, { moneyIn: 100, moneyOut: 76, net: 24, capex: 10 })
  assert.strictEqual(flowOf(null), null)
  assert.strictEqual(pctChange(112, 100), 12)
  assert.strictEqual(pctChange(5, 0), null)
})

t('obligation tiles use the server totals and confirmed items', () => {
  const tl = obligationTiles({ receivables: 30, payables: 12, debts: [
    { type: 'receivable', status: 'overdue', amount: 10 },
    { type: 'payable', status: 'open', amount: 12 },
    { type: 'payable', status: 'open', approval_status: 'pending_approval', amount: 99 },
  ] })
  assert.deepStrictEqual([tl.owedToYou, tl.owedLate, tl.youOwe, tl.oweCount, tl.oweLateCount], [10, 10, 12, 1, 0])
})

t('tiles: totals and lists use the same filter (review 8.2 should-fix)', () => {
  const tl = obligationTiles({ receivables: 999, payables: 999, debts: [
    { type: 'receivable', status: 'open', amount: 5 },
    { type: 'receivable', status: 'open', amount: 7, approval_status: 'pending_approval' },
    { type: 'payable', status: 'overdue', remaining_amount: 4, amount: 9 },
    { type: 'payable', status: 'open', amount: 100, currency: 'USD' },
    { type: 'payable', status: 'paid', amount: 50 },
  ] })
  assert.deepStrictEqual([tl.owedToYou, tl.owedCount, tl.youOwe, tl.oweCount, tl.oweLate, tl.oweLateCount], [5, 1, 4, 1, 4, 1])
})

t('past-due tax is overdue, not "0 days left"; date-only due dates are local days', () => {
  const today = new Date(2026, 9, 3, 10)
  const ds = decisions({ today, obligations: [
    { status: 'calculated', due_date: '2026-09-30', obligation_type: 'pph21', period: '2026-08', amount: 1 },
    { status: 'calculated', due_date: '2026-10-10', obligation_type: 'pph21', period: '2026-09', amount: 1 },
  ] })
  assert.deepStrictEqual(ds.map((d) => [d.days, d.overdue]), [[-3, true], [7, false]])
})

t('cash flow counts every company payment, labelled personal or without a category; not opening balances or transfers (production, 3 Oct)', () => {
  const tx = [
    { type: 'income', description: 'Payment: Andrew', amount_original: 120000, transaction_date: '2026-09-22', scope: 'personal' },
    { type: 'income', description: 'Payment: Client Olga', amount_original: 150000, transaction_date: '2026-09-22', scope: 'personal' },
    { type: 'expense', description: 'Payment: andrey', amount_original: 300000, transaction_date: '2026-09-10', scope: 'personal' },
    { type: 'expense', description: 'Payment: DEMO Property Landlord', amount_original: 3000000, transaction_date: '2026-09-07', scope: 'personal' },
    { type: 'expense', description: 'Payment: PT Circleka', amount_original: 29600000, transaction_date: '2026-09-04', scope: 'personal' },
    { type: 'income', description: 'Opening balance · DEMO - Cash', amount_original: 5000000, transaction_date: '2026-09-04', scope: 'business' },
    { type: 'transfer', description: 'to cash', amount_original: 1000000, transaction_date: '2026-09-05' },
    { type: 'expense', description: 'Payment: old', amount_original: 999, transaction_date: '2026-09-02' },
  ]
  const f = cashFlow(tx, { from: '2026-09-03', to: '2026-10-03' })
  assert.deepStrictEqual([f.moneyIn, f.moneyOut, f.net, f.unclassified, f.count], [270000, 32900000, -32630000, 5, 5])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
