'use strict';
/**
 * CFO AI V2 — Production Verification & Smoke Test Suite
 * Executes non-destructive, safe checks against live production services:
 * - Marketing website: https://cfo-ai.site
 * - Production SaaS App: https://app.cfo-ai.site
 * - Production Supabase: ihvciomcvadjdtskcekb
 */
const assert = require('assert');
const { chromium } = require('playwright-core');

const APP_URL = 'https://app.cfo-ai.site';
const WEBSITE_URL = 'https://cfo-ai.site';

async function runProductionSmoke() {
  console.log('========================================================================');
  console.log('       CFO AI V2 — Live Production Release Smoke Verification           ');
  console.log('========================================================================');

  let passed = 0;
  let total = 0;
  const test = async (name, fn) => {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}:`, err.message);
      throw err;
    }
  };

  // 1. Production Health & Live API Verification
  await test('1. GET /api/health responds with 200 OK and service=helm-finance-web', async () => {
    const res = await fetch(`${APP_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.service, 'helm-finance-web');
  });

  // 2. Public Catalog Live Verification
  let publicPlans = [];
  await test('2. GET /api/public/plans returns Starter ($59), Control ($149), Pro ($249) at version 4', async () => {
    const res = await fetch(`${APP_URL}/api/public/plans`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert(Array.isArray(body.plans), 'Must contain plans array');
    assert.strictEqual(body.plans.length, 3, 'Must contain exactly 3 plans');
    publicPlans = body.plans;

    const starter = body.plans.find(p => p.plan === 'starter');
    const control = body.plans.find(p => p.plan === 'control');
    const pro = body.plans.find(p => p.plan === 'pro');

    assert(starter && control && pro, 'Starter, Control, Pro must all exist');
    assert.strictEqual(starter.price_minor, 5900, 'Starter price must be $59 (5900)');
    assert.strictEqual(control.price_minor, 14900, 'Control price must be $149 (14900)');
    assert.strictEqual(pro.price_minor, 24900, 'Pro price must be $249 (24900)');

    assert.strictEqual(starter.trial_hours, 168, 'Starter trial = 168h');
    assert.strictEqual(control.trial_hours, 168, 'Control trial = 168h');
    assert.strictEqual(pro.trial_hours, 168, 'Pro trial = 168h');

    // Quotas check
    const getLimit = (plan, key) => plan.limits.find(l => l.key === key)?.value;
    assert.strictEqual(getLimit(starter, 'companies'), 1, 'Starter companies = 1');
    assert.strictEqual(getLimit(control, 'companies'), 2, 'Control companies = 2');
    assert.strictEqual(getLimit(pro, 'companies'), 5, 'Pro companies = 5');

    assert.strictEqual(getLimit(starter, 'users'), 5, 'Starter users = 5');
    assert.strictEqual(getLimit(control, 'users'), 10, 'Control users = 10');
    assert.strictEqual(getLimit(pro, 'users'), 30, 'Pro users = 30');

    assert.strictEqual(getLimit(starter, 'transactions'), 2000, 'Starter txs = 2000');
    assert.strictEqual(getLimit(control, 'transactions'), 10000, 'Control txs = 10000');
    assert.strictEqual(getLimit(pro, 'transactions'), 50000, 'Pro txs = 50000');
  });

  // 3. Marketing Pricing Page CTA URLs
  await test('3. Marketing Pricing CTAs point to https://app.cfo-ai.site/login?plan=...', async () => {
    const res = await fetch(`${WEBSITE_URL}/en/pricing/`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    assert(html.includes('href="https://app.cfo-ai.site/login?plan=starter"'), 'Starter CTA must link to app');
    assert(html.includes('href="https://app.cfo-ai.site/login?plan=control"'), 'Control CTA must link to app');
    assert(html.includes('href="https://app.cfo-ai.site/login?plan=pro"'), 'Pro CTA must link to app');
  });

  // 4. Browser Headless Checks on Production App
  const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await test('4. Landing on /login?plan=control stores plan in localStorage and renders SelectedPlanBadge ($149)', async () => {
    await page.goto(`${APP_URL}/login?plan=control`, { waitUntil: 'networkidle' });
    const stored = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
    assert.strictEqual(stored, 'control', 'localStorage cfo_selected_plan must be control');

    const badgeText = await page.innerText('body');
    assert(badgeText.includes('Control'), 'Screen must render Control plan name');
    assert(badgeText.includes('149'), 'Screen must render $149 price');
  });

  await test('5. Landing on /login?plan=starter renders SelectedPlanBadge ($59)', async () => {
    await page.goto(`${APP_URL}/login?plan=starter`, { waitUntil: 'networkidle' });
    const stored = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
    assert.strictEqual(stored, 'starter', 'localStorage cfo_selected_plan must be starter');

    const badgeText = await page.innerText('body');
    assert(badgeText.includes('Starter'), 'Screen must render Starter plan name');
    assert(badgeText.includes('59'), 'Screen must render $59 price');
  });

  await test('6. Landing on /login?plan=pro renders SelectedPlanBadge ($249)', async () => {
    await page.goto(`${APP_URL}/login?plan=pro`, { waitUntil: 'networkidle' });
    const stored = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
    assert.strictEqual(stored, 'pro', 'localStorage cfo_selected_plan must be pro');

    const badgeText = await page.innerText('body');
    assert(badgeText.includes('Pro'), 'Screen must render Pro plan name');
    assert(badgeText.includes('249'), 'Screen must render $249 price');
  });

  await test('7. Page reload retains selected plan without query param', async () => {
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' });
    const stored = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
    assert.strictEqual(stored, 'pro', 'localStorage retains previous valid selection');
  });

  await browser.close();

  console.log('\n========================================================================');
  console.log(`RESULTS: ${passed} / ${total} PRODUCTION SMOKE CHECKS PASSED (100% SUCCESS)`);
  console.log('========================================================================\n');
}

runProductionSmoke().catch(err => {
  console.error('\nProduction Smoke Verification Failed:', err);
  process.exit(1);
});
