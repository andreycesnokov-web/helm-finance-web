// P-10 profit-group mapping: validation and suggestion matching. Run: node tests/pnlMapping.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const M = require('../server/lib/pnlMapping');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nP-10 mapping');
const ID = 'aaaaaaaa-0000-4000-8000-000000000001', ID2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const TPL = [
  { kbli_prefix: '*', category_name: 'Закупка товара', pnl_group: 'direct_cost' },
  { kbli_prefix: '*', category_name: 'Loan interest', pnl_group: 'interest' },
  { kbli_prefix: '81210', category_name: 'Cleaning service income', pnl_group: 'revenue' },
  { kbli_prefix: '47999', category_name: 'Stock for machines', pnl_group: 'direct_cost' },
  { kbli_prefix: '81', category_name: 'Loan interest', pnl_group: 'operating_cost', note: 'test-only broader row' },
  { kbli_prefix: '81210', category_name: 'Loan interest', pnl_group: 'interest', note: 'more specific' },
];

t('exactly the 9 groups, matching the CHECK in migration 062', () => {
  assert.deepStrictEqual(M.GROUPS, ['revenue', 'direct_cost', 'operating_cost', 'interest', 'other_income', 'tax', 'asset_purchase', 'funding', 'transfer']);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '062_pnl_groups_industry_templates.sql'), 'utf8');
  const m = /pnl_group IN \(([^)]+)\)/.exec(sql);
  assert.deepStrictEqual(m[1].split(',').map((x) => x.trim().replace(/'/g, '')), M.GROUPS);
});

t('only owner / ceo / admin / cfo confirm the mapping', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo']) assert.ok(M.canEditMapping(r), r);
  for (const r of ['accountant', 'manager', 'employee', 'auditor', null]) assert.ok(!M.canEditMapping(r), String(r));
});

t('KBLI codes from the tax profile, digits only, de-duplicated', () => {
  assert.deepStrictEqual(M.kbliCodes({ primary_kbli: '81210', additional_kbli: ['47999', '81210', ' 4799-9 '] }), ['81210', '47999']);
  assert.deepStrictEqual(M.kbliCodes(null), []);
});

t('suggestions: exact name, case-insensitive; the most specific KBLI wins; other industries ignored', () => {
  assert.strictEqual(M.suggestFor('  закупка ТОВАРА ', TPL, []).pnl_group, 'direct_cost');
  assert.strictEqual(M.suggestFor('Cleaning service income', TPL, ['81210']).source, 'kbli_81210');
  assert.strictEqual(M.suggestFor('Cleaning service income', TPL, ['47999']), null, 'not a vending category');
  const li = M.suggestFor('Loan interest', TPL, ['81210'])
  assert.deepStrictEqual([li.pnl_group, li.note], ['interest', 'more specific'])
  assert.strictEqual(M.suggestFor('Something new', TPL, ['81210']), null, 'no guess for an unknown name');
});

t('template categories the business does not have yet', () => {
  const miss = M.missingTemplateCategories([{ name: 'cleaning service income' }], TPL, ['81210', '47999']);
  assert.deepStrictEqual(miss.map((m) => m.name).sort(), ['Loan interest', 'Stock for machines']);
});

t('PATCH body: uuid ids, 9 groups or null, no duplicates, bounded', () => {
  assert.deepStrictEqual(M.mappingsFromBody({ mappings: [{ category_id: ID, pnl_group: 'interest' }, { category_id: ID2, pnl_group: null }] }).items,
    [{ category_id: ID, pnl_group: 'interest' }, { category_id: ID2, pnl_group: null }]);
  assert.strictEqual(M.mappingsFromBody({}).error, 'mappings_required');
  assert.strictEqual(M.mappingsFromBody({ mappings: [{ category_id: 'x', pnl_group: 'revenue' }] }).error, 'invalid_category_id');
  assert.strictEqual(M.mappingsFromBody({ mappings: [{ category_id: ID, pnl_group: 'cogs' }] }).error, 'invalid_pnl_group');
  assert.strictEqual(M.mappingsFromBody({ mappings: [{ category_id: ID, pnl_group: 'tax' }, { category_id: ID, pnl_group: 'tax' }] }).error, 'duplicate_category_id');
  assert.strictEqual(M.mappingsFromBody({ mappings: Array.from({ length: 501 }, () => ({ category_id: ID, pnl_group: null })) }).error, 'too_many_mappings');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
