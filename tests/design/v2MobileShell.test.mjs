// Design v2 mobile shell padding and bottom tabbar clearance test.
// Run: node tests/design/v2MobileShell.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
let pass = 0, fail = 0
const t = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (e) {
    fail++
    console.log(`  XX  ${name}\n      ${e.message}`)
  }
}

console.log('\nDesign v2 mobile shell clearance')

t('v2-main.cfo-main overrides legacy shell.css mobile padding with !important', () => {
  const css = read('client/src/v2/v2.css')
  assert.match(css, /\.v2-shell\s+\.v2-main\.cfo-main\s*\{\s*padding:\s*0\s*!important;\s*\}/)
})

t('v2-main-inner specifies at least 112px bottom padding on mobile for tabbar clearance', () => {
  const css = read('client/src/v2/v2.css')
  assert.match(css, /\.v2-main-inner\s*\{[^}]*calc\(112px \+ env\(safe-area-inset-bottom/)
})

t('compact mobile viewports (<=480px) have adjusted padding avoiding horizontal overflow', () => {
  const css = read('client/src/v2/v2.css')
  assert.match(css, /@media\s*\(max-width:\s*480px\)\s*\{\s*\.v2-main-inner\s*\{[^}]*var\(--space-3\)/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
