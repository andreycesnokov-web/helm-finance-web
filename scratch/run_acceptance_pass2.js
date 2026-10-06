const path = require('path');
const Module = require('module');
const http = require('http');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const LOGS_DIR = path.join(ROOT, 'scratch', 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
const ACCEPTANCE_LOG = path.join(LOGS_DIR, 'browser_acceptance.log');
const acceptanceLogStream = fs.createWriteStream(ACCEPTANCE_LOG, { flags: 'w' });

const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = function (chunk, encoding, callback) {
  try { acceptanceLogStream.write(chunk); } catch {}
  return origStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = function (chunk, encoding, callback) {
  try { acceptanceLogStream.write(chunk); } catch {}
  return origStderrWrite(chunk, encoding, callback);
};

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
  {
    id: 88,
    business_id: BIZ_B,
    type: 'payable',
    counterparty: 'QA Pay Partner Beta',
    description: 'QA Pay Partner Beta processing services',
    amount: 5000000,
    original_amount: 5000000,
    paid_amount: 2000000,
    remaining_amount: 3000000,
    currency: 'IDR',
    due_date: null,
    status: 'open',
    created_at: '2026-10-01T00:00:00Z',
  },
]);

// Seed official sources, tax rules and tax profiles for deterministic compliance calendar
mem.__seed('official_sources', [
  {
    id: 1,
    jurisdiction: 'ID',
    title: 'UU HPP No. 7/2021 (Harmonisasi Peraturan Perpajakan)',
    url: 'https://pajak.go.id/uu-hpp',
    status: 'active',
    last_verified_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    jurisdiction: 'ID',
    title: 'PMK 168/2023 (Petunjuk Pemotongan Pajak PPh 21)',
    url: 'https://jdih.kemenkeu.go.id/pmk168',
    status: 'active',
    last_verified_at: '2026-01-01T00:00:00Z',
  },
]);

mem.__seed('tax_rules', [
  {
    id: 1,
    jurisdiction: 'ID',
    rule_code: 'PPh 21',
    title: 'PPh 21 Monthly Employee Withholding',
    version: '2026.1',
    obligation_type: 'withholding',
    filing_frequency: 'monthly',
    status: 'active',
    last_verified_at: '2026-01-01T00:00:00Z',
    official_source_id: 2,
    due_date_rule_json: { day_of_month: 20, next_month: true },
  },
  {
    id: 2,
    jurisdiction: 'ID',
    rule_code: 'PPN',
    title: 'PPN (VAT) Monthly Return SPT Masa',
    version: '2026.1',
    obligation_type: 'filing',
    filing_frequency: 'monthly',
    status: 'active',
    last_verified_at: '2026-01-01T00:00:00Z',
    official_source_id: 1,
    due_date_rule_json: { day_of_month: 30, next_month: true },
  },
]);

mem.__seed('tax_profiles', [
  {
    business_id: BIZ_A,
    jurisdiction: 'ID',
    has_employees: true,
    vat_registered: true,
    reporting_currency: 'IDR',
  },
  {
    business_id: BIZ_B,
    jurisdiction: 'ID',
    has_employees: true,
    vat_registered: false,
    reporting_currency: 'IDR',
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
  let chromium;
  try {
    chromium = require(path.join(__dirname, 'node_modules', 'playwright-core')).chromium;
  } catch {
    chromium = require('playwright-core').chromium;
  }

  console.log('Starting Playwright automated browser verification...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // 1. Desktop Context (1440x900)
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktopCtx.newPage();
  const browserConsoleLogs = [];
  const pageErrors = [];
  page.on('console', msg => {
    browserConsoleLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
    browserConsoleLogs.push(`[PAGEERROR] ${err.message}\n${err.stack || ''}`);
  });

  // Set auth state
  await page.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, bizA }) => {
    localStorage.setItem('hf_token', token);
    localStorage.setItem('hf_lang', 'en');
    localStorage.setItem('activeWorkspaceId', bizA);
    localStorage.setItem('activeBusinessId', bizA);
    localStorage.setItem('last_active_workspace_id', bizA);
    localStorage.setItem('__cfo_test__', '1');
    window.__CFO_TEST_MODE__ = true;
  }, { token: testToken, bizA: BIZ_A });

  console.log('\n======================================================');
  console.log('PART 1: Pulse Daily Spend & Net Burn Verification');
  console.log('======================================================');
  await page.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const shotPulseDesktop = path.join(SCREENSHOTS_DIR, 'proof_01_pulse_daily_spend_desktop.png');
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
  const shotTooltipHover = path.join(SCREENSHOTS_DIR, 'proof_02_daily_spend_tooltip_desktop.png');
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

  const shotAccountsBefore = path.join(SCREENSHOTS_DIR, 'proof_03_accounts_before_transfer.png');
  await page.screenshot({ path: shotAccountsBefore, fullPage: true });
  console.log('Accounts before transfer ->', shotAccountsBefore);

  // Click "Transfer between accounts" button
  const openTransferBtn = await page.waitForSelector('#open-wallet-transfer-btn', { timeout: 5000 });
  await openTransferBtn.click();
  await page.waitForSelector('.cfo-modal', { timeout: 5000 });
  await page.waitForTimeout(500);

  const shotTransferModal = path.join(SCREENSHOTS_DIR, 'proof_04_transfer_modal_opened.png');
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

  const shotTransferFilled = path.join(SCREENSHOTS_DIR, 'proof_05_transfer_modal_filled.png');
  await page.screenshot({ path: shotTransferFilled });
  console.log('Transfer filled screenshot ->', shotTransferFilled);

  // Click "Execute transfer" button
  const submitTransferBtn = await page.waitForSelector('#transfer-submit-btn', { timeout: 5000 });
  await submitTransferBtn.click();
  await page.waitForTimeout(2000);

  const shotAccountsAfter = path.join(SCREENSHOTS_DIR, 'proof_06_accounts_after_transfer.png');
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

  const shotMobile390 = path.join(SCREENSHOTS_DIR, 'proof_07_pulse_mobile_390px.png');
  await page390.screenshot({ path: shotMobile390, fullPage: true });
  console.log('Mobile 390px screenshot ->', shotMobile390);

  // Tap tooltip on mobile 390px
  const mobile390Tooltip = await page390.waitForSelector('.v2-tile:has-text("Daily spend") .info-tooltip-btn, .v2-tile:has-text("Расходы в день") .info-tooltip-btn, .pulse-kpi:has-text("Daily spend") .info-tooltip-btn, .pulse-kpi:has-text("Расходы в день") .info-tooltip-btn', { timeout: 5000 });
  await mobile390Tooltip.click();
  await page390.waitForSelector('.info-tooltip-popover', { timeout: 5000 });
  const shotMobile390Tooltip = path.join(SCREENSHOTS_DIR, 'proof_08_tooltip_sheet_390px.png');
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

  const shotMobile320 = path.join(SCREENSHOTS_DIR, 'proof_09_pulse_mobile_320px.png');
  await page320.screenshot({ path: shotMobile320, fullPage: true });
  console.log('Mobile 320px screenshot ->', shotMobile320);

  console.log('\n======================================================');
  console.log('PART 4: Tax Knowledge Cards, Details Drawer & Ask Prefill');
  console.log('======================================================');
  // Collect console errors and page errors to ensure clean render
  const calendarErrors = [];
  page.on('pageerror', err => calendarErrors.push(`[PAGEERROR] ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') calendarErrors.push(`[CONSOLE_ERR] ${msg.text()}`);
  });

  await page.goto(`http://127.0.0.1:${PORT}/accountant/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  console.log('PART 4 CURRENT URL:', page.url());

  // Assert calendar header, compliance events, and tax knowledge cards are rendered and visible
  const calHeader = await page.waitForSelector('h1:has-text("Compliance calendar"), h1:has-text("Календарь compliance"), h1:has-text("Kalender kepatuhan")', { timeout: 10000 });
  assert.ok(calHeader, 'Compliance Calendar header must be visible');
  
  // Verify tax cards grid or compliance events are present before taking proof_10
  const hasEventsOrCards = await page.evaluate(() => {
    const events = document.querySelectorAll('div[style*="background: var(--surface)"], div[style*="background:var(--surface)"]');
    const cards = document.querySelectorAll('.tax-card, .tax-cards-grid');
    const headings = document.querySelectorAll('h1, h3');
    return { eventsCount: events.length, cardsCount: cards.length, headingsCount: headings.length };
  });
  console.log('Compliance calendar DOM element counts:', hasEventsOrCards);
  assert.ok(hasEventsOrCards.headingsCount >= 2, 'Calendar must display both main title and Tax Knowledge Reference title');
  assert.ok(hasEventsOrCards.cardsCount >= 1, 'Tax Knowledge Cards grid must be populated');

  const shotCalendarTaxCards = path.join(SCREENSHOTS_DIR, 'proof_10_calendar_tax_cards.png');
  await page.screenshot({ path: shotCalendarTaxCards, fullPage: true });
  console.log('Calendar Tax Cards screenshot ->', shotCalendarTaxCards);

  // Assert screenshot file size is non-empty (> 20KB)
  const shot10Stat = fs.statSync(shotCalendarTaxCards);
  console.log('proof_10_calendar_tax_cards.png file size:', shot10Stat.size, 'bytes');
  assert.ok(shot10Stat.size > 20000, 'Screenshot proof_10 must not be a blank image');

  // Visit /business/accountant and check drawer details and Ask button
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const shotAccountantCards = path.join(SCREENSHOTS_DIR, 'proof_11_accountant_tax_cards.png');
  await page.screenshot({ path: shotAccountantCards, fullPage: true });
  console.log('Accountant Tax Cards screenshot ->', shotAccountantCards);

  // Click Details button on PPh 21 card (mandatory assert)
  const detailsBtn = await page.waitForSelector('.tax-card:has-text("PPh 21") button:has-text("Details"), .tax-card:has-text("PPh 21") button:has-text("Подробнее")', { timeout: 5000 });
  await detailsBtn.click();
  await page.waitForSelector('.tax-drawer', { timeout: 5000 });
  await page.waitForTimeout(500);
  const shotDrawer = path.join(SCREENSHOTS_DIR, 'proof_12_tax_card_details_drawer.png');
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

  const shotPrefill = path.join(SCREENSHOTS_DIR, 'proof_13_ask_box_prefilled.png');
  await page.screenshot({ path: shotPrefill });
  console.log('Ask box prefilled screenshot ->', shotPrefill);

  console.log('\n======================================================');
  console.log('PART 5: Company Switch Real Browser Race Condition & Delayed Responses');
  console.log('======================================================');
  // 5a. Intercept /api/accountant/ask to introduce a delayed response for Company A
  let delayedAskPromiseResolve = null;
  const delayedAskPromise = new Promise(res => { delayedAskPromiseResolve = res; });
  let delayedAskIntercepted = false;

  await page.route('**/api/accountant/ask', async (route) => {
    if (!delayedAskIntercepted) {
      delayedAskIntercepted = true;
      console.log('[Playwright Route Intercept] Delayed /api/accountant/ask initiated for Company A...');
      await delayedAskPromise;
      console.log('[Playwright Route Intercept] Fulfilling delayed /api/accountant/ask for Company A now...');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Delayed answer strictly belonging to Company A (Logistics Express PT)',
          disclaimer: 'Company A disclaimer',
          used_rules: [{ rule_code: 'PPh 21' }]
        })
      });
    } else {
      await route.continue();
    }
  });

  // Navigate to Company A Accountant with search query in URL
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant?ask=TemporaryQuestionA`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  assert.ok(page.url().includes('ask='), 'URL has ask parameter before switch');

  // Type question in Company A and click send (do not reload page)
  await page.fill('#acc-ask', 'What are withholding rules for Company A?');
  const sendBtn = await page.waitForSelector('button[aria-label="Send"], button[aria-label="Отправить"]', { timeout: 5000 });
  await sendBtn.click();
  console.log('Question sent in Company A, request delayed in-flight.');
  await page.waitForTimeout(300);

  // Switch to Company B via standard UI switcher WITHOUT page reload
  const switcherBtn = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await switcherBtn.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  
  // Click Company B ("Helm Care Pay") in the dropdown
  const optB = await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Pay")', { timeout: 5000 });
  await optB.click();
  console.log('Clicked standard UI switcher to Helm Care Pay (Company B) without page reload.');

  // Allow workspace state and React effects to transition cleanly without page.goto
  await page.waitForTimeout(800);

  // Confirm Company B is active in UI
  const activeWsText = await page.textContent('.cfo-switch');
  console.log('Active workspace switcher text:', activeWsText);
  assert.ok(activeWsText.includes('Helm Care Pay'), 'Company B (Helm Care Pay) must be the active workspace');

  // Ensure route is at /business/accountant if switcher navigated to /business
  if (!page.url().includes('/business/accountant')) {
    const accTabLink = await page.waitForSelector('a[href="/business/accountant"], a[href="/accountant/calendar"]', { timeout: 5000 });
    await accTabLink.click();
    await page.waitForTimeout(500);
  }

  // Now resolve the delayed response for Company A
  assert.strictEqual(delayedAskIntercepted, true, 'Delayed ask route must have been intercepted in Company A');
  delayedAskPromiseResolve();
  await page.waitForTimeout(800);

  // Verify:
  // 1. Delayed response for Company A NEVER rendered in Company B
  const answerInB = await page.$('.v2-answer');
  if (answerInB) {
    const textInB = await answerInB.textContent();
    assert.ok(!textInB.includes('Delayed answer strictly belonging to Company A'), 'Company A response must never be rendered in Company B');
  }
  assert.strictEqual(answerInB, null, 'No answer from Company A can be displayed in Company B');

  // 2. Input #acc-ask is completely empty in Company B
  const askInputB = await page.$eval('#acc-ask', el => el.value);
  assert.strictEqual(askInputB, '', 'Input #acc-ask must be empty in Company B');

  // 3. URL search params ?ask= and ?q= are absent
  assert.ok(!page.url().includes('ask=') && !page.url().includes('q='), 'URL params ?ask= and ?q= must be removed in Company B');

  // Unroute delayed /api/accountant/ask to restore normal execution
  await page.unroute('**/api/accountant/ask');

  // 4. Send question in Company B specifically referencing Company B's counterparty
  await page.fill('#acc-ask', 'What did we pay QA Pay Partner Beta?');
  const sendBtnB = await page.waitForSelector('button[aria-label="Send"], button[aria-label="Отправить"]', { timeout: 5000 });
  await sendBtnB.click();
  await page.waitForSelector('.v2-answer', { timeout: 8000 });
  const ansBText = await page.textContent('.v2-answer');
  console.log('Company B answer received:', ansBText);
  assert.ok(ansBText.includes('QA Pay Partner Beta'), 'Company B answer must specifically cite Company B counterparty "QA Pay Partner Beta"');
  assert.ok(ansBText.includes('2,000,000') || ansBText.includes('2M') || ansBText.includes('3,000,000'), 'Company B answer must cite Company B debt amounts');

  // 5b. Verify Accounts Delayed Load Isolation on already-open page (A -> B, zero reload)
  console.log('\n--- Checking Accounts Delayed Load Isolation on already-open page (A -> B) ---');
  // First, open /business/accounts while in Company B
  if (!page.url().includes('/business/accounts')) {
    await page.goto(`http://127.0.0.1:${PORT}/business/accounts`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
  }

  // Intercept /api/wallets to hold Company A's request and verify headers
  let heldWalletsResolveA = null;
  const heldWalletsPromiseA = new Promise(res => { heldWalletsResolveA = res; });
  let interceptedWalletsA = false;
  let interceptedBizIdA = null;

  await page.route('**/api/wallets', async (route) => {
    const bizHeader = route.request().headers()['x-business-id'];
    if (bizHeader === BIZ_A && !interceptedWalletsA) {
      interceptedWalletsA = true;
      interceptedBizIdA = bizHeader;
      console.log(`[Playwright Route Intercept] Intercepted and holding /api/wallets for Company A (x-business-id: ${bizHeader})...`);
      await heldWalletsPromiseA;
      console.log('[Playwright Route Intercept] Releasing held /api/wallets for Company A...');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          wallets: [
            { id: 'w-stale-a', name: 'STALE Company A Secret Vault', currency: 'IDR', balance: 999999999, scope: 'business' }
          ]
        })
      });
    } else {
      await route.continue();
    }
  });

  // Switch to Company A on the already-open page via standard UI switcher (zero reload)
  const switcherBtnAccounts = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await switcherBtnAccounts.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  const optA = await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Indonesia")', { timeout: 5000 });
  await optA.click();
  await page.waitForTimeout(500);

  // Assert interception and x-business-id of Company A
  assert.strictEqual(interceptedWalletsA, true, 'Company A /api/wallets request must be intercepted in-flight');
  assert.strictEqual(interceptedBizIdA, BIZ_A, 'Intercepted request must carry Company A x-business-id');

  // Now, while Company A's request is held in-flight, switch to Company B via UI switcher WITHOUT reload
  const switcherBtnToB = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await switcherBtnToB.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  const optBAccounts = await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Pay")', { timeout: 5000 });
  await optBAccounts.click();

  // Wait for Company B's wallets to load and render in DOM
  await page.waitForSelector(':has-text("Helm Pay BCA"), :has-text("w-pay-idr")', { timeout: 8000 });
  console.log('Company B wallets rendered in DOM while Company A request was still held.');

  // Now release Company A's held response
  heldWalletsResolveA();
  await page.waitForTimeout(800);
  await page.unroute('**/api/wallets');

  // Verify: DOM retains Company B wallets, and stale Company A wallet NEVER rendered
  const accountsBodyB = await page.textContent('body');
  assert.ok(!accountsBodyB.includes('STALE Company A Secret Vault'), 'Company A stale wallets must NEVER render in Company B');
  assert.ok(accountsBodyB.includes('Helm Pay BCA') || accountsBodyB.includes('w-pay-idr'), 'Company B must retain its own wallet');
  console.log('Verified: Accounts delayed load race condition cleanly discarded without reload.');

  // 5c. Compliance Calendar Isolation (stale events & stale tax cards across company switch)
  console.log('\n--- Checking Compliance Calendar Isolation (A -> B, zero reload) ---');
  await page.goto(`http://127.0.0.1:${PORT}/business/accountant/calendar`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // 5c-1: Hold Company A calendar events request
  let heldCalendarResolveA = null;
  const heldCalendarPromiseA = new Promise(res => { heldCalendarResolveA = res; });
  let interceptedCalendarA = false;
  let interceptedCalBizIdA = null;
  let interceptedCalendarB = false;

  await page.route('**/api/accountant/calendar', async (route) => {
    const bizHeader = route.request().headers()['x-business-id'];
    if (bizHeader === BIZ_A && !interceptedCalendarA) {
      interceptedCalendarA = true;
      interceptedCalBizIdA = bizHeader;
      console.log(`[Playwright Route Intercept] Intercepted and holding /api/accountant/calendar for Company A (x-business-id: ${bizHeader})...`);
      await heldCalendarPromiseA;
      console.log('[Playwright Route Intercept] Releasing held calendar for Company A...');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { id: 99999, rule_code: 'STALE-RULE-A', title: 'STALE Company A Calendar Event Marker', status: 'upcoming', due_date: '2026-12-31' }
          ],
          active_unverified: 0
        })
      });
    } else if (bizHeader === BIZ_B) {
      interceptedCalendarB = true;
      console.log(`[Playwright Route Intercept] Intercepted /api/accountant/calendar for Company B (x-business-id: ${bizHeader})...`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { id: 77777, rule_code: 'ACTIVE-RULE-B', title: 'CONFIRMED Company B Distinct Calendar Event', status: 'upcoming', due_date: '2026-11-20' }
          ],
          active_unverified: 0
        })
      });
    } else {
      await route.continue();
    }
  });

  // Switch to Company A on calendar
  const calSwitchA = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await calSwitchA.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  await (await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Indonesia")', { timeout: 5000 })).click();
  await page.waitForTimeout(500);

  assert.strictEqual(interceptedCalendarA, true, 'Company A /api/accountant/calendar must be intercepted');
  assert.strictEqual(interceptedCalBizIdA, BIZ_A, 'Intercepted calendar request must carry Company A x-business-id');

  // Switch to Company B via UI switcher without reload
  const calSwitchB = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await calSwitchB.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  await (await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Pay")', { timeout: 5000 })).click();
  
  // Wait for Company B distinct event to render BEFORE releasing Company A
  await page.waitForSelector(':has-text("CONFIRMED Company B Distinct Calendar Event")', { timeout: 8000 });
  const calBodyBeforeRelease = await page.textContent('body');
  assert.ok(calBodyBeforeRelease.includes('CONFIRMED Company B Distinct Calendar Event'), 'Company B distinct event must render BEFORE releasing A response');
  assert.strictEqual(interceptedCalendarB, true, 'Company B calendar request must be received');

  // Now release Company A calendar response
  heldCalendarResolveA();
  await page.waitForTimeout(800);
  await page.unroute('**/api/accountant/calendar');

  const calBodyB = await page.textContent('body');
  assert.ok(calBodyB.includes('CONFIRMED Company B Distinct Calendar Event'), 'Company B events MUST remain preserved after releasing A');
  assert.ok(!calBodyB.includes('STALE Company A Calendar Event Marker'), 'Company A stale calendar events must never render in Company B');
  assert.ok(!calBodyB.includes('STALE-RULE-A'), 'Company A stale rule code must never render in Company B');
  console.log('Verified: Calendar events isolation cleanly protected.');

  // 5c-2: Hold Company A tax cards request across company switch
  let heldCardsResolveA = null;
  const heldCardsPromiseA = new Promise(res => { heldCardsResolveA = res; });
  let interceptedCardsA = false;
  let interceptedCardsBizIdA = null;
  let interceptedCardsB = false;

  await page.route('**/api/accountant/tax-knowledge/cards*', async (route) => {
    const bizHeader = route.request().headers()['x-business-id'];
    if (bizHeader === BIZ_A && !interceptedCardsA) {
      interceptedCardsA = true;
      interceptedCardsBizIdA = bizHeader;
      console.log(`[Playwright Route Intercept] Intercepted and holding tax cards for Company A (x-business-id: ${bizHeader})...`);
      await heldCardsPromiseA;
      console.log('[Playwright Route Intercept] Releasing held tax cards for Company A...');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cards: [
            { topic_id: 'stale-tax-a', rule_code: 'STALE_TAX_A', short_title: 'STALE TAX CARD A EXCLUSIVE', name: 'STALE TAX CARD A EXCLUSIVE', applicability: 'none' }
          ]
        })
      });
    } else if (bizHeader === BIZ_B) {
      interceptedCardsB = true;
      console.log(`[Playwright Route Intercept] Intercepted tax cards for Company B (x-business-id: ${bizHeader})...`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cards: [
            { topic_id: 'active-tax-b', rule_code: 'ACTIVE_TAX_B', short_title: 'CONFIRMED TAX CARD B DISTINCT MARKER', name: 'CONFIRMED TAX CARD B DISTINCT MARKER', applicability: 'mandatory', statutory_basis: 'PMK 168/2023', filing_deadline: '20th', rates_summary: 'TER 0% - 35%' }
          ]
        })
      });
    } else {
      await route.continue();
    }
  });

  // Switch to Company A on calendar
  const cardsSwitchA = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await cardsSwitchA.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  await (await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Indonesia")', { timeout: 5000 })).click();
  await page.waitForTimeout(400);

  // Assert interception and header for Company A tax cards
  assert.strictEqual(interceptedCardsA, true, 'Company A /api/accountant/tax-knowledge/cards must be intercepted');
  assert.strictEqual(interceptedCardsBizIdA, BIZ_A, 'Intercepted tax cards request must carry Company A x-business-id');

  // Switch immediately to Company B without reload
  const cardsSwitchB = await page.waitForSelector('.cfo-switch', { timeout: 5000 });
  await cardsSwitchB.click();
  await page.waitForSelector('.cfo-switch-menu', { timeout: 5000 });
  await (await page.waitForSelector('.cfo-switch-opt:has-text("Helm Care Pay")', { timeout: 5000 })).click();
  
  // Wait for Company B distinct card marker to render BEFORE releasing Company A response
  await page.waitForSelector(':has-text("CONFIRMED TAX CARD B DISTINCT MARKER")', { timeout: 8000 });
  const calCardsBeforeRelease = await page.textContent('body');
  assert.ok(calCardsBeforeRelease.includes('CONFIRMED TAX CARD B DISTINCT MARKER'), 'Company B distinct tax card must render BEFORE releasing A response');
  assert.strictEqual(interceptedCardsB, true, 'Company B tax cards request must be received');

  // Now release Company A's held tax cards response
  heldCardsResolveA();
  await page.waitForTimeout(800);
  await page.unroute('**/api/accountant/tax-knowledge/cards*');

  const calBodyAfterCards = await page.textContent('body');
  assert.ok(calBodyAfterCards.includes('CONFIRMED TAX CARD B DISTINCT MARKER'), 'Company B distinct tax card MUST remain preserved after releasing A');
  assert.ok(!calBodyAfterCards.includes('STALE TAX CARD A EXCLUSIVE'), 'Company A stale tax card must never render in Company B');
  assert.ok(!calBodyAfterCards.includes('STALE_TAX_A'), 'Company A stale rule code must never render in Company B');
  console.log('Verified: Tax cards isolation across company switch cleanly protected.');

  // 5d. Verify Modal Auto-Close on Company Switch without clicking Cancel
  console.log('\n--- Checking Modal Auto-Close on Company Switch ---');
  await page.goto(`http://127.0.0.1:${PORT}/business/accounts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const openTransferBtnInB = await page.waitForSelector('#open-wallet-transfer-btn', { timeout: 5000 });
  await openTransferBtnInB.click();
  await page.waitForSelector('.cfo-modal', { timeout: 5000 });
  assert.ok((await page.$('.cfo-modal')) !== null, 'Transfer modal must be opened');

  // Trigger company switch while modal is open via workspace-switch event
  await page.evaluate(({ bizA }) => {
    window.dispatchEvent(new CustomEvent('workspace-switch', { detail: { id: bizA } }));
  }, { bizA: BIZ_A });

  // Wait for React effect [active?.id, scopeKey] to automatically close the modal
  await page.waitForTimeout(800);
  const modalAfterSwitch = await page.$('.cfo-modal');
  assert.strictEqual(modalAfterSwitch, null, 'Transfer modal must close automatically upon company switch without manual Cancel click');
  console.log('Verified: Transfer modal auto-closes on company switch without Cancel click.');

  // 5e. Test Switcher window.__cfoSwitchTo Build-Gating Restriction
  console.log('\n--- Checking window.__cfoSwitchTo Build-Gating Restriction & Cleanup ---');
  // 5e-1: Normal Production Build Verification
  const prodCtx = await browser.newContext();
  const prodPage = await prodCtx.newPage();
  await prodPage.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await prodPage.evaluate(({ token, bizA }) => {
    localStorage.setItem('hf_token', token);
    localStorage.setItem('activeWorkspaceId', bizA);
    localStorage.setItem('activeBusinessId', bizA);
    localStorage.setItem('__cfo_test__', '1');
    window.__CFO_TEST_MODE__ = true;
    window.__PLAYWRIGHT_TEST__ = true;
  }, { token: testToken, bizA: BIZ_A });
  await prodPage.goto(`http://127.0.0.1:${PORT}/business/pulse`, { waitUntil: 'networkidle' });

  // In production build, window.__cfoSwitchTo must remain undefined despite flags
  const prodInitial = await prodPage.evaluate(() => typeof window.__cfoSwitchTo);
  assert.strictEqual(prodInitial, 'undefined', 'window.__cfoSwitchTo must NOT exist in production build initially');

  // Reload page to verify persistence with flags
  await prodPage.reload({ waitUntil: 'networkidle' });
  const prodAfterReload = await prodPage.evaluate(() => typeof window.__cfoSwitchTo);
  assert.strictEqual(prodAfterReload, 'undefined', 'window.__cfoSwitchTo must NOT exist in production build even after reload with test flags in localStorage/window');
  await prodPage.close();
  await prodCtx.close();
  console.log('Verified: Production build strictly omits window.__cfoSwitchTo (runtime flags cannot bypass).');

  // 5e-2: Test Build Verification (built with MODE === "test")
  console.log('Building temporary test-mode client (vite build --mode test)...');
  const cp = require('child_process');
  const distTestDir = path.join(ROOT, 'client', 'dist-test');
  if (fs.existsSync(distTestDir)) fs.rmSync(distTestDir, { recursive: true, force: true });
  cp.execSync('node client/node_modules/vite/bin/vite.js build client --mode test --outDir dist-test', { cwd: ROOT });

  const TEST_PORT = 5192;
  const testServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const proxyReq = http.request(`http://127.0.0.1:${PORT}${req.url}`, {
        method: req.method,
        headers: req.headers
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      req.pipe(proxyReq);
      return;
    }
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || !reqPath.includes('.')) reqPath = '/index.html';
    const filePath = path.join(distTestDir, reqPath);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const ct = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(fs.readFileSync(filePath));
    } else {
      const indexPath = path.join(distTestDir, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(indexPath));
    }
  });

  await new Promise(res => testServer.listen(TEST_PORT, '127.0.0.1', res));
  console.log(`Test-build server listening on http://127.0.0.1:${TEST_PORT}`);

  try {
    const testCtx = await browser.newContext();
    const testPage = await testCtx.newPage();
    await testPage.goto(`http://127.0.0.1:${TEST_PORT}/login`, { waitUntil: 'domcontentloaded' });
    await testPage.evaluate(({ token, bizA }) => {
      localStorage.setItem('hf_token', token);
      localStorage.setItem('activeWorkspaceId', bizA);
      localStorage.setItem('activeBusinessId', bizA);
      localStorage.setItem('last_active_workspace_id', bizA);
    }, { token: testToken, bizA: BIZ_A });

    await testPage.goto(`http://127.0.0.1:${TEST_PORT}/business/pulse`, { waitUntil: 'networkidle' });
    const testExposed = await testPage.evaluate(() => typeof window.__cfoSwitchTo);
    assert.strictEqual(testExposed, 'function', 'window.__cfoSwitchTo MUST be exposed in test build (import.meta.env.MODE === "test")');

    // Verify it actually invokes WorkspaceProvider.switchTo
    await testPage.evaluate(({ bizB }) => {
      window.__cfoSwitchTo(bizB);
    }, { bizB: BIZ_B });
    await testPage.waitForTimeout(600);
    const activeStored = await testPage.evaluate(() => localStorage.getItem('activeWorkspaceId'));
    assert.strictEqual(activeStored, BIZ_B, 'Calling window.__cfoSwitchTo must switch active workspace to Company B');

    // Verify cleanup upon unmount: navigating to /login (which renders outside WorkspaceProvider) unmounts WorkspaceProvider
    await testPage.goto(`http://127.0.0.1:${TEST_PORT}/login`, { waitUntil: 'domcontentloaded' });
    await testPage.waitForTimeout(400);
    const afterUnmount = await testPage.evaluate(() => typeof window.__cfoSwitchTo);
    assert.strictEqual(afterUnmount, 'undefined', 'window.__cfoSwitchTo must be deleted when WorkspaceProvider unmounts');

    await testPage.close();
    await testCtx.close();
    console.log('Verified: Test build successfully exposes window.__cfoSwitchTo, invokes WorkspaceProvider, and cleans up on unmount.');
  } finally {
    testServer.close();
    if (fs.existsSync(distTestDir)) {
      fs.rmSync(distTestDir, { recursive: true, force: true });
    }
    console.log('Cleaned up temporary test-build artifacts.');
  }

  // 5f. Tax Knowledge Cards Error Matrix across Screens and Languages (Accountant & Calendar × RU/EN/ID)
  console.log('\n--- Checking Comprehensive Tax Cards Error Matrix (Accountant & Calendar × RU/EN/ID) ---');
  const screens = [
    { name: 'Accountant', url: `http://127.0.0.1:${PORT}/business/accountant` },
    { name: 'Calendar', url: `http://127.0.0.1:${PORT}/business/accountant/calendar` }
  ];
  const languages = ['en', 'ru', 'id'];

  for (const sc of screens) {
    for (const lang of languages) {
      console.log(`Testing Error Matrix on ${sc.name} (${lang.toUpperCase()})...`);
      await page.evaluate((l) => { localStorage.setItem('hf_lang', l); }, lang);

      // 1. 401 Unauthorized
      await page.route('**/api/accountant/tax-knowledge/cards*', async route => {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
      });
      await page.goto(sc.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      let content = await page.textContent('body');
      assert.ok(content.includes(lang === 'ru' ? 'Доступ запрещён' : lang === 'id' ? 'Akses ditolak' : 'Access denied'), `${sc.name} (${lang}): 401 must show Access denied banner`);
      let cardsCount = (await page.$$('.tax-card')).length;
      assert.strictEqual(cardsCount, 0, `${sc.name} (${lang}): 401 must not display any cards or fallback snapshot`);
      await page.unroute('**/api/accountant/tax-knowledge/cards*');

      // 2. 403 Forbidden
      await page.route('**/api/accountant/tax-knowledge/cards*', async route => {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) });
      });
      await page.goto(sc.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      content = await page.textContent('body');
      assert.ok(content.includes(lang === 'ru' ? 'Доступ запрещён' : lang === 'id' ? 'Akses ditolak' : 'Access denied'), `${sc.name} (${lang}): 403 must show Access denied banner`);
      cardsCount = (await page.$$('.tax-card')).length;
      assert.strictEqual(cardsCount, 0, `${sc.name} (${lang}): 403 must not display any cards or fallback snapshot`);
      await page.unroute('**/api/accountant/tax-knowledge/cards*');

      // 3. 500 Server Error + Retry Click
      let failServer = true;
      await page.route('**/api/accountant/tax-knowledge/cards*', async route => {
        if (failServer) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) });
        } else {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [
            { topic_id: 'pph21', rule_code: 'PPh 21', name: 'PPh 21 Retried', short_title: 'PPh 21 Retried', applicability: 'mandatory', statutory_basis: 'PMK 168/2023', filing_deadline: '20th', rates_summary: 'TER 0% - 35%' }
          ] }) });
        }
      });
      await page.goto(sc.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      content = await page.textContent('body');
      assert.ok(content.includes(lang === 'ru' ? 'Ошибка сервиса' : lang === 'id' ? 'kesalahan pada layanan' : 'service error'), `${sc.name} (${lang}): 500 must show server error banner`);
      cardsCount = (await page.$$('.tax-card')).length;
      assert.strictEqual(cardsCount, 0, `${sc.name} (${lang}): 500 must not display cards before retry`);

      failServer = false;
      const retryBtn = await page.waitForSelector('button:has-text("Retry"), button:has-text("Повторить"), button:has-text("Coba lagi")', { timeout: 5000 });
      await retryBtn.click();
      await page.waitForTimeout(600);
      content = await page.textContent('body');
      assert.ok(!content.includes(lang === 'ru' ? 'Ошибка сервиса' : lang === 'id' ? 'kesalahan pada layanan' : 'service error'), `${sc.name} (${lang}): 500 error must clear after retry`);
      cardsCount = (await page.$$('.tax-card')).length;
      assert.ok(cardsCount >= 1, `${sc.name} (${lang}): Cards must render after successful retry`);
      await page.unroute('**/api/accountant/tax-knowledge/cards*');

      // 4. Offline Network Error
      await page.route('**/api/accountant/tax-knowledge/cards*', async route => {
        await route.abort('failed');
      });
      await page.goto(sc.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      content = await page.textContent('body');
      assert.ok(content.includes(lang === 'ru' ? 'офлайн-справочник' : lang === 'id' ? 'cadangan offline' : 'Offline backup'), `${sc.name} (${lang}): Network failure must show offline backup dictionary banner`);
      cardsCount = (await page.$$('.tax-card')).length;
      assert.ok(cardsCount >= 1, `${sc.name} (${lang}): Offline mode must render backup dictionary cards`);
      await page.unroute('**/api/accountant/tax-knowledge/cards*');

      // 5. Successful Empty List
      await page.route('**/api/accountant/tax-knowledge/cards*', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [] }) });
      });
      await page.goto(sc.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      content = await page.textContent('body');
      assert.ok(content.includes(lang === 'ru' ? 'карточки отсутствуют' : lang === 'id' ? 'Tidak ada kartu' : 'No tax knowledge cards'), `${sc.name} (${lang}): Empty list must show empty state text`);
      cardsCount = (await page.$$('.tax-card')).length;
      assert.strictEqual(cardsCount, 0, `${sc.name} (${lang}): Empty list must render 0 cards`);
      await page.unroute('**/api/accountant/tax-knowledge/cards*');

      // 6. Malformed Response
      await page.route('**/api/accountant/tax-knowledge/cards*', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrupt: true }) });
      });
      await page.goto(sc.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      content = await page.textContent('body');
      assert.ok(content.includes(lang === 'ru' ? 'некорректный формат' : lang === 'id' ? 'format data tidak sesuai' : 'unexpected response format'), `${sc.name} (${lang}): Malformed response must show format notice`);
      cardsCount = (await page.$$('.tax-card')).length;
      assert.strictEqual(cardsCount, 0, `${sc.name} (${lang}): Malformed response must render 0 cards`);
      await page.unroute('**/api/accountant/tax-knowledge/cards*');
    }
  }
  console.log('Verified: Comprehensive Tax Cards Error Matrix successfully passed for both screens in RU, EN, and ID.');

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

  // Save browser console logs to scratch/logs/browser_console.log
  const logsDir = path.join(ROOT, 'scratch', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'browser_console.log'), browserConsoleLogs.join('\n'));
  console.log('Saved browser console logs to scratch/logs/browser_console.log');

  const unexpectedErrors = pageErrors.filter(e => !e.includes('net::ERR_FAILED') && !e.includes('Failed to fetch'));
  assert.strictEqual(unexpectedErrors.length, 0, `Zero unexpected page errors allowed, found: ${JSON.stringify(unexpectedErrors)}`);

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
    console.log('\nProcess finished with exit code: 0');
    acceptanceLogStream.end(() => {
      process.exit(0);
    });
  } catch (err) {
    console.error('Acceptance run FAILED:', err);
    console.error('\nProcess finished with exit code: 1');
    acceptanceLogStream.end(() => {
      process.exit(1);
    });
  }
}, 1000);
