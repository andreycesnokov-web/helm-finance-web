// P-10 accrual profit from confirmed groups. Run: node tests/design/v2Pnl.test.mjs
import assert from 'node:assert'
import { accrualRows, mappingConfirmed, groupMap, taxLabelKey, GROUPS } from '../../client/src/v2/lib/pnl.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 P-10 profit')
const M = ['2026-08', '2026-09']
const cats = [
  { name: 'Cleaning service income', pnl_group: 'revenue' }, { name: 'Wages: field cleaners', pnl_group: 'direct_cost' },
  { name: 'Аренда офиса', pnl_group: 'operating_cost' }, { name: 'Loan interest', pnl_group: 'interest' },
  { name: 'Deposit and account interest', pnl_group: 'other_income' }, { name: 'Turnover tax (UMKM final)', pnl_group: 'tax' },
  { name: 'Cleaning machines', pnl_group: 'asset_purchase' }, { name: 'Получение кредитов и займов', pnl_group: 'funding' },
  { name: 'Перевод между счетами — выбытие', pnl_group: 'transfer' }, { name: 'Unconfirmed', pnl_group: null },
]

t('9 groups; a mapping counts as confirmed only when a person set a group', () => {
  assert.strictEqual(GROUPS.length, 9)
  assert.ok(!mappingConfirmed([{ name: 'x', pnl_group: null }, { name: 'y' }]))
  assert.ok(mappingConfirmed(cats))
  assert.strictEqual(groupMap(cats).size, 9)
})

t('the waterfall: interest below EBITDA, other income below operating profit, tax last', () => {
  const tx = [
    { id: 1, type: 'income', category: 'Cleaning service income', amount_original: 1000, transaction_date: '2026-09-02' },
    { id: 2, type: 'payroll', category: 'Wages: field cleaners', amount_original: 400, transaction_date: '2026-09-03' },
    { id: 3, type: 'expense', category: 'Аренда офиса', amount_original: 100, transaction_date: '2026-09-04' },
    { id: 4, type: 'expense', category: 'Loan interest', amount_original: 30, transaction_date: '2026-09-05' },
    { id: 5, type: 'income', category: 'Deposit and account interest', amount_original: 8, transaction_date: '2026-09-06' },
    { id: 6, type: 'expense', category: 'Turnover tax (UMKM final)', amount_original: 5, transaction_date: '2026-09-07' },
  ]
  const r = accrualRows({ transactions: tx, categories: cats, months: M }).rows[1]
  assert.deepStrictEqual([r.revenue, r.direct, r.gross, r.opex, r.ebitda], [1000, 400, 600, 100, 500])
  assert.deepStrictEqual([r.operating, r.otherIncome, r.interest, r.pbt, r.tax, r.net], [500, 8, 30, 478, 5, 473])
  assert.strictEqual(r.margin, 0.6)
})

t('clarification 1: an invoice paid net of PPh 23 keeps FULL revenue; the payment is not counted twice', () => {
  const debts = [{ id: 9, type: 'receivable', category: 'Cleaning service income', original_amount: 100, paid_amount: 98, created_at: '2026-09-10T00:00:00Z', status: 'partial', approval_status: 'approved', linked_transaction_id: 50 }]
  const tx = [{ id: 50, type: 'income', category: 'Cleaning service income', amount_original: 98, transaction_date: '2026-09-20' }]
  const r = accrualRows({ transactions: tx, debts, categories: cats, months: M }).rows[1]
  assert.strictEqual(r.revenue, 100, 'full invoice amount, withheld 2 is not a revenue cut')
  assert.strictEqual(r.direct + r.opex + r.tax, 0, 'and not a cost or a tax')
})

t('clarification 2: deposit interest is other income, shown net as recorded; never in interest or tax', () => {
  const tx = [{ id: 1, type: 'income', category: 'Deposit and account interest', amount_original: 80, transaction_date: '2026-09-30' }]
  const r = accrualRows({ transactions: tx, categories: cats, months: M }).rows[1]
  assert.deepStrictEqual([r.otherIncome, r.interest, r.tax, r.revenue], [80, 0, 0, 0])
})

t('clarification 3: turnover tax is labelled separately for UMKM final regimes only', () => {
  assert.strictEqual(taxLabelKey('pph_final_umkm'), 'turnover')
  assert.strictEqual(taxLabelKey('pp23_final'), 'turnover')
  assert.strictEqual(taxLabelKey('normal'), 'income')
  assert.strictEqual(taxLabelKey(null), 'income')
})

t('accrual: a bill counts in the month it was received, paid or not; pending and rejected do not count', () => {
  const debts = [
    { id: 1, type: 'payable', category: 'Аренда офиса', original_amount: 300, created_at: '2026-08-28T00:00:00Z', status: 'open', approval_status: 'approved' },
    { id: 2, type: 'payable', category: 'Аренда офиса', original_amount: 999, created_at: '2026-08-28T00:00:00Z', status: 'open', approval_status: 'pending_approval' },
    { id: 3, type: 'payable', category: 'Аренда офиса', original_amount: 999, created_at: '2026-08-28T00:00:00Z', status: 'cancelled' },
  ]
  const r = accrualRows({ debts, categories: cats, months: M }).rows[0]
  assert.strictEqual(r.opex, 300)
})

t('never guessed: uncategorised or unconfirmed records stay out of profit and are counted', () => {
  const tx = [
    { id: 1, type: 'income', category: 'Cleaning service income', amount_original: 10, transaction_date: '2026-09-01' },
    { id: 2, type: 'income', category: '', amount_original: 999, transaction_date: '2026-09-01', description: 'sales' },
    { id: 3, type: 'expense', category: 'Unconfirmed', amount_original: 999, transaction_date: '2026-09-01' },
  ]
  const { rows, coverage } = accrualRows({ transactions: tx, categories: cats, months: M })
  assert.strictEqual(rows[1].revenue, 10)
  assert.deepStrictEqual([coverage.categorised, coverage.total], [1, 3])
  assert.deepStrictEqual(coverage.missing.map((m) => m.name).sort(), ['Unconfirmed', '—'])
})

t('assets, funding and transfers are never profit; other workspaces and currencies are excluded', () => {
  const tx = [
    { id: 1, type: 'expense', category: 'Cleaning machines', amount_original: 7000, transaction_date: '2026-09-01' },
    { id: 2, type: 'income', category: 'Получение кредитов и займов', amount_original: 5000, transaction_date: '2026-09-01' },
    { id: 3, type: 'expense', category: 'Перевод между счетами — выбытие', amount_original: 100, transaction_date: '2026-09-01' },
    { id: 4, type: 'income', category: 'Cleaning service income', amount_original: 50, transaction_date: '2026-09-01', scope: 'personal' },
    { id: 5, type: 'income', category: 'Cleaning service income', amount_original: 50, transaction_date: '2026-09-01', currency_original: 'USD' },
    { id: 6, type: 'transfer', category: 'Cleaning service income', amount_original: 50, transaction_date: '2026-09-01' },
  ]
  const r = accrualRows({ transactions: tx, categories: cats, months: M }).rows[1]
  assert.deepStrictEqual([r.revenue, r.net, r.assets], [0, 0, 7000])
})

t('asset register (P-11): a registered purchase is not a cost; depreciation comes after EBITDA', () => {
  const debts = [{ id: 70, type: 'payable', category: 'Аренда офиса', original_amount: 7000, created_at: '2026-09-02T00:00:00Z', status: 'paid', approval_status: 'approved' }]
  const tx = [{ id: 71, type: 'expense', category: 'Аренда офиса', amount_original: 3000, transaction_date: '2026-09-03' },
    { id: 72, type: 'income', category: 'Cleaning service income', amount_original: 1000, transaction_date: '2026-09-03' }]
  const assets = { available: true, assets: [{ purchase_debt_id: 70 }, { purchase_transaction_id: 71 }], depreciation_by_month: { '2026-09': 125 } }
  const { rows, hasRegister } = accrualRows({ transactions: tx, debts, categories: cats, months: M, assets })
  const r = rows[1]
  assert.deepStrictEqual([r.opex, r.ebitda, r.depreciation, r.operating, r.net], [0, 1000, 125, 875, 875])
  assert.ok(hasRegister)
  const noReg = accrualRows({ transactions: tx, debts, categories: cats, months: M }).rows[1]
  assert.deepStrictEqual([noReg.opex, noReg.depreciation], [10000, 0], 'without the register the bills are costs as categorised')
})

t('refunds reduce the group they belong to', () => {
  const tx = [
    { id: 1, type: 'income', category: 'Cleaning service income', amount_original: 100, transaction_date: '2026-09-01' },
    { id: 2, type: 'expense', category: 'Cleaning service income', amount_original: 10, transaction_date: '2026-09-02' },
  ]
  assert.strictEqual(accrualRows({ transactions: tx, categories: cats, months: M }).rows[1].revenue, 90)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
