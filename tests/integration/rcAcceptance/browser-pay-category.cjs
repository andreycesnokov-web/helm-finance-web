'use strict';
// Real browser + backend (financial integrity audit 2026-10-24): recording a bill payment can give the payment
// operation a category the user picks — a bill carries none and nothing is guessed. Without a choice the
// operation stays without a category, as before ("choose later"). Needs admit-http.cjs and browser-native.cjs
// (signed-in browser state, stored for origin 127.0.0.1:4333 — the same origin is used here). Synthetic data only.
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), { randomUUID } = require('node:crypto'), { Client } = require('pg'), { chromium } = require('playwright-core');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), db = new Client({ connectionString: process.env.DATABASE_URL }), results = [];
const origin = 'http://127.0.0.1:4333', target = new URL(process.env.BASE_URL);
const proxy = http.createServer((req, res) => { const up = http.request(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up); });
const pass = (name, extra = {}) => { results.push({ case: name, status: 'PASS', ...extra }); fs.writeFileSync('/evidence/BROWSER_PAY_CATEGORY.json', JSON.stringify({ candidate: process.env.CFO_RC_SHA || 'unrecorded', results }, null, 2)); console.log('PASS ' + name); };
async function api(path, method, body) { const r = await fetch(process.env.BASE_URL + '/api' + path, { method, headers: { authorization: 'Bearer ' + C.owner.token, 'x-business-id': C.biz, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data; }
let browser, page;
(async () => {
  await db.connect(); assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, C.cluster);
  // The admitted company starts without categories: add one inflow category of its own for the test.
  await api('/cashflow-categories', 'POST', { name: 'RC payment category ' + Date.now(), group_type: 'inflow' });
  const cats = await api('/cashflow-categories', 'GET');
  const inflow = (cats.categories || []).find((c) => c.group_type === 'inflow' && c.is_active !== false && c.business_id === C.biz);
  assert.ok(inflow, 'an inflow category of this company');
  await new Promise((r) => proxy.listen(4333, '127.0.0.1', r));
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ storageState: '/tmp/native-browser-state.json', viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const receive = async (who, category) => {
    const bill = await api('/debts', 'POST', { request_key: randomUUID(), type: 'receivable', counterparty: who, amount: '250003', currency: 'IDR', scope: 'business', invoice_number: 'RC-CAT-' + Date.now(), invoice_date: '2026-10-01', due_date: '2026-10-30' });
    await page.goto(origin + '/business/receivables', { waitUntil: 'networkidle' });
    const row = page.locator('.v2-brow', { hasText: who }).first(); await row.waitFor();
    await row.getByRole('button', { name: 'Mark received' }).click();
    const dialog = page.locator('[role=dialog]').last(); await dialog.waitFor();
    const wallet = dialog.locator('select').first();
    if (await wallet.inputValue() === '') await wallet.selectOption(String(C.wallet));
    // Categories load after the dialog opens: wait for the company's one to be offered.
    await dialog.locator('[data-payb-category] option', { hasText: inflow.name }).first().waitFor({ state: 'attached', timeout: 15000 });
    const options = await dialog.locator('[data-payb-category] option').allTextContents();
    assert.ok(options.includes(inflow.name), 'the dialog offers the company\'s inflow categories');
    assert.ok(!options.some((o) => (cats.categories || []).some((c) => c.name === o && c.group_type === 'outflow')), 'no outflow category for money coming in');
    if (category) await dialog.locator('[data-payb-category]').selectOption(category);
    await dialog.locator('[data-payb-save]').click();
    await dialog.waitFor({ state: 'detached', timeout: 20000 });
    const tx = (await db.query('SELECT id, type, category, amount_idr::text FROM transactions WHERE business_id=$1 AND debt_payment_id=$2', [C.biz, bill.debt?.id ?? bill.id])).rows;
    assert.equal(tx.length, 1, 'one payment operation'); assert.equal(tx[0].type, 'income'); assert.equal(tx[0].amount_idr, '250003.00');
    return tx[0];
  };
  const chosen = await receive('RC Pay category ' + Date.now(), inflow.name);
  assert.equal(chosen.category, inflow.name);
  pass('a payment recorded with a chosen category gets exactly that category', { category: chosen.category });
  const none = await receive('RC Pay no category ' + Date.now(), null);
  assert.equal(none.category, null);
  pass('without a choice the payment operation stays without a category (nothing guessed)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/business/receivables', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll on a phone');
  pass('the receivables list fits a phone screen');
  await context.close(); await browser.close(); proxy.close(); await db.end();
})().catch(async (e) => { console.error(e.message); if (page) await page.screenshot({ path: '/evidence/browser-pay-category-failure.png' }).catch(() => {}); await browser?.close().catch(() => {}); proxy.close(); await db.end().catch(() => {}); process.exit(1); });
