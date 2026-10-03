// Screenshot the v2 screens from a flag-ON build against the fixture harness.
//   (cd client && VITE_DESIGN_V2=true npm run build) && node tests/design/v2/shoot.mjs out-dir path1 path2 …
// Each path is shot at desktop 1440 and phone 390. Also reports console errors and
// horizontal overflow at 390 — both must be zero for a batch to pass.
const pw = await import(process.env.PLAYWRIGHT || 'playwright')
const chromium = pw.chromium || pw.default?.chromium
import fs from 'node:fs'
import path from 'node:path'
import { start } from './serve.mjs'

const [outDir, ...paths] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const server = await start(4318)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined })
// Unsigned token shaped like the app's JWT; the harness accepts any bearer.
const token = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
let problems = 0
for (const [label, vp] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })
  await ctx.addInitScript((tk) => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, token)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  for (const p of paths) {
    errors.length = 0
    await page.goto(`http://localhost:4318${p}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const name = `${label}-${p.replace(/^\//, '').replace(/[/?=&]/g, '_') || 'root'}.png`
    await page.screenshot({ path: path.join(outDir, name), fullPage: true })
    const bad = errors.filter((e) => !/not_in_fixture|404/.test(e))
    if (bad.length || overflow > 0) problems++
    console.log(`${label} ${p} overflow=${overflow} errors=${bad.length}${bad.length ? ' ' + bad.join(' | ').slice(0, 300) : ''}`)
  }
  await ctx.close()
}
await browser.close(); server.close()
process.exit(problems ? 1 : 0)
