// Unit tests for match-candidate scoring (pure, deterministic, no I/O).
// Run: node --test tests/incomingPaymentMatching.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../server/lib/incomingPaymentMatching');

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const payment = (o = {}) => ({
  id: 'pay-1', business_id: BIZ_A, gross_amount: 1000000, net_amount: 1000000, currency: 'IDR',
  transaction_at: '2026-08-10T00:00:00.000Z', payer_name: 'PT Maju Jaya',
  payer_reference: 'INV-100', description: 'transfer', ...o,
});
const debt = (o = {}) => ({
  id: 11, business_id: BIZ_A, type: 'receivable', status: 'open', remaining_amount: 1000000,
  due_date: '2026-08-10', counterparty: 'PT Maju Jaya', currency: 'IDR', ...o,
});
const tx = (o = {}) => ({
  id: 21, business_id: BIZ_A, type: 'income', amount_idr: 1000000,
  transaction_date: '2026-08-10', counterparty_name: 'PT Maju Jaya', currency_original: 'IDR', ...o,
});
const build = (p, sets) => M.buildCandidates(p, sets);

// ── Business isolation (the one that must never fail) ────────────────────────────────────
test('a receivable from ANOTHER business is never a candidate', () => {
  const out = build(payment(), { debts: [debt({ business_id: BIZ_B })] });
  assert.strictEqual(out.length, 0, "another company's receivable was proposed");
});

test('a transaction from ANOTHER business is never a candidate', () => {
  assert.strictEqual(build(payment(), { transactions: [tx({ business_id: BIZ_B })] }).length, 0);
});

test('a perfect same-business match still needs the business to agree', () => {
  assert.strictEqual(build(payment(), { debts: [debt()] }).length, 1);
  assert.strictEqual(build(payment({ business_id: BIZ_B }), { debts: [debt()] }).length, 0);
});

test('a payment with no business produces nothing', () => {
  assert.strictEqual(build(payment({ business_id: null }), { debts: [debt()] }).length, 0);
  assert.strictEqual(M.buildCandidates(null, { debts: [debt()] }).length, 0);
});

// ── What may be a target ─────────────────────────────────────────────────────────────────
test('payables are never candidates — incoming money does not settle what we owe', () => {
  assert.strictEqual(build(payment(), { debts: [debt({ type: 'payable' })] }).length, 0);
});

test('settled or paid receivables are skipped', () => {
  assert.strictEqual(build(payment(), { debts: [debt({ status: 'paid' })] }).length, 0);
  assert.strictEqual(build(payment(), { debts: [debt({ is_settled: true })] }).length, 0);
});

test('only income transactions are candidates', () => {
  assert.strictEqual(build(payment(), { transactions: [tx({ type: 'expense' })] }).length, 0);
  assert.strictEqual(build(payment(), { transactions: [tx({ type: 'income' })] }).length, 1);
});

test('there is no invoice target — invoices do not exist in production', () => {
  const out = build(payment(), { debts: [debt()], transactions: [tx()] });
  assert.ok(out.every((c) => ['debt', 'transaction'].includes(c.target_type)));
});

// ── Amount ───────────────────────────────────────────────────────────────────────────────
test('an exact amount scores highest and says so', () => {
  const [c] = build(payment(), { debts: [debt({ remaining_amount: 1000000 })] });
  assert.ok(c.match_reasons.some((r) => r.key === 'amount_exact'));
});

test('NET is compared as well as gross — the fee side is not assumed', () => {
  // The receivable is for the net that landed; which side absorbs the gateway fee is exactly
  // what we do not know yet, so both are tried.
  const p = payment({ gross_amount: 1000000, net_amount: 967810 });
  const [c] = build(p, { debts: [debt({ remaining_amount: 967810 })] });
  assert.ok(c, 'a net-amount match was not proposed');
  assert.ok(c.match_reasons.some((r) => r.key === 'amount_exact' && /net/.test(r.detail)));
});

test('a wildly different amount is not proposed at all', () => {
  assert.strictEqual(build(payment(), { debts: [debt({ remaining_amount: 17 })] }).length, 0);
});

test('a near amount scores lower than an exact one', () => {
  const exact = build(payment(), { debts: [debt({ id: 1, remaining_amount: 1000000 })] })[0];
  const near = build(payment(), { debts: [debt({ id: 2, remaining_amount: 1004000 })] })[0];
  assert.ok(near.score < exact.score, 'a 0.4% gap scored as well as an exact match');
});

test('amount comparison runs in cents, not floats', () => {
  const p = payment({ gross_amount: 0.3, net_amount: 0.3 });
  const [c] = build(p, { debts: [debt({ remaining_amount: 0.3 })] });
  assert.ok(c.match_reasons.some((r) => r.key === 'amount_exact'));
});

// ── Date ─────────────────────────────────────────────────────────────────────────────────
test('same-day scores full, far-apart is dropped', () => {
  assert.strictEqual(M.scoreDate('2026-08-10', '2026-08-10').score, 1);
  assert.strictEqual(M.scoreDate('2026-08-10', '2026-12-01').score, 0);
  const near = M.scoreDate('2026-08-10', '2026-08-17');
  assert.ok(near.score > 0 && near.score < 1);
  assert.match(near.reason.detail, /days apart/);
});

test('a missing date neither helps nor throws', () => {
  assert.strictEqual(M.scoreDate(null, '2026-08-10').score, 0);
  assert.strictEqual(M.scoreDate('nonsense', '2026-08-10').score, 0);
});

// ── Reference / payer ────────────────────────────────────────────────────────────────────
test('an exact reference is the strongest non-amount signal', () => {
  const r = M.scoreReference({ payer_reference: 'INV-100' }, { reference: 'inv 100' });
  assert.strictEqual(r.score, 1);
  assert.strictEqual(r.reason.key, 'reference_exact');
});

test('payer names match on whole words, so different customers stay different', () => {
  // "PT Maju" must not match "PT Maju Jaya Abadi" just because one contains the other.
  const partial = M.scoreReference({ payer_name: 'PT Maju' }, { counterparty: 'PT Maju Jaya Abadi' });
  assert.ok(partial.score < 1, 'a substring was treated as a full payer match');
  const exact = M.scoreReference({ payer_name: 'PT Maju Jaya' }, { counterparty: 'pt maju jaya' });
  assert.strictEqual(exact.score, 1);
});

test('a description mentioning the counterparty is weak corroboration only', () => {
  const r = M.scoreReference({ description: 'payment from pt maju jaya' }, { counterparty: 'PT Maju Jaya' });
  assert.ok(r.score > 0 && r.score < 1);
  assert.strictEqual(r.reason.key, 'description_mentions');
});

// ── Currency ─────────────────────────────────────────────────────────────────────────────
test('a currency mismatch disqualifies outright', () => {
  // Money in one currency is not payment of a debt in another, however well the number lines up.
  const out = build(payment({ currency: 'USD' }), { debts: [debt({ currency: 'IDR' })] });
  assert.strictEqual(out.length, 0);
});

test('an unknown currency is neutral, not disqualifying', () => {
  assert.strictEqual(build(payment(), { debts: [debt({ currency: null })] }).length, 1);
});

// ── Output shape ─────────────────────────────────────────────────────────────────────────
test('candidates are sorted best-first and capped', () => {
  const debts = Array.from({ length: 25 }, (_, i) => debt({ id: i + 1, remaining_amount: 1000000 }));
  const out = build(payment(), { debts });
  assert.strictEqual(out.length, M.MAX_CANDIDATES);
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score);
});

test('every candidate is explainable and correctly targeted', () => {
  const out = build(payment(), { debts: [debt()], transactions: [tx()] });
  assert.strictEqual(out.length, 2);
  for (const c of out) {
    assert.ok(Array.isArray(c.match_reasons) && c.match_reasons.length, 'a candidate had no stated reason');
    assert.ok(c.score >= M.MIN_SCORE && c.score <= 1);
    if (c.target_type === 'debt') {
      assert.ok(c.target_debt_id && !c.target_transaction_id);
    } else {
      assert.ok(c.target_transaction_id && !c.target_debt_id);
    }
  }
});

test('weak proposals are withheld rather than shown as noise', () => {
  // Amount 15% off, no name, no reference, no date: below the floor.
  const p = payment({ payer_name: null, payer_reference: null, description: null, transaction_at: null });
  assert.strictEqual(build(p, { debts: [debt({ remaining_amount: 1150000, counterparty: null, due_date: null })] }).length, 0);
});

test('the scorer never proposes a decision — only a score and reasons', () => {
  const [c] = build(payment(), { debts: [debt()] });
  assert.ok(!('status' in c), 'the scorer decided a status');
  assert.ok(!('accepted' in c));
});

// ── Self-audit regressions (post-B round 4) ──────────────────────────────────────────────
//
// Three findings from auditing PR3-PR5 for the classes Agent B found in PR2. None of them
// had coverage, which is why they survived: each is a case where the code looks right and
// the tests agree, because both make the same wrong assumption.

// 1. Schema assumptions. The fake Supabase returns whatever the fixture holds, so a column
//    that does not exist in the real database looks identical to one that does.
test('the matcher reads only columns that actually exist on debts', () => {
  // `debts` has no `reference` column (migrations 006/015 + the production insert shape).
  // Reading one would silently evaluate to undefined and look like a working comparison.
  const t = M.receivableTarget({
    id: 1, business_id: BIZ_A, remaining_amount: 1000, due_date: '2026-08-10',
    counterparty: 'X', currency: 'IDR', notes: 'INV-100',
  });
  assert.strictEqual(t.reference, 'INV-100', 'notes is the only free-text field to match on');
  assert.strictEqual(t.amount, 1000, 'remaining_amount is what is still owed');
});

test('a partial payment is compared against what is STILL OWED, not the original amount', () => {
  // Comparing against original_amount would score a legitimate partial payment as a mismatch.
  const t = M.receivableTarget({ id: 1, business_id: BIZ_A, original_amount: 5000,
    amount: 5000, remaining_amount: 1000 });
  assert.strictEqual(t.amount, 1000);
});

test('transactions expose no reference, and the matcher does not pretend otherwise', () => {
  const t = M.transactionTarget({ id: 2, business_id: BIZ_A, amount_idr: 1000,
    transaction_date: '2026-08-10', counterparty_name: 'X', currency_original: 'IDR' });
  assert.strictEqual(t.reference, null);
});

// 2. Production returns NUMERIC as strings; the fake returns JS numbers. Every money path
//    must survive the real shape.
test('scoring works on PostgREST string numerics, not just JS numbers', () => {
  const payment = { id: 'p', business_id: BIZ_A, gross_amount: '1000000.00',
    net_amount: '967810.00', currency: 'IDR', transaction_at: '2026-08-10T00:00:00.000Z',
    payer_name: 'PT Maju Jaya' };
  const debt = { id: 11, business_id: BIZ_A, type: 'receivable', status: 'open',
    remaining_amount: '967810.00', due_date: '2026-08-10', counterparty: 'PT Maju Jaya',
    currency: 'IDR' };
  const [c] = M.buildCandidates(payment, { debts: [debt] });
  assert.ok(c, 'string numerics produced no candidate');
  assert.ok(c.match_reasons.some((r) => r.key === 'amount_exact' && /net/.test(r.detail)));
});

test('a string-numeric amount mismatch still disqualifies', () => {
  const payment = { id: 'p', business_id: BIZ_A, gross_amount: '1000000.00',
    net_amount: '1000000.00', currency: 'IDR', payer_name: 'PT Maju Jaya',
    transaction_at: '2026-08-10T00:00:00.000Z' };
  const debt = { id: 11, business_id: BIZ_A, type: 'receivable', status: 'open',
    remaining_amount: '17.00', due_date: '2026-08-10', counterparty: 'PT Maju Jaya',
    currency: 'IDR' };
  assert.strictEqual(M.buildCandidates(payment, { debts: [debt] }).length, 0);
});
