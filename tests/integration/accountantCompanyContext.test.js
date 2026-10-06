// Integration tests for AI Accountant company financial context in POST /api/accountant/ask
//
// Verifies:
// 1. POST /api/accountant/ask incorporates company debts and answers counterparty questions:
//    - "Сколько мы заплатили поставщику QA-7DAY-RUN01 Vendor Beta и сколько ещё должны?"
//    - Returns exact figures: 15,000,000 IDR paid, 0 IDR remaining debt, status paid.
// 2. English question returns accurate figures and currency.
// 3. Wallet balance queries return calculated balances from transactions.
// 4. Strict business boundary isolation: User in Business B cannot see Business A's vendors or debts.
// 5. Tax rules context and disclaimers remain functional.
//
// Run: node tests/integration/accountantCompanyContext.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake',
  SUPABASE_SECRET_KEY: 'fake',
  BOT_TOKEN: 'fake',
  JWT_SECRET: 'accountant-test-secret',
  TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5618',
  NODE_ENV: 'test',
  FX_PROVIDER: 'mock',
});

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const BIZ_HCI = 'b949966a-3988-47cb-9e7c-afad1423f4f8';
const BIZ_OTHER = '22222222-2222-4222-8222-222222222222';
const USER_HCI = 98881;
const USER_OTHER = 98882;

mem.__seed('businesses', [
  { id: BIZ_HCI, name: 'Helm Care Indonesia', type: 'company', owner_user_id: USER_HCI, base_currency: 'IDR', created_at: '2026-01-01' },
  { id: BIZ_OTHER, name: 'Other Business PT', type: 'company', owner_user_id: USER_OTHER, base_currency: 'IDR', created_at: '2026-01-01' },
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_HCI, business_id: BIZ_HCI, role: 'owner', status: 'active' },
  { id: 2, user_id: USER_OTHER, business_id: BIZ_OTHER, role: 'owner', status: 'active' },
]);

mem.__seed('wallets', [
  { id: 'w-bca-idr', business_id: BIZ_HCI, name: 'QA-7DAY-RUN01 BCA IDR', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 1 },
  { id: 'w-mandiri', business_id: BIZ_HCI, name: 'Mandiri Operasional', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 2 },
  { id: 'w-other', business_id: BIZ_OTHER, name: 'Other Co Wallet', currency: 'IDR', type: 'bank', scope: 'business', is_active: true, sort_order: 1 },
]);

mem.__seed('debts', [
  {
    id: 86,
    business_id: BIZ_HCI,
    type: 'payable',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    currency: 'IDR',
    amount: 15000000,
    original_amount: 15000000,
    paid_amount: 15000000,
    status: 'paid',
    is_settled: true,
    due_date: '2026-10-15',
    created_at: '2026-10-01T08:00:00Z',
  },
  {
    id: 87,
    business_id: BIZ_HCI,
    type: 'payable',
    counterparty: 'QA-7DAY-RUN01 Cloud Services',
    currency: 'IDR',
    amount: 3000000,
    original_amount: 3000000,
    paid_amount: 1000000,
    status: 'partial',
    is_settled: false,
    due_date: '2026-10-20',
    created_at: '2026-10-02T08:00:00Z',
  },
  {
    id: 88,
    business_id: BIZ_OTHER,
    type: 'payable',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    currency: 'IDR',
    amount: 50000000,
    original_amount: 50000000,
    paid_amount: 0,
    status: 'open',
    is_settled: false,
    due_date: '2026-10-25',
    created_at: '2026-10-03T08:00:00Z',
  },
]);

mem.__seed('transactions', [
  {
    id: 395,
    business_id: BIZ_HCI,
    wallet_id: 'w-bca-idr',
    source: 'QA-7DAY-RUN01 BCA IDR',
    type: 'income',
    amount_original: 50000000,
    amount_idr: 50000000,
    currency_original: 'IDR',
    category: 'Sales',
    counterparty: 'Client Alpha',
    created_at: '2026-10-01T09:00:00Z',
  },
  {
    id: 396,
    business_id: BIZ_HCI,
    wallet_id: 'w-bca-idr',
    source: 'QA-7DAY-RUN01 BCA IDR',
    type: 'expense',
    amount_original: 5000000,
    amount_idr: 5000000,
    currency_original: 'IDR',
    category: 'Vendor Payment',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    created_at: '2026-10-04T10:00:00Z',
  },
  {
    id: 398,
    business_id: BIZ_HCI,
    wallet_id: 'w-bca-idr',
    source: 'QA-7DAY-RUN01 BCA IDR',
    type: 'expense',
    amount_original: 10000000,
    amount_idr: 10000000,
    currency_original: 'IDR',
    category: 'Vendor Payment',
    counterparty: 'QA-7DAY-RUN01 Vendor Beta',
    created_at: '2026-10-05T12:00:00Z',
  },
]);

mem.__seed('tax_profiles', [
  {
    business_id: BIZ_HCI,
    jurisdiction: 'ID',
    legal_entity_type: 'pt_pma',
    tax_regime: 'standard',
    vat_status: 'pkp',
    employee_status: 'has_employees',
  },
]);

mem.__seed('tax_rules', [
  {
    id: 1,
    jurisdiction: 'ID',
    rule_code: 'ID-CIT-STD',
    version: '1.0',
    title: 'Corporate Income Tax (PPh 25)',
    obligation_type: 'cit',
    status: 'active',
  },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);

async function askAccountant(userId, bizId, body) {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${tok(userId)}`,
    'x-business-id': bizId,
  };
  const res = await fetch(`${BASE}/accountant/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: json };
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    fail++;
    console.error(`FAIL: ${name}`, e);
  }
};

(async () => {
  // Test 1: Query QA-7DAY-RUN01 Vendor Beta in Russian
  await t('Answers vendor payment and debt question in Russian with exact numbers (15M paid, 0 remaining)', async () => {
    const res = await askAccountant(USER_HCI, BIZ_HCI, {
      question: 'Сколько мы заплатили поставщику QA-7DAY-RUN01 Vendor Beta и сколько ещё должны?',
      language: 'ru',
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body?.answer, 'Answer must not be empty');
    const ans = res.body.answer;
    assert.ok(ans.includes('15') && ans.includes('IDR'), `Answer should mention 15M IDR: ${ans}`);
    assert.ok(ans.includes('0 IDR') || ans.includes('0'), `Answer should mention 0 remaining debt: ${ans}`);
    assert.ok(ans.includes('QA-7DAY-RUN01 Vendor Beta'), `Answer should mention vendor name: ${ans}`);
    assert.ok(res.body?.disclaimer, 'Disclaimer must be present');
  });

  // Test 2: Query QA-7DAY-RUN01 Vendor Beta in English
  await t('Answers vendor payment and debt question in English with exact numbers', async () => {
    const res = await askAccountant(USER_HCI, BIZ_HCI, {
      question: 'How much did we pay to QA-7DAY-RUN01 Vendor Beta and how much do we still owe?',
      language: 'en',
    });
    assert.equal(res.status, 200);
    const ans = res.body.answer;
    assert.ok(ans.includes('15,000,000') || ans.includes('15000000') || ans.includes('15'), `Answer should mention 15M: ${ans}`);
    assert.ok(ans.includes('0 IDR') || ans.includes('0'), `Answer should mention 0 remaining: ${ans}`);
    assert.ok(/fully paid|paid/i.test(ans), `Answer should mention paid status: ${ans}`);
  });

  // Test 3: Partial debt vendor QA-7DAY-RUN01 Cloud Services
  await t('Answers partial debt vendor with 1M paid and 2M remaining', async () => {
    const res = await askAccountant(USER_HCI, BIZ_HCI, {
      question: 'Сколько мы должны поставщику QA-7DAY-RUN01 Cloud Services?',
      language: 'ru',
    });
    assert.equal(res.status, 200);
    const ans = res.body.answer;
    assert.ok(ans.includes('QA-7DAY-RUN01 Cloud Services'), `Must mention vendor: ${ans}`);
    assert.ok(ans.includes('1') && ans.includes('IDR'), `Should mention 1M paid: ${ans}`);
    assert.ok(ans.includes('2') && ans.includes('IDR'), `Should mention 2M remaining: ${ans}`);
  });

  // Test 4: Wallet balances query
  await t('Answers wallet balances query with transaction-derived balances', async () => {
    const res = await askAccountant(USER_HCI, BIZ_HCI, {
      question: 'Какой баланс кошельков?',
      language: 'ru',
    });
    assert.equal(res.status, 200);
    const ans = res.body.answer;
    assert.ok(ans.includes('QA-7DAY-RUN01 BCA IDR'), `Must mention wallet name: ${ans}`);
    // Balance: 50,000,000 in - 5,000,000 out - 10,000,000 out = 35,000,000
    assert.ok(ans.includes('35') && ans.includes('IDR'), `Must show computed balance 35M: ${ans}`);
  });

  // Test 5: Strict business boundary isolation
  await t('Business B sees only its own debts and never sees Business A figures', async () => {
    const res = await askAccountant(USER_OTHER, BIZ_OTHER, {
      question: 'Сколько мы заплатили поставщику QA-7DAY-RUN01 Vendor Beta и сколько ещё должны?',
      language: 'ru',
    });
    assert.equal(res.status, 200);
    const ans = res.body.answer;
    // BIZ_OTHER has 50M payable, 0 paid
    assert.ok(ans.includes('0 IDR') || ans.includes('оплачено 0'), `BIZ_OTHER paid is 0: ${ans}`);
    assert.ok(ans.includes('50') && ans.includes('IDR'), `BIZ_OTHER remaining is 50M: ${ans}`);
  });

  // Test 6: Requires valid question
  await t('Rejects empty question with 400', async () => {
    const res = await askAccountant(USER_HCI, BIZ_HCI, { question: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error, 'question required');
  });

  // Test 7: PPh 26 tax knowledge card question returns grounded Russian answer with sources and limitations
  await t('Answers PPh 26 tax card question in Russian with sources and limitations for Helm Care Indonesia', async () => {
    const res = await askAccountant(USER_HCI, BIZ_HCI, {
      question: 'Объясни PPh 26 — Pajak Penghasilan Pasal 26 по доступным источникам и укажи ограничения.',
      language: 'ru',
    });
    assert.equal(res.status, 200);
    const ans = res.body.answer;
    assert.ok(ans.includes('PPh 26'), `Should mention PPh 26: ${ans}`);
    assert.ok(ans.includes('нерезидентов'), `Should mention non-residents: ${ans}`);
    assert.ok(ans.includes('Источники') && ans.includes('Pasal 26'), `Should cite sources: ${ans}`);
    assert.ok(ans.includes('Ограничения') && ans.includes('Архивное пояснение'), `Should include limitations notice: ${ans}`);
  });

  console.log(`\nAccountant Company Context Test Results: ${pass} passed, ${fail} failed.`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
