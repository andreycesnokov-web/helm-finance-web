// Design v2 — VITE_DESIGN_V2 must be OFF by default and leave production unchanged.
//
// Builds the client twice into throwaway directories (flag unset, flag on) and checks:
//   - OFF: no v2 chunk, no v2 marker strings, no new API path in the bundle
//   - ON: the v2 chunk exists and carries the markers
// plus source rules: v2 is reachable only through the guarded lazy imports in App.jsx.
//
// Run: node tests/design/v2/flag.test.mjs   (≈15s; needs client/node_modules)
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { t, done, ROOT, code } from './_t.mjs'

const CLIENT = path.join(ROOT, 'client')
const MARKERS = ['v2-shell-marker-never', 'v2-sidebar', 'v2-tabbar', "'nav.group.obligations'", 'Bills & invoices', '/admin/system']

function build(env) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'v2flag-'))
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: CLIENT, env: { ...process.env, ...env }, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, `vite build failed: ${r.stderr || r.stdout}`)
  const files = []
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  walk(out)
  const text = files.filter((f) => /\.(js|css|html)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  return { out, files: files.map((f) => path.relative(out, f)), text }
}

console.log('\nSource')
await t('App.jsx reaches v2 only through the guarded lazy imports', () => {
  const app = code('client/src/App.jsx')
  assert.match(app, /const DESIGN_V2 = import\.meta\.env\.VITE_DESIGN_V2 === 'true'/)
  const imports = [...app.matchAll(/import\(['"](\.\/v2\/[^'"]+)['"]\)/g)]
  assert.ok(imports.length >= 1)
  for (const m of app.matchAll(/lazy\(\(\) => import\(['"]\.\/v2\//g)) {
    const line = app.slice(app.lastIndexOf('\n', m.index), m.index)
    assert.match(line, /DESIGN_V2 \?/, 'every v2 import must sit behind DESIGN_V2 ?')
  }
  assert.ok(!/^import .* from ['"]\.\/v2\//m.test(app), 'no static import of v2 in App.jsx')
})
await t('no file outside client/src/v2 imports v2 code (except App.jsx guard)', () => {
  const offenders = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) { if (!p.endsWith(path.join('src', 'v2'))) walk(p); continue }
      if (!/\.(jsx?|mjs)$/.test(f) || p.endsWith('App.jsx')) continue
      if (/from ['"][./]*\/?v2\//.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p))
    }
  }
  walk(path.join(CLIENT, 'src'))
  assert.deepStrictEqual(offenders, [])
})
await t('the flag is documented and defaults to false', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'), /^VITE_DESIGN_V2=false$/m)
  assert.match(fs.readFileSync(path.join(CLIENT, '.env.example'), 'utf8'), /^VITE_DESIGN_V2=false$/m)
})

console.log('\nBuilds')
const env = { ...process.env }; delete env.VITE_DESIGN_V2
const off = build({ VITE_DESIGN_V2: '' })
const on = build({ VITE_DESIGN_V2: 'true' })
await t('flag OFF: no v2 chunk and no v2 marker in the bundle', () => {
  assert.ok(!off.files.some((f) => /BusinessApp|AdminApp/.test(f)), `v2 chunk present: ${off.files.join(', ')}`)
  for (const m of MARKERS) assert.ok(!off.text.includes(m), `OFF bundle contains ${m}`)
})
await t('flag ON: the v2 chunk ships with its markers', () => {
  assert.ok(on.files.some((f) => /BusinessApp/.test(f)), 'BusinessApp chunk missing')
  for (const m of ['v2-sidebar', 'v2-tabbar']) assert.ok(on.text.includes(m), `ON bundle lacks ${m}`)
})
fs.rmSync(off.out, { recursive: true, force: true }); fs.rmSync(on.out, { recursive: true, force: true })

done()
