// "+ Add" body: always Business, whole rupiah, required fields. Run: node tests/design/v2AddEntry.test.mjs
import assert from 'node:assert'
import { addEntryBody } from '../../client/src/v2/lib/addEntry.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 add entry')
const ok = { type: 'expense', amount: '1.500.000', wallet_id: 'w1', date: '2026-10-03', description: 'Office rent' }

t('a valid expense is always scope business, IDR, on the chosen company account', () => {
  assert.deepStrictEqual(addEntryBody(ok).tx, { type: 'expense', amount: 1500000, currency: 'IDR', wallet_id: 'w1',
    transaction_date: '2026-10-03', description: 'Office rent', category: null, scope: 'business' })
  assert.strictEqual(addEntryBody({ ...ok, type: 'income', scope: 'personal' }).tx.scope, 'business', 'a caller cannot ask for personal')
})
t('amounts: whole rupiah with dot, comma or space separators; nothing else', () => {
  for (const a of ['1500000', '1.500.000', '1,500,000', '1 500 000']) assert.strictEqual(addEntryBody({ ...ok, amount: a }).tx.amount, 1500000, a)
  for (const a of ['', '0', '-5', 'abc', '12,5', '1e9', '9999999999999999']) assert.strictEqual(addEntryBody({ ...ok, amount: a }).error, 'amount', a)
})
t('type, account, date and description are required', () => {
  assert.strictEqual(addEntryBody({ ...ok, type: 'transfer' }).error, 'type')
  assert.strictEqual(addEntryBody({ ...ok, wallet_id: '' }).error, 'wallet')
  assert.strictEqual(addEntryBody({ ...ok, date: '03/10/2026' }).error, 'date')
  assert.strictEqual(addEntryBody({ ...ok, description: '   ' }).error, 'description')
})
t('foreign currency amounts: support decimal and thousand formats for USD, EUR, SGD, USDT', () => {
  assert.deepStrictEqual(addEntryBody({ ...ok, currency: 'USD', amount: '12.50' }).tx, {
    type: 'expense', amount: 12.5, currency: 'USD', wallet_id: 'w1',
    transaction_date: '2026-10-03', description: 'Office rent', category: null, scope: 'business',
  })
  assert.strictEqual(addEntryBody({ ...ok, currency: 'EUR', amount: '1,500.25' }).tx.amount, 1500.25)
  assert.strictEqual(addEntryBody({ ...ok, currency: 'SGD', amount: '1500,75' }).tx.amount, 1500.75)
  assert.strictEqual(addEntryBody({ ...ok, currency: 'USDT', amount: '250.5' }).tx.amount, 250.5)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
