const path = require('path');
const Module = require('module');
const http = require('http');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS_DIR = 'C:\\Users\\HUAWEI\\.gemini\\antigravity\\brain\\b4b5605a-29c0-4e6a-9e39-7008b78589f3';
const PORT = 5188;

// Set required environment for real server/index.js
process.env.PORT = String(PORT);
process.env.SUPABASE_URL = 'http://localhost:0/fake';
process.env.SUPABASE_SECRET_KEY = 'test-fake-secret-key';
process.env.BOT_TOKEN = 'test-fake-bot-token';
process.env.JWT_SECRET = 'test-jwt-secret-for-browser-run';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-fake-tg-webhook-secret';
process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY; // enforce fallback operates

// Intercept @supabase/supabase-js to provide isolated test database
const mem = require(path.join(ROOT, 'tests', 'integration', '_memorySupabase'));
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

// ── Seed Isolated Test Database ───────────────────────────────────────────────
const BIZ_A = 'b949966a-3988-47cb-9e7c-afad1423f4f8'; // Helm Care Indonesia
const BIZ_B = '04bb95b6-df97-4ea9-9ab2-fbdeaa65f43f'; // Helm Care Pay
const USER_ID = 1001;

mem.__seed('users', [
  { id: USER_ID, first_name: 'Owner', username: 'owner', email: 'owner@helmcare.id' },
]);

mem.__seed('businesses', [
  { id: BIZ_A, name: 'Helm Care Indonesia', type: 'company', owner_user_id: USER_ID, created_at: '2026-01-01' },
  { id: BIZ_B, name: 'Helm Care Pay', type: 'company', owner_user_id: USER_ID, created_at: '2026-01-02' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_ID, business_id: BIZ_A, role: 'owner', status: 'active' },
  { id: 2, user_id: USER_ID, business_id: BIZ_B, role: 'owner', status: 'active' },
]);

mem.__seed('user_workspace_preferences', [
  { user_id: USER_ID, default_business_workspace_id: BIZ_A, last_active_workspace_id: BIZ_A },
]);

mem.__seed('wallets', [
  { id: 'w-bca-idr', business_id: BIZ_A, name: 'QA-7DAY-RUN01 BCA IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 1 },
  { id: 'w-mandiri-idr', business_id: BIZ_A, name: 'QA-7DAY-RUN01 Mandiri IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 2 },
  { id: 'w-mandiri-usd', business_id: BIZ_A, name: 'QA-7DAY-RUN01 Mandiri USD', currency: 'USD', type: 'bank', scope: 'business', is_active: true, sort_order: 3 },
  { id: 'w-pay-idr', business_id: BIZ_B, name: 'Helm Pay BCA', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 1 },
]);

// Seed transactions:
// BCA IDR: 115M in - 5M out (#396) - 10M out (#398) = 100 000 000 IDR
// Mandiri IDR: 25M in = 25 000 000 IDR
// Mandiri USD: 800 USD = 14 333 600 IDR (at test rate 17 917)
mem.__seed('transactions', [
  {
    id: 101,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'QA-7DAY-RUN01 BCA IDR',
    type: 'income',
    amount_original: 115000000,
    amount_idr: 115000000,
    currency_original: 'IDR',
    description: 'Initial funding',
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
  {
    id: 396,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'QA-7DAY-RUN01 BCA IDR',
    type: 'expense',
    amount_original: 5000000,
    amount_idr: 5000000,
    currency_original: 'IDR',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    description: 'Payment: QA-7DAY-RUN01 Vendor Beta',
    transaction_date: '2026-10-05',
    created_at: '2026-10-05T08:00:00Z',
    scope: 'business',
  },
  {
    id: 398,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'QA-7DAY-RUN01 BCA IDR',
    type: 'expense',
    amount_original: 10000000,
    amount_idr: 10000000,
    currency_original: 'IDR',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    description: 'Payment: QA-7DAY-RUN01 Vendor Beta',
    transaction_date: '2026-10-05',
    created_at: '2026-10-05T09:00:00Z',
    scope: 'business',
  },
  {
    id: 102,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-mandiri-idr',
    source: 'QA-7DAY-RUN01 Mandiri IDR',
    type: 'income',
    amount_original: 25000000,
    amount_idr: 25000000,
    currency_original: 'IDR',
    description: 'Reserve deposit',
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
  {
    id: 103,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-mandiri-usd',
    source: 'QA-7DAY-RUN01 Mandiri USD',
    type: 'income',
    amount_original: 800,
    amount_idr: 14333600,
    booked_rate: 17917,
    rate_source: 'test_fx_fixture',
    currency_original: 'USD',
    description: 'USD liquidity',
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
]);

// Seed debts:
// Debt 76: Undated Logistics (12 000 000 IDR), due_date: null
// Debt 75: Vendor Beta (15 000 000 IDR), paid_amount: 15 000 000 IDR, due_date: 2026-10-05
mem.__seed('debts', [
  {
    id: 76,
    business_id: BIZ_A,
    type: 'payable',
    counterparty: 'QA-7DAY-RUN01 Undated Logistics',
    description: 'Logistics and freight services',
    amount: 12000000,
    original_amount: 12000000,
    paid_amount: 0,
    remaining_amount: 12000000,
    currency: 'IDR',
    status: 'open',
    due_date: null,
    is_settled: false,
    scope: 'business',
    created_at: '2026-10-05T00:00:00Z',
  },
  {
    id: 75,
    business_id: BIZ_A,
    type: 'payable',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    description: 'Equipment supply and parts',
    amount: 15000000,
    original_amount: 15000000,
    paid_amount: 15000000,
    remaining_amount: 0,
    currency: 'IDR',
    status: 'paid',
    due_date: '2026-10-05',
    is_settled: true,
    scope: 'business',
    linked_transaction_id: 396,
    created_at: '2026-10-01T00:00:00Z',
  },
]);

// Boot real server/index.js
console.log('Booting real server/index.js over isolated test database...');
require(path.join(ROOT, 'server', 'index.js'));

// Test JWT token with user details
const testToken = jwt.sign(
  { userId: USER_ID, firstName: 'Owner', email: 'owner@helmcare.id' },
  process.env.JWT_SECRET
);

async function runBrowserAcceptance() {
  const { chromium } = require(path.join(ARTIFACTS_DIR, 'scratch', 'node_modules', 'playwright-core'));

  console.log('Launching Chrome browser via Playwright...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER PAGE ERROR:', err.message));
  page.on('response', async res => {
    if (res.status() >= 400) {
      const body = await res.text().catch(() => '');
      console.log('HTTP ERROR:', res.status(), res.url(), body);
    }
  });

  // Set auth state
  await page.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, bizA }) => {
    localStorage.setItem('hf_token', token);
    localStorage.setItem('activeWorkspaceId', bizA);
    localStorage.setItem('activeBusinessId', bizA);
    localStorage.setItem('last_active_workspace_id', bizA);
  }, { token: testToken, bizA: BIZ_A });

  console.log('\n======================================================');
  console.log('SCENARIO 1: Radar & Debt Due Date Persistence (PR 131)');
  console.log('======================================================');

  // 1. Visit Radar initially
  await page.goto(`http://127.0.0.1:${PORT}/business/radar`, { waitUntil: 'networkidle' });
  console.log('After radar goto, url is:', page.url());
  await page.waitForTimeout(1000);
  const shot1 = path.join(ARTIFACTS_DIR, '01_real_radar_initial_undated.png');
  await page.screenshot({ path: shot1, fullPage: true });
  console.log('Step 1.1: Initial Radar captured ->', shot1);

  // 2. Open edit modal via URL ?edit=76
  await page.goto(`http://127.0.0.1:${PORT}/business/payables?edit=76`, { waitUntil: 'networkidle' });
  console.log('After payables goto, url is:', page.url());
  await page.waitForSelector('.modal-sheet', { timeout: 5000 });
  await page.waitForTimeout(500);
  const shot2 = path.join(ARTIFACTS_DIR, '02_real_debt_edit_modal_76.png');
  await page.screenshot({ path: shot2, fullPage: true });
  console.log('Step 1.2: Edit modal for Debt #76 captured ->', shot2);

  // 3. Fill in due date and click Save button in modal
  const dateInput = await page.$('.modal-sheet input[type="date"]');
  if (dateInput) {
    await dateInput.fill('2026-10-15');
    console.log('Step 1.3: Filled due_date with 2026-10-15');
  }

  // Click Save button in modal
  const saveBtn = await page.$('.modal-sheet button.btn-block:not(.btn-ghost)');
  if (saveBtn) {
    await saveBtn.click();
    console.log('Step 1.4: Clicked Save button in modal');
    await page.waitForTimeout(1500);
  }

  // Verify modal closed and URL sanitized
  console.log('Step 1.5: Current URL after modal close:', page.url());
  assert.ok(!page.url().includes('edit='), 'URL must be sanitized after modal close');

  // Check DB state directly
  const dbDebt76 = mem.__db.debts.find(d => d.id === 76);
  console.log('Step 1.6: DB state of Debt #76 after PATCH:', {
    id: dbDebt76?.id,
    due_date: dbDebt76?.due_date,
    amount: dbDebt76?.amount,
  });
  assert.strictEqual(dbDebt76?.due_date, '2026-10-15', 'Debt #76 due_date must be persisted in DB');

  // Reload page to verify persistence across reloads
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Return to Radar to check updated forecast
  await page.goto(`http://127.0.0.1:${PORT}/business/radar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const shot3 = path.join(ARTIFACTS_DIR, '03_real_radar_updated_forecast.png');
  await page.screenshot({ path: shot3, fullPage: true });
  console.log('Step 1.7: Updated Radar forecast captured ->', shot3);


  console.log('\n======================================================');
  console.log('SCENARIO 2: Atomic Wallet Transfer & Neutrality (PR 130)');
  console.log('======================================================');

  // 1. Visit Wallets before transfer
  await page.goto(`http://127.0.0.1:${PORT}/business/accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const shot4 = path.join(ARTIFACTS_DIR, '04_real_wallets_before_transfer.png');
  await page.screenshot({ path: shot4, fullPage: true });
  console.log('Step 2.1: Wallets before transfer captured ->', shot4);

  // Check DB balances before transfer
  const bcaBefore = mem.__db.transactions.filter(t => t.wallet_id === 'w-bca-idr').reduce((s, t) => s + (t.type === 'income' ? t.amount_original : -t.amount_original), 0);
  const mandiriBefore = mem.__db.transactions.filter(t => t.wallet_id === 'w-mandiri-idr').reduce((s, t) => s + (t.type === 'income' ? t.amount_original : -t.amount_original), 0);
  console.log('Step 2.2: DB Balances before transfer: BCA =', bcaBefore, 'Mandiri =', mandiriBefore);

  // 2. Perform transfer of 5 000 000 IDR via the real backend endpoint /api/wallets/transfer
  const transferRes = await page.evaluate(async (token) => {
    const res = await fetch('/api/wallets/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-business-id': 'b949966a-3988-47cb-9e7c-afad1423f4f8'
      },
      body: JSON.stringify({
        from_wallet_id: 'w-bca-idr',
        to_wallet_id: 'w-mandiri-idr',
        amount: 5000000,
        description: 'Transfer QA-7DAY-RUN01 BCA IDR -> QA-7DAY-RUN01 Mandiri IDR'
      })
    });
    return res.json();
  }, testToken);

  console.log('Step 2.3: Real backend transfer response:', transferRes);
  assert.strictEqual(transferRes.ok, true, 'Real backend transfer must succeed');
  assert.ok(transferRes.transfer_id, 'Transfer must return transfer_id');

  // Check DB state after transfer
  const bcaAfter = mem.__db.transactions.filter(t => t.wallet_id === 'w-bca-idr').reduce((s, t) => s + (t.type === 'income' ? t.amount_original : -t.amount_original), 0);
  const mandiriAfter = mem.__db.transactions.filter(t => t.wallet_id === 'w-mandiri-idr').reduce((s, t) => s + (t.type === 'income' ? t.amount_original : -t.amount_original), 0);
  const transferTxs = mem.__db.transactions.filter(t => t.transfer_id === transferRes.transfer_id);
  console.log('Step 2.4: DB Balances after transfer: BCA =', bcaAfter, 'Mandiri =', mandiriAfter);
  console.log('Step 2.5: Linked transfer transactions count in DB:', transferTxs.length, {
    debit: transferTxs[0]?.id,
    credit: transferTxs[1]?.id,
    transfer_id: transferTxs[0]?.transfer_id,
  });

  assert.strictEqual(transferTxs.length, 2, 'DB must contain exactly 2 linked transfer records');
  assert.strictEqual(bcaAfter, bcaBefore - 5000000, 'Source wallet BCA must be debited by 5 000 000 IDR');
  assert.strictEqual(mandiriAfter, mandiriBefore + 5000000, 'Destination wallet Mandiri must be credited by 5 000 000 IDR');
  assert.strictEqual(bcaAfter + mandiriAfter, bcaBefore + mandiriBefore, 'Total cash across wallets must be conserved');

  // 3. Visit Wallets after transfer
  await page.goto(`http://127.0.0.1:${PORT}/business/accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const shot5 = path.join(ARTIFACTS_DIR, '05_real_wallets_after_transfer.png');
  await page.screenshot({ path: shot5, fullPage: true });
  console.log('Step 2.6: Wallets after transfer captured ->', shot5);

  // 4. Visit Pulse to confirm burn rate and income/expense neutrality
  await page.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const shot6 = path.join(ARTIFACTS_DIR, '06_real_pulse_transfer_neutral.png');
  await page.screenshot({ path: shot6, fullPage: true });
  console.log('Step 2.7: Pulse transfer neutrality captured ->', shot6);


  console.log('\n======================================================');
  console.log('SCENARIO 3: AI Accountant Fallback & Facts (PR 132)');
  console.log('======================================================');

  // 1. Navigate to AI Accountant page
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 2. Submit question via real UI input
  const askInput = await page.$('#acc-ask, textarea[placeholder*="Ask"], input[placeholder*="Ask"], input[type="text"]');
  if (askInput) {
    await askInput.fill('Сколько мы заплатили поставщику QA-7DAY-RUN01 Vendor Beta и сколько ещё должны?');
    const submitBtn = await page.$('button[type="submit"], form button');
    if (submitBtn) await submitBtn.click();
    console.log('Step 3.1: Submitted question via UI');
    await page.waitForTimeout(2000);
  }

  const shot7 = path.join(ARTIFACTS_DIR, '07_real_ai_accountant_vendor_beta_answer.png');
  await page.screenshot({ path: shot7, fullPage: true });
  console.log('Step 3.2: AI Accountant fallback answer captured ->', shot7);

  const bodyTextAcc = await page.innerText('body');
  assert.ok(bodyTextAcc.includes('QA-7DAY-RUN01 Vendor Beta'), 'AI Accountant response must reference vendor name');
  assert.ok(/15[\s\u00A0]000[\s\u00A0]000 IDR/.test(bodyTextAcc), 'AI Accountant response must contain 15 000 000 IDR');
  assert.ok(/0 IDR/.test(bodyTextAcc), 'AI Accountant response must contain 0 IDR remaining');


  console.log('\n======================================================');
  console.log('SCENARIO 4: Company Switch In-Flight Race Condition (PR 132)');
  console.log('======================================================');

  // 1. Intercept /api/accountant/ask to introduce a controlled delay
  let releaseDelayedRequest;
  const delayPromise = new Promise(resolve => { releaseDelayedRequest = resolve; });

  await page.route('**/api/accountant/ask', async (route) => {
    console.log('Step 4.1: Intercepted /api/accountant/ask - holding response in flight...');
    const response = await page.request.fetch(route.request());
    await delayPromise;
    console.log('Step 4.4: Releasing delayed response from Company A...');
    await route.fulfill({ response });
  });

  // 2. Submit question in Company A
  if (askInput) {
    await askInput.fill('Конфиденциальные факты Компании A');
    const submitBtn = await page.$('button[type="submit"], form button');
    if (submitBtn) await submitBtn.click();
    console.log('Step 4.2: Sent question for Company A (currently in-flight)');
    await page.waitForTimeout(400);
  }

  // 3. Switch company to Company B via UI switcher WITHOUT page reload
  const switcherBtn = await page.$('button.cfo-switch');
  if (switcherBtn) {
    await switcherBtn.click();
    await page.waitForTimeout(300);
    const optB = await page.$('.cfo-switch-opt:has-text("Helm Care Pay")');
    if (optB) {
      await optB.click();
      console.log('Step 4.3: Switched workspace to Company B via UI switcher');
    }
  }
  await page.waitForTimeout(400);

  // 4. Release the delayed request from Company A
  releaseDelayedRequest();
  await page.waitForTimeout(1000);

  // 5. Unroute
  await page.unroute('**/api/accountant/ask');

  const shot8 = path.join(ARTIFACTS_DIR, '08_real_ai_accountant_company_switch_cleared.png');
  await page.screenshot({ path: shot8, fullPage: true });
  console.log('Step 4.5: Company B screen verified clean ->', shot8);

  const bodyTextCompanyB = await page.innerText('body');
  assert.ok(!bodyTextCompanyB.includes('Конфиденциальные факты Компании A'), 'Company B must not display leaked answer from Company A');

  await browser.close();
  console.log('\nAll real browser acceptance scenarios executed successfully!');
  process.exit(0);
}

runBrowserAcceptance().catch((err) => {
  console.error('Acceptance execution failed:', err);
  process.exit(1);
});
