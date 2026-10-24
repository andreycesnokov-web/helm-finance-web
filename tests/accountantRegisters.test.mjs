// Accountant handoff registers and ZIP writer: periods, safe names, CSV, totals, financing, tax schedule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportingPeriod, quarterOf, safeFileName, uniqueName, toCsv, buildRegisters, taxPreparation, readmeText, PACKAGE_LABEL } from '../client/src/v2/lib/accountantRegisters.js'
import { createZip } from '../client/src/v2/lib/accounting.js'

test('periods: exact first and last day, leap February, quarters of three months', () => {
  assert.deepEqual(reportingPeriod('2026-09'), { kind: 'month', key: '2026-09', months: ['2026-09'], start: '2026-09-01', end: '2026-09-30' })
  assert.equal(reportingPeriod('2028-02').end, '2028-02-29')
  assert.deepEqual(reportingPeriod('2026-Q3'), { kind: 'quarter', key: '2026-Q3', months: ['2026-07', '2026-08', '2026-09'], start: '2026-07-01', end: '2026-09-30' })
  assert.equal(reportingPeriod('2026-Q4').end, '2026-12-31')
  assert.equal(quarterOf('2026-08'), '2026-Q3'); assert.equal(quarterOf('2026-12'), '2026-Q4')
  for (const bad of ['2026-13', '2026-Q5', '2026-9', '', null]) assert.throws(() => reportingPeriod(bad), /invalid_period/)
})

test('file names stay inside the archive and never collide', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('C:\\Users\\x\\inv:oice?.pdf'), 'inv_oice_.pdf')
  assert.equal(safeFileName('..'), 'file'); assert.equal(safeFileName('.hidden.pdf'), 'hidden.pdf')
  assert.equal(safeFileName('Счёт №1.pdf'), 'Счёт No1.pdf', 'NFKC: Cyrillic kept, the numero sign becomes "No"')
  const taken = new Set()
  assert.equal(uniqueName('a.pdf', taken, 'id1'), 'a.pdf'); assert.equal(uniqueName('a.pdf', taken, 'id2'), 'a_id2.pdf'); assert.equal(uniqueName('a.pdf', taken, 'id2'), 'a_id2_1.pdf')
})

test('CSV: BOM, RFC 4180 quoting, and formula-like text cannot execute in a spreadsheet', () => {
  const csv = toCsv({ columns: ['a', 'b', 'c'], rows: [['x,y', 'he said "hi"', '=HYPERLINK("http://x")'], [-125000, '-5', '+1']] })
  assert.ok(csv.startsWith('\uFEFFa,b,c\r\n'))
  assert.ok(csv.includes('"x,y","he said ""hi""","=HYPERLINK(""http://x"")"'))
  assert.ok(csv.includes('\r\n-125000,-5,+1\r\n'), 'numbers stay numbers')
})

test('ZIP writer: valid DOS date, UTF-8 names, refuses traversal and duplicate entries', () => {
  const zip = createZip([{ name: 'documents/Счёт.pdf', data: '%PDF-1.4' }], { date: new Date(2026, 9, 24, 8, 30, 10) })
  const dv = new DataView(zip.buffer)
  assert.equal(dv.getUint16(6, true) & 0x0800, 0x0800, 'UTF-8 flag')
  const d = dv.getUint16(12, true); assert.deepEqual([(d >> 9) + 1980, (d >> 5) & 15, d & 31], [2026, 10, 24])
  for (const bad of ['../x', '/abs', 'C:/x', 'a\\b', 'a/./b', 'a\u0001b']) assert.throws(() => createZip([{ name: bad, data: '' }]), /unsafe_zip_entry_name/, bad)
  assert.throws(() => createZip([{ name: 'a', data: '' }, { name: 'a', data: '' }]), /duplicate_zip_entry_name/)
})

const B = 'biz-1', W = 'w-bank'
const input = () => ({
  period: reportingPeriod('2026-09'), company: { name: 'Synthetic', business_id: B },
  wallets: [{ id: W, business_id: B, name: 'Bank', type: 'bank', currency: 'IDR' }],
  transactions: [
    { id: 1, business_id: B, type: 'income', amount_original: '100000000', currency_original: 'IDR', transaction_date: '2026-08-31', wallet_id: W, description: 'before' },
    { id: 2, business_id: B, type: 'income', amount_original: '50000000.50', currency_original: 'IDR', transaction_date: '2026-09-01', wallet_id: W, category: 'Service revenue', bank_import_row_id: 'r2' },
    { id: 3, business_id: B, type: 'income', amount_original: '250000000', currency_original: 'IDR', transaction_date: '2026-09-15', wallet_id: W, category: 'Loan proceeds', linked_statement_row_id: 'r3' },
    { id: 4, business_id: B, type: 'expense', amount_original: '20000000.25', currency_original: 'IDR', transaction_date: '2026-09-30', wallet_id: W, category: 'Rent' },
    { id: 5, business_id: B, type: 'expense', amount_original: '7', currency_original: 'IDR', transaction_date: '2026-10-01', wallet_id: W, description: 'after' },
    { id: 6, business_id: 'other', type: 'income', amount_original: '999', currency_original: 'IDR', transaction_date: '2026-09-10', wallet_id: W },
    { id: 7, business_id: B, type: 'income', amount_original: '1', currency_original: 'IDR', transaction_date: '2026-09-10', wallet_id: W, is_training: true },
  ],
  funding: { records: [{ id: 'f1', business_id: B, instrument: 'loan', source_kind: 'bank', amount: '250000000', received_on: '2026-09-15', received_transaction_id: '3', repayments: [{ due_on: '2026-10-05', principal: '25000000', interest: '2000000', paid_on: null }] }] },
  pnl: { currency: 'IDR', entries: [{ transaction_id: '2', group: 'revenue' }, { transaction_id: '4', group: 'operating_cost' }], excluded: [{ transaction_id: '3', reason: 'financing' }], exceptions: [], periods: {} },
  payrollRuns: [{ business_id: B, period_month: '2026-09', status: 'scheduled', payroll_payments: [
    { employee_name: 'E1', gross_amount: '8474663', net_amount: '8000000', employer_bpjs: '400000', status: 'paid', transaction_id: 9, payroll_payment_items: [{ item_type: 'salary', amount: '8474663' }, { item_type: 'pph21', amount: '154663' }, { item_type: 'bpjs_kes', amount: '80000' }, { item_type: 'bpjs_jp', amount: '80000' }, { item_type: 'bpjs_jht', amount: '160000' }] },
    { employee_name: 'E2', gross_amount: '4680000', net_amount: '4500000', employer_bpjs: '0', status: 'scheduled', payroll_payment_items: [{ item_type: 'salary', amount: '4680000' }, { item_type: 'bpjs', amount: '180000' }] }] }],
  debts: [{ id: 'd1', business_id: B, type: 'receivable', counterparty: 'Client', original_amount: '35000000', paid_amount: '0', invoice_date: '2026-09-05', due_date: '2026-09-20', status: 'open', approval_status: 'approved' }],
})

test('registers: exact period, this company only, cent-exact totals, opening and closing balances', () => {
  const r = buildRegisters(input())
  const t = r.tables.find((x) => x.name === 'transactions')
  assert.deepEqual(t.rows.map((x) => x[1]), ['2', '3', '4'], 'only 1 Sep..30 Sep, own company, no training rows')
  assert.deepEqual(r.totals.transactions, { count: 3, money_in: 300000000.5, money_out: 20000000.25 })
  const a = r.tables.find((x) => x.name === 'bank_cash_accounts').rows[0]
  assert.deepEqual(a.slice(3, 7), [100000000, 300000000.5, 20000000.25, 380000000.25])
  assert.deepEqual(t.rows.map((x) => x[14]), ['yes', 'yes', 'no'], 'statement-backed: created from a row or linked to one')
})

test('financing is flagged from the funding register and never treated as revenue', () => {
  const r = buildRegisters(input())
  const loan = r.tables.find((x) => x.name === 'transactions').rows.find((x) => x[1] === '3')
  assert.equal(loan[9], 'excluded: financing'); assert.match(loan[10], /loan received/)
  assert.equal(r.totals.financing.received, 250000000)
  const f = r.tables.find((x) => x.name === 'financing').rows
  assert.deepEqual(f.map((x) => x[4]), ['received'], 'October instalment is outside September')
})

test('payroll: entered PPh 21 and the BPJS split are kept; a missing PPh 21 says so; unpaid net is visible', () => {
  const r = buildRegisters(input())
  const p = r.tables.find((x) => x.name === 'payroll').rows
  assert.deepEqual(p[0].slice(7, 12), [154663, 80000, 80000, 160000, 0])
  assert.equal(p[1][7], 'not entered'); assert.equal(p[1][11], 180000)
  assert.equal(r.totals.payroll.pph21_entered, 154663); assert.equal(r.totals.payroll.unpaid_net, 4500000)
  const tax = r.tax.table.rows.find((x) => x[1].startsWith('PPh 21'))
  assert.equal(tax[3], 154663); assert.match(tax[5], /1 payroll line\(s\) without PPh 21/)
})

test('tax schedule follows the profile: PPN only for PKP, LKPM only for PMA/foreign-owned, never a Coretax import', () => {
  const base = { period: reportingPeriod('2026-Q3'), payroll: { rows: [] }, transactions: { rows: [] }, debts: { rows: [] } }
  const nonPkp = taxPreparation({ ...base, profile: { pkp_status: 'not_registered', legal_entity_type: 'PT', npwp: 'x', tax_regime: 'y' } })
  assert.match(nonPkp.table.rows.find((x) => x[1] === 'PPN')[2], /only if the company is PKP/)
  assert.ok(!nonPkp.table.rows.some((x) => /LKPM/.test(x[1])))
  const pma = taxPreparation({ ...base, profile: { pkp_status: 'pkp_registered', legal_entity_type: 'PT PMA', foreign_owned: 'true' } })
  assert.match(pma.table.rows.find((x) => x[1] === 'PPN')[2], /Coretax DJP/)
  assert.match(pma.table.rows.find((x) => /LKPM/.test(x[1]))[2], /OSS/)
  assert.deepEqual(taxPreparation({ ...base, profile: null }).missing_profile.length, 4)
  assert.equal(pma.table.title.includes(PACKAGE_LABEL), true)
  const readme = readmeText({ period: reportingPeriod('2026-09'), company: { name: 'S' }, totals: buildRegisters(input()).totals, isComplete: false, unavailableSources: ['payroll'], generatedAt: 'now' })
  assert.match(readme, /INCOMPLETE/); assert.match(readme, /Filed: NO/); assert.match(readme, /SOURCES NOT AVAILABLE WHEN BUILT .*payroll/)
})
