// AI Accountant helpers. Run: node tests/design/v2Accounting.test.mjs
import assert from 'node:assert'
import { monthOptions, defaultCloseMonth, closeReadiness, packages, packageSummary, monthGrid, complianceEvents, eventStage } from '../../client/src/v2/lib/accounting.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 accounting')
const today = new Date('2026-10-03T10:00:00')

t('months: newest first, close defaults to last month', () => {
  const m = monthOptions(3, today)
  assert.deepStrictEqual(m.map((x) => x.key), ['2026-10', '2026-09', '2026-08'])
  assert.strictEqual(m[1].end, '2026-09-30')
  assert.strictEqual(defaultCloseMonth(today), '2026-09')
})

t('readiness counts only what the system can check', () => {
  const r = closeReadiness({ month: '2026-09',
    transactions: [
      { type: 'expense', category: 'Fuel', transaction_date: '2026-09-02' },
      { type: 'expense', category: '', transaction_date: '2026-09-03', description: 'X' },
      { type: 'transfer', category: null, transaction_date: '2026-09-04' },
      { type: 'expense', category: '', transaction_date: '2026-08-30' },
    ],
    debts: [{ type: 'payable', due_date: '2026-09-10', attachments: [{}] }, { type: 'payable', due_date: '2026-09-12', counterparty: 'Y' }, { type: 'payable', due_date: '2026-09-12', status: 'cancelled' }],
    wallets: [{ id: 'a', type: 'bank', name: 'A' }, { id: 'b', type: 'bank', name: 'B' }, { id: 'c', type: 'cash', name: 'C' }],
    batches: [{ wallet_id: 'a', statement_start: '2026-09-01', statement_end: '2026-09-30', status: 'imported' }, { wallet_id: 'b', statement_start: '2026-09-01', statement_end: '2026-09-29', status: 'imported' }],
  })
  assert.strictEqual(r.records, 5)
  assert.strictEqual(r.complete, 3)
  assert.strictEqual(r.percent, 60)
  const by = Object.fromEntries(r.checks.map((c) => [c.key, c]))
  assert.deepStrictEqual([by.statements.ok, by.statements.total, by.statements.missing], [1, 2, ['B']])
  assert.deepStrictEqual([by.bills.ok, by.bills.missing], [1, ['Y']])
  assert.deepStrictEqual([by.categories.ok, by.categories.total], [2, 3])
})

t('no records → percent null, never 100%', () => {
  assert.strictEqual(closeReadiness({ month: '2026-09' }).percent, null)
})

t('packages: bills, invoices, uncategorised and payroll; slip not claimed', () => {
  const rows = packages({ month: '2026-09',
    debts: [{ id: 1, type: 'payable', due_date: '2026-09-05', status: 'paid', last_payment_at: '2026-09-05', attachments: [{}] },
      { id: 2, type: 'receivable', due_date: '2026-09-07', status: 'open' }, { id: 3, type: 'payable', due_date: '2026-09-08', status: 'paid' }],
    transactions: [{ id: 9, type: 'expense', category: '', transaction_date: '2026-09-09' }, { id: 10, type: 'payroll', category: 'Payroll', transaction_date: '2026-09-25' }, { id: 11, type: 'expense', category: 'Fuel', transaction_date: '2026-09-09' }],
  })
  const st = Object.fromEntries(rows.map((r) => [r.key, r.status]))
  assert.deepStrictEqual(st, { 'debt:1': 'complete', 'debt:2': 'missing', 'debt:3': 'missing', 'tx:9': 'nocat', 'tx:10': 'open' })
  assert.deepStrictEqual(packageSummary(rows), { total: 5, complete: 1, missing: 2, nocat: 1, slipsToMake: null })
  assert.ok(rows.find((r) => r.key === 'tx:10').items.some((i) => i.unknown), 'payroll documents are not claimed done')
})

t('packages before migration 061: slip not tracked, no check item, nothing claimed', () => {
  const rows = packages({ month: '2026-09', slipNeeded: true,
    debts: [{ id: 1, type: 'payable', due_date: '2026-09-05', status: 'paid', last_payment_at: '2026-09-05', attachments: [{}] }] })
  const items = rows[0].items
  assert.deepStrictEqual(items.find((i) => i.key === 'slip'), { key: 'slip', unknown: true })
  assert.ok(!items.some((i) => i.key === 'check'))
  assert.strictEqual(rows[0].status, 'open', 'an unknown slip keeps it from "complete"')
  assert.strictEqual(packageSummary(rows).slipsToMake, null)
})

t('packages with P-05 option B: slip from withholding_records, check from 061', () => {
  const base = { type: 'payable', due_date: '2026-09-05', status: 'paid', last_payment_at: '2026-09-05', attachments: [{}] }
  const slips = { available: true, by_debt: { 1: { slip_document_id: 'doc' }, 2: { slip_document_id: null } } }
  const rows = packages({ month: '2026-09', slipNeeded: true, slips, debts: [
    { ...base, id: 1, accountant_checked_at: '2026-09-30T10:00:00Z', accountant_checked_by: 5 },
    { ...base, id: 2, accountant_checked_at: null, accountant_checked_by: null },
    { ...base, id: 3, currency: 'USD', accountant_checked_at: null, accountant_checked_by: null },
    { id: 4, type: 'receivable', due_date: '2026-09-06', status: 'paid', last_payment_at: '2026-09-06', attachments: [{}], accountant_checked_at: null, accountant_checked_by: null },
  ] })
  const by = Object.fromEntries(rows.map((r) => [r.id, r]))
  assert.strictEqual(by[1].status, 'complete')
  assert.strictEqual(by[2].status, 'missing', 'slip missing')
  assert.strictEqual(by[3].status, 'open', 'no slip for a non-IDR bill; unchecked = open, not missing')
  assert.ok(!by[4].items.some((i) => i.key === 'slip'), 'no slip for an invoice to a customer')
  assert.strictEqual(packageSummary(rows).slipsToMake, 1)
  const noRule = packages({ month: '2026-09', slipNeeded: false, slips, debts: [{ ...base, id: 5, accountant_checked_at: null, accountant_checked_by: null }] })
  assert.ok(!noRule[0].items.some((i) => i.key === 'slip'), 'no engine rate → no slip expected')
  const unread = packages({ month: '2026-09', slipNeeded: true, slips: { available: false }, debts: [{ ...base, id: 6 }] })
  assert.deepStrictEqual(unread[0].items.find((i) => i.key === 'slip'), { key: 'slip', unknown: true }, 'unreadable → not tracked, never claimed')
})

t('calendar grid is Monday-first and whole weeks', () => {
  const g = monthGrid('2026-10')
  assert.ok(g.every((w) => w.length === 7))
  assert.strictEqual(g[0].findIndex((c) => c && c.day === 1), 3, '1 Oct 2026 is a Thursday')
  assert.strictEqual(g.flat().filter(Boolean).length, 31)
})

t('events: merged, de-duplicated, sorted; stage from stored status only', () => {
  const ev = complianceEvents({ overdue: [{ id: 1, due_date: '2026-09-15' }], upcoming: [{ id: 2, due_date: '2026-10-15' }, { id: 1, due_date: '2026-09-15' }] })
  assert.deepStrictEqual(ev.map((e) => e.id), [1, 2])
  assert.strictEqual(eventStage({ payment_status: 'paid' }), 'done')
  assert.strictEqual(eventStage({ days: -1 }), 'overdue')
  assert.strictEqual(eventStage({ estimated_amount: 10, days: 3 }), 'calculated')
  assert.strictEqual(eventStage({ days: 3 }), 'todo')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
