// Design v2 guard rails: flag gating, workspace isolation, no writes, tokens, copy
// and demo data. Static checks over the source, so they run without a browser or
// database. Run: node tests/design/v2Guards.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import en from '../../client/src/v2/i18n/en.js'
import ru from '../../client/src/v2/i18n/ru.js'
import id from '../../client/src/v2/i18n/id.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const V2 = path.join(ROOT, 'client', 'src', 'v2')
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
const files = walk(V2)
const src = files.filter((f) => /\.(jsx?|mjs)$/.test(f))
const rel = (f) => path.relative(ROOT, f)

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }

// Mutating calls v2 is allowed to make. Every entry reuses an EXISTING endpoint with its
// existing server-side role check; it is listed in the batch report. All of them live in
// client/src/v2/lib/actions.js — no other v2 file may write.
export const WRITE_ALLOW = [
  { method: 'PATCH', path: '/approve' },        // PATCH /api/debts/:id/approve
  { method: 'PATCH', path: '/reject' },         // PATCH /api/debts/:id/reject
  { method: 'POST', path: '/request-info' },    // POST  /api/debts/:id/request-info
  { method: 'PATCH', path: '/transactions/' },  // PATCH /api/transactions/:id (category)
  { method: 'POST', path: "'/counterparties'" },// POST  /api/counterparties
  // Batch 8 — approved proposals (DECISIONS.md): role-checked and audited on the server.
  { method: 'PATCH', path: '`/counterparties/' }, // PATCH /api/counterparties/:id (P-04)
  { method: 'PATCH', path: "'/business/targets'" }, // PATCH /api/business/targets (P-01, P-08)
  { method: 'PATCH', path: '/checklist' },      // PATCH /api/debts/:id/checklist (P-05)
  // Batch 9 — P-10 (DECISIONS.md): role-checked and audited on the server.
  { method: 'PATCH', path: "'/pnl-mapping'" },  // PATCH /api/pnl-mapping
  // Batch 10 — DECISIONS.md final decisions item 5: role-checked and audited on the server.
  { method: 'POST', path: '/withholding' },     // POST /api/debts/:id/withholding
  // Batch 11 — P-11 asset register: role-checked and audited on the server.
  { method: 'POST', path: "'/assets'" },        // POST /api/assets
]
const ACTIONS = path.join(V2, 'lib', 'actions.js')
// POSTs that ask an existing AI endpoint a question and change no data. Only in lib/ask.js.
const ASK = path.join(V2, 'lib', 'ask.js')
const ASK_ALLOW = ["'/accountant/ask'", "'/ai-cfo/ask'"]

console.log('\nDesign v2 — flag')

// App.jsx is matched raw: its comments contain route globs like '/business/*' that a
// naive comment stripper would read as the start of a block comment.
const appSrc = read(path.join(ROOT, 'client/src/App.jsx'))

t('App.jsx reads VITE_DESIGN_V2 as a strict string compare (default OFF)', () => {
  assert.ok(/const DESIGN_V2 = import\.meta\.env\.VITE_DESIGN_V2 === 'true'/.test(appSrc), 'flag constant missing')
})

t('the v2 app is reachable only through the flag-gated lazy import', () => {
  const app = appSrc
  const imports = [...app.matchAll(/import\(['"]\.\/v2\/[^'"]+['"]\)/g)]
  assert.ok(imports.length >= 1, 'expected a lazy import of ./v2')
  for (const m of imports) {
    const line = app.slice(app.lastIndexOf('\n', m.index), app.indexOf('\n', m.index))
    assert.match(line, /DESIGN_V2 \? lazy\(\(\) => import\(/, `ungated v2 import: ${line.trim()}`)
  }
  assert.ok(!/^import .* from ['"]\.\/v2/m.test(app), 'App.jsx must not statically import v2')
})

t('nothing outside client/src/v2 imports v2 statically', () => {
  const others = walk(path.join(ROOT, 'client', 'src')).filter((f) => !f.startsWith(V2) && /\.(jsx?)$/.test(f))
  for (const f of others) {
    const s = code(read(f))
    assert.ok(!/^import [^\n]* from ['"][./]*v2\//m.test(s), `${rel(f)} statically imports v2`)
  }
})

t('flag documented in both .env.example files', () => {
  assert.match(read(path.join(ROOT, 'client/.env.example')), /^VITE_DESIGN_V2=false$/m)
  assert.match(read(path.join(ROOT, '.env.example')), /VITE_DESIGN_V2/)
})

console.log('\nDesign v2 — workspace isolation and writes')

t('v2 never calls a Personal API (Business workspace only)', () => {
  for (const f of src) {
    const s = code(read(f))
    assert.ok(!/['"`]\/(api\/)?personal\//.test(s), `${rel(f)} references a /personal API path`)
    assert.ok(!/personal-business-connections|['"`]\/(api\/)?funding\b/.test(s), `${rel(f)} touches the Personal↔Business bridge`)
  }
})

t('v2 never overrides the business scope header', () => {
  for (const f of src) assert.ok(!/x-business-id/i.test(code(read(f))), `${rel(f)} sets x-business-id itself`)
})

t('v2 makes no mutating request outside the reviewed allow-list', () => {
  for (const f of src) {
    const s = code(read(f))
    const writes = [...s.matchAll(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g)]
    if (f === ASK) {
      for (const m of writes) {
        const line = s.slice(s.lastIndexOf('\n', m.index), m.index)
        assert.ok(m[1] === 'POST' && ASK_ALLOW.some((a) => line.includes(a)), `${rel(f)}: only POST to ${ASK_ALLOW.join(', ')}`)
      }
      continue
    }
    if (f !== ACTIONS) { assert.strictEqual(writes.length, 0, `${rel(f)} writes; only lib/actions.js may`); continue }
    for (const m of writes) {
      const line = s.slice(s.lastIndexOf('\n', m.index), m.index)
      const hit = WRITE_ALLOW.find((w) => line.includes(w.path) && w.method === m[1])
      assert.ok(hit, `${rel(f)}: ${m[1]} ${line.trim().slice(0, 80)} not in WRITE_ALLOW`)
    }
    assert.strictEqual(writes.length, WRITE_ALLOW.length, 'every allowed write is used exactly once')
  }
})

t('every allowed write exists on the server (batch 8 routes are the approved ones only)', () => {
  const server = read(path.join(ROOT, 'server/index.js'))
  for (const r of [/app\.patch\('\/api\/debts\/:id\/approve'/, /app\.patch\('\/api\/debts\/:id\/reject'/,
    /app\.post\('\/api\/debts\/:id\/request-info'/, /app\.patch\('\/api\/transactions\/:id'/, /app\.post\('\/api\/counterparties'/,
    /app\.patch\('\/api\/counterparties\/:id'/, /app\.patch\('\/api\/business\/targets'/, /app\.patch\('\/api\/debts\/:id\/checklist'/,
    /app\.patch\('\/api\/pnl-mapping'/, /app\.post\('\/api\/debts\/:id\/withholding'/,
    /app\.post\('\/api\/assets'/]) {
    assert.ok(r.test(server), `server route ${r} missing`)
  }
})

t('no direct apiFetch writes hidden behind a helper outside actions.js', () => {
  for (const f of src) {
    if (f === ACTIONS || f === ASK) continue
    assert.ok(!/\bapiFetch\(/.test(code(read(f))) || f.endsWith('data.jsx'), `${rel(f)} calls apiFetch directly (reads go through useApi)`)
  }
})

t('no new server endpoint namespace for v2', () => {
  for (const f of src) assert.ok(!/\/api\/v2\b|['"`]\/v2\//.test(code(read(f))), `${rel(f)} calls a /v2 API`)
})

console.log('\nDesign v2 — tokens, fonts, data')

t('v2 CSS declares no custom properties (tokens live in brand/tokens.css)', () => {
  for (const f of files.filter((x) => x.endsWith('.css'))) {
    assert.ok(!/(^|[;{\s])--[\w-]+\s*:/.test(read(f)), `${rel(f)} declares a custom property`)
  }
})

t('v2 CSS uses no raw hex colours', () => {
  for (const f of files.filter((x) => x.endsWith('.css'))) {
    const hex = read(f).replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g)
    assert.ok(!hex, `${rel(f)} hard-codes ${hex && hex.join(', ')}`)
  }
})

t('no Google Fonts CDN', () => {
  for (const f of files) assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(read(f)), `${rel(f)} loads Google Fonts`)
})

t('no demo company, people or figures from the designs', () => {
  const demo = ['Nusantara', 'Sinar Abadi', 'Mitra Bali', 'Para Legals', 'Bali Resort', 'Denpasar', 'Budi', '122.9', '78.2M', '153.9']
  for (const f of src) {
    const s = code(read(f))
    for (const d of demo) assert.ok(!s.includes(d), `${rel(f)} contains design demo value "${d}"`)
  }
})

console.log('\nDesign v2 — copy')

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)
const used = new Set()
for (const f of src) for (const m of code(read(f)).matchAll(/\bt\(\s*['"]([a-zA-Z][\w.]+)['"]/g)) used.add(m[1])
for (const f of src) for (const m of read(f).matchAll(/(?:labelKey|titleKey):\s*['"]([\w.]+)['"]/g)) used.add(m[1])
for (const f of src) for (const m of read(f).matchAll(/titleKey="([\w.]+)"/g)) used.add(m[1])

t('every copy key used by v2 exists in EN', () => {
  const missing = [...used].filter((k) => typeof lookup(en, k) !== 'string')
  assert.deepStrictEqual(missing, [])
})

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p + k + '.') : [p + k]))
const enKeys = flat(en)
const missingRu = enKeys.filter((k) => typeof lookup(ru, k) !== 'string')
const missingId = enKeys.filter((k) => typeof lookup(id, k) !== 'string')
console.log(`  ..  RU falls back to EN for ${missingRu.length} key(s)${missingRu.length ? ': ' + missingRu.join(', ') : ''}`)
console.log(`  ..  ID falls back to EN for ${missingId.length} key(s)${missingId.length ? ': ' + missingId.join(', ') : ''}`)

t('RU and ID carry no key EN does not have', () => {
  const extra = [...flat(ru), ...flat(id)].filter((k) => typeof lookup(en, k) !== 'string')
  assert.deepStrictEqual(extra, [])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
