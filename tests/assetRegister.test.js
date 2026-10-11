// P-11 asset register: rules → groups, straight-line depreciation, validation.
// Run: node tests/assetRegister.test.js
const assert = require('node:assert');
const A = require('../server/lib/assetRegister');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nAsset register');
const RULE = { id: 'r1', rule_code: 'TEST_DEPRECIATION', obligation_type: 'depreciation', status: 'active',
  parameters: { method: 'straight_line', groups: [
    { code: 'g1', label: 'Group 1', useful_life_months: 48, asset_types: ['computers', 'furniture'] },
    { code: 'g2', label: 'Group 2', useful_life_years: 8, asset_types: ['machines', 'vehicles'] },
    { code: 'g2b', label: 'Group 2b', useful_life_months: 96, asset_types: ['vehicles'] },
  ] } };
const verified = (r) => r.id === 'r1';

t('groups only from ACTIVE, VERIFIED depreciation rules (the engine decides "verified")', () => {
  assert.deepStrictEqual(A.depreciationGroups([RULE], () => false), [], 'unverified → nothing');
  assert.deepStrictEqual(A.depreciationGroups([{ ...RULE, obligation_type: 'vat' }], verified), []);
  assert.deepStrictEqual(A.depreciationGroups([{ ...RULE, parameters: { ...RULE.parameters, method: 'declining_balance' } }], verified), []);
  const g = A.depreciationGroups([RULE], verified);
  assert.deepStrictEqual(g.map((x) => [x.code, x.useful_life_months]), [['g1', 48], ['g2', 96], ['g2b', 96]]);
});

t('a type in exactly one group gets it; an ambiguous type needs an explicit group; none → no life', () => {
  const g = A.depreciationGroups([RULE], verified);
  assert.strictEqual(A.groupFor('computers', g).code, 'g1');
  assert.strictEqual(A.groupFor('vehicles', g), null, 'two groups list vehicles');
  assert.strictEqual(A.groupFor('vehicles', g, 'g2b').code, 'g2b');
  assert.strictEqual(A.groupFor('buildings', g), null);
});

t('validation: life and rule come from the engine, never from the body', () => {
  const g = A.depreciationGroups([RULE], verified);
  const r = A.assetFromBody({ name: ' Laptop ', asset_type: 'computers', cost: '15000000', acquired_on: '2026-09-15', useful_life_months: 1, depreciation_rule_id: 'x' }, g).row;
  assert.deepStrictEqual([r.name, r.useful_life_months, r.depreciation_rule_id, r.asset_group, r.quantity], ['Laptop', 48, 'r1', 'g1', 1]);
  const none = A.assetFromBody({ name: 'Scrubber', asset_type: 'machines', cost: 7e6, acquired_on: '2026-09-15' }, []).row;
  assert.deepStrictEqual([none.useful_life_months, none.depreciation_rule_id], [null, null]);
  for (const [b, e] of [[{}, 'name_required'], [{ name: 'x', asset_type: 'gold' }, 'invalid_asset_type'], [{ name: 'x', asset_type: 'other', cost: 0 }, 'invalid_cost'],
    [{ name: 'x', asset_type: 'other', cost: 1, acquired_on: '15/09/2026' }, 'invalid_acquired_on'], [{ name: 'x', asset_type: 'other', cost: 1, acquired_on: '2026-09-15', quantity: 0 }, 'invalid_quantity'],
    [{ name: 'x', asset_type: 'other', cost: 1, acquired_on: '2026-09-15', purchase_debt_id: 'abc' }, 'invalid_purchase_debt_id'],
    [{ name: 'x', asset_type: 'other', cost: 1, acquired_on: '2026-09-15', asset_group: 'nope' }, 'unknown_asset_group']])
    assert.strictEqual(A.assetFromBody(b, g).error, e, JSON.stringify(b));
});

t('straight line from the month of acquisition; the total is exactly the cost', () => {
  const a = { cost: 1000, useful_life_months: 3, acquired_on: '2026-09-15' };
  assert.deepStrictEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'].map((m) => A.depreciationIn(a, m)), [0, 333.33, 333.33, 333.34, 0]);
  assert.deepStrictEqual(A.bookValue(a, '2026-12'), { accumulated: 1000, book_value: 0 });
  assert.deepStrictEqual(A.bookValue(a, '2026-09'), { accumulated: 333.33, book_value: 666.67 });
});

t('no life → no depreciation, full book value; disposal stops depreciation', () => {
  assert.strictEqual(A.depreciationIn({ cost: 1000, acquired_on: '2026-01-01' }, '2026-05'), 0);
  assert.deepStrictEqual(A.bookValue({ cost: 1000, acquired_on: '2026-01-01' }, '2026-12'), { accumulated: 0, book_value: 1000 });
  const d = { cost: 1200, useful_life_months: 12, acquired_on: '2026-01-10', disposed_on: '2026-03-20' };
  assert.deepStrictEqual(['2026-03', '2026-04'].map((m) => A.depreciationIn(d, m)), [100, 0]);
});

t('roles', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo', 'accountant']) assert.ok(A.canEditAssets(r));
  for (const r of ['manager', 'employee', 'auditor', null]) assert.ok(!A.canEditAssets(r));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
