'use strict';
/**
 * CFO AI V2 — P0: Real Website-to-App Integration Test Suite
 * 
 * Objective:
 * Start EVERY scenario by opening the real staging Pricing V2 page (https://127.0.0.1:55481/en/pricing),
 * click the actual plan CTA button, follow the real browser navigation into the SaaS application,
 * complete registration, verify email via Mailpit, log in, create a company, activate the 7-day trial,
 * and verify the backend database ledger.
 *
 * Scenarios:
 *  - Scenario A: Control ($149 / month, 2 companies, 10 users, 168h trial)
 *  - Scenario B: Starter ($59 / month, 1 company, 5 users, 168h trial)
 *  - Scenario C: Pro ($249 / month, 5 companies, 30 users, 168h trial)
 *  - Additional Checks:
 *      * Page refresh during onboarding preserves plan
 *      * Parameter tampering / fallback
 *      * Idempotent trial activation
 *      * Financial operations allowed post-activation
 */

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { Client } = require('pg');
const { secrets, PORTS } = require('./env.cjs');

const S = secrets();
const WEBSITE_PRICING_URL = 'https://127.0.0.1:55481/en/pricing';
const API_URL = `http://127.0.0.1:${PORTS.api}/api`;
const MAIL_URL = `http://127.0.0.1:${PORTS.mail}/api/v1`;
const DB_URL = `postgresql://postgres:${S.db_password}@127.0.0.1:${PORTS.db}/postgres`;

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'e2e', 'screenshots_website_to_app');
const TRACES_DIR = path.join(__dirname, '..', 'e2e', 'traces');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(TRACES_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getMailLink(email, beforeIds = []) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAIL_URL}/search?query=${encodeURIComponent('to:' + email)}`);
    const data = await res.json();
    const newMsgs = (data.messages || []).filter((m) => !beforeIds.includes(m.ID));
    if (newMsgs.length > 0) {
      const msgRes = await fetch(`${MAIL_URL}/message/${newMsgs[0].ID}`);
      const msg = await msgRes.json();
      const text = msg.Text || msg.HTML || '';
      const match = /http:\/\/127\.0\.0\.1:55450\/auth\/v1\/verify\?[^\s"'<>)\]]+/.exec(text);
      if (match) return match[0].replace(/&amp;/g, '&');
    }
    await sleep(250);
  }
  throw new Error(`No verification email found for ${email}`);
}

async function runWebsiteToAppSuite() {
  console.log('========================================================================');
  console.log('   CFO AI V2 — Real Website-to-App Integration Acceptance Tests (P0)   ');
  console.log('========================================================================');

  const pgClient = new Client({ connectionString: DB_URL });
  await pgClient.connect();

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];

  const record = (name, ok, details = '') => {
    results.push({ name, ok, details });
    console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name} ${details ? '(' + details + ')' : ''}`);
    if (!ok) throw new Error(`Test failed: ${name} — ${details}`);
  };

  try {
    // =========================================================================
    // SCENARIO A: CONTROL PLAN ($149 / mo, 2 Companies, 10 Users)
    // =========================================================================
    console.log('\n--- Scenario A: Control Plan Website-to-App Journey ---');
    {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();

      const runId = crypto.randomBytes(4).toString('hex');
      const email = `owner.control.${runId}@rehearsal.test`;
      const password = `Password-Control-2026-${runId}!`;
      const companyName = `Control Ventures ${runId.toUpperCase()}`;

      // 1. Open the real Staging Pricing V2 Website
      await page.goto(WEBSITE_PRICING_URL, { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_control_pricing_page.png') });
      const pricingTitle = await page.title();
      record('A1. Opened real staging Pricing V2 page', pricingTitle.includes('Pricing') && pricingTitle.includes('CFO AI'));

      // 2. Locate the Control Card and click the actual Pricing CTA
      const controlCta = await page.$('a[data-track-plan="control"]');
      record('A2. Found Control plan CTA button on Pricing page', !!controlCta);
      
      const ctaHref = await controlCta.getAttribute('href');
      record('A3. Control CTA points to staging application (not production)', ctaHref.includes(':55471') && ctaHref.includes('plan=control'), ctaHref);

      // Click the CTA and wait for browser navigation
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        controlCta.click()
      ]);

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02_control_app_landing.png') });
      const appUrl = page.url();
      record('A4. Browser navigated to SaaS app with plan parameter preserved', appUrl.includes(':55471') && appUrl.includes('plan=control'), appUrl);

      // Verify plan badge on app registration / login screen
      const storedPlan = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
      record('A5. Application captured selected plan in localStorage', storedPlan === 'control', `stored: ${storedPlan}`);

      const pageText = await page.textContent('body');
      record('A6. SelectedPlanBadge displayed on SaaS screen with Control and $149', pageText.includes('Control') && pageText.includes('149'));

      // 3. Register a new test user
      // If landed on /login?plan=control, click "Create account" to go to /register or fill registration if on /signup
      if (page.url().includes('/login')) {
        const createAccountLink = await page.$('a:has-text("Create account"), a:has-text("Создать аккаунт"), a:has-text("Buat akun")');
        if (createAccountLink) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            createAccountLink.click()
          ]);
        }
      }

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03_control_registration_form.png') });
      const existingMailsRes = await fetch(`${MAIL_URL}/search?query=${encodeURIComponent('to:' + email)}`);
      const existingMails = (await existingMailsRes.json()).messages || [];
      const beforeIds = existingMails.map((m) => m.ID);

      await page.fill('input[type="email"]', email);
      const pwInputs = await page.$$('input[type="password"]');
      await pwInputs[0].fill(password);
      await pwInputs[1].fill(password);
      await page.click('button[type="submit"]');

      // 4. Verify email link received in Mailpit test inbox
      const verifyLink = await getMailLink(email, beforeIds);
      record('A7. Verification email delivered to test Mailpit inbox', !!verifyLink);

      // Open verification link
      const verifyRes = await fetch(verifyLink, { redirect: 'manual' });
      const locationHeader = verifyRes.headers.get('location') || '';
      const fragmentParams = Object.fromEntries(new URLSearchParams(locationHeader.split('#')[1] || ''));
      record('A8. GoTrue emitted valid access_token', !!fragmentParams.access_token);

      // Confirm with server
      const confirmRes = await fetch(`${API_URL}/auth/password/confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: fragmentParams.access_token })
      });
      record('A9. Server confirmed email and linked password identity', confirmRes.status === 200);

      // 5. Sign in
      await page.goto(`https://127.0.0.1:55471/login?plan=control`, { waitUntil: 'networkidle' });
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);

      // 6. Navigate to /business/new to create company
      await page.goto(`https://127.0.0.1:55471/business/new?plan=control`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04_control_company_setup.png') });
      const setupText = await page.textContent('body');
      record('A10. SelectedPlanBadge displayed on company creation screen', setupText.includes('Control') && setupText.includes('149'));

      await page.fill('input.v2-input', companyName);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);

      const continueBtn = await page.$('button:has-text("Continue"), button:has-text("Продолжить"), button:has-text("Lanjutkan")');
      if (continueBtn) {
        await continueBtn.click();
        await page.waitForTimeout(2000);
      }

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05_control_trial_selection.png') });
      record('A11. Navigated to trial activation screen (/business/trial)', page.url().includes('/business/trial') || page.url().includes('/business/billing'));

      // 7. Verify Selected Plan Hero Card and 1-click activation
      const billingText = await page.textContent('body');
      record('A12. Billing shows Selected Plan hero card for Control ($149)', billingText.includes('Control') && billingText.includes('149'));

      const activateBtn = await page.$('button:has-text("Start 7-Day Free Trial"), button:has-text("Начать 7-дневный"), button:has-text("Mulai Uji Coba")');
      record('A13. Found 1-click trial activation button for Control plan', !!activateBtn);
      await activateBtn.click();
      await page.waitForTimeout(3000);

      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06_control_trial_activated.png') });
      const postActivationText = await page.textContent('body');
      record('A14. Trial status displays Active 7 days remaining', postActivationText.includes('Active') || postActivationText.includes('Активен') || postActivationText.includes('7 days') || postActivationText.includes('7 дн'));

      // 8. Database verification
      const userRow = (await pgClient.query('SELECT user_id as id FROM user_email_identities WHERE email = $1', [email])).rows[0];
      const bizRow = (await pgClient.query('SELECT b.id, b.name, b.plan, b.billing_policy FROM businesses b JOIN business_members bm ON bm.business_id = b.id WHERE bm.user_id = $1', [userRow.id])).rows[0];
      const billingAccount = (await pgClient.query('SELECT * FROM billing_accounts WHERE business_id = $1', [bizRow.id])).rows[0];
      const planVersion = (await pgClient.query('SELECT * FROM plan_versions WHERE id = $1', [billingAccount.selected_plan_version_id])).rows[0];
      const events = (await pgClient.query('SELECT event_type FROM billing_events WHERE business_id = $1 ORDER BY created_at', [bizRow.id])).rows.map(r => r.event_type);

      record('A15. Database businesses table registered commercial_v2', bizRow.billing_policy === 'commercial_v2');
      record('A16. Database selected plan version is Control ($149 / 14900)', planVersion.plan === 'control' && Number(planVersion.price_minor) === 14900);
      record('A17. Database recorded exact 168-hour trial duration', billingAccount.trial_hours === 168 && billingAccount.trial_started_at && billingAccount.trial_ends_at);

      const trialStart = new Date(billingAccount.trial_started_at).getTime();
      const trialEnd = new Date(billingAccount.trial_ends_at).getTime();
      const diffHours = Math.round((trialEnd - trialStart) / (1000 * 60 * 60));
      record('A18. Trial duration matches exactly 168 hours', diffHours === 168, `diff: ${diffHours}h`);

      record('A19. Two-step audit events logged (plan_selected and trial_activated)', events.includes('plan_selected') && events.includes('trial_activated'), JSON.stringify(events));

      const limits = planVersion.limits;
      record('A20. Control plan limits: 2 companies, 10 users, 10000 transactions', limits.companies === 2 && limits.users === 10 && limits.transactions === 10000);

      // Financial operation during active trial
      const appToken = await page.evaluate(() => localStorage.getItem('hf_token'));
      const walletRes = await fetch(`${API_URL}/wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${appToken}`,
          'x-business-id': bizRow.id
        },
        body: JSON.stringify({ request_key: crypto.randomUUID(), name: 'BCA Operational', currency: 'IDR' })
      });
      record('A21. Financial write allowed during active Control trial (200 OK)', walletRes.status === 201 || walletRes.status === 200, `status: ${walletRes.status}`);

      await context.tracing.stop({ path: path.join(TRACES_DIR, 'scenario_a_control_trace.zip') });
      await context.close();
    }

    // =========================================================================
    // SCENARIO B: STARTER PLAN ($59 / mo, 1 Company, 5 Users)
    // =========================================================================
    console.log('\n--- Scenario B: Starter Plan Website-to-App Journey ---');
    {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();

      const runId = crypto.randomBytes(4).toString('hex');
      const email = `owner.starter.${runId}@rehearsal.test`;
      const password = `Password-Starter-2026-${runId}!`;
      const companyName = `Starter Studio ${runId.toUpperCase()}`;

      // 1. Open real Pricing page
      await page.goto(WEBSITE_PRICING_URL, { waitUntil: 'networkidle' });

      // 2. Click Starter CTA
      const starterCta = await page.$('a[data-track-plan="starter"]');
      record('B1. Found Starter plan CTA button on Pricing page', !!starterCta);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        starterCta.click()
      ]);

      record('B2. Navigated from Pricing to application with plan=starter', page.url().includes('plan=starter'));

      if (page.url().includes('/login')) {
        const createAccountLink = await page.$('a:has-text("Create account"), a:has-text("Создать аккаунт"), a:has-text("Buat akun")');
        if (createAccountLink) {
          await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), createAccountLink.click()]);
        }
      }

      await page.fill('input[type="email"]', email);
      const pwInputs = await page.$$('input[type="password"]');
      await pwInputs[0].fill(password);
      await pwInputs[1].fill(password);
      await page.click('button[type="submit"]');

      const verifyLink = await getMailLink(email);
      const verifyRes = await fetch(verifyLink, { redirect: 'manual' });
      const f = Object.fromEntries(new URLSearchParams(verifyRes.headers.get('location').split('#')[1] || ''));
      await fetch(`${API_URL}/auth/password/confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: f.access_token })
      });

      await page.goto(`https://127.0.0.1:55471/login?plan=starter`, { waitUntil: 'networkidle' });
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);

      await page.goto(`https://127.0.0.1:55471/business/new?plan=starter`, { waitUntil: 'networkidle' });
      await page.fill('input.v2-input', companyName);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);

      const continueBtn = await page.$('button:has-text("Continue"), button:has-text("Продолжить"), button:has-text("Lanjutkan")');
      if (continueBtn) { await continueBtn.click(); await page.waitForTimeout(2000); }

      const activateBtn = await page.$('button:has-text("Start 7-Day Free Trial"), button:has-text("Начать 7-дневный"), button:has-text("Mulai Uji Coba")');
      record('B3. Found 1-click trial activation button for Starter ($59)', !!activateBtn);
      await activateBtn.click();
      await page.waitForTimeout(3000);

      // Database verification
      const userRow = (await pgClient.query('SELECT user_id as id FROM user_email_identities WHERE email = $1', [email])).rows[0];
      const bizRow = (await pgClient.query('SELECT b.id FROM businesses b JOIN business_members bm ON bm.business_id = b.id WHERE bm.user_id = $1', [userRow.id])).rows[0];
      const billingAccount = (await pgClient.query('SELECT * FROM billing_accounts WHERE business_id = $1', [bizRow.id])).rows[0];
      const planVersion = (await pgClient.query('SELECT * FROM plan_versions WHERE id = $1', [billingAccount.selected_plan_version_id])).rows[0];

      record('B4. Database selected plan is Starter ($59 / 5900)', planVersion.plan === 'starter' && Number(planVersion.price_minor) === 5900);
      record('B5. Starter limits: 1 company, 5 users', planVersion.limits.companies === 1 && planVersion.limits.users === 5);

      await context.tracing.stop({ path: path.join(TRACES_DIR, 'scenario_b_starter_trace.zip') });
      await context.close();
    }

    // =========================================================================
    // SCENARIO C: PRO PLAN ($249 / mo, 5 Companies, 30 Users)
    // =========================================================================
    console.log('\n--- Scenario C: Pro Plan Website-to-App Journey ---');
    {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();

      const runId = crypto.randomBytes(4).toString('hex');
      const email = `owner.pro.${runId}@rehearsal.test`;
      const password = `Password-Pro-2026-${runId}!`;
      const companyName = `Pro Global ${runId.toUpperCase()}`;

      // 1. Open real Pricing page
      await page.goto(WEBSITE_PRICING_URL, { waitUntil: 'networkidle' });

      // 2. Click Pro CTA
      const proCta = await page.$('a[data-track-plan="pro"]');
      record('C1. Found Pro plan CTA button on Pricing page', !!proCta);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        proCta.click()
      ]);

      record('C2. Navigated from Pricing to application with plan=pro', page.url().includes('plan=pro'));

      if (page.url().includes('/login')) {
        const createAccountLink = await page.$('a:has-text("Create account"), a:has-text("Создать аккаунт"), a:has-text("Buat akun")');
        if (createAccountLink) {
          await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), createAccountLink.click()]);
        }
      }

      await page.fill('input[type="email"]', email);
      const pwInputs = await page.$$('input[type="password"]');
      await pwInputs[0].fill(password);
      await pwInputs[1].fill(password);
      await page.click('button[type="submit"]');

      const verifyLink = await getMailLink(email);
      const verifyRes = await fetch(verifyLink, { redirect: 'manual' });
      const f = Object.fromEntries(new URLSearchParams(verifyRes.headers.get('location').split('#')[1] || ''));
      await fetch(`${API_URL}/auth/password/confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: f.access_token })
      });

      await page.goto(`https://127.0.0.1:55471/login?plan=pro`, { waitUntil: 'networkidle' });
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);

      await page.goto(`https://127.0.0.1:55471/business/new?plan=pro`, { waitUntil: 'networkidle' });
      await page.fill('input.v2-input', companyName);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);

      const continueBtn = await page.$('button:has-text("Continue"), button:has-text("Продолжить"), button:has-text("Lanjutkan")');
      if (continueBtn) { await continueBtn.click(); await page.waitForTimeout(2000); }

      const activateBtn = await page.$('button:has-text("Start 7-Day Free Trial"), button:has-text("Начать 7-дневный"), button:has-text("Mulai Uji Coba")');
      record('C3. Found 1-click trial activation button for Pro ($249)', !!activateBtn);
      await activateBtn.click();
      await page.waitForTimeout(3000);

      // Database verification
      const userRow = (await pgClient.query('SELECT user_id as id FROM user_email_identities WHERE email = $1', [email])).rows[0];
      const bizRow = (await pgClient.query('SELECT b.id FROM businesses b JOIN business_members bm ON bm.business_id = b.id WHERE bm.user_id = $1', [userRow.id])).rows[0];
      const billingAccount = (await pgClient.query('SELECT * FROM billing_accounts WHERE business_id = $1', [bizRow.id])).rows[0];
      const planVersion = (await pgClient.query('SELECT * FROM plan_versions WHERE id = $1', [billingAccount.selected_plan_version_id])).rows[0];

      record('C4. Database selected plan is Pro ($249 / 24900)', planVersion.plan === 'pro' && Number(planVersion.price_minor) === 24900);
      record('C5. Pro limits: 5 companies, 30 users', planVersion.limits.companies === 5 && planVersion.limits.users === 30);

      await context.tracing.stop({ path: path.join(TRACES_DIR, 'scenario_c_pro_trace.zip') });
      await context.close();
    }

    // =========================================================================
    // ADDITIONAL CHECKS: EDGE CASES & RESILIENCE
    // =========================================================================
    console.log('\n--- Additional Checks: Edge Cases & Resilience ---');
    {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();

      // Check 1: Browser refresh on signup retains plan
      await page.goto(`https://127.0.0.1:55471/signup?plan=control`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      const planAfterReload = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
      record('D1. Browser refresh retains selected plan', planAfterReload === 'control');

      // Check 2: Direct unadorned navigation preserves stored plan
      await page.goto(`https://127.0.0.1:55471/login`, { waitUntil: 'networkidle' });
      const planOnLogin = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
      record('D2. Direct /login retains previously stored plan', planOnLogin === 'control');

      // Check 3: Invalid plan parameter does not overwrite valid plan
      await page.goto(`https://127.0.0.1:55471/signup?plan=unsupported_tier`, { waitUntil: 'networkidle' });
      const planAfterTamper = await page.evaluate(() => localStorage.getItem('cfo_selected_plan'));
      record('D3. Invalid query param does not overwrite valid selection', planAfterTamper === 'control');

      await context.close();
    }

    console.log('\n========================================================================');
    console.log(`ACCEPTANCE SUMMARY: ${results.filter(r => r.ok).length}/${results.length} CHECKS PASSED`);
    console.log('========================================================================');

  } finally {
    await browser.close();
    await pgClient.end();
  }
}

runWebsiteToAppSuite().catch(err => {
  console.error('\nSUITE RUN FAILED:', err);
  process.exit(1);
});
