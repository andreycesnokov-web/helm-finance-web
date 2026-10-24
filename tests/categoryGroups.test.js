'use strict';
// Confirmed category groups per company (incl. shared system categories) and the evidence the cash insights use.
const test = require('node:test');
const assert = require('node:assert');
const { resolver, loadInsightEvidence } = require('../server/lib/categoryGroups');
const { computeInsights, classifyTransaction } = require('../server/lib/financialInsights');

const B = 'b0000000-0000-4000-8000-000000000001', OTHER = 'b0000000-0000-4000-8000-000000000002';
const SYS_RENT = 'c0000000-0000-4000-8000-0000000000a1', SYS_LOAN = 'c0000000-0000-4000-8000-0000000000a2';
const system = [{ id: SYS_RENT, business_id: null, name: 'Аренда офиса', is_system: true }, { id: SYS_LOAN, business_id: null, name: 'Получение кредитов и займов', is_system: true }];

test('a system category takes only THIS company\'s confirmed group; another company\'s choice is ignored', () => {
  const groups = [{ business_id: B, category_id: SYS_RENT, pnl_group: 'operating_cost' }, { business_id: OTHER, category_id: SYS_LOAN, pnl_group: 'revenue' }];
  const r = resolver({ businessId: B, companyCategories: [], systemCategories: system, categoryGroups: groups });
  assert.strictEqual(r.category({ cashflow_category_id: SYS_RENT }).pnl_group, 'operating_cost');
  assert.strictEqual(r.category({ cashflow_category_id: SYS_LOAN }).pnl_group, null, 'OTHER\'s mapping must not leak');
  const o = resolver({ businessId: OTHER, companyCategories: [], systemCategories: system, categoryGroups: groups });
  assert.strictEqual(o.category({ cashflow_category_id: SYS_LOAN }).pnl_group, 'revenue');
  assert.strictEqual(o.category({ cashflow_category_id: SYS_RENT }).pnl_group, null);
});

test('by name: a company category wins over a system one; a duplicate name stays unresolved; unknown id is null', () => {
  const own = [{ id: 'own-rent', business_id: B, name: 'Аренда  офиса', pnl_group: 'direct_cost' }];
  const r = resolver({ businessId: B, companyCategories: own, systemCategories: system, categoryGroups: [{ business_id: B, category_id: SYS_RENT, pnl_group: 'operating_cost' }] });
  assert.strictEqual(r.category({ category: 'аренда офиса' }).id, 'own-rent');
  assert.strictEqual(r.category({ category: 'Получение кредитов и займов' }).id, SYS_LOAN);
  const dup = resolver({ businessId: B, companyCategories: [...own, { id: 'own-rent-2', business_id: B, name: 'Аренда офиса', pnl_group: 'operating_cost' }], systemCategories: system });
  assert.strictEqual(dup.category({ category: 'Аренда офиса' }), null);
  assert.strictEqual(r.category({ cashflow_category_id: 'not-a-category' }), null);
  // A row of another company passed in by mistake is never used.
  assert.strictEqual(resolver({ businessId: B, companyCategories: [{ id: 'x', business_id: OTHER, name: 'X', pnl_group: 'revenue' }] }).category({ cashflow_category_id: 'x' }), null);
});

const tx = (id, type, amount, category, extra = {}) => ({ id, type, amount_original: amount, amount_idr: amount, currency_original: 'IDR', category, transaction_date: '2026-09-10', ...extra });

test('funding register and confirmed funding group classify financing that keywords miss (Russian names)', () => {
  const rows = [tx(1, 'income', 300000000, 'Кредит банка: получение'), tx(2, 'expense', 12500000, 'Кредит банка: погашение'),
    tx(3, 'income', 250000000, 'Вклад собственника (компания)', { cashflow_category_id: 'own-equity' }), tx(4, 'income', 50000000, 'Услуги: консалтинг', { cashflow_category_id: 'own-sales' })];
  const before = computeInsights(rows);
  assert.strictEqual(before.metrics.other_cash_movement.funding, 0, 'keywords alone do not see these');
  const categoryOf = resolver({ businessId: B, companyCategories: [{ id: 'own-equity', business_id: B, name: 'Вклад собственника (компания)', pnl_group: 'funding' }, { id: 'own-sales', business_id: B, name: 'Услуги: консалтинг', pnl_group: 'revenue' }] }).category;
  const evidence = { fundingTx: new Map([['1', null], ['2', 12500000]]), categoryOf };
  const after = computeInsights(rows, { evidence });
  assert.strictEqual(after.metrics.other_cash_movement.funding, 300000000 + 12500000 + 250000000);
  assert.strictEqual(after.metrics.revenue, 50000000, 'financing never becomes revenue');
  assert.strictEqual(classifyTransaction(rows[0], evidence).matched_on, 'funding_register');
  assert.strictEqual(classifyTransaction(rows[2], evidence).matched_on, 'confirmed_category_group');
});

test('a repayment debit above its principal is not hidden as financing; a refund is not revenue', () => {
  const evidence = { fundingTx: new Map([['9', 12500000]]), categoryOf: () => ({ pnl_group: 'revenue' }) };
  // Principal + interest in one debit: the register alone cannot split it.
  assert.notStrictEqual(classifyTransaction(tx('9', 'expense', 15100000, 'Платёж банку'), { ...evidence, categoryOf: () => null }).class, 'financing');
  // An expense in a revenue category is a refund: the confirmed group does not make it revenue.
  assert.notStrictEqual(classifyTransaction(tx('10', 'expense', 100000, 'Возврат'), evidence).class, 'revenue');
  // Structural classes still come first: a transfer stays a transfer.
  assert.strictEqual(classifyTransaction(tx('11', 'income', 4000000, 'Пополнение кассы', { transfer_id: 't1' }), { fundingTx: new Map([['11', null]]) }).class, 'transfer');
});

test('evidence loader reads only this company and tolerates a missing table', async () => {
  const calls = [];
  const rows = { business_funding_records: [{ business_id: B, received_transaction_id: 7 }, { business_id: OTHER, received_transaction_id: 8 }],
    business_funding_repayments: [{ business_id: B, paid_transaction_id: 9, principal: '12500000' }], cashflow_categories: [], business_category_pnl_groups: null };
  const q = (table) => {
    const filters = [];
    const chain = { select: () => chain, eq: (k, v) => { filters.push([k, v]); return chain; }, is: (k, v) => { filters.push([k, v]); return chain; },
      order: () => chain, limit: () => chain, abortSignal: () => chain,
      then: (ok, ko) => { calls.push([table, filters]);
        const data = rows[table]; if (data === null) return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(ok, ko);
        return Promise.resolve({ data: data.filter((r) => !filters.some(([k, v]) => k === 'business_id' && v !== null && r.business_id !== v)), error: null }).then(ok, ko); } };
    return chain;
  };
  const ev = await loadInsightEvidence({ from: q }, B);
  assert.deepStrictEqual([...ev.fundingTx.entries()], [['7', null], ['9', 12500000]]);
  for (const [table, filters] of calls) {
    const biz = filters.find(([k]) => k === 'business_id');
    assert.ok(biz && (biz[1] === B || (table === 'cashflow_categories' && biz[1] === null)), `${table} must be scoped`);
  }
});
