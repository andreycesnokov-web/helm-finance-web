// Design v2 release: flag on in production builds, workspace switcher and tax regime translated.
// Run: node tests/design/v2Release.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import en from '../../client/src/v2/i18n/en.js'
import ru from '../../client/src/v2/i18n/ru.js'
import id from '../../client/src/v2/i18n/id.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 release')

t('production builds turn the redesign on; a Railway variable can still turn it off', () => {
  assert.match(read('client/.env.production'), /^VITE_DESIGN_V2=true$/m)
  assert.match(read('_specs/design-v2/RELEASE_CHECKLIST.md'), /VITE_DESIGN_V2` = `false` and redeploy/)
})

t('workspace switcher: legacy keeps its English defaults, v2 passes translated labels', () => {
  const sw = read('client/src/shell/WorkspaceSwitcher.jsx')
  assert.match(sw, /groupCompany: 'Company Workspaces'/)
  assert.match(sw, /\{L\.company\} · \{L\.role\(active\.role\)\}/)
  assert.ok(!/>Company · \{/.test(sw), 'no hard-coded "Company ·" left')
  assert.match(read('client/src/v2/shell/V2Shell.jsx'), /<WorkspaceSwitcher[^>]*labels=\{\{/)
  for (const L of [en, ru, id]) for (const k of ['company', 'personal', 'wsGroupCompany', 'wsCreate', 'wsCreateHint', 'wsMember']) assert.ok(L.shell[k], k)
  assert.notStrictEqual(ru.shell.company, en.shell.company)
})

t('tax regime is shown in words in EN/RU/ID', () => {
  for (const L of [en, ru, id]) for (const k of ['normal', 'pp23_final', 'pph_final_umkm']) assert.ok(L.prof.regimeV[k], k)
  assert.match(read('client/src/v2/pages/CompanyProfile.jsx'), /t\(`prof\.regimeV\.\$\{p\.tax_regime\}`\)/)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
