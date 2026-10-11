// Clickable AI phrases (DESIGN_SPEC rule 6). Run: node tests/design/v2AiLinks.test.mjs
import assert from 'node:assert'
import { parseAiText, safeTarget, drillLink, readDrill } from '../../client/src/v2/lib/aiLinks.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 AI links')

t('a phrase becomes a page + filter link (both forms)', () => {
  const a = parseAiText('Costs grew after the [April expansion](cfo://performance?month=2026-04&compare=2026-03&focus=april-expansion).')
  assert.deepStrictEqual(a, [
    { type: 'text', text: 'Costs grew after the ' },
    { type: 'link', text: 'April expansion', to: '/business/performance?month=2026-04&compare=2026-03&focus=april-expansion' },
    { type: 'text', text: '.' },
  ])
  const b = parseAiText('See [transactions](/business/transactions?month=2026-09).')
  assert.strictEqual(b[1].to, '/business/transactions?month=2026-09')
})

t('unsafe or unknown targets degrade to plain text', () => {
  for (const bad of ['https://evil.example', 'javascript:alert(1)', '//evil.example', '/admin/system', '/business/settings',
    'cfo://unknown', '/business/performance?month=2026-13', '/business/performance?evil=1', '/business/performance?focus=<b>',
    '/business/performance?month=2026-04&month=2026-05', '/business/performance#x', 'cfo://performance?focus=a%22onload']) {
    const r = parseAiText(`x [phrase](${bad}) y`)
    assert.ok(r.every((seg) => seg.type === 'text'), `should not link: ${bad}`)
    assert.ok(r.map((seg) => seg.text).join('').startsWith('x phrase'), `text kept: ${bad}`)
  }
})

t('text without links is one segment; empty is empty', () => {
  assert.deepStrictEqual(parseAiText('plain'), [{ type: 'text', text: 'plain' }])
  assert.deepStrictEqual(parseAiText(''), [])
  assert.deepStrictEqual(parseAiText(null), [])
})

t('safeTarget normalises trailing slashes and keeps only allowed params', () => {
  assert.strictEqual(safeTarget('/business/radar/'), '/business/radar')
  assert.strictEqual(safeTarget('cfo://performance/cash?month=2026-09'), '/business/performance/cash?month=2026-09')
  assert.strictEqual(safeTarget('/business/radar?filter=in'), '/business/radar?filter=in')
})

t('drillLink builds, readDrill reads back and drops junk', () => {
  const to = drillLink('performance', { month: '2026-04', compare: '2026-03', focus: 'april-expansion' })
  assert.strictEqual(to, '/business/performance?month=2026-04&compare=2026-03&focus=april-expansion')
  assert.deepStrictEqual(readDrill(to.split('?')[1]), { month: '2026-04', compare: '2026-03', focus: 'april-expansion' })
  assert.deepStrictEqual(readDrill('month=bad&focus=ok'), { month: null, compare: null, focus: 'ok' })
})

t('prototype keys never resolve: constructor, __proto__, toString, hasOwnProperty (review 8.2 #1)', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
    assert.strictEqual(safeTarget(`cfo://${k}`), null, k)
    assert.strictEqual(safeTarget(`/business/pulse?${k}=1`), null, k)
    assert.doesNotThrow(() => parseAiText(`see [x](/business/pulse?${k}=1) and [y](cfo://${k})`), k)
    const segs = parseAiText(`see [x](/business/pulse?${k}=1)`)
    assert.ok(segs.every((g) => g.type === 'text'), k)
  }
  assert.strictEqual(typeof safeTarget('cfo://toString'), 'object')
  const d = readDrill('?constructor=1&__proto__=x&month=2026-04')
  assert.deepStrictEqual(d, { month: '2026-04', compare: null, focus: null })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
