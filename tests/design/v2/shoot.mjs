// Design v2 visual harness: serve a VITE_DESIGN_V2=true build against the
// synthetic API in fixtures.mjs and photograph routes at 1440 and 390.
//
// Checks per shot (fails the run on any):
//   - no console error / page error
//   - no horizontal scroll at 390
//   - on phone: every visible v2 link/button inside .v2-root is ≥ 44px tall
//     (the tab bar, nav rows and buttons — inline text links excluded)
// Also prints every /api call the fixtures did not answer (404), so a gap in the
// fixture set is visible rather than silently rendered as an error state.
//
// Usage: node tests/design/v2/shoot.mjs <distDir> <outDir> [route ...]
// Requires Playwright (global install is used if the project has none).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { route as api } from './fixtures.mjs'

const [,, DIST, OUT, ...ROUTES_ARG] = process.argv
if (!DIST || !OUT) { console.error('usage: shoot.mjs <distDir> <outDir> [route ...]'); process.exit(2) }
const req = createRequire(import.meta.url)
let chromium
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) {
  try { ({ chromium } = req(p)); break } catch { /* next */ }
}
if (!chromium) { console.log('SKIP: playwright not available'); process.exit(0) }

const ROUTES = ROUTES_ARG.length ? ROUTES_ARG : ['/business/pulse', '/business/more']
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.json': 'application/json' }
const misses = new Set()

const server = http.createServer((rq, rs) => {
  const url = new URL(rq.url, 'http://x')
  if (url.pathname.startsWith('/api/')) {
    const hit = api(rq.method, url.pathname + url.search)
    if (!hit) misses.add(`${rq.method} ${url.pathname}`)
    rs.writeHead(hit ? hit.status : 404, { 'content-type': 'application/json' })
    rs.end(JSON.stringify(hit ? hit.body : { error: 'not_in_fixtures' }))
    return
  }
  let f = path.join(DIST, decodeURIComponent(url.pathname))
  if (!f.startsWith(path.resolve(DIST)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  rs.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(rs)
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`
fs.mkdirSync(OUT, { recursive: true })

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64({ alg: 'none' })}.${b64({ userId: 1, firstName: 'Test' })}.x`

const browser = await chromium.launch()
let failures = 0
for (const vp of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'phone', width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript((tok) => {
    localStorage.setItem('hf_token', tok); localStorage.setItem('hf_lang', 'en')
    localStorage.setItem('cfo_onboarded', '1')
  }, TOKEN)
  for (const r of ROUTES) {
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()) })
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(base + r, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const probe = await page.evaluate((phone) => {
      const doc = document.documentElement
      const hscroll = doc.scrollWidth > window.innerWidth + 1
      const small = []
      if (phone) {
        document.querySelectorAll('.v2-root a, .v2-root button').forEach((el) => {
          const rect = el.getBoundingClientRect()
          if (!rect.width || !rect.height) return
          if (el.closest('.v2-legacy, .v2-legacy-embed') || el.matches('.v2-inline, .v2-skip')) return
          if (getComputedStyle(el).display === 'inline') return
          if (rect.height < 43.5) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(rect.height)}px`)
        })
      }
      return { hscroll, small: [...new Set(small)].slice(0, 8), hasV2: !!document.querySelector('.v2-root') }
    }, vp.name === 'phone')
    const file = path.join(OUT, `${vp.name}${r.replace(/[/?=&]+/g, '_')}.png`)
    await page.screenshot({ path: file, fullPage: true })
    const problems = []
    if (!probe.hasV2) problems.push('v2 shell not rendered')
    if (errs.length) problems.push(`console: ${errs.slice(0, 3).join(' | ')}`)
    if (vp.name === 'phone' && probe.hscroll) problems.push('horizontal scroll at 390')
    if (probe.small.length) problems.push(`small targets: ${probe.small.join('; ')}`)
    console.log(`${problems.length ? 'XX' : 'ok'}  ${vp.name.padEnd(7)} ${r}${problems.length ? '\n      ' + problems.join('\n      ') : ''}`)
    failures += problems.length ? 1 : 0
    await page.close()
  }
  await ctx.close()
}
await browser.close()
server.close()
if (misses.size) console.log(`\nAPI calls not in fixtures (answered 404):\n  ${[...misses].sort().join('\n  ')}`)
console.log(`\n${failures ? `${failures} shot(s) with problems` : 'all shots clean'}`)
process.exit(failures ? 1 : 0)
