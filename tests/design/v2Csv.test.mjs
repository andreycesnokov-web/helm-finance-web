// CSV export cells: quoting and formula-injection guard. Run: node tests/design/v2Csv.test.mjs
import assert from 'node:assert'
import { csvCell } from '../../client/src/v2/lib/csv.js'
import { toCsv } from '../../client/src/v2/lib/obligations.js'
import { rowsCsv } from '../../client/src/v2/lib/performance.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 CSV')
t('cells starting with = + - @ tab or CR are prefixed with a quote', () => {
  assert.strictEqual(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
  assert.strictEqual(csvCell('+1+1'), "'+1+1")
  assert.strictEqual(csvCell('-2+3'), "'-2+3")
  assert.strictEqual(csvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.strictEqual(csvCell('\t=1'), "'\t=1")
})
t('numbers, including negative ones, stay numbers', () => {
  assert.strictEqual(csvCell(-125000), '-125000')
  assert.strictEqual(csvCell('-125000.50'), '-125000.50')
  assert.strictEqual(csvCell(0), '0')
  assert.strictEqual(csvCell(null), '')
})
t('quoting still works', () => assert.strictEqual(csvCell('a,"b"\nc'), '"a,""b""\nc"'))
t('both exports use the guard', () => {
  assert.ok(toCsv([{ transaction_date: '2026-09-01', type: 'expense', description: '=cmd|calc', amount_original: '-5' }]).includes("'=cmd|calc"))
  assert.strictEqual(rowsCsv([{ month: '2026-09', note: '@x', v: -3 }], ['month', 'note', 'v']), "month,note,v\n2026-09,'@x,-3")
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
