// Release walk (batch 13): open every v2 screen from a flag-ON build against the fixture
// harness, collect every in-app link and button, follow every link and report:
//   * links that land somewhere else than asked (the catch-all sends them to Pulse);
//   * buttons that are disabled without saying why (no title / aria-describedby / visible note);
//   * console errors and horizontal overflow at 1440 and 390.
//   (cd client && VITE_DESIGN_V2=true npm run build) && node tests/design/v2/walk.mjs [report.json]
// With FIXTURE_MODE=error or =empty the same walk checks every screen's error / empty state
// (no crash, no overflow); links are not followed in those modes.
const pw = await import(process.env.PLAYWRIGHT || 'playwright')
const chromium = pw.chromium || pw.default?.chromium
import fs from 'node:fs'
import { start } from './serve.mjs'

export const SCREENS = [
  '/business/pulse', '/business/radar', '/business/performance', '/business/performance/cash', '/business/performance/forecast',
  '/business/performance/groups', '/business/ai-cfo', '/business/accounts', '/business/transactions', '/business/funding-investors',
  '/business/assets', '/business/assets/new', '/business/payables', '/business/receivables', '/business/payables/d1', '/business/receivables/d4',
  '/business/payroll', '/business/approvals', '/business/counterparties', '/business/counterparties/new', '/business/counterparties/c5/edit',
  '/business/documents', '/business/accountant', '/business/accountant?tab=packages', '/business/accountant?tab=taxes',
  '/business/accountant/tax-profile', '/business/settings', '/business/more', '/business/onboarding',
  '/admin', '/admin/businesses', '/admin/system',
]
const out = process.argv[2] || null
const server = await start(4319)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
const token = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
const report = { screens: {}, badLinks: [], silentDisabled: [], errors: [], overflow: [] }
const norm = (u) => { const x = new URL(u, 'http://h'); return x.pathname.replace(/\/$/, '') + x.search }

for (const [label, vp] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript((tk) => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, token)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !/not_in_fixture|404|500|harness_error|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  const links = new Set()
  for (const s of SCREENS) {
    errors.length = 0
    await page.goto(`http://localhost:4319${s}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    const landed = norm(page.url())
    if (!process.env.FIXTURE_MODE && landed.split('?')[0] !== s.split('?')[0] && !(s === '/admin' && landed.startsWith('/admin'))) report.badLinks.push({ from: '(direct)', to: s, landed })
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      const as = [...document.querySelectorAll('a[href]')].filter(vis).map((a) => a.getAttribute('href')).filter((h) => h.startsWith('/'))
      const bs = [...document.querySelectorAll('button')].filter(vis).map((b) => ({
        text: (b.textContent || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        why: !!(b.getAttribute('title') || b.getAttribute('aria-describedby') || b.querySelector('.v2-notyet')),
      }))
      return { as, bs, overflow: document.documentElement.scrollWidth - window.innerWidth }
    })
    info.as.forEach((h) => links.add(h))
    report.screens[`${label} ${s}`] = { links: info.as.length, buttons: info.bs.length, disabled: info.bs.filter((b) => b.disabled).length,
      buttonTexts: [...new Set(info.bs.map((b) => (b.disabled ? '[off] ' : '') + b.text))], linkTargets: [...new Set(info.as)] }
    for (const b of info.bs) if (b.disabled && !b.why && b.text) report.silentDisabled.push({ screen: `${label} ${s}`, button: b.text })
    if (info.overflow > 0) report.overflow.push({ screen: `${label} ${s}`, px: info.overflow })
    if (errors.length) report.errors.push({ screen: `${label} ${s}`, errors: [...errors] })
  }
  if (label === 'desktop' && !process.env.FIXTURE_MODE) {
    for (const h of [...links].sort()) {
      if (/^\/(api|personal)\b/.test(h)) continue
      await page.goto(`http://localhost:4319${h}`, { waitUntil: 'networkidle' })
      const landed = norm(page.url())
      const want = norm(h)
      const ok = landed.split('?')[0] === want.split('?')[0]
        || (want === '/business' && landed === '/business/pulse')
        || (want.startsWith('/admin') && landed.startsWith('/admin'))
      if (!ok) report.badLinks.push({ from: 'link', to: h, landed })
    }
    report.linksFollowed = links.size
  }
  await ctx.close()
}
await browser.close(); server.close()
const bad = report.badLinks.length + report.silentDisabled.length + report.errors.length + report.overflow.length
console.log(JSON.stringify({ linksFollowed: report.linksFollowed, screens: Object.keys(report.screens).length,
  badLinks: report.badLinks, silentDisabled: report.silentDisabled, errors: report.errors, overflow: report.overflow }, null, 1))
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1))
process.exit(bad ? 1 : 0)
