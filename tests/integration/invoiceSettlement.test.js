// Invoice settlement endpoints — scoping, partial state and duplicate protection.
// Boots the REAL server/index.js over the in-memory supabase shim, drives real HTTP.
//
// Run: node tests/integration/invoiceSettlement.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'settlement-test-secret', TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5605', NODE_ENV: 'test',
});
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';   // user is NOT a member
const P = '44444444-4444-4444-4444-444444444444';   // personal
const USER = 920101;

mem.__seed('businesses', [
  { id: A, name: 'A', type: 'company', owner_user_id: USER, created_at: '2026-01-01' },
  { id: B, name: 'B', type: 'company', owner_user_id: 999, created_at: '2026-01-02' },
  { id: P, name: 'Personal', type: 'personal', owner_user_id: USER, created_at: '2026-01-03' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: USER, business_id: A, role: 'owner', status: 'active' },
  { id: 3, user_id: USER, business_id: P, role: 'owner', status: 'active' },
]);

// The Circleka sample, partially paid.
mem.__seed('debts', [
  { id: 501, business_id: A, type: 'payable', counterparty: 'PT Circleka Indonesia Utama',
    description: 'Rent space X2610001139', amount: 143856000, original_amount: 143856000,
    paid_amount: 29600000, status: 'partial', currency: 'IDR' },
  { id: 502, business_id: B, type: 'payable', counterparty: 'Other Co',
    amount: 1000, original_amount: 1000, paid_amount: 0, status: 'open' },
]);
mem.__seed('transactions', [
  { id: 9001, business_id: A, type: 'expense', amount_original: 29600000, description: 'Payment: Circleka' },
  { id: 9002, business_id: A, type: 'expense', amount_original: 50000000, description: 'Payment 2: Circleka' },
  { id: 9003, business_id: B, type: 'expense', amount_original: 500, description: 'Other business payment' },
]);
mem.__seed('financial_documents', [
  { id: 'doc-inv-A', business_id: A, document_type: 'vendor_invoice', document_number: 'X2610001139',
    commercial_base_amount: 129600000, commercial_tax_amount: 14256000, gross_amount: 143856000 },
  { id: 'doc-proof-A', business_id: A, document_type: 'payment_proof',
    extracted_json: { bank_name: 'BCA', reference_number: '26090400308936' } },
  { id: 'doc-B', business_id: B, document_type: 'payment_proof', extracted_json: {} },
]);
mem.__seed('document_debt_links', [
  { id: 'l1', business_id: A, document_id: 'doc-inv-A', debt_id: 501 },
  { id: 'l2', business_id: A, document_id: 'doc-proof-A', debt_id: 501 },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
async function call(method, p, { user = USER, biz, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}
const allocs = () => mem.__db.debt_settlement_allocations || [];

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  console.log('\nSettlement state');
  await t('reports the Circleka sample as partially paid with the right remainder', async () => {
    const r = await call('GET', '/invoices/501/settlement', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    const s = r.body.settlement;
    assert.strictEqual(s.invoice_total, 143856000);
    assert.strictEqual(s.paid_amount, 29600000);
    assert.strictEqual(s.remaining_amount, 114256000);
    assert.strictEqual(s.status, 'partially_paid');
    assert.strictEqual(s.base_view.base_remaining, 100000000, 'base-only context');
  });

  await t('a partially paid invoice cannot be closed, and says why', async () => {
    const r = await call('GET', '/invoices/501/settlement', { biz: A });
    assert.strictEqual(r.body.closeout.can_close, false);
    assert.strictEqual(r.body.closeout.state, 'Partially paid');
    assert.ok(r.body.closeout.blockers.some((b) => /Remaining balance: 114256000/.test(b)));
  });

  await t('the document checklist reflects what is actually attached', async () => {
    const d = (await call('GET', '/invoices/501/settlement', { biz: A })).body.documents;
    assert.strictEqual(d.invoice, true);
    assert.strictEqual(d.payment_proof, true);
    assert.strictEqual(d.tax_invoice, false);
    assert.strictEqual(d.accountant_confirmation, false);
  });

  console.log('\nAllocation + duplicate protection');
  await t('records an allocation for a transaction in this business', async () => {
    const before = allocs().length;
    const r = await call('POST', '/invoices/501/allocate', { biz: A,
      body: { transaction_id: 9001, allocated_amount: 29600000, document_id: 'doc-proof-A' } });
    assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert.strictEqual(allocs().length, before + 1);
    assert.strictEqual(Number(r.body.allocation.allocated_amount), 29600000);
  });

  await t('the same transaction cannot be allocated twice to the same invoice', async () => {
    const before = allocs().length;
    const r = await call('POST', '/invoices/501/allocate', { biz: A,
      body: { transaction_id: 9001, allocated_amount: 29600000 } });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'transaction_already_allocated_to_this_invoice');
    assert.strictEqual(allocs().length, before, 'no duplicate row may be written');
  });

  await t('an allocation exceeding the invoice total is refused', async () => {
    const before = allocs().length;
    const r = await call('POST', '/invoices/501/allocate', { biz: A,
      body: { transaction_id: 9002, allocated_amount: 200000000 } });
    assert.strictEqual(r.status, 400, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'allocation_exceeds_invoice_total');
    assert.strictEqual(allocs().length, before);
  });

  await t('a non-positive allocation is refused', async () => {
    const r = await call('POST', '/invoices/501/allocate', { biz: A, body: { transaction_id: 9002, allocated_amount: 0 } });
    assert.strictEqual(r.status, 400, `status ${r.status}`);
  });

  console.log('\nIsolation');
  await t('8. an invoice from another business returns 404', async () => {
    const r = await call('GET', '/invoices/502/settlement', { biz: A });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'invoice_not_found_in_this_business');
  });

  await t('8b. a transaction from another business cannot settle our invoice', async () => {
    const before = allocs().length;
    const r = await call('POST', '/invoices/501/allocate', { biz: A,
      body: { transaction_id: 9003, allocated_amount: 500 } });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'transaction_not_found_in_this_business');
    assert.strictEqual(allocs().length, before);
  });

  await t('8c. a document from another business cannot be attached', async () => {
    const r = await call('POST', '/invoices/501/allocate', { biz: A,
      body: { transaction_id: 9002, allocated_amount: 1000, document_id: 'doc-B' } });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'document_not_found_in_this_business');
  });

  await t('8d. a non-member business is refused outright', async () => {
    const r = await call('GET', '/invoices/502/settlement', { biz: B });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'workspace_not_accessible');
  });

  await t('9. a personal workspace is refused', async () => {
    const r = await call('GET', '/invoices/501/settlement', { biz: P });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'business_workspace_required');
  });

  await t('unauthenticated is refused', async () => {
    const r = await call('GET', '/invoices/501/settlement', { user: null });
    assert.strictEqual(r.status, 401, `status ${r.status}`);
  });

  await t('nothing leaked into business B', async () => {
    assert.ok(!allocs().some((a) => a.business_id === B), 'allocation written to B');
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
