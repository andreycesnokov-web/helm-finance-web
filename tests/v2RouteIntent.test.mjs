import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyDestination, requestedBusiness, businessSwitchDestination } from '../client/src/lib/routeIntent.js'
import { createRequire } from 'node:module'
const { historyOptions, walletHistoryFilter } = createRequire(import.meta.url)('../server/lib/walletHistory.js')
const A = '00112233-4455-6677-8899-aabbccddeeff', B = '11112233-4455-6677-8899-aabbccddeeff'
test('bookmarks retain the entity, company and safe document context', () => {
  assert.equal(legacyDestination({ pathname: '/accounts/' + A, search: '?business_id=' + B + '&period=all&token=secret&redirect=https://evil', hash: '#history' }, '/business/accounts'), '/business/accounts/' + A + '?business_id=' + B + '&period=all#history')
  assert.equal(legacyDestination({ pathname: '/invoices/42', search: '?doc=' + A }, '/business/invoices'), '/business/invoices/42?doc=' + A)
})
test('tax and settlement links retain their invoice; absent id requires invoice selection', () => {
  for (const mode of ['tax-split', 'settlement']) {
    assert.equal(legacyDestination({ pathname: '/business/accountant/' + mode, search: '?debt_id=42&business_id=' + A }, '/business/payables'), '/business/invoices/42?debt_id=42&business_id=' + A)
    assert.equal(legacyDestination({ pathname: '/business/accountant/' + mode, search: '' }, '/business/payables'), '/business/invoice-review/' + mode)
  }
})
test('company scope accepts only an unambiguous accessible Business UUID', () => {
  const ws = { business: [{ id: A, type: 'business' }], personal: [{ id: B }] }
  assert.equal(requestedBusiness('?business_id=' + A, ws).status, 'available')
  assert.equal(requestedBusiness('?business_id=' + B, ws).status, 'unavailable')
  assert.equal(requestedBusiness('?business_id=' + A + '&business_id=' + B, ws).status, 'invalid')
  assert.equal(requestedBusiness('?workspace_id=personal', ws).status, 'invalid')
  assert.equal(requestedBusiness('', ws).status, 'unspecified')
})
test('switching companies drops entity intent instead of reusing an id in another company', () => {
  assert.equal(businessSwitchDestination('/business/accounts/' + A), '/business/accounts')
  assert.equal(businessSwitchDestination('/business/payables/42'), '/business/payables')
  assert.equal(businessSwitchDestination('/business/counterparties/42/edit'), '/business/counterparties')
  assert.equal(businessSwitchDestination('/business/settings'), '/business/settings')
})
test('history period is applied before pagination and pagination is bounded', () => {
  assert.deepEqual(historyOptions({ period: 'month', limit: '50', offset: '100' }, new Date('2026-10-12T03:00:00Z')), { period: 'month', limit: 50, offset: 100, from: '2026-10-01' })
  for (const q of [{ limit: '-1' }, { limit: '1000' }, { offset: 'Infinity' }, { offset: '1.5' }, { period: 'unknown' }]) assert.throws(() => historyOptions(q))
})
test('legacy source fallback is restricted to null wallet ids, and quotes remain data', () => {
  const filter = walletHistoryFilter({ id: A, name: 'Bank, "Main"\\A' }, '2026-10-01')
  assert.equal(filter, 'and(or(wallet_id.eq.' + A + ',and(wallet_id.is.null,source.eq.' + JSON.stringify('Bank, "Main"\\A') + ')),or(transaction_date.gte.2026-10-01,and(transaction_date.is.null,created_at.gte.2026-10-01)))')
  assert.throws(() => walletHistoryFilter({ id: 'A),business_id.not.is.null', name: 'bad' }))
})
