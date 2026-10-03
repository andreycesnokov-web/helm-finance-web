// Batch 10 route wiring (static, over server/index.js). Run: node tests/withholdingRouteWiring.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const block = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n});', i)); };
console.log('\nWithholding route wiring');

t('POST /api/debts/:id/withholding: Business only, role, business-scoped reads, audit, 409 message', () => {
  const h = block("app.post('/api/debts/:id/withholding'");
  assert.ok(h.includes('business_workspace_required'));
  assert.ok(h.includes('DW.canRecordWithholding(biz.role)'));
  assert.ok(/from\('debts'\)[\s\S]*\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(/from\('financial_documents'\)[\s\S]*\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(/from\('withholding_records'\)\.insert\(\{\s*business_id: biz\.business\.id/.test(h));
  assert.ok(/settlement_source_type: 'withholding_record'/.test(h));
  assert.ok(/DW\.isGuardRejection\(aErr\)[\s\S]*status\(409\)[\s\S]*DW\.GUARD_MESSAGE/.test(h));
  assert.ok(/\.delete\(\)\.eq\('id', rec\.id\)\.eq\('business_id', biz\.business\.id\)/.test(h), 'undo is scoped');
  assert.ok(/recordAudit\([\s\S]*debt_withholding_recorded/.test(h));
  assert.ok(!/paid_amount\s*:/.test(h), 'paid_amount is never written');
});

t('loadWithholdings reads only this business and only withholding allocations; errors fall back to {}', () => {
  const h = block('async function loadWithholdings(');
  assert.ok(/\.eq\('business_id', businessId\)\.eq\('settlement_source_type', 'withholding_record'\)/.test(h));
  assert.ok(/catch \{ return \{\}; \}/.test(h));
});

t('computeDebtStatus delegates to the tested module; list loaders use the business-scoped enrich', () => {
  assert.ok(/function computeDebtStatus\(debt\) \{[\s\S]*?return DW\.debtStatusOf\(debt, new Date\(\)\);/.test(src));
  assert.ok(src.includes('res.json(await enrichDebtsFor(biz.business.id, data));'), 'GET /api/debts');
  assert.ok(/const debts = await enrichDebtsFor\(biz\.business\.id, rawDebts\);/.test(src), 'pulse and snapshot');
});

t('/settle marks only the part not already withheld as paid', () => {
  const h = block("app.patch('/api/debts/:id/settle'");
  assert.ok(h.includes('paid_amount:  Math.max(0, fullAmount - withheld)'));
  assert.ok(h.includes('await loadWithholdings(biz.business.id)'));
});

t('migration 031 is not changed by this batch', () => {
  const head = require('node:child_process').execSync('git diff --name-only origin/main -- migrations/031_tax_document_linking.sql', { cwd: path.join(__dirname, '..') }).toString().trim();
  assert.strictEqual(head, '');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
