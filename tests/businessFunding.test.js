// P-03 business funding register. Run: node tests/businessFunding.test.js
const assert = require('node:assert');
const F = require('../server/lib/businessFunding');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nBusiness funding');
const base = { source_kind: 'founder', instrument: 'loan', lender_name: 'Founder', amount: '100000000', received_on: '2026-01-10' };

t('only owner / ceo / admin / cfo record funding', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo']) assert.ok(F.canEditFunding(r));
  for (const r of ['accountant', 'manager', 'employee', null]) assert.ok(!F.canEditFunding(r));
});

t('a founder loan with a schedule; no Personal fields exist or are accepted', () => {
  const v = F.recordFromBody({ ...base, interest_rate_annual: 6, due_on: '2027-01-10', personal_workspace_id: 'x', wallet_id: 'y',
    schedule: [{ due_on: '2026-02-10', principal: 2000000, interest: 500000 }] });
  assert.ok(!v.error, v.error);
  assert.deepStrictEqual(Object.keys(v.row).filter((k) => /personal|wallet|workspace/.test(k)), []);
  assert.deepStrictEqual(v.schedule, [{ due_on: '2026-02-10', principal: 2000000, interest: 500000 }]);
});

t('validation', () => {
  const cases = [
    [{ ...base, source_kind: 'personal' }, 'invalid_source_kind'], [{ ...base, instrument: 'grant' }, 'invalid_instrument'],
    [{ ...base, amount: 0 }, 'invalid_amount'], [{ ...base, received_on: '10/01/2026' }, 'invalid_received_on'],
    [{ ...base, lender_name: ' ' }, 'lender_required'], [{ ...base, counterparty_id: 'x' }, 'invalid_counterparty_id'],
    [{ ...base, instrument: 'equity', interest_rate_annual: 5 }, 'equity_has_no_interest'],
    [{ ...base, instrument: 'equity', schedule: [] }, 'equity_has_no_repayments'],
    [{ ...base, interest_rate_annual: 101 }, 'invalid_interest_rate_annual'], [{ ...base, due_on: '2025-01-01' }, 'invalid_due_on'],
    [{ ...base, schedule: [{ due_on: '2026-02-10' }] }, 'schedule_invalid_repayment_amounts'],
    [{ ...base, received_transaction_id: 'abc' }, 'invalid_received_transaction_id'],
  ];
  for (const [b, e] of cases) assert.strictEqual(F.recordFromBody(b).error, e, JSON.stringify(b));
  assert.strictEqual(F.paidFromBody({}).error, 'invalid_paid_on');
  assert.deepStrictEqual(F.paidFromBody({ paid_on: '2026-02-10', paid_transaction_id: '12' }), { paid_on: '2026-02-10', paid_transaction_id: 12 });
});

t('summary: raised, outstanding after paid principal, next repayment, interest by month', () => {
  const recs = [{ id: 'L', instrument: 'loan', status: 'active', amount: 100, lender_name: 'Founder' }, { id: 'E', instrument: 'equity', status: 'active', amount: 50 }];
  const reps = [
    { id: 'r1', funding_record_id: 'L', due_on: '2026-09-10', principal: 10, interest: 1, paid_on: '2026-09-10', paid_transaction_id: 7 },
    { id: 'r2', funding_record_id: 'L', due_on: '2026-10-10', principal: 10, interest: 0.9 },
    { id: 'r3', funding_record_id: 'L', due_on: '2026-11-10', principal: 10, interest: 0.8 },
  ];
  const s = F.summarize(recs, reps, { today: '2026-10-15', months: ['2026-09', '2026-10'] });
  assert.deepStrictEqual([s.totals.raised_equity, s.totals.raised_loans, s.totals.loans_outstanding], [50, 100, 90]);
  assert.strictEqual(s.totals.next_repayment.id, 'r2');
  assert.strictEqual(s.totals.next_repayment.overdue, true);
  assert.deepStrictEqual(s.interest_by_month, { '2026-09': 1, '2026-10': 0.9 });
  assert.deepStrictEqual(s.repayment_transactions, ['7']);
  assert.strictEqual(s.records.find((r) => r.id === 'E').outstanding, 0, 'equity is never owed back');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
