// Design v2 chart maths. Run: node tests/design/v2ChartScale.test.mjs
import assert from 'node:assert'
import { niceTicks, tickLabel, nearestIndex, bandIndex, tipLeft } from '../../client/src/v2/charts/scale.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 chart scale')

t('Radar case from production: −16.5M … 131.8M has a zero tick and a negative bottom', () => {
  const { lo, hi, ticks } = niceTicks([-16.5e6, 57e6, 131.8e6], 5)
  assert.ok(ticks.includes(0), 'zero is a tick')
  assert.ok(lo < 0 && lo <= -16.5e6, 'bottom is below the worst case')
  assert.ok(hi >= 131.8e6)
  assert.strictEqual(ticks[0], lo); assert.strictEqual(ticks[ticks.length - 1], hi)
})

t('negative ticks are labelled with a minus (the old axis showed −20M as "20M")', () => {
  assert.strictEqual(tickLabel(-20e6), '−20M')
  assert.strictEqual(tickLabel(0), '0')
  assert.strictEqual(tickLabel(50e6), '50M')
})

t('all-positive data starts at zero; all-zero data still has a range', () => {
  assert.strictEqual(niceTicks([10, 45e6]).lo, 0)
  assert.deepStrictEqual(niceTicks([0, 0]), { lo: 0, hi: 1, ticks: [0, 1] })
  assert.ok(niceTicks([-5e6, -1e6]).hi === 0)
})

t('ticks are evenly spaced round numbers', () => {
  const { ticks } = niceTicks([-35e6, 25e6], 4)
  const steps = ticks.slice(1).map((v, i) => v - ticks[i])
  assert.ok(steps.every((s) => s === steps[0]), JSON.stringify(ticks))
})

t('pointer snapping and tooltip placement', () => {
  assert.strictEqual(nearestIndex(0, 31, 8, 308), 0)
  assert.strictEqual(nearestIndex(9999, 31, 8, 308), 30)
  assert.strictEqual(nearestIndex(158, 31, 8, 308), 15)
  assert.strictEqual(bandIndex(4 + 50 * 3 + 10, 12, 4, 50), 3)
  assert.strictEqual(tipLeft(100, 180, 600), 112)
  assert.strictEqual(tipLeft(550, 180, 600), 358)
  assert.strictEqual(tipLeft(20, 700, 600), 0)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
