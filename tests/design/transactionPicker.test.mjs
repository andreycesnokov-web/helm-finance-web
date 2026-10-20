import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareDocumentTransaction, filterAndRankTransactions, transactionCounterparty, transactionCurrency, transactionMatchScore } from '../../client/src/v2/lib/transactionPickerModel.js'
import { appendTransactionPage } from '../../client/src/v2/lib/transactionPages.js'

const doc = { gross_amount: 8500000, currency: 'IDR', document_date: '2026-08-21', issuer_counterparty_id: 'cp-a' }
const txs = [
  { id: 1, type: 'expense', amount_original: 8500000, currency_original: 'IDR', transaction_date: '2026-08-21', wallet_id: 'bca', counterparty_id: 'cp-a', counterparty_name: 'ARY MICRO', description: 'TRF ARY MICRO 081234' },
  { id: 2, type: 'expense', amount_original: 8500000, currency_original: 'IDR', transaction_date: '2026-07-01', wallet_id: 'permata', description: 'TRF OTHER PARTY' },
  { id: 3, type: 'income', amount_original: 8500000, currency_original: 'IDR', transaction_date: '2026-08-20', wallet_id: 'bca', description: 'Incoming transfer' },
  { id: 4, type: 'expense', amount_original: 8500000, currency_original: 'USD', transaction_date: '2026-08-21', wallet_id: 'bca', description: 'USD payment' },
]
const base = { search: '', from: '', to: '', direction: 'all', wallet: 'all', unmatched: false }

test('search includes recorded date and references without manufacturing counterparties or currency', () => {
  assert.deepEqual(filterAndRankTransactions(txs, doc, { ...base, search: '2026-07-01' }).map(x => x.id), [2])
  const row = { ...txs[0], bank_reference: 'BANK-001-REF' }
  assert.equal(filterAndRankTransactions([row], doc, { ...base, search: 'bank-001-ref' }).length, 1)
  assert.equal(transactionCurrency({ amount: 100 }), '')
})

test('cursor pages preserve unique order and reject repeated, malformed and oversized pages', () => {
  const first = appendTransactionPage([], [{ id: 9 }, { id: 7 }], null, 2)
  assert.equal(first.hasMore, true)
  assert.equal(first.beforeId, 7)
  const last = appendTransactionPage(first.rows, [{ id: 1 }], first.beforeId, 2)
  assert.deepEqual(last.rows.map(x => x.id), [9, 7, 1])
  assert.equal(last.hasMore, false)
  for (const page of [[{ id: 7 }], [{ id: 1 }, { id: 2 }], [{ id: 0 }], [{ id: 'oops' }]]) {
    assert.throws(() => appendTransactionPage(first.rows, page, 7, 2), /cursor/)
  }
  assert.throws(() => appendTransactionPage([], [{ id: 3 }, { id: 2 }, { id: 1 }], null, 2), /response/)
  assert.throws(() => appendTransactionPage([], {}, null), /response/)
})

test('ranks only evidence: exact IDR amount, close date and recorded counterparty', () => {
  const rows = filterAndRankTransactions(txs, doc, base)
  assert.equal(rows[0].id, 1)
  assert.ok(transactionMatchScore(txs[0], doc) > transactionMatchScore(txs[2], doc))
  assert.ok(transactionMatchScore(txs[1], doc) > transactionMatchScore(txs[3], doc))
  assert.equal(transactionCounterparty(txs[2]), '') // Never invent a name from the description.
})

test('searches formatted amounts and explicit counterparty or bank text', () => {
  assert.deepEqual(filterAndRankTransactions(txs, doc, { ...base, search: '8,500,000' }).map(x => x.id).sort(), [1, 2, 3, 4])
  assert.deepEqual(filterAndRankTransactions(txs, doc, { ...base, search: 'ARY MICRO' }).map(x => x.id), [1])
  assert.deepEqual(filterAndRankTransactions(txs, doc, { ...base, search: 'incoming' }).map(x => x.id), [3])
  assert.deepEqual(filterAndRankTransactions(txs, doc, { ...base, search: 'Incoming 8500000' }).map(x => x.id), [])
})

test('date, debit/credit, account and unmatched filters compose without writing links', () => {
  const filters = { ...base, from: '2026-08-01', to: '2026-08-31', direction: 'out', wallet: 'bca', unmatched: true }
  assert.deepEqual(filterAndRankTransactions(txs, doc, filters, [], new Set(['1'])).map(x => x.id), [4])
  assert.deepEqual(filterAndRankTransactions(txs, doc, filters, [], new Set()).map(x => x.id), [1, 4])
  assert.deepEqual(filterAndRankTransactions([{ ...txs[0], transaction_date: null }], doc,
    { ...base, to: '2026-08-31' }), [])
})

test('comparison reports matches only from comparable stored fields', () => {
  assert.deepEqual(compareDocumentTransaction(doc, txs[0]), {
    amount: 'matches', date: 'matches', counterparty: 'matches', insufficientDocumentData: false,
  })
  assert.deepEqual(compareDocumentTransaction(doc, txs[1]), {
    amount: 'matches', date: 'differs', counterparty: 'unknown', insufficientDocumentData: false,
  })
  assert.equal(compareDocumentTransaction(doc, txs[3]).amount, 'differs') // currency differs
  assert.equal(compareDocumentTransaction({ ...doc, currency: null }, txs[0]).amount, 'unknown')
  assert.equal(compareDocumentTransaction({ ...doc, currency: null }, txs[0]).insufficientDocumentData, true)
  assert.equal(compareDocumentTransaction(doc, { ...txs[0], counterparty_id: 'cp-b' }).counterparty, 'differs')
})

test('missing document fields and ledger timestamps never imply a match', () => {
  const missing = { gross_amount: null, document_date: null, issuer_counterparty_id: null }
  assert.deepEqual(compareDocumentTransaction(missing, { ...txs[0], transaction_date: null, created_at: '2026-08-21' }), {
    amount: 'unknown', date: 'unknown', counterparty: 'unknown', insufficientDocumentData: true,
  })
  assert.equal(compareDocumentTransaction({ ...doc, document_date: '2026-02-31' }, txs[0]).date, 'unknown')
  assert.equal(compareDocumentTransaction({ ...doc, document_date: '2026-02-31' }, txs[0]).insufficientDocumentData, true)
})
