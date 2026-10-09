// Empty records registry in the accountant package: a quiet month is legitimate, so the package
// only asks to import / restore when a statement for the month actually has lines.
// Run: node tests/accountantEmptyMonth.test.mjs   (PDF_OUT=<dir> also writes the PDFs for review)
import fs from 'node:fs'
import path from 'node:path'
import { emptyMonthAssessment, createAccountantZipPackage } from '../client/src/v2/lib/accounting.js'
import { I18N } from '../client/src/v2/lib/accountantSummaryPdf.js'

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) { console.log('OK  ' + msg); pass++ } else { console.error('FAIL ' + msg); fail++ } }

const MONTH = '2026-09'
const BIZ = 'biz-empty-month'
const bank = { id: 'w-bank', business_id: BIZ, name: 'Permata IDR', type: 'bank', currency: 'IDR', is_active: true }
const bank2 = { id: 'w-bank2', business_id: BIZ, name: 'BCA Payroll', type: 'bank', currency: 'IDR', is_active: true }
const cash = { id: 'w-cash', business_id: BIZ, name: 'Kas Kecil (Cash)', type: 'cash', currency: 'IDR', is_active: true }
const stmt = (over) => ({ id: 'b-' + Math.random().toString(36).slice(2, 8), business_id: BIZ, wallet_id: bank.id, status: 'imported',
  statement_start: '2026-09-01', statement_end: '2026-09-30', opening_balance: 5000000, closing_balance: 5000000, row_count: 0, ...over })

console.log('\n--- emptyMonthAssessment')
{
  ok('registry not empty → null', emptyMonthAssessment({ month: MONTH, registryLength: 3, batches: [], wallets: [bank] }) === null)

  const lines = emptyMonthAssessment({ month: MONTH, batches: [stmt({ row_count: 43 })], wallets: [bank] })
  ok('statement for the month has lines → statement_has_lines', lines.kind === 'statement_has_lines' && lines.lines === 43 && lines.wallets_with_lines[0] === 'Permata IDR')

  const noStmt = emptyMonthAssessment({ month: MONTH, batches: [], wallets: [bank] })
  ok('no statement → unconfirmed (no warning to restore)', noStmt.kind === 'unconfirmed' && noStmt.wallets_without_statement[0] === 'Permata IDR')

  const quiet = emptyMonthAssessment({ month: MONTH, batches: [stmt({ row_count: 0 })], wallets: [bank] })
  ok('statement covering the month with no lines → confirmed_empty', quiet.kind === 'confirmed_empty')

  const wide = emptyMonthAssessment({ month: MONTH, batches: [stmt({ statement_start: '2026-07-01', statement_end: '2026-09-30', row_count: 12 })], wallets: [bank] })
  ok('quarter statement with lines → unconfirmed (lines may be in other months)', wide.kind === 'unconfirmed' && wide.wallets_uncertain[0] === 'Permata IDR')

  const partial = emptyMonthAssessment({ month: MONTH, batches: [stmt({ statement_end: '2026-09-15', row_count: 0 })], wallets: [bank] })
  ok('statement for half of the month, no lines → unconfirmed', partial.kind === 'unconfirmed')

  const mixed = emptyMonthAssessment({ month: MONTH, batches: [stmt({ row_count: 0 }), stmt({ wallet_id: bank2.id, row_count: 0 })], wallets: [bank, bank2, cash] })
  ok('every bank account quiet (cash ignored) → confirmed_empty', mixed.kind === 'confirmed_empty')

  const oneMissing = emptyMonthAssessment({ month: MONTH, batches: [stmt({ row_count: 0 })], wallets: [bank, bank2] })
  ok('one bank account without a statement → unconfirmed', oneMissing.kind === 'unconfirmed' && oneMissing.wallets_without_statement[0] === 'BCA Payroll')

  const cancelled = emptyMonthAssessment({ month: MONTH, batches: [stmt({ row_count: 43, status: 'cancelled' })], wallets: [bank] })
  ok('a cancelled (superseded) statement is ignored', cancelled.kind === 'unconfirmed')

  ok('no bank account → no_bank_accounts', emptyMonthAssessment({ month: MONTH, batches: [], wallets: [cash] }).kind === 'no_bank_accounts')
}

console.log('\n--- package wiring + PDF per scenario')
const scenarios = [
  ['statement_has_lines', { batches: [stmt({ row_count: 43 })], wallets: [bank] }],
  ['unconfirmed', { batches: [], wallets: [bank] }],
  ['confirmed_empty', { batches: [stmt({ row_count: 0 })], wallets: [bank] }],
  ['no_bank_accounts', { batches: [], wallets: [cash] }],
]
const out = process.env.PDF_OUT || null
if (out) fs.mkdirSync(out, { recursive: true })
for (const [kind, input] of scenarios) {
  for (const lang of ['ru', 'en', 'id']) {
    const pkg = await createAccountantZipPackage({ month: MONTH, companyName: 'PT Quiet Month', businessId: BIZ, transactions: [], debts: [], documents: [], lang, ...input })
    ok(`${kind} ${lang}: summary.empty_month.kind`, pkg.summary.empty_month?.kind === kind)
    ok(`${kind} ${lang}: PDF generated`, pkg.summaryPdfBytes instanceof Uint8Array && pkg.summaryPdfBytes.length > 1000)
    if (out) fs.writeFileSync(path.join(out, `empty-${kind}-${lang}.pdf`), pkg.summaryPdfBytes)
  }
}
{
  const withTx = await createAccountantZipPackage({ month: MONTH, companyName: 'PT Busy Month', businessId: BIZ, documents: [], lang: 'ru',
    wallets: [bank], batches: [stmt({ row_count: 1 })],
    transactions: [{ id: 1, business_id: BIZ, wallet_id: bank.id, type: 'income', amount_original: 100000, currency_original: 'IDR', transaction_date: '2026-09-10', category: 'Sales', description: 'Client' }] })
  ok('month with records: no empty_month assessment', withTx.summary.empty_month === null)
  if (out) fs.writeFileSync(path.join(out, 'nonempty-ru.pdf'), withTx.summaryPdfBytes)
}

console.log('\n--- texts exist in every language and only the "has lines" text asks to restore')
for (const lang of ['ru', 'en', 'id']) {
  const t = I18N[lang]
  ok(`${lang}: all empty-month texts present`, ['statusEmptyRegistry', 'emptyRegistryTitle', 'emptyHasLines', 'emptyUnconfirmed', 'emptyConfirmed', 'emptyNoBanks', 'emptyUnlinkedNote'].every(k => t[k]))
}
const restoreWord = { ru: /восстанов/i, en: /restore/i, id: /pulihkan/i }
for (const lang of ['ru', 'en', 'id']) {
  const t = I18N[lang]
  ok(`${lang}: "has lines" asks to import/restore`, restoreWord[lang].test(t.emptyHasLines('X', 3)))
  ok(`${lang}: quiet / open / no-bank texts do not ask to restore`,
    ![t.emptyConfirmed, t.emptyNoBanks, t.emptyUnconfirmed('X', ''), t.emptyUnlinkedNote].some(s => restoreWord[lang].test(s)))
}

console.log(`\nEMPTY MONTH TESTS: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
