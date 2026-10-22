// Isolated UI exercise using the existing design fixture server. No real CFO API is contacted.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { start } from './serve.mjs'
import { installFixtureTransport } from './fixtureTransport.mjs'
import { routes } from './fixtures.mjs'
const { chromium } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright-core')

const dir = process.env.SHOTS_DIR || path.resolve('reports/transaction-picker-preview')
fs.mkdirSync(dir, { recursive: true })
const inProcess = process.env.UI_IN_PROCESS === 'true'
const server = inProcess ? {close(){}} : await start(4332)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
if(inProcess){const create=browser.newContext.bind(browser);browser.newContext=async(...args)=>{const context=await create(...args);await installFixtureTransport(context);return context}}
try {
  for (const [width, height, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const token = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
    await context.addInitScript(tk => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, token)
    const page = await context.newPage()
    let linkPosts = 0
    page.on('request', req => { if (req.method() === 'POST' && /\/api\/documents\/[^/]+\/links$/.test(req.url())) linkPosts++ })
    await page.route('**/api/documents/doc1/links', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ ok: true, link_id: 'fixture-link' }) }))
    await page.goto('http://127.0.0.1:4332/business/documents?doc=doc1', { waitUntil: 'networkidle' })
    await page.locator('[data-doc-drawer="doc1"]').waitFor()
    await page.getByRole('button', { name: 'Find a transaction' }).click()
    await page.getByRole('searchbox', { name: 'Search transactions' }).fill('450000')
    const result = page.locator('.v2-txp-option')
    assert.equal(await result.count(), 1)
    assert.match(await result.first().innerText(), /TRF 0192 FUEL/)
    if (name === 'mobile') {
      assert.equal(await page.locator('.v2-txp-filter-body').isVisible(), false, 'mobile filters start collapsed')
    } else assert.equal(await page.locator('.v2-txp-filter-body').isVisible(), true)
    await page.locator('.v2-txp-panel').screenshot({ path: path.join(dir, `${name}-search.png`) })
    if (name === 'mobile') {
      await page.getByRole('button', { name: 'Filters' }).click()
      assert.equal(await page.locator('.v2-txp-filter-body').isVisible(), true)
      await page.locator('.v2-txp-panel').screenshot({ path: path.join(dir, 'mobile-filters.png') })
    }
    await page.getByRole('searchbox', { name: 'Search transactions' }).press('ArrowDown')
    assert.equal(await result.first().evaluate(el => document.activeElement === el), true)
    await result.first().press('Enter')
    assert.equal(await page.locator('.v2-txp-compare').count(), 1)
    assert.equal(await page.locator('.v2-txp-caution').count(), 1, 'missing document fields require a visible warning')
    assert.equal(await page.locator('.v2-txp-comparison .v2-pill-neutral').count(), 3, 'unknown evidence is not called a match')
    assert.equal(linkPosts, 0, 'choosing a row must not create a document link')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert.equal(overflow, false, `${name} should have no horizontal overflow`)
    await page.locator('.v2-txp-compare').screenshot({ path: path.join(dir, `${name}-compare.png`) })
    await page.getByRole('button', { name: 'Change transaction' }).click()
    await page.getByRole('searchbox', { name: 'Search transactions' }).press('Escape')
    assert.equal(await page.locator('[data-doc-drawer="doc1"]').count(), 1, 'Escape in picker should keep the document open')
    assert.equal(await page.locator('.v2-txp-panel').count(), 0)
    await page.evaluate(() => {
      const confirm = document.querySelector('.v2-txp-compare + button')
      if (!confirm) throw new Error('Missing final link button')
      confirm.click()
      confirm.click()
    })
    await page.waitForTimeout(250)
    assert.equal(linkPosts, 1, 'rapid double confirmation must make only one link request')
    await context.close()
  }
  for (const [mode, status, expected] of [['empty', 200, 'No transactions match'], ['error', 500, 'Could not load transactions']]) {
    const context = await browser.newContext()
    const token = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
    await context.addInitScript(tk => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, token)
    const page = await context.newPage()
    await page.route('**/api/transactions?*', route => route.fulfill({ status, contentType: 'application/json',
      body: status === 200 ? '[]' : '{"error":"fixture_error"}' }))
    await page.goto('http://127.0.0.1:4332/business/documents?doc=doc1', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Find a transaction' }).click()
    assert.match(await page.locator('.v2-txp-panel').innerText(), new RegExp(expected))
    await context.close()
  }
  const loadingContext = await browser.newContext()
  const loadingToken = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
  await loadingContext.addInitScript(tk => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, loadingToken)
  const loadingPage = await loadingContext.newPage()
  let releaseTransactions
  const transactionsReady = new Promise(resolve => { releaseTransactions = resolve })
  await loadingPage.route('**/api/transactions?*', async route => { await transactionsReady; await route.fallback() })
  try {
    await loadingPage.goto('http://127.0.0.1:4332/business/documents?doc=doc1', { waitUntil: 'domcontentloaded' })
    await loadingPage.getByRole('button', { name: 'Find a transaction' }).click()
    await loadingPage.getByRole('status').getByText('Loading transactions').waitFor()
    releaseTransactions()
    await loadingPage.locator('.v2-txp-option').first().waitFor()
  } finally { releaseTransactions(); await loadingContext.close() }
  process.env.FIXTURE_TX_COUNT = '1205'
  const largeContext = await browser.newContext()
  const token = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Demo' })).toString('base64') + '.y'
  await largeContext.addInitScript(tk => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, token)
  const largePage = await largeContext.newPage()
  await largePage.goto('http://127.0.0.1:4332/business/documents?doc=doc1', { waitUntil: 'networkidle' })
  await largePage.getByRole('button', { name: 'Find a transaction' }).click()
  await largePage.getByRole('searchbox', { name: 'Search transactions' }).fill('Archive sample 123')
  await largePage.locator('.v2-txp-option', { hasText: 'Archive sample 123' }).waitFor()
  assert.equal(await largePage.locator('.v2-txp-option', { hasText: 'Archive sample 123' }).count(), 1,
    'search reaches a transaction beyond the usual 1000-row API cap')
  await largeContext.close()
  delete process.env.FIXTURE_TX_COUNT
  // Keyboard regression: existing links are visible but disabled. Navigation
  // skips them at both edges and in the middle, including a filtered all-disabled list.
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(tk => { localStorage.setItem('hf_token', tk); localStorage.setItem('hf_lang', 'en') }, token)
    const page = await context.newPage()
    let posts = 0
    page.on('request', req => { if (req.method() === 'POST') posts++ })
    const blocked = [901, 903, 905]
    await page.route(/\/api\/documents(?:\?.*)?$/, route => {
      const data = routes['GET /api/documents']()
      data.documents.find(d => d.id === 'doc1').links = blocked.map(id => ({ id: `l-${id}`, target_type: 'transaction', target_id: String(id) }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.route('**/api/transactions?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      [905, 904, 903, 902, 901].map(id => ({ id, type: 'expense', amount_original: 100000, currency_original: 'IDR', transaction_date: '2026-08-20', wallet_id: 'w1', description: `Keyboard ${id}` }))) }))
    await page.goto('http://127.0.0.1:4332/business/documents?doc=doc1', { waitUntil: 'networkidle' })
    posts = 0 // Ignore normal application bootstrap requests; observe keyboard interaction only.
    await page.getByRole('button', { name: 'Find a transaction' }).click()
    const options = page.locator('.v2-txp-option'), search = page.getByRole('searchbox', { name: 'Search transactions' })
    assert.equal(await options.count(), 5)
    assert.equal(await options.nth(0).isDisabled(), true)
    await search.press('ArrowDown')
    assert.equal(await options.nth(1).evaluate(el => document.activeElement === el), true)
    await options.nth(1).press('ArrowDown')
    assert.equal(await options.nth(3).evaluate(el => document.activeElement === el), true)
    await options.nth(3).press('ArrowUp')
    assert.equal(await options.nth(1).evaluate(el => document.activeElement === el), true)
    await options.nth(1).press('End')
    assert.equal(await options.nth(3).evaluate(el => document.activeElement === el), true)
    await options.nth(3).press('Home')
    assert.equal(await options.nth(1).evaluate(el => document.activeElement === el), true)
    await search.fill('Keyboard 903')
    await search.press('ArrowDown')
    assert.equal(await search.evaluate(el => document.activeElement === el), true)
    assert.equal(await options.first().isDisabled(), true)
    assert.equal(posts, 0, 'keyboard browsing must not create links or any other records')
    await context.close()
  }
  console.log('Transaction picker browser: desktop/mobile, loading/empty/error and 1205-row pagination PASS')
} finally { await browser.close(); server.close() }
