#!/usr/bin/env node
// Design v2 flag verification (AGENTS.md "Feature Flags": build with the flag OFF and ON).
//
//   node scripts/design-v2-verify.mjs [baseline-ref]      (default: origin/main)
//
// 1. Builds `baseline-ref` in a temporary git worktree (cached per commit).
// 2. Builds this tree with VITE_DESIGN_V2 unset (OFF) and compares with the baseline:
//      - every JS file must be byte-identical (compared by content, not file name);
//      - CSS may differ ONLY by the design-v2 token declarations added to
//        brand/tokens.css (unused with the flag off);
//      - index.html may differ only in hashed asset names.
//    Then greps the OFF bundle for v2 markers — there must be none.
// 3. Builds with VITE_DESIGN_V2=true and checks the lazy v2 chunk is emitted.
// Exits non-zero on any difference. Leaves client/dist as the OFF build.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ref = process.argv[2] || 'origin/main'
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts })
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
let failures = 0
const fail = (m) => { failures++; console.log(`  XX  ${m}`) }
const ok = (m) => console.log(`  ok  ${m}`)

// Tokens added for design v2. Any other CSS difference fails the check.
const V2_TOKENS = ['radius-card', 'radius-control', 'radius-pill', 'chart-1', 'chart-2', 'chart-3',
  'on-navy-muted', 'on-navy-pos', 'on-navy-neg', 'v2-sidebar-width', 'v2-content-max', 'touch-min']
const stripV2Tokens = (css) => css.replace(new RegExp(`--(?:${V2_TOKENS.join('|')}):[^;}]*;?`, 'g'), '').replace(/;}/g, '}')

function collect(dist) {
  const out = { js: new Map(), css: [], html: '' }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) return walk(p)
    const buf = fs.readFileSync(p)
    if (p.endsWith('.js')) out.js.set(sha(buf), path.relative(dist, p))
    else if (p.endsWith('.css')) out.css.push(buf.toString('utf8'))
    else if (p.endsWith('index.html')) out.html = buf.toString('utf8').replace(/assets\/[\w.-]+?-[\w-]{8}\.(js|css)/g, 'assets/X.$1')
    else out[`other:${path.relative(dist, p)}`] = sha(buf)
  })
  walk(dist)
  return out
}

const build = (cwd, env = {}) => sh('npm run build', { cwd, env: { ...process.env, VITE_DESIGN_V2: '', ...env } })

console.log(`\nDesign v2 verify — baseline ${ref}`)
const baseSha = sh(`git rev-parse ${ref}`, { cwd: ROOT }).trim()
const cache = path.join(os.tmpdir(), `design-v2-baseline-${baseSha.slice(0, 12)}`)
if (!fs.existsSync(path.join(cache, 'client', 'dist', 'index.html'))) {
  if (fs.existsSync(cache)) sh(`git worktree remove --force ${cache}`, { cwd: ROOT })
  sh(`git worktree add --detach ${cache} ${baseSha}`, { cwd: ROOT })
  sh('npm ci --no-audit --no-fund', { cwd: path.join(cache, 'client') })
  build(path.join(cache, 'client'))
}
const base = collect(path.join(cache, 'client', 'dist'))

console.log('\nFlag OFF')
build(path.join(ROOT, 'client'))
const off = collect(path.join(ROOT, 'client', 'dist'))

const jsMissing = [...base.js.keys()].filter((h) => !off.js.has(h))
const jsExtra = [...off.js.keys()].filter((h) => !base.js.has(h))
if (jsMissing.length || jsExtra.length) fail(`JS differs: ${jsExtra.map((h) => off.js.get(h)).join(', ')} vs ${jsMissing.map((h) => base.js.get(h)).join(', ')}`)
else ok(`all ${off.js.size} JS files byte-identical to ${ref}`)

const cssOff = off.css.map(stripV2Tokens).sort()
const cssBase = base.css.map(stripV2Tokens).sort()
if (JSON.stringify(cssOff) !== JSON.stringify(cssBase)) fail('CSS differs beyond the design-v2 token declarations')
else ok(`CSS identical apart from ${V2_TOKENS.length} unused design-v2 token declarations`)

if (off.html !== base.html) fail('index.html differs beyond hashed asset names')
else ok('index.html identical apart from hashed asset names')

const others = Object.keys({ ...base, ...off }).filter((k) => k.startsWith('other:'))
const otherDiff = others.filter((k) => base[k] !== off[k])
if (otherDiff.length) fail(`static files differ: ${otherDiff.join(', ')}`)
else ok(`${others.length} static files identical`)

const bundle = [...fs.readdirSync(path.join(ROOT, 'client', 'dist', 'assets'))]
  .map((f) => fs.readFileSync(path.join(ROOT, 'client', 'dist', 'assets', f), 'utf8')).join('\n')
const markers = ['v2-shell', 'data-v2', 'BusinessApp', 'AdminApp', 'VITE_DESIGN_V2', 'design-v2']
const hits = markers.filter((m) => bundle.includes(m))
if (hits.length) fail(`OFF bundle contains v2 markers: ${hits.join(', ')}`)
else ok(`OFF bundle has 0 v2 markers (${markers.join(', ')})`)

console.log('\nFlag ON')
build(path.join(ROOT, 'client'), { VITE_DESIGN_V2: 'true' })
const onFiles = fs.readdirSync(path.join(ROOT, 'client', 'dist', 'assets'))
for (const chunk of ['BusinessApp', 'AdminApp']) {
  if (!onFiles.some((f) => new RegExp(`^${chunk}-.*\\.js$`).test(f))) fail(`ON build has no ${chunk} chunk`)
  else ok(`ON build emits the ${chunk} chunk (${onFiles.filter((f) => f.startsWith(chunk)).join(', ')})`)
}

// Leave the tree as the production (OFF) build.
build(path.join(ROOT, 'client'))
console.log(failures ? `\n${failures} check(s) failed` : '\nAll flag checks passed')
process.exit(failures ? 1 : 0)
