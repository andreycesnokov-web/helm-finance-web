// Design v2 — batch 3 (obligations & money): pure helpers and the write-surface rules.
// Run: node tests/design/v2/obligations.test.mjs
import assert from 'node:assert'
import { t, done, code } from './_t.mjs'
import { debtStatus, summarize, rowsFor, recentlyDecided, isPending, isLive, asList } from '../../../client/src/v2/lib/debts.js'
import {
  freshnessByWallet, txDir, needsCategory, recent, runBreakdown, counterpartyBody, holderMatches,
  balancesByCounterparty, missingDetails, TYPE_TO_ROLE,
} from '../../../client/src/v2/lib/derive.js'

const NOW = new Date('2026-10-03T10:00:00Z')
const d = (o) => ({ id: Math.random().toString(36).slice(2), type: 'payable', amount: 100, remaining_amount: 100, status: 'open', approval_status: 'approved', ...o })

console.log('\nBills & invoices')
await t('status mapping follows server status and approval, with a text label', () => {
  assert.deepStrictEqual(debtStatus(d({ approval_status: 'pending_approval' })), { key: 'pending', tone: 'info' })
  assert.deepStrictEqual(debtStatus(d({ status: 'overdue', type: 'receivable' })), { key: 'late', tone: 'critical' })
  assert.deepStrictEqual(debtStatus(d({ status: 'overdue' })), { key: 'overdue', tone: 'critical' })
  assert.strictEqual(debtStatus(d({ status: 'paid' })).key, 'paid')
  assert.strictEqual(debtStatus(d({ approval_status: 'rejected', status: 'cancelled' })).key, 'rejected')
  assert.strictEqual(debtStatus(d({ status: 'partial' })).key, 'partial')
})
await t('summary uses open approved amounts; pending is reported apart, not added', () => {
  const s = summarize([
    d({ type: 'receivable', remaining_amount: 50, status: 'overdue' }), d({ type: 'receivable', remaining_amount: 20, due_date: '2026-10-10' }),
    d({ remaining_amount: 30 }), d({ remaining_amount: 999, approval_status: 'pending_approval' }), d({ status: 'paid', remaining_amount: 0, amount: 70 }),
  ], NOW)
  assert.deepStrictEqual([s.in.total, s.in.late, s.in.due14, s.in.count], [70, 50, 20, 2])
  assert.deepStrictEqual([s.out.total, s.out.pending, s.out.count], [30, 999, 1])
})
await t('rows: late first, then pending, then by due date; paid tab shows paid only', () => {
  const rows = rowsFor([d({ id: 'a', due_date: '2026-10-20' }), d({ id: 'b', status: 'overdue', due_date: '2026-09-01' }),
    d({ id: 'c', approval_status: 'pending_approval', due_date: '2026-10-25' }), d({ id: 'p', status: 'paid' })], 'payable')
  assert.deepStrictEqual(rows.map((r) => r.id), ['b', 'c', 'a'])
  assert.deepStrictEqual(rowsFor([d({ id: 'p', status: 'paid' }), d({ id: 'x' })], 'payable', 'paid').map((r) => r.id), ['p'])
})
await t('recently decided = approved/rejected with a decision time, newest first', () => {
  const r = recentlyDecided([d({ id: 'o', approved_at: '2026-09-01' }), d({ id: 'n', approved_at: '2026-10-01', approval_status: 'rejected' }), d({ id: 'x' })])
  assert.deepStrictEqual(r.map((x) => x.id), ['n', 'o'])
  assert.ok(isPending(d({ approval_status: 'pending_approval' })) && !isLive(d({ status: 'cancelled' })))
  assert.strictEqual(asList({ debts: [1] }).length, 1)
})

console.log('\nAccounts, transactions, payroll')
await t('statement freshness: latest non-failed batch per wallet, review lines counted', () => {
  const f = freshnessByWallet([
    { wallet_id: 'w1', statement_end: '2026-09-20', status: 'imported' }, { wallet_id: 'w1', statement_end: '2026-09-30', status: 'review_required', row_count: 5, imported_count: 3 },
    { wallet_id: 'w2', statement_end: '2026-10-01', status: 'failed' }, { wallet_id: null, statement_end: '2026-10-01', status: 'imported' }])
  assert.deepStrictEqual(f, { w1: { date: '2026-09-30', review: 2 } })
})
await t('transactions: direction, needs-category and last-N-days by effective date', () => {
  assert.strictEqual(txDir({ type: 'payroll' }), 'out'); assert.strictEqual(txDir({ type: 'transfer' }), 'transfer')
  assert.ok(needsCategory({ type: 'expense', category: ' ' })); assert.ok(!needsCategory({ type: 'transfer' }))
  const r = recent([{ id: 1, transaction_date: '2026-09-01', created_at: '2026-10-02' }, { id: 2, transaction_date: '2026-09-20' }], 30, NOW)
  assert.deepStrictEqual(r.map((x) => x.id), [2], 'back-dated rows follow transaction_date, not created_at')
})
await t('payroll: tax shown only from a recorded withholding line', () => {
  const b = runBreakdown({ net_amount: 935, payroll_payment_items: [{ direction: 'addition', amount: 1000 }, { direction: 'deduction', amount: 50, label: 'PPh 21' }, { direction: 'deduction', amount: 15, label: 'BPJS' }] })
  assert.deepStrictEqual(b, { gross: 1000, tax: 50, otherDed: 15, net: 935, hasTaxLine: true })
  assert.strictEqual(runBreakdown({ net_amount: 500, payroll_payment_items: [] }).hasTaxLine, false)
})

console.log('\nCounterparties')
await t('add-counterparty body maps UI type to existing roles and drops blanks', () => {
  assert.deepStrictEqual(TYPE_TO_ROLE, { supplier: 'vendor', customer: 'customer', both: 'both' })
  const body = counterpartyBody({ type: 'supplier', legal_name: ' CV Test ', display_name: '', npwp: '01.234', pkp_status: 'pkp', address: '', email: '', phone: '', notes: '', bank_name: 'BCA', bank_number: '123', bank_holder: 'CV Test' })
  assert.deepStrictEqual(body, { legal_name: 'CV Test', role: 'vendor', npwp: '01.234', pkp_status: 'pkp',
    bank_accounts: [{ bank_name: 'BCA', account_number: '123', account_name: 'CV Test', is_primary: true }] })
  assert.ok(!('create_new_anyway' in body), 'never overrides the duplicate check by default')
})
await t('bank holder check ignores entity prefixes and punctuation', () => {
  assert.strictEqual(holderMatches('Sumber Teknik Bali', 'CV Sumber Teknik Bali'), true)
  assert.strictEqual(holderMatches('Someone Else', 'CV Sumber Teknik Bali'), false)
  assert.strictEqual(holderMatches('', 'x'), null)
})
await t('open balances join by counterparty_id, then by name/alias', () => {
  const cps = [{ id: 'a', name: 'PT A', aliases: ['Alpha'] }, { id: 'b', name: 'CV B' }]
  const bal = balancesByCounterparty(cps, [
    d({ type: 'receivable', counterparty: 'alpha', remaining_amount: 10, status: 'overdue' }), d({ counterparty_id: 'b', counterparty: 'x', remaining_amount: 5 }),
    d({ counterparty: 'PT A', status: 'paid' })])
  assert.deepStrictEqual(bal, { a: { owesYou: 10, youOwe: 0, late: true }, b: { owesYou: 0, youOwe: 5, late: false } })
  assert.ok(missingDetails({ npwp: null, bank_accounts: [{}] }))
})

console.log('\nWrite surface')
await t('only existing endpoints are written, and only from the pages that need them', () => {
  const writes = {
    'client/src/v2/pages/Approvals.jsx': [/\/debts\/\$\{debt\.id\}\/approve/, /\/debts\/\$\{debt\.id\}\/reject/, /\/debts\/\$\{debt\.id\}\/request-info/],
    'client/src/v2/pages/AddCounterparty.jsx': [/apiFetch\('\/counterparties', token, \{ method: 'POST'/],
  }
  for (const [f, pats] of Object.entries(writes)) for (const p of pats) assert.match(code(f), p, `${f} ${p}`)
  for (const f of ['Bills', 'BillDetail', 'Counterparties', 'Accounts', 'Transactions', 'Payroll', 'Funding']) {
    assert.ok(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(code(`client/src/v2/pages/${f}.jsx`)), `${f} must not write directly`)
  }
})
await t('Add counterparty never merges: duplicate override only after an explicit choice', () => {
  const src = code('client/src/v2/pages/AddCounterparty.jsx')
  assert.match(src, /possible_duplicate_counterparty/)
  assert.match(src, /save\(true\)/)
  assert.ok(!/merge/i.test(src.replace(/acp\.\w+/g, '')), 'no merge call')
})
await t('payroll page never computes PPh 21 rates', () => {
  assert.ok(!/0\.0\d|TER_RATES|\*\s*0\./.test(code('client/src/v2/pages/Payroll.jsx')))
})

done()
