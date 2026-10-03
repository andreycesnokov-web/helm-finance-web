// Pulse (design v2) model. Run: node tests/design/v2PulseModel.test.mjs
import assert from 'node:assert'
import { runwayDays, pulseStatus, headlineKey, decisions, nextDays, flowOf, pctChange, obligationTiles, RUNWAY_TARGET_DAYS } from '../../client/src/v2/lib/pulseModel.js'

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
  assert.deepStrictEqual([tl.owedToYou, tl.owedLate, tl.youOwe, tl.oweCount, tl.oweLateCount], [30, 10, 12, 1, 0])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
