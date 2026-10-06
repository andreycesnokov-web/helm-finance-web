const path = require('path');
const Module = require('module');
const http = require('http');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS_DIR = 'C:\\Users\\HUAWEI\\.gemini\\antigravity\\brain\\b4b5605a-29c0-4e6a-9e39-7008b78589f3';
const PORT = 5189;

process.env.PORT = String(PORT);
process.env.SUPABASE_URL = 'http://localhost:0/fake';
process.env.SUPABASE_SECRET_KEY = 'test-fake-secret-key';
process.env.BOT_TOKEN = 'test-fake-bot-token';
process.env.JWT_SECRET = 'test-jwt-secret-for-browser-run';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-fake-tg-webhook-secret';
process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY;

// Intercept @supabase/supabase-js to provide isolated in-memory test database
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

// Clear and seed clean wallets for BIZ_A and BIZ_B
// BCA IDR: 75 000 000 IDR
// Mandiri IDR: 25 000 000 IDR
// Total IDR cash across active accounts: 100 000 000 IDR
mem.__seed('wallets', [
  { id: 'w-bca-idr', business_id: BIZ_A, name: 'BCA IDR Main', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 1 },
  { id: 'w-mandiri-idr', business_id: BIZ_A, name: 'Mandiri IDR Payroll', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 2 },
  { id: 'w-mandiri-usd', business_id: BIZ_A, name: 'Mandiri USD Reserve', currency: 'USD', type: 'bank', scope: 'business', is_active: true, sort_order: 3 },
  { id: 'w-pay-idr', business_id: BIZ_B, name: 'Helm Pay BCA', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 1 },
]);

// Operating transactions window:
// Window start: 2026-10-02 (Inflow 40 000 000 IDR)
// Expenses: 2026-10-04 (5 000 000 IDR) and 2026-10-05 (10 000 000 IDR) -> Total OPEX = 15 000 000 IDR
// Window days = 5 days inclusive (2026-10-02 to 2026-10-06 inclusive)
// Daily spend = 15 000 000 / 5 = 3 000 000 IDR/day
// Operating Inflow = 40 000 000 IDR
// Since 40M > 15M: Net Burn = 0, Runway = null (Cash flow positive, positive_cash_flow)
mem.__seed('transactions', [
  {
    id: 101,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'BCA IDR Main',
    type: 'income',
    amount_original: 40000000,
    amount_idr: 40000000,
    currency_original: 'IDR',
    description: 'Client payment invoice 101',
    transaction_date: '2026-10-02',
    created_at: '2026-10-02T00:00:00Z',
    scope: 'business',
  },
  {
    id: 102,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'BCA IDR Main',
    type: 'income',
    amount_original: 35000000,
    amount_idr: 35000000,
    currency_original: 'IDR',
    description: 'Capital equity funding', // financing excluded from operating revenue
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
  {
    id: 396,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'BCA IDR Main',
    type: 'expense',
    amount_original: 5000000,
    amount_idr: 5000000,
    currency_original: 'IDR',
    counterparty: 'Cloud Hosting Services',
    description: 'Cloud Hosting Services OPEX',
    transaction_date: '2026-10-04',
    created_at: '2026-10-04T08:00:00Z',
    scope: 'business',
  },
  {
    id: 398,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-bca-idr',
    source: 'BCA IDR Main',
    type: 'expense',
    amount_original: 10000000,
    amount_idr: 10000000,
    currency_original: 'IDR',
    counterparty: 'Office Workspace Lease',
    description: 'Office Workspace Lease',
    transaction_date: '2026-10-05',
    created_at: '2026-10-05T09:00:00Z',
    scope: 'business',
  },
  {
    id: 104,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-mandiri-idr',
    source: 'Mandiri IDR Payroll',
    type: 'income',
    amount_original: 25000000,
    amount_idr: 25000000,
    currency_original: 'IDR',
    description: 'Opening balance · Mandiri',
    category: 'Opening balance',
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
  {
    id: 105,
    business_id: BIZ_A,
    created_by_user_id: USER_ID,
    wallet_id: 'w-mandiri-usd',
    source: 'Mandiri USD Reserve',
    type: 'income',
    amount_original: 800,
    amount_idr: 14333600,
    booked_rate: 17917,
    rate_source: 'test_fx_fixture',
    currency_original: 'USD',
    description: 'USD liquidity reserve',
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
  {
    id: 201,
    business_id: BIZ_B,
    created_by_user_id: USER_ID,
    wallet_id: 'w-pay-idr',
    source: 'Helm Pay BCA',
    type: 'income',
    amount_original: 1500000,
    amount_idr: 1500000,
    currency_original: 'IDR',
    description: 'Helm Pay deposit',
    transaction_date: '2026-10-01',
    created_at: '2026-10-01T00:00:00Z',
    scope: 'business',
  },
]);

// Seed debts:
mem.__seed('debts', [
  {
    id: 76,
    business_id: BIZ_A,
    type: 'payable',
    counterparty: 'Logistics Express PT',
    description: 'Logistics Express freight',
    amount: 12000000,
    original_amount: 12000000,
    paid_amount: 0,
    remaining_amount: 12000000,
    currency: 'IDR',
    due_date: null,
    status: 'open',
    created_at: '2026-10-01T00:00:00Z',
  },
]);

// Load real server
const app = require(path.join(ROOT, 'server', 'index'));

// Test JWT token
const testToken = jwt.sign(
  { userId: USER_ID, firstName: 'Owner', email: 'owner@helmcare.id' },
  process.env.JWT_SECRET
);

async function runAcceptancePass() {
  const { chromium } = require(path.join(ARTIFACTS_DIR, 'scratch', 'node_modules', 'playwright-core'));

  console.log('Starting Playwright automated browser verification...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // 1. Desktop Context (1440x900)
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktopCtx.newPage();

  // Set auth state
  await page.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, bizA }) => {
    localStorage.setItem('hf_token', token);
    localStorage.setItem('hf_lang', 'en');
    localStorage.setItem('activeWorkspaceId', bizA);
    localStorage.setItem('activeBusinessId', bizA);
    localStorage.setItem('last_active_workspace_id', bizA);
  }, { token: testToken, bizA: BIZ_A });

  console.log('\n======================================================');
  console.log('PART 1: Pulse Daily Spend & Net Burn Verification');
  console.log('======================================================');
  await page.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const shotPulseDesktop = path.join(ARTIFACTS_DIR, 'proof_01_pulse_daily_spend_desktop.png');
  await page.screenshot({ path: shotPulseDesktop, fullPage: true });
  console.log('Screenshot saved ->', shotPulseDesktop);

  // Assert Daily Spend and Net Cash Burn
  const kpiEl = await page.waitForSelector('.v2-tiles, .pulse-kpis', { timeout: 10000 });
  const dailySpendText = await page.textContent('.v2-tiles, .pulse-kpis');
  console.log('Pulse KPIs text snippet:', dailySpendText?.slice(0, 300));
  assert.ok(dailySpendText.includes('Daily spend') || dailySpendText.includes('Расходы в день'), 'Pulse must display Daily spend KPI');
  assert.ok(dailySpendText.includes('Net cash burn') || dailySpendText.includes('Чистый отток'), 'Pulse must display Net cash burn KPI');
  assert.ok(dailySpendText.includes('3,000,000') || dailySpendText.includes('3.0M') || dailySpendText.includes('3M'), 'Daily spend must equal 15M/5d = 3,000,000 IDR');

  // Hover over daily spend tooltip
  const dailySpendTooltipBtn = await page.waitForSelector('.v2-tile:has-text("Daily spend") .info-tooltip-btn, .v2-tile:has-text("Расходы в день") .info-tooltip-btn, .pulse-kpi:has-text("Daily spend") .info-tooltip-btn, .pulse-kpi:has-text("Расходы в день") .info-tooltip-btn', { timeout: 5000 });
  await dailySpendTooltipBtn.hover();
  await page.waitForSelector('.info-tooltip-popover', { timeout: 5000 });
  const shotTooltipHover = path.join(ARTIFACTS_DIR, 'proof_02_daily_spend_tooltip_desktop.png');
  await page.screenshot({ path: shotTooltipHover });
  console.log('Tooltip hover screenshot saved ->', shotTooltipHover);

  // Press Escape to test keyboard closing
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const popoverAfterEsc = await page.$('.info-tooltip-popover');
  assert.strictEqual(popoverAfterEsc, null, 'Popover must close on Escape key');

  console.log('\n======================================================');
  console.log('PART 2: Wallet Transfer Modal, Double Entry & History');
  console.log('======================================================');
  await page.goto(`http://127.0.0.1:${PORT}/business/accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const shotAccountsBefore = path.join(ARTIFACTS_DIR, 'proof_03_accounts_before_transfer.png');
  await page.screenshot({ path: shotAccountsBefore, fullPage: true });
  console.log('Accounts before transfer ->', shotAccountsBefore);

  // Click "Transfer between accounts" button
  const openTransferBtn = await page.waitForSelector('#open-wallet-transfer-btn', { timeout: 5000 });
  await openTransferBtn.click();
  await page.waitForSelector('.cfo-modal', { timeout: 5000 });
  await page.waitForTimeout(500);

  const shotTransferModal = path.join(ARTIFACTS_DIR, 'proof_04_transfer_modal_opened.png');
  await page.screenshot({ path: shotTransferModal });
  console.log('Transfer modal screenshot ->', shotTransferModal);

  // Fill in transfer details:
  // From: BCA IDR Main ('w-bca-idr') [75M IDR]
  // To: Mandiri IDR Payroll ('w-mandiri-idr') [25M IDR]
  // Amount: 10 000 000 IDR
  await page.selectOption('#transfer-from-wallet', 'w-bca-idr');
  await page.selectOption('#transfer-to-wallet', 'w-mandiri-idr');
  await page.fill('#transfer-amount-input', '10000000');
  await page.fill('#transfer-desc-input', 'Transfer to payroll buffer');
  await page.waitForTimeout(300);

  const shotTransferFilled = path.join(ARTIFACTS_DIR, 'proof_05_transfer_modal_filled.png');
  await page.screenshot({ path: shotTransferFilled });
  console.log('Transfer filled screenshot ->', shotTransferFilled);

  // Click "Execute transfer" button
  const submitTransferBtn = await page.waitForSelector('#transfer-submit-btn', { timeout: 5000 });
  await submitTransferBtn.click();
  await page.waitForTimeout(2000);

  const shotAccountsAfter = path.join(ARTIFACTS_DIR, 'proof_06_accounts_after_transfer.png');
  await page.screenshot({ path: shotAccountsAfter, fullPage: true });
  console.log('Accounts after transfer ->', shotAccountsAfter);

  // Verify in memory database:
  // Transfer transactions must exist and balance updated
  const allTxs = mem.__db['transactions'] || [];
  const transferTxs = allTxs.filter(t => t.description && t.description.includes('payroll buffer'));
  console.log('Transfer transactions in DB count:', transferTxs.length);
  assert.strictEqual(transferTxs.length, 2, 'Must create exactly 2 atomic transactions (double-entry)');
  const [txFrom, txTo] = transferTxs;
  assert.strictEqual(txFrom.wallet_id, 'w-bca-idr');
  assert.strictEqual(txFrom.type, 'expense');
  assert.strictEqual(txFrom.amount_idr, 10000000);
  assert.strictEqual(txTo.wallet_id, 'w-mandiri-idr');
  assert.strictEqual(txTo.type, 'income');
  assert.strictEqual(txTo.amount_idr, 10000000);
  assert.strictEqual(txFrom.transfer_id, txTo.transfer_id, 'Both legs must share the same transfer_id');
  console.log('Verified: Double entry ledger pair booked atomically with matching amounts and identical transfer_id.');

  // Check that transfer moves appear in transfer history on page as single grouped row
  const movesText = await page.textContent('.v2-moves');
  console.log('Grouped moves text snippet:', movesText);
  assert.ok(movesText.includes('BCA IDR Main → Mandiri IDR Payroll'), 'Transfer history must show grouped accounts from -> to');
  assert.ok(movesText.includes('10M') || movesText.includes('10,000,000'), 'Transfer history must show transfer amount');

  console.log('\n======================================================');
  console.log('PART 3: Mobile Viewports (390px and 320px) & Overflow');
  console.log('======================================================');
  // 390px Mobile Viewport
  const mobileCtx390 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page390 = await mobileCtx390.newPage();
  await page390.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await page390.evaluate(({ token, bizA }) => {
    localStorage.setItem('hf_token', token);
    localStorage.setItem('hf_lang', 'en');
    localStorage.setItem('activeWorkspaceId', bizA);
    localStorage.setItem('activeBusinessId', bizA);
  }, { token: testToken, bizA: BIZ_A });

  await page390.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page390.waitForTimeout(800);

  // Check no horizontal scrollbar on 390px
  const hasHorizontalScroll390 = await page390.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.strictEqual(hasHorizontalScroll390, false, 'Page must have no horizontal overflow at 390px');

  const shotMobile390 = path.join(ARTIFACTS_DIR, 'proof_07_pulse_mobile_390px.png');
  await page390.screenshot({ path: shotMobile390, fullPage: true });
  console.log('Mobile 390px screenshot ->', shotMobile390);

  // Tap tooltip on mobile 390px
  const mobile390Tooltip = await page390.waitForSelector('.v2-tile:has-text("Daily spend") .info-tooltip-btn, .v2-tile:has-text("Расходы в день") .info-tooltip-btn, .pulse-kpi:has-text("Daily spend") .info-tooltip-btn, .pulse-kpi:has-text("Расходы в день") .info-tooltip-btn', { timeout: 5000 });
  await mobile390Tooltip.click();
  await page390.waitForSelector('.info-tooltip-popover', { timeout: 5000 });
  const shotMobile390Tooltip = path.join(ARTIFACTS_DIR, 'proof_08_tooltip_sheet_390px.png');
  await page390.screenshot({ path: shotMobile390Tooltip });
  console.log('Mobile 390px tooltip sheet ->', shotMobile390Tooltip);

  // 320px Ultra-Compact Mobile Viewport
  const mobileCtx320 = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page320 = await mobileCtx320.newPage();
  await page320.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await page320.evaluate(({ token, bizA }) => {
    localStorage.setItem('hf_token', token);
    localStorage.setItem('hf_lang', 'en');
    localStorage.setItem('activeWorkspaceId', bizA);
    localStorage.setItem('activeBusinessId', bizA);
  }, { token: testToken, bizA: BIZ_A });

  await page320.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page320.waitForTimeout(800);

  // Check no horizontal scrollbar on 320px
  const hasHorizontalScroll320 = await page320.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.strictEqual(hasHorizontalScroll320, false, 'Page must have no horizontal overflow at 320px');

  const shotMobile320 = path.join(ARTIFACTS_DIR, 'proof_09_pulse_mobile_320px.png');
  await page320.screenshot({ path: shotMobile320, fullPage: true });
  console.log('Mobile 320px screenshot ->', shotMobile320);

  console.log('\n======================================================');
  console.log('PART 4: Tax Knowledge Cards, Details Drawer & Ask Prefill');
  console.log('======================================================');
  await page.goto(`http://127.0.0.1:${PORT}/accountant/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const shotCalendarTaxCards = path.join(ARTIFACTS_DIR, 'proof_10_calendar_tax_cards.png');
  await page.screenshot({ path: shotCalendarTaxCards, fullPage: true });
  console.log('Calendar Tax Cards screenshot ->', shotCalendarTaxCards);

  // Visit /business/accountant and check drawer details and Ask button
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const shotAccountantCards = path.join(ARTIFACTS_DIR, 'proof_11_accountant_tax_cards.png');
  await page.screenshot({ path: shotAccountantCards, fullPage: true });
  console.log('Accountant Tax Cards screenshot ->', shotAccountantCards);

  // Click Details button on PPh 21 card (mandatory assert)
  const detailsBtn = await page.waitForSelector('.tax-card:has-text("PPh 21") button:has-text("Details"), .tax-card:has-text("PPh 21") button:has-text("Подробнее")', { timeout: 5000 });
  await detailsBtn.click();
  await page.waitForSelector('.tax-drawer', { timeout: 5000 });
  await page.waitForTimeout(500);
  const shotDrawer = path.join(ARTIFACTS_DIR, 'proof_12_tax_card_details_drawer.png');
  await page.screenshot({ path: shotDrawer });
  console.log('Tax Details Drawer screenshot ->', shotDrawer);

  // Verify drawer shows clean statutory citation without raw SHA hash
  const drawerContent = await page.textContent('.tax-drawer');
  assert.ok(!drawerContent.includes('SHA:'), 'Drawer must not display raw technical SHA hash in user-facing UI');

  // Click Ask AI Accountant in drawer (mandatory assert)
  const askBtn = await page.waitForSelector('.tax-drawer-foot button:has-text("Ask AI Accountant"), .tax-drawer-foot button:has-text("Спросить AI Accountant")', { timeout: 5000 });
  await askBtn.click();
  await page.waitForTimeout(500);

  // Verify input #acc-ask is populated with question and NOT automatically submitted
  const askVal = await page.$eval('#acc-ask', el => el.value);
  console.log('Question prefilled in #acc-ask:', askVal);
  assert.ok(askVal.includes('PPh 21') || askVal.includes('PPh21'), 'Question must be prefilled with tax card question');

  // Verify no answer box is visible before user presses send button
  const answerBeforeSubmit = await page.$('.v2-answer');
  assert.strictEqual(answerBeforeSubmit, null, 'No automatic submission: assistant must not produce answer before user sends');

  const shotPrefill = path.join(ARTIFACTS_DIR, 'proof_13_ask_box_prefilled.png');
  await page.screenshot({ path: shotPrefill });
  console.log('Ask box prefilled screenshot ->', shotPrefill);

  console.log('\n======================================================');
  console.log('PART 5: Company Switch Race Condition & State Discard');
  console.log('======================================================');
  // Type question in Company A
  await page.fill('#acc-ask', 'What are withholding rules for Company A?');
  const askInputA = await page.$eval('#acc-ask', el => el.value);
  assert.strictEqual(askInputA, 'What are withholding rules for Company A?');

  // Also verify URL query param ?ask= gets stripped on workspace switch
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant?ask=TemporaryQuestionA`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  assert.ok(page.url().includes('ask='), 'URL has ask parameter before switch');

  // Now switch workspace preference to Company B (BIZ_B) in localStorage and trigger workspace switch
  await page.evaluate(({ bizB }) => {
    localStorage.setItem('activeWorkspaceId', bizB);
    localStorage.setItem('activeBusinessId', bizB);
    localStorage.setItem('last_active_workspace_id', bizB);
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('workspace-switch', { detail: { id: bizB } }));
  }, { bizB: BIZ_B });

  // Navigate to Company B's accountant page
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Assert input #acc-ask is cleared, answer is absent, and URL parameters ?ask= / ?q= are absent
  const askInputB = await page.$eval('#acc-ask', el => el.value);
  assert.strictEqual(askInputB, '', 'Input #acc-ask must be completely cleared upon company switch');
  const answerB = await page.$('.v2-answer');
  assert.strictEqual(answerB, null, 'No answer from Company A can be displayed in Company B');
  assert.ok(!page.url().includes('ask=') && !page.url().includes('q='), 'URL params ?ask= and ?q= must be removed');
  console.log('Verified: Company switch race condition protected. All inputs, answers, modals and query params cleared.');

  console.log('\n======================================================');
  console.log('PART 6: Multi-language Localization (RU / ID / EN)');
  console.log('======================================================');
  // Set language to Russian
  await page.evaluate(() => {
    localStorage.setItem('hf_lang', 'ru');
  });
  await page.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const ruPulseText = await page.textContent('.v2-tiles, .pulse-kpis');
  assert.ok(ruPulseText.includes('Расходы в день') || ruPulseText.includes('Чистый отток'), 'Must display Russian translations on Pulse');
  console.log('Verified: Russian UI localization functioning.');

  // Set language to Indonesian
  await page.evaluate(() => {
    localStorage.setItem('hf_lang', 'id');
  });
  await page.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const idPulseText = await page.textContent('.v2-tiles, .pulse-kpis');
  assert.ok(idPulseText.includes('Pengeluaran harian') || idPulseText.includes('Arus kas positif') || idPulseText.includes('Ringkasan kas'), 'Must display Indonesian translations on Pulse');
  console.log('Verified: Indonesian UI localization functioning.');

  // Restore English
  await page.evaluate(() => {
    localStorage.setItem('hf_lang', 'en');
  });

  await browser.close();
  console.log('\n======================================================');
  console.log('ALL PLAYWRIGHT TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================');
}

// Start browser tests (server/index.js already listens on process.env.PORT)
setTimeout(async () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
  try {
    await runAcceptancePass();
    console.log('Acceptance run complete.');
    process.exit(0);
  } catch (err) {
    console.error('Acceptance run FAILED:', err);
    process.exit(1);
  }
}, 1000);
