// Remaining balance with withholdings (batch 10, DECISIONS.md final decisions item 5).
// Run: node tests/debtWithholding.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const W = require('../server/lib/debtWithholding');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nDebt withholding');
const NOW = new Date('2026-10-03T10:00:00Z');

// The computeDebtStatus body as it was on main before batch 10, verbatim.
function legacyStatus(debt, now) {
  const effectiveAmount = Number(debt.original_amount || debt.amount || 0);
  const paidAmount      = Number(debt.paid_amount     || 0);
  const remaining       = Math.max(0, effectiveAmount - paidAmount);
  const dueDate         = debt.due_date ? new Date(debt.due_date) : null;
  const daysOverdue     = dueDate ? Math.floor((now - dueDate) / 86400000) : 0;
  let status;
  if (debt.status === 'cancelled')             status = 'cancelled';
  else if (debt.is_settled || remaining <= 0)  status = 'paid';
  else if (paidAmount > 0)                     status = 'partial';
  else if (dueDate && now > dueDate)           status = 'overdue';
  else                                         status = 'open';
  return { ...debt, original_amount: effectiveAmount, paid_amount: paidAmount, remaining_amount: remaining, status, days_overdue: status === 'overdue' ? daysOverdue : 0 };
}

t('a bill with no withholding is calculated EXACTLY as before (3000 random bills)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  for (let i = 0; i < 3000; i++) {
    const amount = pick([0, 1, 99.5, 100, 1e6, null, '250000', undefined]);
    const d = {
      id: i, type: pick(['receivable', 'payable']), amount, original_amount: pick([null, undefined, amount, 0, 500]),
      paid_amount: pick([0, null, undefined, 50, 100, 1e6, '20']), status: pick(['open', 'cancelled', 'paid', 'overdue', undefined]),
      is_settled: pick([true, false, undefined]), due_date: pick([null, '2026-09-01', '2026-12-31', '2026-10-03']),
      approval_status: pick(['approved', 'pending_approval', undefined]),
    };
    if (rnd() < 0.3) d.withholding_allocated = pick([0, undefined, null]);
    assert.deepStrictEqual(W.debtStatusOf(d, NOW), legacyStatus(d, NOW), JSON.stringify(d));
  }
});

t('receivable withheld by the customer: invoice 100, paid 98, PPh 23 2 → paid, nothing outstanding', () => {
  const d = W.debtStatusOf({ id: 1, type: 'receivable', original_amount: 100, paid_amount: 98, due_date: '2026-09-01', withholding_allocated: 2, withholding_waiting_slip: true }, NOW);
  assert.deepStrictEqual([d.remaining_amount, d.status, d.days_overdue, d.withholding_waiting_slip], [0, 'paid', 0, true]);
});

t('payable withheld by us: bill 100, we pay the supplier 98 and withhold 2 → paid', () => {
  const d = W.debtStatusOf({ id: 2, type: 'payable', original_amount: 100, paid_amount: 98, withholding_allocated: 2 }, NOW);
  assert.deepStrictEqual([d.remaining_amount, d.status], [0, 'paid']);
});

t('"waiting for slip" never makes an invoice overdue: withholding recorded, money not yet in', () => {
  const d = W.debtStatusOf({ id: 3, type: 'receivable', original_amount: 100, paid_amount: 0, due_date: '2026-09-01', withholding_allocated: 2, withholding_waiting_slip: true }, NOW);
  assert.strictEqual(d.remaining_amount, 98);
  assert.notStrictEqual(d.status, 'overdue');
  assert.strictEqual(d.status, 'partial');
});

t('/pay remaining uses the same formula: an overpayment after a withholding is refused', () => {
  const debt = { original_amount: 100, paid_amount: 0, withholding_allocated: 2 };
  assert.strictEqual(W.remainingOf(debt), 98);
  assert.ok(100 > W.remainingOf(debt) + 0.01, 'a payment of 100 exceeds the remaining 98');
  assert.strictEqual(W.remainingOf({ original_amount: 100, paid_amount: 0 }), 100, 'unchanged without a withholding');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const pay = src.slice(src.indexOf("app.post('/api/debts/:id/pay'"), src.indexOf('\n})', src.indexOf("app.post('/api/debts/:id/pay'")));
  assert.ok(pay.includes('DW.remainingOf({ ...debt, withholding_allocated: withheld })'), '/pay uses remainingOf');
  assert.ok(pay.includes('Payment amount exceeds remaining balance'));
});

t('only withholding allocations count; transaction allocations are never subtracted', () => {
  const by = W.withholdingByDebt([
    { debt_id: 5, settlement_source_type: 'withholding_record', withholding_record_id: 'w1', allocated_amount: 2 },
    { debt_id: 5, settlement_source_type: 'transaction', allocated_amount: 98 },
    { debt_id: 5, settlement_source_type: 'withholding_record', withholding_record_id: 'w2', allocated_amount: '1.5' },
    { debt_id: 6, settlement_source_type: 'credit_note', allocated_amount: 10 },
  ], [{ id: 'w1', bukti_potong_document_id: 'doc' }, { id: 'w2', bukti_potong_document_id: null }]);
  assert.deepStrictEqual(by, { 5: { amount: 3.5, waiting_slip: true } });
  const rows = W.attachWithholdings([{ id: 5, amount: 10 }, { id: 6, amount: 10 }], by);
  assert.strictEqual(rows[0].withholding_allocated, 3.5);
  assert.ok(!('withholding_allocated' in rows[1]), 'others untouched');
});

t('route validation: positive amount within the remaining, known tax type, open approved bill', () => {
  const debt = { type: 'receivable', original_amount: 100, paid_amount: 98, approval_status: 'approved', status: 'partial' };
  assert.deepStrictEqual(W.withholdingFromBody({ amount: 2 }, debt), { amount: 2, taxType: 'pph_23', slip: null, status: 'waiting_slip' });
  assert.strictEqual(W.withholdingFromBody({ amount: 3 }, debt).error, 'exceeds_remaining');
  for (const a of [0, -1, 'x', true, null]) assert.strictEqual(W.withholdingFromBody({ amount: a }, debt).error, 'invalid_amount', String(a));
  assert.strictEqual(W.withholdingFromBody({ amount: 1, tax_type: 'vat' }, debt).error, 'invalid_tax_type');
  assert.strictEqual(W.withholdingFromBody({ amount: 1, bukti_potong_document_id: 'nope' }, debt).error, 'invalid_bukti_potong_document_id');
  assert.strictEqual(W.withholdingFromBody({ amount: 1, bukti_potong_document_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, debt).status, 'slip_received');
  assert.strictEqual(W.withholdingFromBody({ amount: 1 }, { ...debt, approval_status: 'pending_approval' }).error, 'debt_not_open');
  assert.strictEqual(W.withholdingFromBody({ amount: 1 }, { ...debt, status: 'cancelled' }).error, 'debt_not_open');
});

t('the guard message is the one in DECISIONS.md, and the guard error is recognised', () => {
  const dec = fs.readFileSync(path.join(__dirname, '..', '_specs', 'design-v2', 'DECISIONS.md'), 'utf8');
  assert.ok(dec.includes(W.GUARD_MESSAGE));
  assert.ok(W.isGuardRejection({ message: 'over-allocation: debt 5 alloc 90 + 10 > available 10 (ceiling 100 - legacy paid 90)' }));
  assert.ok(!W.isGuardRejection({ message: 'isolation: debt other business' }));
});

t('roles: accountant and above record a withholding', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo', 'accountant']) assert.ok(W.canRecordWithholding(r));
  for (const r of ['manager', 'employee', 'auditor', null]) assert.ok(!W.canRecordWithholding(r));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
