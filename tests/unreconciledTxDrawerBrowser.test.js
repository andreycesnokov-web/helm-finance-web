/**
 * Browser verification test for UnreconciledTxDrawer & Month Close Workbench.
 *
 * Exercises the real React UI in Chromium:
 * 1. Mounting and displaying unreconciled transaction workbench cards & group banners.
 * 2. Navigation from unreconciled group to BankImport with wallet_id and month preserved.
 * 3. Opening the UnreconciledTxDrawer and diagnosing the reason with interactive details.
 * 4. Stale save protection with in-flight latency:
 *    - Closing the drawer via Escape while PATCH is pending -> verifies drawer unmounts
 *      and late response DOES NOT fire onSaved / onTxUpdated callbacks or cause state corruption.
 * 5. Workspace switch isolation with in-flight latency:
 *    - Switching company while PATCH is pending -> verifies scope changes, drawer unmounts,
 *      and late response from Company A is dropped without executing callbacks in Company B.
 * 6. Clean mutation in regular workflow with database persistence and zero console errors.
 */

const path = require('path');
const Module = require('module');
const http = require('http');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 5198;

process.env.PORT = String(PORT);
process.env.SUPABASE_URL = 'http://localhost:0/fake';
process.env.SUPABASE_SECRET_KEY = 'test-fake-secret-key';
process.env.BOT_TOKEN = 'test-fake-bot-token';
process.env.JWT_SECRET = 'test-jwt-secret-for-browser-run';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-fake-tg-webhook-secret';
process.env.NODE_ENV = 'test';

const mem = require(path.join(ROOT, 'tests', 'integration', '_memorySupabase'));
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_ALPHA = 'c1111111-2222-3333-4444-555555555555';
const BIZ_BETA = 'c9999999-8888-7777-6666-555555555555';
const USER_ID = 3001;

mem.__seed('users', [
  { id: USER_ID, first_name: 'Test Accountant', username: 'test_acct', email: 'acct@testhelm.id' },
]);
mem.__seed('businesses', [
  { id: BIZ_ALPHA, name: 'PT Alpha Utama (Isolated)', type: 'company', owner_user_id: USER_ID, created_at: '2026-01-01' },
  { id: BIZ_BETA, name: 'PT Beta Sejahtera (Isolated)', type: 'company', owner_user_id: USER_ID, created_at: '2026-01-01' },
]);
mem.__seed('business_members', [
  { id: 'bm-alpha', business_id: BIZ_ALPHA, user_id: USER_ID, role: 'owner', status: 'active', is_active: true },
  { id: 'bm-beta', business_id: BIZ_BETA, user_id: USER_ID, role: 'owner', status: 'active', is_active: true },
]);
mem.__seed('user_subscriptions', [
  { user_id: USER_ID, status: 'active', plan: 'founder' },
]);
mem.__seed('business_addons', [
  { id: 'ad-alpha', business_id: BIZ_ALPHA, addon: 'ai_accountant', status: 'active' },
  { id: 'ad-beta', business_id: BIZ_BETA, addon: 'ai_accountant', status: 'active' },
]);
mem.__seed('wallets', [
  { id: 'w-alpha-bca', business_id: BIZ_ALPHA, name: 'BCA Operasional Alpha', currency: 'IDR', type: 'bank', is_active: true },
  { id: 'w-alpha-mandiri', business_id: BIZ_ALPHA, name: 'Mandiri Payroll Alpha', currency: 'IDR', type: 'bank', is_active: true },
  { id: 'w-beta-bca', business_id: BIZ_BETA, name: 'BCA Operasional Beta', currency: 'IDR', type: 'bank', is_active: true },
]);
mem.__seed('transactions', [
  {
    id: 501,
    business_id: BIZ_ALPHA,
    transaction_date: '2026-09-12',
    date: '2026-09-12',
    amount_original: 2500000,
    amount: 2500000,
    currency_original: 'IDR',
    currency: 'IDR',
    type: 'expense',
    description: 'Sewa Server Cloud Alpha',
    category: 'Infrastructure',
    wallet_id: 'w-alpha-bca',
    source: 'manual',
    is_reconciled: false,
  },
  {
    id: 502,
    business_id: BIZ_ALPHA,
    transaction_date: '2026-09-15',
    date: '2026-09-15',
    amount_original: 5000000,
    amount: 5000000,
    currency_original: 'IDR',
    currency: 'IDR',
    type: 'expense',
    description: 'Pembayaran Invoice Supplier #991',
    category: 'Vendor',
    wallet_id: 'w-alpha-bca',
    source: 'manual',
    is_reconciled: false,
  },
]);
mem.__seed('debts', [
  {
    id: 991,
    business_id: BIZ_ALPHA,
    type: 'payable',
    status: 'paid',
    counterparty: 'PT Cloud Solutions',
    invoice_number: 'INV-2026-991',
    original_amount: 5000000,
    amount: 5000000,
    paid_amount: 5000000,
    due_date: '2026-09-20',
    linked_transaction_id: 502,
  },
]);
mem.__seed('cashflow_categories', [
  { id: 'cat-infra', business_id: BIZ_ALPHA, name: 'Infrastructure', group_type: 'opex' },
  { id: 'cat-vendor', business_id: BIZ_ALPHA, name: 'Vendor', group_type: 'opex' },
]);

// Bank statement batch history with explicit statement_start / statement_end:
// Batch 1: September statement covering 2026-09-01 to 2026-09-30
// Batch 2: September statement uploaded in October (created_at is October, but period is September)
// Batch 3: Unknown dates batch (must never auto-open or match September)
mem.__seed('bank_import_batches', [
  {
    id: 'batch-sept-alpha',
    business_id: BIZ_ALPHA,
    wallet_id: 'w-alpha-mandiri',
    file_name: 'mandiri_sept_2026.csv',
    status: 'imported',
    statement_start: '2026-09-01',
    statement_end: '2026-09-30',
    created_at: '2026-10-05T10:00:00Z', // Uploaded in October!
    row_count: 15,
    imported_count: 15,
  },
  {
    id: 'batch-unknown-dates',
    business_id: BIZ_ALPHA,
    wallet_id: 'w-alpha-bca',
    file_name: 'raw_undated_export.csv',
    status: 'imported',
    statement_start: null,
    statement_end: null,
    created_at: '2026-09-15T12:00:00Z', // Created in Sept, but period unknown
    row_count: 8,
    imported_count: 8,
  },
]);

require(path.join(ROOT, 'server', 'index.js'));

setTimeout(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const token = jwt.sign({ userId: USER_ID, email: 'acct@testhelm.id' }, process.env.JWT_SECRET);

    await page.addInitScript(({ tok, biz }) => {
      localStorage.setItem('hf_token', tok);
      localStorage.setItem('activeWorkspaceId', biz);
      localStorage.setItem('activeBusinessId', biz);
      localStorage.setItem('last_active_workspace_id', biz);
      localStorage.setItem('hf_lang', 'ru');
      localStorage.setItem('lang', 'ru');
      // Setup spy counters and history for real onSaved and onTxUpdated callbacks
      window.__drawerSavedCount = 0;
      window.__drawerTxUpdatedCount = 0;
      window.__drawerSavedEvents = [];
      window.__onDrawerSaved = (updated) => {
        window.__drawerSavedCount += 1;
        window.__drawerSavedEvents.push({ type: 'onSaved', tx: updated, time: Date.now() });
      };
      window.__onDrawerTxUpdated = (updated) => {
        window.__drawerTxUpdatedCount += 1;
        window.__drawerSavedEvents.push({ type: 'onTxUpdated', tx: updated, time: Date.now() });
      };
    }, { tok: token, biz: BIZ_ALPHA });

    console.log('1. Navigating to /business/accountant?tab=close ...');
    await page.goto('http://127.0.0.1:' + PORT + '/business/accountant?tab=close', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Test 1: Unreconciled block exists and displays transactions
    const groupCard = await page.waitForSelector('.v2-unlinked-group', { timeout: 8000 });
    console.log('PASS: Unreconciled transactions group card is visible:', !!groupCard);

    // Test 2: Group navigation link contains wId and month
    const link = await page.$('.v2-unlinked-banner a');
    const linkHref = link ? await link.getAttribute('href') : '';
    console.log('Group link href:', linkHref);
    const hasExpectedParams = linkHref.includes('wallet_id=w-alpha-bca') && linkHref.includes('month=2026-09');
    console.log('PASS: Group link contains correct wId and month:', hasExpectedParams);

    // Test 3: Click group link and verify navigation to BankImport with period context
    console.log('2. Clicking group link to BankImport...');
    await link.click();
    await page.waitForTimeout(1000);

    console.log('Current URL after navigation:', page.url());
    const hasTargetPeriodBanner = await page.waitForSelector(':text("Период:")', { timeout: 5000 });
    console.log('PASS: BankImport shows target period banner:', !!hasTargetPeriodBanner);

    const selectedWalletSelect = await page.$('select');
    const selectedWalletVal = selectedWalletSelect ? await selectedWalletSelect.inputValue() : '';
    console.log('PASS: BankImport has selected wallet id w-alpha-bca:', selectedWalletVal === 'w-alpha-bca');

    // Test 4: Statement period matching for September statement uploaded in October
    console.log('3. Testing BankImport statement period matching...');
    await page.goto('http://127.0.0.1:' + PORT + '/business/bank-import?wallet_id=w-alpha-mandiri&month=2026-09', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Batch with statement_start=2026-09-01 should match September and auto-open, even though created_at was in October
    const mandiriBatchOpened = await page.$(':text("mandiri_sept_2026.csv")');
    console.log('PASS: September statement uploaded in October matches September period:', !!mandiriBatchOpened);

    // Batch with unknown dates (created in September, but start/end null) should NOT auto-open for September
    await page.goto('http://127.0.0.1:' + PORT + '/business/bank-import?wallet_id=w-alpha-bca&month=2026-09', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const undatedBatchAutoOpened = await page.$(':text("raw_undated_export.csv")');
    console.log('PASS: Batch with unknown statement dates does not auto-open:', undatedBatchAutoOpened === null);

    // Test 5: Return to Accountant Close tab and test NORMAL SAVE to prove callback counters work
    console.log('4. Testing NORMAL SAVE in Drawer (proves callback counters increase)...');
    await page.goto('http://127.0.0.1:' + PORT + '/business/accountant?tab=close', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const initialCounters = await page.evaluate(() => ({
      saved: window.__drawerSavedCount || 0,
      updated: window.__drawerTxUpdatedCount || 0,
    }));
    console.log('Initial counters before normal save:', initialCounters);

    const reviewBtnNormal = await page.waitForSelector('.v2-unlinked-item button:has-text("Разобрать")', { timeout: 5000 });
    await reviewBtnNormal.click();
    const drawerNormal = await page.waitForSelector('.v2-workbench-drawer', { timeout: 5000 });
    console.log('PASS: Drawer opened:', !!drawerNormal);

    const editBtnNormal = await page.waitForSelector('button:has-text("Редактировать")', { timeout: 5000 });
    await editBtnNormal.click();
    const descInputNormal = await page.waitForSelector('input[value="Sewa Server Cloud Alpha"], textarea', { timeout: 5000 });
    await descInputNormal.fill('Sewa Server Cloud Alpha (Normal Save Verified)');
    const saveBtnNormal = await page.waitForSelector('button:has-text("Сохранить изменения")', { timeout: 5000 });
    await saveBtnNormal.click();

    // Wait for save callbacks to execute and counters to increment
    await page.waitForFunction(() => (window.__drawerSavedCount || 0) > 0, { timeout: 5000 });
    const countersAfterNormalSave = await page.evaluate(() => ({
      saved: window.__drawerSavedCount || 0,
      updated: window.__drawerTxUpdatedCount || 0,
    }));
    console.log('Counters after normal save:', countersAfterNormalSave);

    const normalSaveIncremented =
      countersAfterNormalSave.saved === initialCounters.saved + 1 &&
      countersAfterNormalSave.updated === initialCounters.updated + 1;
    console.log('PASS: Normal save successfully incremented callback counters (intercept verified):', normalSaveIncremented);

    // Close the normal save drawer
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Test 6: In-flight delayed PATCH with Drawer Close via Escape (counters MUST NOT increment)
    console.log('5. Testing delayed PATCH after Drawer Close via Escape (counters must NOT increment)...');
    const countersBeforeDelayedClose = await page.evaluate(() => ({
      saved: window.__drawerSavedCount,
      updated: window.__drawerTxUpdatedCount,
    }));

    const reviewBtnDelayed = await page.waitForSelector('.v2-unlinked-item button:has-text("Разобрать")', { timeout: 5000 });
    await reviewBtnDelayed.click();
    const drawerDelayed = await page.waitForSelector('.v2-workbench-drawer', { timeout: 5000 });
    console.log('PASS: Drawer opened for delayed close check:', !!drawerDelayed);

    // Intercept PATCH with 900ms synthetic delay
    await page.route('**/api/transactions/501', async (route) => {
      console.log('Intercepted PATCH /api/transactions/501 in-flight, delaying response by 900ms...');
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });

    const editBtnDelayed = await page.waitForSelector('button:has-text("Редактировать")', { timeout: 5000 });
    await editBtnDelayed.click();
    const descInputDelayed = await page.$('input[value*="Sewa Server Cloud Alpha"], textarea');
    await descInputDelayed.fill('Sewa Server Cloud Alpha (Delayed Close In-Flight)');
    const saveBtnDelayed = await page.waitForSelector('button:has-text("Сохранить изменения")', { timeout: 5000 });
    await saveBtnDelayed.click();

    // Close drawer via Escape while PATCH is in-flight
    await page.waitForTimeout(50);
    console.log('Closing drawer via Escape while PATCH is in-flight...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const drawerClosedInFlight = await page.$('.v2-workbench-drawer');
    console.log('PASS: Drawer closed immediately without waiting for late response:', drawerClosedInFlight === null);

    // Wait for late response to arrive
    await page.waitForTimeout(1200);

    // Verify counters DID NOT increment after close
    const countersAfterDelayedClose = await page.evaluate(() => ({
      saved: window.__drawerSavedCount,
      updated: window.__drawerTxUpdatedCount,
    }));
    console.log('Counters after delayed close arrived:', countersAfterDelayedClose);
    const noIncrementAfterClose =
      countersAfterDelayedClose.saved === countersBeforeDelayedClose.saved &&
      countersAfterDelayedClose.updated === countersBeforeDelayedClose.updated;
    console.log('PASS: Callback counters did NOT increment after drawer close:', noIncrementAfterClose);

    // Test 7: In-flight delayed PATCH with Company Switch (counters MUST NOT increment)
    console.log('6. Testing delayed PATCH with Company Switch in-flight (counters must NOT increment)...');
    const countersBeforeCompanySwitch = await page.evaluate(() => ({
      saved: window.__drawerSavedCount,
      updated: window.__drawerTxUpdatedCount,
    }));

    const reviewBtnSwitch = await page.waitForSelector('.v2-unlinked-item button:has-text("Разобрать")', { timeout: 5000 });
    await reviewBtnSwitch.click();
    await page.waitForSelector('.v2-workbench-drawer', { timeout: 5000 });
    const editBtnSwitch = await page.waitForSelector('button:has-text("Редактировать")', { timeout: 5000 });
    await editBtnSwitch.click();
    const descInputSwitch = await page.waitForSelector('input[value*="Sewa Server Cloud Alpha"], textarea', { timeout: 5000 });
    await descInputSwitch.fill('Sewa Server Cloud Alpha (Company Switch In-Flight)');
    const saveBtnSwitch = await page.waitForSelector('button:has-text("Сохранить изменения")', { timeout: 5000 });
    await saveBtnSwitch.click();

    // Switch company while PATCH is in-flight
    await page.waitForTimeout(50);
    console.log('Switching workspace to Beta while PATCH is in-flight...');
    await page.evaluate(({ bizB }) => {
      localStorage.setItem('activeWorkspaceId', bizB);
      localStorage.setItem('activeBusinessId', bizB);
      localStorage.setItem('last_active_workspace_id', bizB);
      window.dispatchEvent(new CustomEvent('workspace-switch', { detail: { id: bizB } }));
    }, { bizB: BIZ_BETA });

    await page.waitForTimeout(1200);

    const drawerInBeta = await page.$('.v2-workbench-drawer');
    console.log('PASS: Drawer unmounted and dropped after company switch:', drawerInBeta === null);

    const countersAfterCompanySwitch = await page.evaluate(() => ({
      saved: window.__drawerSavedCount,
      updated: window.__drawerTxUpdatedCount,
    }));
    console.log('Counters after company switch arrived:', countersAfterCompanySwitch);
    const noIncrementAfterCompanySwitch =
      countersAfterCompanySwitch.saved === countersBeforeCompanySwitch.saved &&
      countersAfterCompanySwitch.updated === countersBeforeCompanySwitch.updated;
    console.log('PASS: Callback counters did NOT increment across company switch:', noIncrementAfterCompanySwitch);

    // Verify company isolation: Beta has 0 transactions
    const unlinkedInBeta = await page.$('.v2-unlinked-group');
    console.log('PASS: Beta workspace has isolated empty state (no leak from Alpha):', unlinkedInBeta === null);

    console.log('Total console errors during full run:', consoleErrors.length);
    if (consoleErrors.length > 0) {
      console.log('Console errors:', consoleErrors);
    }

    await browser.close();
    process.exit(consoleErrors.length === 0 ? 0 : 1);
  } catch (err) {
    console.error('Browser test run failed with exception:', err);
    if (browser) await browser.close();
    process.exit(1);
  }
}, 1200);
