// Design v2: technical tags are hidden from screens. Run: node tests/design/v2Markers.test.mjs
import assert from 'node:assert'
import { stripMarkers, scrubMarkers } from '../../client/src/v2/lib/markers.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 markers')

t('demo pack tag is removed from production descriptions', () => {
  assert.strictEqual(stripMarkers('DEMO-AR-002 Partner settlement — overdue [CFO_AI_DEMO_PACK_V1]'), 'DEMO-AR-002 Partner settlement — overdue')
  assert.strictEqual(stripMarkers('Co-branding campaign [CFO_AI_DEMO_PACK_V1] · was due'), 'Co-branding campaign · was due')
  assert.strictEqual(stripMarkers('[CFO_AI_DEMO_PACK_V1] Monthly wash'), 'Monthly wash')
})

t('ordinary brackets stay', () => {
  for (const s of ['Invoice [draft]', 'Pay [PT ABC]', 'Revenue [Q3]', 'Rent [2026]', 'no tag here']) assert.strictEqual(stripMarkers(s), s)
})

t('deep scrub keeps keys, numbers and shape', () => {
  const src = { debts: [{ id: 1, amount: 5500000, description: 'x [CFO_AI_DEMO_PACK_V1]', tags: ['[A_B]', 'ok'] }], ok: true, n: null }
  assert.deepStrictEqual(scrubMarkers(src), { debts: [{ id: 1, amount: 5500000, description: 'x', tags: ['', 'ok'] }], ok: true, n: null })
  assert.strictEqual(src.debts[0].description, 'x [CFO_AI_DEMO_PACK_V1]', 'input not mutated')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
