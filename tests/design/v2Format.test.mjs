// Design v2 money/date formatting. Run: node tests/design/v2Format.test.mjs
import assert from 'node:assert'
import { money, compact, daysUntil, initial } from '../../client/src/v2/lib/format.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 formatting')

t('compact amounts in the design style', () => {
  assert.strictEqual(compact(4200000), '4.2M')
  assert.strictEqual(compact(10000000), '10M')
  assert.strictEqual(compact(300000), '300K')
  assert.strictEqual(compact(12500), '12.5K')
  assert.strictEqual(compact(2500000000), '2.5B')
  assert.strictEqual(compact(950), '950')
})

t('signs use a true minus and an explicit plus', () => {
  assert.strictEqual(money(-75200000, { sign: true }), '−Rp 75.2M')
  assert.strictEqual(money(12500000, { sign: true }), '+Rp 12.5M')
  assert.strictEqual(money(-1), '−Rp 1')
  assert.strictEqual(money(0, { sign: true }), 'Rp 0')
})

t('full form and foreign currency', () => {
  assert.strictEqual(money(250000, { full: true }), 'Rp 250,000')
  assert.strictEqual(money(1200, { currency: 'USD' }), 'USD 1.2K')
})

t('a missing figure is a dash, never zero', () => {
  for (const v of [null, undefined, '', 'abc']) assert.strictEqual(money(v), '—')
})

t('daysUntil counts calendar days', () => {
  const from = new Date('2026-10-02T15:00:00')
  assert.strictEqual(daysUntil('2026-10-09', from), 7)
  assert.strictEqual(daysUntil('2026-10-02', from), 0)
  assert.strictEqual(daysUntil('2026-09-30', from), -2)
  assert.strictEqual(daysUntil('nope', from), null)
})

t('initial', () => { assert.strictEqual(initial('demo co'), 'D'); assert.strictEqual(initial(''), '?') })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
