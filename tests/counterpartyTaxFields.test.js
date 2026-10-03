// Counterparty tax fields and roles (Design v2 P-04). Run: node tests/counterpartyTaxFields.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const C = require('../server/lib/counterpartyIntelligence');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nCounterparty tax fields');

t('landlord and lender roles added; existing roles kept', () => {
  for (const r of ['vendor', 'customer', 'both', 'tax_authority', 'bank', 'employee', 'other', 'landlord', 'lender']) assert.ok(C.ROLES.includes(r), r);
});

t('entity form list matches the CHECK in migration 060', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '060_counterparty_tax_fields.sql'), 'utf8');
  const m = /entity_form IN \(([^)]+)\)/.exec(sql);
  assert.deepStrictEqual(m[1].split(',').map((x) => x.trim().replace(/'/g, '')), C.ENTITY_FORMS);
});

t('valid values pass, only present keys are returned', () => {
  assert.deepStrictEqual(C.taxFieldsFromBody({ entity_form: 'pt', payment_terms_days: 30 }).fields, { entity_form: 'pt', payment_terms_days: 30 });
  assert.deepStrictEqual(C.taxFieldsFromBody({ payment_terms_days: '14' }).fields, { payment_terms_days: 14 });
  assert.deepStrictEqual(C.taxFieldsFromBody({ entity_form: null, payment_terms_days: '' }).fields, { entity_form: null, payment_terms_days: null });
  assert.deepStrictEqual(C.taxFieldsFromBody({ name: 'x' }).fields, {});
});

t('invalid values are rejected', () => {
  for (const bad of ['PT', 'llc', 1, true]) assert.strictEqual(C.taxFieldsFromBody({ entity_form: bad }).error, 'invalid_entity_form', String(bad));
  for (const bad of [-1, 366, 1.5, 'abc', true, [], '1e2']) assert.strictEqual(C.taxFieldsFromBody({ payment_terms_days: bad }).error, 'invalid_payment_terms_days', String(bad));
});

t('only the accountant role and above may set them', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo', 'accountant']) assert.ok(C.canSetTaxFields(r), r);
  for (const r of ['manager', 'employee', 'auditor', null]) assert.ok(!C.canSetTaxFields(r), String(r));
});

t('no tax rate or obligation is derived from entity form here (rule engine owns that)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'counterpartyIntelligence.js'), 'utf8');
  const block = src.slice(src.indexOf('tax fields (Design v2 P-04'), src.indexOf('const canSetTaxFields'));
  assert.ok(!/rate|pph|withhold|percent/i.test(block.replace(/^\s*\/\/.*$/gm, '')), 'no tax logic in the tax-field validator');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
