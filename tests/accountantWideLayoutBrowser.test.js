/**
 * Browser check for the AI Accountant month-close workspace (owner design 2026-10:
 * "AI Бухгалтер — новая рабочая область (1920)" / "— телефон (390)") and the v2 sidebar.
 *
 * Real server (in-memory Supabase) + built client (client/dist) in Chromium:
 *   · the workspace uses the full width on /business/accountant (32 px gutters, 16 px phone);
 *   · no horizontal scroll at 1920 / 1440 / 1280 / 390; long titles wrap; amount and the
 *     Investigate button never overlap anything;
 *   · the row is no longer a button: only "Разобрать" opens the drawer; the reason pill is a
 *     button (aria-expanded / aria-controls) that opens an explanation block under the row,
 *     inside the card; Enter and Space work; the action link keeps account, month and batch;
 *   · Escape closes the drawer; phone buttons are ≥ 44 px;
 *   · sidebar: drag to 220 / 320, double-click back to 264, arrows ±8, remembered;
 *     labels one line in RU / EN / ID; the overdue badge is a compact "13" with the full
 *     phrase as its name; "Platform admin" carries a lock, not a badge;
 *   · zero console errors.
 *
 * Run (after `cd client && npm run build`):  node tests/accountantWideLayoutBrowser.test.js
 * Screenshots: set SHOTS_DIR=<dir>.
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 5199;
const SHOTS = process.env.SHOTS_DIR || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

process.env.PORT = String(PORT);
process.env.SUPABASE_URL = 'http://localhost:0/fake';
process.env.SUPABASE_SECRET_KEY = 'test-fake-secret-key';
process.env.BOT_TOKEN = 'test-fake-bot-token';
process.env.JWT_SECRET = 'test-jwt-secret-for-browser-run';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-fake-tg-webhook-secret';
process.env.NODE_ENV = 'test';

const BIZ = 'c2222222-3333-4444-5555-666666666666';
const USER_ID = 3101;
process.env.ADMIN_TELEGRAM_IDS = String(USER_ID);   // shows "Platform admin" in the sidebar

const mem = require(path.join(ROOT, 'tests', 'integration', '_memorySupabase'));
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const LONG = 'Pembayaran jasa konsultasi hukum dan pengurusan perubahan anggaran dasar PT untuk periode September 2026 termasuk biaya notaris dan PNBP AHU Online';

mem.__seed('users', [{ id: USER_ID, first_name: 'Layout Tester', username: 'layout', email: 'layout@testhelm.id' }]);
mem.__seed('businesses', [{ id: BIZ, name: 'PT Lebar Layar Indonesia', type: 'company', owner_user_id: USER_ID, created_at: '2026-01-01' }]);
mem.__seed('business_members', [{ id: 'bm-1', business_id: BIZ, user_id: USER_ID, role: 'owner', status: 'active', is_active: true }]);
mem.__seed('user_subscriptions', [{ user_id: USER_ID, status: 'active', plan: 'founder' }]);
mem.__seed('business_addons', [{ id: 'ad-1', business_id: BIZ, addon: 'ai_accountant', status: 'active' }]);
mem.__seed('wallets', [
  { id: 'w-bca', business_id: BIZ, name: 'BCA Operasional', currency: 'IDR', type: 'bank', is_active: true },
  { id: 'w-mandiri', business_id: BIZ, name: 'Mandiri Payroll', currency: 'IDR', type: 'bank', is_active: true },
  { id: 'w-permata', business_id: BIZ, name: 'Permata Giro', currency: 'IDR', type: 'bank', is_active: true },
]);
const tx = (id, wallet, type, amount, description, day, category) => ({
  id, business_id: BIZ, transaction_date: `2026-09-${day}`, date: `2026-09-${day}`,
  amount_original: amount, amount, currency_original: 'IDR', currency: 'IDR', type, description, category,
  wallet_id: wallet, source: 'manual', is_reconciled: false,
});
mem.__seed('transactions', [
  tx(701, 'w-bca', 'expense', 17500000, LONG, '12', 'Legal'),
  tx(702, 'w-bca', 'expense', 2500000, 'Sewa server cloud', '14', 'Infrastructure'),
  tx(703, 'w-mandiri', 'income', 125000000, 'Pembayaran klien PT Resort Bali', '18', 'Sales'),
  tx(704, 'w-permata', 'expense', 999999999, 'Pembelian peralatan kantor', '20', 'Assets'),
]);
// Thirteen overdue payables → the sidebar badge reads "13".
mem.__seed('debts', Array.from({ length: 13 }, (_, i) => ({
  id: 900 + i, business_id: BIZ, type: 'payable', status: 'open', approval_status: 'approved',
  counterparty: `Supplier ${i + 1}`, original_amount: 1000000, amount: 1000000, paid_amount: 0, due_date: '2026-09-05',
})));
mem.__seed('cashflow_categories', [
  { id: 'cat-legal', business_id: BIZ, name: 'Legal', group_type: 'opex' },
  { id: 'cat-infra', business_id: BIZ, name: 'Infrastructure', group_type: 'opex' },
]);
mem.__seed('bank_import_batches', [
  // Mandiri: September statement uploaded but still to review → "statement unconfirmed".
  { id: 'batch-mandiri', business_id: BIZ, wallet_id: 'w-mandiri', file_name: 'mandiri_sept.csv', status: 'review_required',
    statement_start: '2026-09-01', statement_end: '2026-09-30', created_at: '2026-10-02T10:00:00Z', row_count: 10, imported_count: 0 },
  // Permata: September statement imported → the transaction is "not found in statement".
  { id: 'batch-permata', business_id: BIZ, wallet_id: 'w-permata', file_name: 'permata_sept.csv', status: 'imported',
    statement_start: '2026-09-01', statement_end: '2026-09-30', created_at: '2026-10-02T11:00:00Z', row_count: 12, imported_count: 12 },
  // BCA: no statement at all → "no statement".
]);

require(path.join(ROOT, 'server', 'index.js'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};
// The desktop shell scrolls inside .v2-main, so a full-page screenshot first lets the page
// grow to its content (screenshot only — the checks above ran on the real layout).
const shot = async (page, name, opts = {}) => {
  if (!SHOTS) return;
  if (opts.fullPage) {
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.id = '__shot';
      st.textContent = 'html,body{height:auto!important;overflow:visible!important}.v2-shell{height:auto!important;overflow:visible!important}.v2-main{height:auto!important;overflow:visible!important}.v2-sidebar{position:sticky;top:0;height:100vh!important}';
      document.head.appendChild(st);
      window.scrollTo(0, 0);
    });
  }
  await page.screenshot({ path: path.join(SHOTS, name), ...opts });
  if (opts.fullPage) await page.evaluate(() => document.getElementById('__shot')?.remove());
};
const URL_CLOSE = `http://127.0.0.1:${PORT}/business/accountant?tab=close&month=2026-09`;

async function context(browser, { width, height, lang = 'ru' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const token = jwt.sign({ userId: USER_ID, email: 'layout@testhelm.id' }, process.env.JWT_SECRET);
  await ctx.addInitScript(({ tok, biz, lg }) => {
    localStorage.setItem('hf_token', tok);
    localStorage.setItem('activeWorkspaceId', biz);
    localStorage.setItem('activeBusinessId', biz);
    localStorage.setItem('last_active_workspace_id', biz);
    localStorage.setItem('hf_lang', lg);
    localStorage.setItem('lang', lg);
  }, { tok: token, biz: BIZ, lg: lang });
  return ctx;
}

// Rectangles of the row parts, and whether any two overlap.
const rowGeometry = (page) => page.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const overlap = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  return [...document.querySelectorAll('.v2-unlinked-item')].map((li) => {
    const parts = {
      title: r(li.querySelector('.v2-urow-title')), status: r(li.querySelector('.v2-reason-toggle')),
      amount: r(li.querySelector('.v2-urow-amount')), action: r(li.querySelector('.v2-urow-review')),
    };
    const box = r(li);
    const names = Object.keys(parts);
    const overlaps = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      if (overlap(parts[names[i]], parts[names[j]])) overlaps.push(`${names[i]}×${names[j]}`);
    }
    const outside = names.filter((n) => parts[n] && (parts[n].left < box.left - 0.5 || parts[n].right > box.right + 0.5));
    return { overlaps, outside, amountRight: parts.amount && parts.amount.right, statusTop: parts.status && parts.status.top, titleBottom: parts.title && parts.title.bottom };
  });
});
const noHorizontalScroll = (page) => page.evaluate(() => {
  const main = document.querySelector('.v2-main');
  return {
    doc: document.documentElement.scrollWidth <= window.innerWidth,
    main: !main || main.scrollWidth <= main.clientWidth + 1,
    cards: [...document.querySelectorAll('.v2-acct-close .v2-card')].every((c) => c.scrollWidth <= c.clientWidth + 1),
  };
});

setTimeout(async () => {
  let browser;
  const consoleErrors = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(e.message));
  };
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });

    for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1100, 800], [390, 844]]) {
      const ctx = await context(browser, { width, height });
      const page = await ctx.newPage(); watch(page);
      await page.goto(URL_CLOSE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.v2-unlinked-item', { timeout: 10000 });
      const phone = width <= 600;

      // Full width on this page only.
      const inner = await page.evaluate(() => {
        const el = document.querySelector('.v2-main-inner');
        const cs = getComputedStyle(el);
        return { wide: el.classList.contains('v2-main-wide'), maxWidth: cs.maxWidth, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), w: el.getBoundingClientRect().width };
      });
      check(`${width}: wide workspace (no 1120 cap)`, inner.wide && inner.maxWidth === 'none', inner);
      check(`${width}: gutters ${phone ? '16' : '32'} px`, phone ? inner.padL === 16 && inner.padR === 16 : inner.padL === 32 && inner.padR === 32, inner);
      if (width === 1920) check('1920: content wider than the old 1120 px', inner.w > 1400, inner.w);

      // Top row: two columns from 1180 px, one below.
      const top = await page.evaluate(() => getComputedStyle(document.querySelector('.v2-acct-top')).gridTemplateColumns.split(' ').length);
      check(`${width}: top row ${width >= 1180 ? 'two columns' : 'one column'}`, width >= 1180 ? top === 2 : top === 1, top);

      // The row is not a button; the parts never overlap.
      check(`${width}: rows are not role=button`, (await page.$$('.v2-unlinked-item[role="button"]')).length === 0);
      const geo = await rowGeometry(page);
      check(`${width}: title / status / amount / button never overlap`, geo.every((g) => g.overlaps.length === 0), geo.map((g) => g.overlaps));
      check(`${width}: nothing sticks out of its row`, geo.every((g) => g.outside.length === 0), geo.map((g) => g.outside));
      if (width === 1100) check('1100 (< 1180): status moves under the title', geo.every((g) => g.statusTop >= g.titleBottom - 1), geo.map((g) => [g.titleBottom, g.statusTop]));
      if (!phone && width >= 1180) {
        const rights = [...new Set(geo.map((g) => Math.round(g.amountRight)))];
        check(`${width}: amounts right-aligned in one column`, rights.length === 1, rights);
      }

      // Clicking the row (title) opens nothing; the pill opens the explanation, not the drawer.
      await page.click('.v2-unlinked-item .v2-urow-title');
      await page.waitForTimeout(200);
      check(`${width}: clicking the row does not open the drawer`, (await page.$('.v2-workbench-drawer')) === null);
      const toggles = await page.$$('.v2-reason-toggle');
      await toggles[0].click();
      await page.waitForTimeout(150);
      const detail = await page.evaluate(() => {
        const btn = document.querySelector('.v2-reason-toggle');
        const box = document.getElementById(btn.getAttribute('aria-controls'));
        const li = btn.closest('.v2-unlinked-item');
        const a = box && box.querySelector('a');
        const rb = box && box.getBoundingClientRect(); const rl = li.getBoundingClientRect(); const ra = a && a.getBoundingClientRect();
        return {
          expanded: btn.getAttribute('aria-expanded'), label: box && box.querySelector('.v2-reason-detail-label')?.textContent,
          inside: !!rb && rb.left >= rl.left - 0.5 && rb.right <= rl.right + 0.5 && (!ra || (ra.right <= rb.right + 0.5 && ra.left >= rb.left - 0.5)),
          href: a && a.getAttribute('href'), action: a && a.textContent, icon: !!btn.querySelector('svg'), text: btn.textContent,
        };
      });
      check(`${width}: pill expands the explanation (aria-expanded=true)`, detail.expanded === 'true', detail.expanded);
      check(`${width}: explanation titled "Почему не сверена"`, detail.label === 'Почему не сверена', detail.label);
      check(`${width}: explanation and its button fit inside the row`, detail.inside);
      check(`${width}: action is translated and keeps account + month`, detail.action && !/acct\./.test(detail.action) && /wallet_id=w-/.test(detail.href) && /month=2026-09/.test(detail.href), detail);
      check(`${width}: status has an icon and text`, detail.icon && detail.text.trim().length > 3, detail.text);
      check(`${width}: the explanation does not open the drawer`, (await page.$('.v2-workbench-drawer')) === null);

      // Keyboard: Enter collapses, Space expands again.
      await page.focus('.v2-reason-toggle');
      await page.keyboard.press('Enter');
      const afterEnter = await page.getAttribute('.v2-reason-toggle', 'aria-expanded');
      await page.keyboard.press('Space');
      const afterSpace = await page.getAttribute('.v2-reason-toggle', 'aria-expanded');
      check(`${width}: Enter / Space toggle the explanation`, afterEnter === 'false' && afterSpace === 'true', { afterEnter, afterSpace });
      const focusVisible = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none');
      check(`${width}: focus is visible on the pill`, focusVisible);

      // The unconfirmed and no-match rows carry their batch in the link too.
      const allToggles = await page.$$('.v2-reason-toggle');
      for (const tg of allToggles.slice(1)) { if ((await tg.getAttribute('aria-expanded')) !== 'true') await tg.click(); }
      await page.waitForTimeout(150);
      const hrefs = await page.$$eval('.v2-reason-detail-box a', (as) => as.map((a) => a.getAttribute('href')));
      check(`${width}: unconfirmed / no-match links carry batchId`, hrefs.some((h) => /batchId=batch-mandiri/.test(h)) && hrefs.some((h) => /batchId=batch-permata/.test(h)), hrefs);

      const scroll = await noHorizontalScroll(page);
      check(`${width}: no horizontal scroll (page, main, cards)`, scroll.doc && scroll.main && scroll.cards, scroll);

      if (phone) {
        const heights = await page.$$eval('.v2-urow-review, .v2-reason-toggle, .v2-reason-detail-action', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
        check('390: buttons are at least 44 px tall', heights.every((h) => h >= 44), heights);
        const order = await page.evaluate(() => {
          const li = document.querySelector('.v2-unlinked-item.is-open');
          const y = (s) => li.querySelector(s).getBoundingClientRect().top;
          return [y('.v2-urow-title'), y('.v2-reason-toggle'), y('.v2-reason-detail-box'), y('.v2-urow-amount')];
        });
        check('390: title → status → explanation → amount/button, top to bottom', order.every((v, i) => i === 0 || v > order[i - 1]), order);
      }

      // Screenshots with an explanation open.
      if (width === 1920 || width === 1440) await shot(page, `accountant-${width}.png`, { fullPage: true });
      if (phone) {
        await page.evaluate(() => document.querySelector('.v2-unlinked-item.is-open').scrollIntoView({ block: 'start' }));
        await shot(page, 'accountant-390-explanation.png');
        await shot(page, 'accountant-390-full.png', { fullPage: true });
      }

      // Only "Разобрать" opens the drawer; Escape closes it.
      await page.click('.v2-unlinked-item .v2-urow-review');
      const drawer = await page.waitForSelector('.v2-workbench-drawer', { timeout: 5000 }).catch(() => null);
      check(`${width}: "Разобрать" opens the drawer`, !!drawer);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(`${width}: Escape closes the drawer`, (await page.$('.v2-workbench-drawer')) === null);
      await ctx.close();
    }

    // Following the explanation's action keeps account and month on Bank Import.
    {
      const ctx = await context(browser, { width: 1440, height: 900 });
      const page = await ctx.newPage(); watch(page);
      await page.goto(URL_CLOSE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.v2-reason-toggle');
      await page.click('.v2-reason-toggle');
      await page.click('.v2-reason-detail-box a');
      await page.waitForTimeout(1000);
      const u = new URL(page.url());
      check('explanation link lands on Bank Import with wallet and month', u.pathname === '/business/bank-import' && u.searchParams.get('wallet_id') && u.searchParams.get('month') === '2026-09', page.url());
      await ctx.close();
    }

    // Sidebar: resize, persistence, one-line labels, badge, admin lock.
    {
      const ctx = await context(browser, { width: 1440, height: 900 });
      const page = await ctx.newPage(); watch(page);
      await page.goto(URL_CLOSE, { waitUntil: 'networkidle' });
      const sep = await page.waitForSelector('.v2-sidebar-resizer[role="separator"]');
      const width = () => page.evaluate(() => Math.round(document.querySelector('.v2-sidebar').getBoundingClientRect().width));
      const attrs = await sep.evaluate((e) => ({ min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'), now: e.getAttribute('aria-valuenow'), o: e.getAttribute('aria-orientation'), tab: e.tabIndex }));
      check('sidebar: separator with aria-valuemin/max/now, vertical, focusable', attrs.min === '220' && attrs.max === '320' && attrs.now === '264' && attrs.o === 'vertical' && attrs.tab === 0, attrs);
      check('sidebar: default 264 px', (await width()) === 264, await width());
      const drag = async (x) => {
        const b = await sep.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + 200);
        await page.mouse.down();
        await page.mouse.move(x, b.y + 220, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(100);
      };
      await drag(150);
      check('sidebar: dragging left stops at 220 px', (await width()) === 220, await width());
      await shot(page, 'sidebar-220.png', { clip: { x: 0, y: 0, width: 420, height: 900 } });
      await drag(500);
      check('sidebar: dragging right stops at 320 px', (await width()) === 320, await width());
      await shot(page, 'sidebar-320.png', { clip: { x: 0, y: 0, width: 520, height: 900 } });
      const stored = await page.evaluate(() => localStorage.getItem('v2.sidebarWidth'));
      check('sidebar: width remembered', stored === '320', stored);
      await page.reload({ waitUntil: 'networkidle' });
      check('sidebar: width restored after reload', (await width()) === 320, await width());
      await page.dblclick('.v2-sidebar-resizer');
      await page.waitForTimeout(100);
      check('sidebar: double-click resets to 264 px', (await width()) === 264, await width());
      await page.focus('.v2-sidebar-resizer');
      await page.keyboard.press('ArrowRight');
      const afterRight = await width();
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      const afterLeft = await width();
      check('sidebar: arrows change the width by 8 px', afterRight === 272 && afterLeft === 256, { afterRight, afterLeft });

      const badge = await page.evaluate(() => {
        const b = document.querySelector('.v2-navbadge.v2-tone-crit');
        return b && { text: b.textContent, label: b.getAttribute('aria-label'), title: b.getAttribute('title') };
      });
      check('sidebar: overdue badge is a compact "13" named "13 просрочено"', badge && badge.text === '13' && badge.label === '13 просрочено' && badge.title === '13 просрочено', badge);
      const lock = await page.evaluate(() => {
        const l = document.querySelector('.v2-nav-admin .v2-nav-lock');
        return l && { label: l.getAttribute('aria-label'), title: l.getAttribute('title'), svg: !!l.querySelector('svg'), badge: !!document.querySelector('.v2-nav-admin .v2-navbadge') };
      });
      check('sidebar: admin carries a lock "Видно только вам", no badge', lock && lock.label === 'Видно только вам' && lock.title === 'Видно только вам' && lock.svg && !lock.badge, lock);
      await ctx.close();

      const phoneCtx = await context(browser, { width: 390, height: 844 });
      const pp = await phoneCtx.newPage(); watch(pp);
      await pp.goto(URL_CLOSE, { waitUntil: 'networkidle' });
      const handleVisible = await pp.evaluate(() => { const h = document.querySelector('.v2-sidebar-resizer'); return !!h && getComputedStyle(h).display !== 'none'; });
      check('phone: no resize handle', !handleVisible);
      await phoneCtx.close();
    }

    // One-line menu labels at the narrowest sidebar, in RU / EN / ID.
    for (const [lang, expected] of [['ru', 'Счета и Инвойсы'], ['en', 'Bills & Invoices'], ['id', null]]) {
      const ctx = await context(browser, { width: 1440, height: 900, lang });
      await ctx.addInitScript(() => localStorage.setItem('v2.sidebarWidth', '220'));
      const page = await ctx.newPage(); watch(page);
      await page.goto(URL_CLOSE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.v2-nav-label');
      const labels = await page.$$eval('.v2-sidebar .v2-nav', (navs) => navs.map((n) => {
        const l = n.querySelector('.v2-nav-label');
        const lh = parseFloat(getComputedStyle(l).lineHeight) || 17;
        return { text: l.textContent, oneLine: l.getBoundingClientRect().height <= lh + 12 + 1, nowrap: getComputedStyle(l).whiteSpace === 'nowrap', href: n.getAttribute('href') };
      }));
      const bills = labels.find((l) => /\/business\/(payables|bills)/.test(l.href || ''));
      check(`${lang}: every sidebar label on one line at 220 px`, labels.every((l) => l.oneLine && l.nowrap), labels.filter((l) => !l.oneLine).map((l) => l.text));
      if (expected) check(`${lang}: bills item reads "${expected}"`, bills && bills.text === expected, bills && bills.text);
      if (lang === 'ru') await shot(page, 'sidebar-ru-220-labels.png', { clip: { x: 0, y: 0, width: 420, height: 900 } });
      await ctx.close();
    }

    check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${failed.length === 0 ? `ALL PASS — ${results.length} checks` : `${failed.length} of ${results.length} checks FAILED`}`);
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (err) {
    console.error('Browser test run failed with exception:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}, 1200);
