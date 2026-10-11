// Bills, approvals, counterparties, accounts, transactions, payroll helpers.
// Run: node tests/design/v2Obligations.test.mjs
import assert from 'node:assert'
import {
  billStatus, tabForPath, billSummary, billRows, withholdingSplit, payerHistory, duplicatePairs, npwpFormat,
  holderMatches, cpFilter, txFilter, needsCategory, txDir, toCsv, statementFreshness, latestPayrollRun, txSource, billChecklistItems, withholdingTreatment } from '../../client/src/v2/lib/obligations.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 obligations')

t('routes preset the tab', () => {
  assert.strictEqual(tabForPath('/business/payables'), 'pay')
  assert.strictEqual(tabForPath('/business/receivables'), 'collect')
  assert.strictEqual(tabForPath('/business/invoices'), 'all')
})

t('status: pending approval wins over late; rejected is cancelled', () => {
  assert.strictEqual(billStatus({ status: 'overdue', approval_status: 'pending_approval' }), 'pending')
  assert.strictEqual(billStatus({ status: 'overdue' }), 'late')
  assert.strictEqual(billStatus({ status: 'open', approval_status: 'rejected' }), 'cancelled')
  assert.strictEqual(billStatus({ status: 'paid' }), 'paid')
})

t('summary separates confirmed, late, pending and due-soon', () => {
  const today = new Date('2026-10-03')
  const s = billSummary([
    { type: 'receivable', status: 'overdue', remaining_amount: 10 },
    { type: 'receivable', status: 'open', remaining_amount: 5, due_date: '2026-10-10' },
    { type: 'payable', status: 'open', remaining_amount: 7, approval_status: 'pending_approval' },
    { type: 'payable', status: 'open', remaining_amount: 3, due_date: '2026-12-01' },
    { type: 'payable', status: 'paid', remaining_amount: 0 },
  ], { today })
  assert.deepStrictEqual([s.collect.total, s.collect.late, s.collect.dueSoon], [15, 10, 5])
  assert.deepStrictEqual([s.pay.total, s.pay.count, s.pay.pending, s.pay.pendingCount], [3, 1, 7, 1])
})

t('rows: open vs paid, training excluded, undated last', () => {
  const r = billRows([
    { id: 1, type: 'payable', status: 'open' },
    { id: 2, type: 'payable', status: 'open', due_date: '2026-10-05' },
    { id: 3, type: 'payable', status: 'paid' },
    { id: 4, type: 'payable', status: 'open', is_training: true },
    { id: 5, type: 'receivable', status: 'open' },
  ], { tab: 'pay' })
  assert.deepStrictEqual(r.map((x) => x.id), [2, 1])
  assert.deepStrictEqual(billRows([{ id: 3, type: 'payable', status: 'paid' }], { tab: 'pay', view: 'paid' }).map((x) => x.id), [3])
})

t('withholding split needs an engine rate; none → no split', () => {
  assert.deepStrictEqual(withholdingSplit(10_000_000, 2), { gross: 10_000_000, rate: 2, tax: 200_000, net: 9_800_000 })
  assert.strictEqual(withholdingSplit(10_000_000, null), null)
  assert.strictEqual(withholdingSplit(10_000_000, 0), null)
  assert.strictEqual(withholdingSplit(0, 2), null)
})

t('payer history from paid items', () => {
  const h = payerHistory([
    { counterparty: 'Acme', status: 'paid', due_date: '2026-09-01', last_payment_at: '2026-09-09' },
    { counterparty: 'acme ', status: 'paid', due_date: '2026-08-01', last_payment_at: '2026-07-30' },
    { counterparty: 'Acme', status: 'overdue', remaining_amount: 5, type: 'receivable' },
  ], 'ACME')
  assert.deepStrictEqual([h.paidCount, h.onTime, h.avgLate, h.theyOwe, h.lateTheyOwe, h.weOwe], [2, 1, 4, 5, 5, 0])
})

t('payer history: directions apart, pending left out, any of the names, null when nothing matches', () => {
  const debts = [
    { counterparty: 'PT Maju', type: 'receivable', status: 'open', remaining_amount: 100 },
    { counterparty: 'Maju', type: 'payable', status: 'overdue', remaining_amount: 30 },
    { counterparty: 'Maju', type: 'payable', status: 'open', remaining_amount: 999, approval_status: 'pending_approval' },
    { counterparty: 'Other', type: 'payable', status: 'open', remaining_amount: 7 },
  ]
  const h = payerHistory(debts, ['PT Maju Jaya', 'PT Maju', 'Maju'])
  assert.deepStrictEqual([h.theyOwe, h.weOwe, h.lateTheyOwe, h.lateWeOwe], [100, 30, 0, 30])
  assert.strictEqual(payerHistory(debts, ['Nobody']), null, 'no match → null, so a fallback name can be tried')
  assert.strictEqual(payerHistory(debts, [null, '']), null)
})

t('duplicates by NPWP or bank account; never by name alone', () => {
  const p = duplicatePairs([
    { id: 'a', name: 'X', npwp: '01.234.567.8-901.234', bank_accounts: [] },
    { id: 'b', name: 'Y', npwp: '012345678901234', bank_accounts: [] },
    { id: 'c', name: 'Z', bank_accounts: [{ account_number: '123-456-789' }] },
    { id: 'd', name: 'W', bank_accounts: [{ account_number: '123456789' }] },
    { id: 'e', name: 'X', bank_accounts: [] },
    { id: 'f', name: 'Q', npwp: '012345678901234', status: 'archived' },
  ])
  assert.deepStrictEqual(p.map((x) => [x.a.id, x.b.id, x.reason]), [['a', 'b', 'npwp'], ['c', 'd', 'bank']])
})

t('NPWP format and holder match', () => {
  assert.strictEqual(npwpFormat('01.234.567.8-901.234'), 'ok')
  assert.strictEqual(npwpFormat('1234567890123456'), 'ok')
  assert.strictEqual(npwpFormat('123'), 'bad')
  assert.strictEqual(npwpFormat(''), 'empty')
  assert.strictEqual(holderMatches('CV SUMBER TEKNIK', 'CV Sumber Teknik'), true)
  assert.strictEqual(holderMatches('Budi', 'PT Sumber'), false)
  assert.strictEqual(holderMatches('', 'PT Sumber'), null)
})

t('counterparty filters', () => {
  assert.ok(cpFilter({ role: 'both' }, 'customer') && cpFilter({ role: 'both' }, 'supplier'))
  assert.ok(cpFilter({ role: 'vendor' }, 'missing'))
  assert.ok(!cpFilter({ role: 'vendor', npwp: '1' }, 'missing'))
})

t('transactions: direction, needs category, filters, search', () => {
  const rows = [
    { id: 1, type: 'income', category: 'Sales', transaction_date: '2026-10-02', description: 'A', amount_original: 5 },
    { id: 2, type: 'expense', category: '', transaction_date: '2026-10-01', description: 'Fuel', amount_original: 3, wallet_id: 'w' },
    { id: 3, type: 'transfer', category: null, transaction_date: '2026-09-01', description: 'move' },
  ]
  assert.strictEqual(txDir(rows[2]), 'transfer')
  assert.ok(needsCategory(rows[1]) && !needsCategory(rows[2]))
  const today = new Date('2026-10-03')
  assert.deepStrictEqual(txFilter(rows, { today }).map((x) => x.id), [1, 2])
  assert.deepStrictEqual(txFilter(rows, { today, days: 0, kind: 'review' }).map((x) => x.id), [2])
  assert.deepStrictEqual(txFilter(rows, { today, days: 0, q: 'fuel' }).map((x) => x.id), [2])
  assert.deepStrictEqual(txFilter(rows, { today, days: 0, walletId: 'w' }).map((x) => x.id), [2])
  assert.strictEqual(txSource({ bank_import_batch_id: 'x' }), 'bank')
})

t('CSV escapes commas and quotes', () => {
  const csv = toCsv([{ type: 'expense', description: 'a, "b"', amount_original: 1, transaction_date: '2026-10-01' }])
  assert.ok(csv.split('\n')[1].includes('"a, ""b"""'))
})

t('statement freshness keeps the newest usable batch per wallet', () => {
  const f = statementFreshness([
    { wallet_id: 'w', statement_end: '2026-09-01', status: 'imported' },
    { wallet_id: 'w', statement_end: '2026-09-30', status: 'imported' },
    { wallet_id: 'w', statement_end: '2026-10-02', status: 'failed' },
    { wallet_id: null, statement_end: '2026-10-02', status: 'imported' },
  ])
  assert.deepStrictEqual(Object.keys(f), ['w'])
  assert.strictEqual(f.w.date, '2026-09-30')
})

t('payroll: latest period, PPh 21 only when recorded', () => {
  const run = latestPayrollRun({ payments: [
    { id: 1, period_month: '2026-09', employee_name: 'A', gross_amount: 100, net_amount: 90, status: 'paid',
      payroll_payment_items: [{ direction: 'deduction', label: 'PPh 21', amount: 4 }, { direction: 'deduction', label: 'BPJS', amount: 6 }] },
    { id: 2, period_month: '2026-09', employee_name: 'B', gross_amount: 50, net_amount: 50, status: 'paid', payroll_payment_items: [] },
    { id: 3, period_month: '2026-08', employee_name: 'A', gross_amount: 100, net_amount: 100, status: 'paid' },
  ] })
  assert.strictEqual(run.period, '2026-09')
  assert.deepStrictEqual([run.gross, run.net, run.tax, run.bpjs], [150, 140, 4, 6])
  assert.strictEqual(run.people.find((p) => p.name === 'B').tax, null)
  assert.strictEqual(latestPayrollRun({ payments: [] }), null)
})

t('bill checklist: slip read from withholding_records, check from 061, never claimed', () => {
  const before = billChecklistItems({ id: 1, status: 'open' }, { hasInvoice: true, slipNeeded: true })
  assert.deepStrictEqual(before.map((c) => [c.key, c.done, !!c.unknown]), [['invoice', true, false], ['proof', false, false], ['slip', false, true], ['check', false, true]])
  const slips = { available: true, by_debt: { 1: { slip_document_id: 'd' } } }
  const after = billChecklistItems({ id: 1, status: 'paid', last_payment_at: 'x', accountant_checked_at: null }, { paid: true, slipNeeded: true, slips })
  assert.deepStrictEqual(after.map((c) => [c.key, c.done, !!c.editable]), [['invoice', false, false], ['proof', true, false], ['slip', true, false], ['check', false, true]])
  assert.strictEqual(after.find((c) => c.key === 'slip').documentId, 'd')
  assert.ok(!billChecklistItems({ accountant_checked_at: null }, { slipNeeded: false }).some((c) => c.key === 'slip'), 'no slip without an engine withholding')
})

t('landlord counts as a supplier; lender does not (P-04 roles)', () => {
  assert.ok(cpFilter({ role: 'landlord' }, 'supplier'))
  assert.ok(!cpFilter({ role: 'lender' }, 'supplier'))
  assert.ok(!cpFilter({ role: 'lender' }, 'customer'))
})

t('withholding split only with a treatment (review 8.2 #9)', () => {
  const bill = { type: 'payable', currency: 'IDR', description: 'Site repair' }
  assert.strictEqual(withholdingTreatment(bill, null), null, 'no counterparty treatment → no split (goods, fuel)')
  assert.strictEqual(withholdingTreatment(bill, { default_tax_treatment: 'Possibly PPh 23 — needs accountant review' }), 'withhold')
  assert.strictEqual(withholdingTreatment(bill, { default_tax_treatment: 'PPh Final Pasal 4(2) candidate' }), 'withhold')
  assert.strictEqual(withholdingTreatment(bill, { default_tax_treatment: 'No withholding' }), null)
  assert.strictEqual(withholdingTreatment({ ...bill, description: 'gross 100 · withheld 2 (2%)' }, { default_tax_treatment: 'PPh 23' }), 'applied')
  assert.strictEqual(withholdingTreatment({ ...bill, withholding_allocated: 200000 }, { default_tax_treatment: 'PPh 23' }), 'applied', 'a withholding record already reduced what is open')
  assert.strictEqual(withholdingTreatment({ ...bill, currency: 'USD' }, { default_tax_treatment: 'PPh 23' }), null)
  assert.strictEqual(withholdingTreatment({ ...bill, type: 'receivable' }, { default_tax_treatment: 'PPh 23' }), null)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
