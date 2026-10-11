// Width standard walk (owner, 2026-10: "every tab the same — full width, standard").
// Opens every v2 screen from a built client against the fixture harness (serve.mjs) at
// 1920 / 1440 / 1280 / 390 and checks, per screen:
//   * the workspace is full width: no max-width cap, 32 px gutters on desktop, 16 px on phone;
//   * no horizontal scroll (page and the .v2-main scroller);
//   * nothing sticks out of the workspace (scrollable containers such as wide tables excepted);
//   * the screen did not crash (ErrorBoundary) and logged no console errors.
// Screenshots (full page) at 1920 and 390 when SHOTS_DIR is set.
//   (cd client && npm run build) && CHROMIUM=<chrome.exe> PLAYWRIGHT=playwright-core node tests/design/v2/widthWalk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { start } from './serve.mjs'
const pw = await import(process.env.PLAYWRIGHT || 'playwright')
const chromium = pw.chromium || pw.default?.chromium

const SCREENS = [
  '/business/pulse', '/business/radar', '/business/performance', '/business/performance/cash', '/business/performance/forecast',
  '/business/performance/groups', '/business/ai-cfo', '/business/accounts', '/business/transactions', '/business/funding-investors',
  '/business/assets', '/business/assets/new', '/business/payables', '/business/receivables', '/business/payables/d1', '/business/receivables/d4',
  '/business/payroll', '/business/approvals', '/business/counterparties', '/business/counterparties/new', '/business/counterparties/c5/edit',
  '/business/documents', '/business/accountant', '/business/accountant?tab=packages', '/business/accountant?tab=taxes',
  '/business/accountant/tax-profile', '/business/settings', '/business/more', '/business/onboarding', '/business/add',
  // '/admin' itself is the legacy admin page (not v2), so it is not part of this standard.
  '/admin/businesses', '/admin/system',
]
const WIDTHS = [[1920, 1080], [1440, 900], [1280, 800], [390, 844]]
const SHOTS = process.env.SHOTS_DIR || null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const PORT = 4321
const server = await start(PORT)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
const token = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
const problems = []
let checked = 0

for (const [width, height] of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((tk) => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'ru') }, token)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !/not_in_fixture|404|500|harness_error|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  for (const s of SCREENS) {
    errors.length = 0
    await page.goto(`http://localhost:${PORT}${s}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const inner = document.querySelector('.v2-main-inner')
      const main = document.querySelector('.v2-main')
      if (!inner || !main) return { missing: true }
      const cs = getComputedStyle(inner)
      const mr = main.getBoundingClientRect()
      const scrollsX = (el) => { for (let p = el.parentElement; p && p !== main; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true } return false }
      const out = []
      for (const el of inner.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (!b.width || !b.height || getComputedStyle(el).position === 'fixed') continue
        if (b.right > mr.right + 1 && !scrollsX(el)) { out.push((el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase()).slice(0, 80)); if (out.length > 4) break }
      }
      return {
        maxWidth: cs.maxWidth, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight),
        innerW: Math.round(inner.getBoundingClientRect().width), mainW: Math.round(mr.width),
        docOverflow: document.documentElement.scrollWidth - window.innerWidth, mainOverflow: main.scrollWidth - main.clientWidth,
        crashed: /Something went wrong on this screen|На этом экране что-то пошло не так|Terjadi kesalahan/.test(document.body.innerText),
        out,
      }
    })
    checked++
    const desktop = width >= 1025
    const bad = []
    if (r.missing) bad.push('no v2 workspace')
    else {
      if (r.maxWidth !== 'none') bad.push(`max-width ${r.maxWidth}`)
      const g = desktop ? 32 : 16
      if (r.padL !== g || r.padR !== g) bad.push(`gutters ${r.padL}/${r.padR} (want ${g})`)
      if (Math.abs(r.innerW - r.mainW) > 20) bad.push(`workspace ${r.innerW}px of ${r.mainW}px`)
      if (r.docOverflow > 0) bad.push(`page scrolls sideways ${r.docOverflow}px`)
      if (r.mainOverflow > 1) bad.push(`workspace scrolls sideways ${r.mainOverflow}px`)
      if (r.out.length) bad.push(`sticks out: ${r.out.join(', ')}`)
      if (r.crashed) bad.push('screen crashed')
    }
    if (errors.length) bad.push(`console: ${errors.slice(0, 2).join(' | ').slice(0, 200)}`)
    if (bad.length) problems.push({ width, screen: s, bad })
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${width} ${s}${bad.length ? ' — ' + bad.join('; ') : ''}`)
    if (SHOTS && (width === 1920 || width === 390)) {
      await page.evaluate(() => {
        const st = document.createElement('style'); st.id = '__shot'
        st.textContent = 'html,body{height:auto!important;overflow:visible!important}.v2-shell{height:auto!important;overflow:visible!important}.v2-main{height:auto!important;overflow:visible!important}.v2-sidebar{position:sticky;top:0;height:100vh!important}'
        document.head.appendChild(st); window.scrollTo(0, 0)
      })
      const name = `${width}-${s.replace(/^\//, '').replace(/[/?=&]+/g, '_')}.png`
      await page.screenshot({ path: path.join(SHOTS, name), fullPage: true })
      await page.evaluate(() => document.getElementById('__shot')?.remove())
    }
  }
  await ctx.close()
}
await browser.close(); server.close()
console.log(`\n${problems.length === 0 ? `ALL PASS — ${checked} screen×width checks` : `${problems.length} of ${checked} screen×width checks FAILED`}`)
process.exitCode = problems.length ? 1 : 0
