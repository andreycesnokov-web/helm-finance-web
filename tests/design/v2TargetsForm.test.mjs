// Settings → Targets save body (review 8.2 #13). Run: node tests/design/v2TargetsForm.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import { targetsPatch } from '../../client/src/v2/lib/targetsForm.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 targets form')
const tg = { runway_target_days: 90, min_cash_idr: '50000000', weekly_brief: { day: 1, hour: 8, minute: 30 } }
const same = { runway: 90, minCash: '50000000', day: '1', hour: '8' }

t('nothing changed → empty body', () => assert.deepStrictEqual(targetsPatch(tg, same), {}))
t('only the changed field is sent', () => {
  assert.deepStrictEqual(targetsPatch(tg, { ...same, runway: '120' }), { runway_target_days: 120 })
  assert.deepStrictEqual(targetsPatch(tg, { ...same, minCash: '' }), { min_cash_idr: null })
})
t('changing the brief hour keeps the stored minute', () => {
  assert.deepStrictEqual(targetsPatch(tg, { ...same, hour: '9' }), { weekly_brief: { day: 1, hour: 9, minute: 30 } })
  assert.deepStrictEqual(targetsPatch(tg, { ...same, day: '' }), { weekly_brief: null })
  assert.deepStrictEqual(targetsPatch({}, { runway: '', minCash: '', day: '3', hour: '7' }), { weekly_brief: { day: 3, hour: 7, minute: 0 } })
})
t('TargetsCard sends targetsPatch, never a hard-coded minute 0', () => {
  const src = fs.readFileSync(new URL('../../client/src/v2/components/TargetsCard.jsx', import.meta.url), 'utf8')
  assert.match(src, /targetsPatch\(tg, form\)/)
  assert.ok(!/minute: 0/.test(src))
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
