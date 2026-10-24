'use strict';
// Real browser + backend (24 Oct 2026): in the transaction window an owner marks an operation personal with a note
// and as reviewed; the server stores purpose, note and the review mark with the owner as actor; the operation, its
// amount and the account balance do not change; the month-close page shows the accounting-preparation summary;
// desktop and phone without sideways scrolling. Needs admit-http.cjs and browser-native.cjs (session for origin
// 127.0.0.1:4333). Synthetic data only.
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), { randomUUID } = require('node:crypto'), { Client } = require('pg'), { chromium } = require('playwright-core');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), db = new Client({ connectionString: process.env.DATABASE_URL }), results = [];
const origin = 'http://127.0.0.1:4333', target = new URL(process.env.BASE_URL);
const proxy = http.createServer((req, res) => { const up = http.request(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up); });
const pass = (name, extra = {}) => { results.push({ case: name, status: 'PASS', ...extra }); fs.writeFileSync('/evidence/BROWSER_CLASSIFICATION.json', JSON.stringify({ candidate: process.env.CFO_RC_SHA || 'unrecorded', results }, null, 2)); console.log('PASS ' + name); };
async function api(path, method, body) { const r = await fetch(process.env.BASE_URL + '/api' + path, { method, headers: { authorization: 'Bearer ' + C.owner.token, 'x-business-id': C.biz, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data; }
let browser, page;
(async () => {
  await db.connect(); assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, C.cluster);
  const desc = 'RC browser personal ' + Date.now();
  await api('/transactions/batch', 'POST', { request_key: randomUUID(), transactions: [{ type: 'expense', amount: '777000', currency: 'IDR', wallet_id: C.wallet, transaction_date: new Date().toISOString().slice(0, 10), description: desc, scope: 'business' }] });
  const txId = (await db.query('SELECT id FROM transactions WHERE business_id=$1 AND description=$2', [C.biz, desc])).rows[0].id;
  const ledger = async () => (await db.query('SELECT to_jsonb(t) j FROM transactions t WHERE id=$1', [txId])).rows[0].j;
  const balance = async () => (await db.query('SELECT fn_wallet_ledger_balance($1)::text b', [C.wallet])).rows[0].b;
  const before = await ledger(), bal0 = await balance();
  await new Promise((r) => proxy.listen(4333, '127.0.0.1', r));
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ storageState: '/tmp/native-browser-state.json', viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  await page.goto(origin + '/business/transactions?tx=' + txId, { waitUntil: 'networkidle' });
  const box = page.locator('[data-txd-accounting]'); await box.waitFor({ timeout: 20000 });
  await page.locator('[data-txd-purpose]').selectOption('personal');
  await page.locator('[data-txd-note]').fill('owner purchase, company card');
  await page.locator('[data-txd-reviewed]').check();
  // The owner is not an accountant: the window says the mark is the owner's, not an accountant's review.
  await page.locator('[data-txd-not-accountant]').waitFor();
  assert.match(await page.locator('[data-txd-not-accountant]').innerText(), /not as a review by an accountant/);
  await page.screenshot({ path: '/evidence/classification-dialog-desktop.png' });
  await page.getByRole('button', { name: 'Save' }).click();
  await box.waitFor({ state: 'detached', timeout: 20000 });
  const row = (await db.query('SELECT business_purpose, note, accountant_reviewed_by::text by, accountant_reviewed_at FROM transaction_classifications WHERE transaction_id=$1', [txId])).rows[0];
  assert.deepEqual([row.business_purpose, row.note, row.by], ['personal', 'owner purchase, company card', String(C.owner.user.id)]);
  assert.equal((await db.query('SELECT accountant_reviewed_role r FROM transaction_classifications WHERE transaction_id=$1', [txId])).rows[0].r, 'owner'); assert.ok(row.accountant_reviewed_at);
  assert.deepEqual(await ledger(), before); assert.equal(await balance(), bal0);
  pass('the transaction window stores purpose, note and the review mark (owner as actor); the operation and the balance are unchanged');
  // Reopen: the window shows what is stored.
  await page.goto(origin + '/business/transactions?tx=' + txId, { waitUntil: 'networkidle' });
  await page.locator('[data-txd-accounting]').waitFor();
  assert.equal(await page.locator('[data-txd-purpose]').inputValue(), 'personal');
  assert.equal(await page.locator('[data-txd-reviewed]').isChecked(), true);
  pass('reopened, the window shows the stored purpose and review');
  await page.goto(origin + '/business/accountant', { waitUntil: 'networkidle' });
  const prep = page.locator('[data-acct-prep]'); await prep.waitFor({ timeout: 20000 });
  assert.match(await prep.innerText(), /Marked personal/);
  // Each figure stays on one line (prod 24 Oct: long labels squeezed the figure column to one character).
  const wrapped = () => page.evaluate(() => [...document.querySelectorAll('[data-acct-prep] dd')].filter((dd) => { const r = document.createRange(); r.selectNodeContents(dd); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1; }).map((dd) => dd.textContent));
  for (const width of [1440, 1100]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(300); assert.deepEqual(await wrapped(), [], 'figures wrap at ' + width); }
  await prep.scrollIntoViewIfNeeded(); await page.screenshot({ path: '/evidence/classification-prep-desktop.png' });
  pass('month close shows the accounting-preparation summary');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/business/transactions?tx=' + txId, '/business/accountant']) {
    await page.goto(origin + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll ' + path);
    if (path === '/business/accountant') { await page.locator('[data-acct-prep]').waitFor(); assert.deepEqual(await wrapped(), [], 'figures wrap on phone'); }
  }
  await page.goto(origin + '/business/transactions?tx=' + txId, { waitUntil: 'networkidle' }); await page.locator('[data-txd-accounting]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/evidence/classification-dialog-phone.png' });
  pass('phone: transaction window and month close fit the screen');
  await context.close(); await browser.close(); proxy.close(); await db.end();
})().catch(async (e) => { console.error(e.message); if (page) await page.screenshot({ path: '/evidence/browser-classification-failure.png' }).catch(() => {}); await browser?.close().catch(() => {}); proxy.close(); await db.end().catch(() => {}); process.exit(1); });
