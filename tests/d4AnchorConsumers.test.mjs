// D4-A consumers: opening-anchor bookkeeping rows (moved anchor, its reversal, bank opening
// alignment) are balance mechanics, not operations. They must never count as revenue/cost/burn,
// never make a month unreconciled and never demand documents from the accountant.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { classOf } from '../client/src/v2/lib/cashClass.js'
import { closeReadiness, OPENING_ANCHOR_SOURCES } from '../client/src/v2/lib/accounting.js'

const require = createRequire(import.meta.url)
const { classifyTransaction } = require('../server/lib/financialInsights')
const { documentControl } = require('../server/lib/operationDocuments')
const { validBusinessTimezone } = require('../server/lib/profileValidation')
const { openingRequest } = require('../server/lib/bankImportReview')

const anchorRows = [
  { id: 11, type: 'correction', source: 'opening_reanchor', category: 'Opening balance', description: 'Moved opening', amount_original: '36000000', transaction_date: '2026-08-31', wallet_id: 'w1', scope: 'business' },
  { id: 12, type: 'correction', source: 'opening_reanchor_reversal', category: 'Opening balance', description: 'Reversal', amount_original: '-41000000', transaction_date: '2026-09-30', wallet_id: 'w1', scope: 'business' },
  { id: 13, type: 'correction', source: 'bank_import_opening', category: 'Balance adjustment', description: 'Bank opening', amount_original: '-200000', transaction_date: '2026-09-30', wallet_id: 'w1', scope: 'business' },
]

test('cash class: a moved anchor and its reversal are opening balance (client and server agree)', () => {
  for (const t of anchorRows.slice(0, 2)) {
    assert.equal(classOf(t), 'opening_balance')
    assert.equal(classifyTransaction(t).class, 'opening_balance')
  }
  assert.equal(classOf(anchorRows[2]), 'balance_correction', 'a bank alignment stays a correction')
  assert.equal(classifyTransaction(anchorRows[2]).class, 'balance_correction')
  assert.equal(classOf({ type: 'correction', source: 'manual' }), 'balance_correction', 'ordinary corrections unchanged')
  assert.equal(classOf({ type: 'expense', source: 'manual', category: 'Supplier invoices' }) === 'opening_balance', false)
})

test('bank reconciliation: anchor rows never make the month unreconciled', () => {
  assert.deepEqual([...OPENING_ANCHOR_SOURCES].sort(), ['bank_import_opening', 'opening_reanchor', 'opening_reanchor_reversal'])
  const r = closeReadiness({ month: '2026-09', transactions: anchorRows, wallets: [{ id: 'w1', type: 'bank', name: 'BCA', currency: 'IDR' }], batches: [] })
  assert.deepEqual(r.unlinked_transactions.map(t => t.id), [], 'none of the anchor rows is listed as an unlinked bank movement')
  const manual = closeReadiness({ month: '2026-09', transactions: [...anchorRows, { id: 14, type: 'expense', source: 'manual', category: 'Supplier invoices', amount_original: '5', transaction_date: '2026-09-02', wallet_id: 'w1' }],
    wallets: [{ id: 'w1', type: 'bank', name: 'BCA', currency: 'IDR' }], batches: [] })
  assert.deepEqual(manual.unlinked_transactions.map(t => t.id), [14], 'a real unlinked movement is still reported')
})

test('operation documents: anchor rows are not operations that need evidence', () => {
  const s = { scope: 'company', transactions: [...anchorRows, { id: 1, scope: 'business', created_by_user_id: 1, transaction_date: '2026-09-01', type: 'expense', category: 'Supplier invoices', amount_original: '30', currency_original: 'IDR', wallet_id: 'w1', document_review_version: 'v1' }].map(t => ({ document_review_version: 'v1', created_by_user_id: 1, ...t })),
    documents: [], files: [], debt_links: [], transaction_links: [], audit: [] }
  const out = documentControl(s, { month: '2026-09', role: 'owner', actor: 1 })
  assert.equal(out.summary.total, 1)
  assert.deepEqual(out.operations.flatMap(o => o.payments.map(p => Number(p.id))), [1])
})

test('company time zone: only IANA Area/Location (POSIX names invert the sign in PostgreSQL)', () => {
  for (const z of ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'America/Argentina/Buenos_Aires', '', null]) assert.equal(validBusinessTimezone(z), true, z)
  for (const z of ['GMT+7', 'UTC+7', '+07:00', 'WIB', 'Etc/GMT-7', 'Asia/Nowhere', 'asia/jakarta', 'x'.repeat(70)]) assert.equal(validBusinessTimezone(z), false, z)
})

test('re-anchor request contract: exact shape, align keeps the former receipt shape', () => {
  const r = openingRequest({ mode: 'reanchor', reason: ' move ', expected_anchor_id: '7', expected_new_anchor: '36000000', expected_today_after: '41000000', same_day: 'after' })
  assert.deepEqual(r, { mode: 'reanchor', reason: 'move', expected_anchor_id: 7, expected_new_anchor: '36000000', expected_today_after: '41000000', confirm_today_change: false, same_day: 'after', align_target: null })
  assert.deepEqual(openingRequest({ expected_historical_opening: '10', target_opening: '12', reason: 'r' }), { expected_historical_opening: '10', target_opening: '12', reason: 'r' })
  for (const bad of [{ mode: 'reanchor', reason: 'x', expected_anchor_id: 1, expected_new_anchor: '1', expected_today_after: '1', extra: 1 },
    { mode: 'reanchor', reason: '', expected_anchor_id: 1, expected_new_anchor: '1', expected_today_after: '1' },
    { mode: 'reanchor', reason: 'x', expected_anchor_id: 0, expected_new_anchor: '1', expected_today_after: '1' },
    { mode: 'reanchor', reason: 'x', expected_anchor_id: 1, expected_new_anchor: '1', expected_today_after: '1', same_day: 'maybe' },
    { mode: 'reanchor', reason: 'x', expected_anchor_id: 1, expected_new_anchor: '1e400', expected_today_after: '1' },
    { mode: 'other', reason: 'x' }]) assert.throws(() => openingRequest(bad), /import_invalid_opening/)
})
