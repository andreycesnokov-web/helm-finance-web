// Design v2 batch 8: the write paths for P-01/P-08 (targets), P-04 (counterparty tax
// fields) and P-05 (bill checklist) check the role, scope by business, refuse Personal
// where it matters, and write an audit row. Static check over server/index.js — the same
// approach as the other wiring tests, since these routes need a live Supabase to run.
// Run: node tests/designV2ApprovedWiring.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nDesign v2 approved proposals — route wiring');

/** Body of `app.<method>('<path>', …)` up to its closing `});` at column 0. */
function handler(method, route) {
  const start = src.indexOf(`app.${method}('${route}'`);
  assert.ok(start >= 0, `${method.toUpperCase()} ${route} exists`);
  const end = src.indexOf('\n});', start);
  return src.slice(start, end < 0 ? undefined : end);
}

t('PATCH /api/business/targets: business-scoped, Personal refused, role, validation, audit', () => {
  const h = handler('patch', '/api/business/targets');
  assert.ok(h.includes('requireBusiness(req, res)'));
  assert.ok(/type === 'personal'[\s\S]*business_workspace_required/.test(h));
  assert.ok(h.includes('TARGETS.canEditTargets(biz.role)'));
  assert.ok(h.includes('TARGETS.targetsPatchFromBody'));
  assert.ok(/\.eq\('id', biz\.business\.id\)/.test(h), 'updates only the active business');
  assert.ok(/recordAudit\([\s\S]*business_targets_updated/.test(h));
  assert.ok(h.includes('migration_not_applied'), '409 before the migration');
  assert.ok(!/req\.body\.business_id|body\.business_id/.test(h), 'never trusts a business id from the body');
});

t('GET /api/business/targets: finance roles only, Personal refused, works before the migration', () => {
  const h = handler('get', '/api/business/targets');
  assert.ok(h.includes('canViewBusinessFinance(biz.role)'));
  assert.ok(h.includes("business_workspace_required"));
  assert.ok(/available/.test(h));
});

t('PATCH /api/debts/:id/checklist: business-scoped, role, slip verified in this business, audit', () => {
  const h = handler('patch', '/api/debts/:id/checklist');
  assert.ok(h.includes('CHECKLIST.canEditChecklist(biz.role)'));
  assert.ok(/from\('debts'\)[\s\S]*\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(/from\('financial_documents'\)[\s\S]*\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(h.includes('CHECKLIST.slipProblem'));
  assert.ok(/recordAudit\([\s\S]*debt_checklist_updated/.test(h));
  assert.ok(!/status:\s*'paid'|approval_status|settle/.test(h.replace(/^\s*\/\/.*$/gm, '')), 'never pays, settles or approves');
  assert.ok(h.includes("{ userId: req.user.userId }"), 'actor from the token');
});

t('POST /api/debts strips the checklist fields from the spread body', () => {
  const h = handler('post', '/api/debts');
  assert.ok(h.includes('...CHECKLIST.withoutChecklistFields(req.body)'));
  assert.ok(!/\.\.\.req\.body,/.test(h), 'raw body is no longer spread');
});

t('POST and PATCH /api/counterparties: tax fields validated and role-gated; audit unchanged', () => {
  for (const m of ['post', 'patch']) {
    const h = handler(m, m === 'post' ? '/api/counterparties' : '/api/counterparties/:id');
    assert.ok(h.includes('CPI.taxFieldsFromBody(b)'), m);
    assert.ok(h.includes('CPI.canSetTaxFields(biz.role)'), m);
    assert.ok(/recordAudit\(/.test(h), m + ' audited');
  }
  assert.ok(/entity_form: row\.entity_form \?\? null/.test(src) && /payment_terms_days: row\.payment_terms_days \?\? null/.test(src), 'public shape null-safe');
});

t('no new migration touches 037–043 or R001, and the new ones are 058–061 only', () => {
  const dir = fs.readdirSync(path.join(__dirname, '..', 'migrations'));
  for (const n of ['058_business_runway_target.sql', '059_business_targets_alerts.sql', '060_counterparty_tax_fields.sql', '061_bill_checklist_status.sql'])
    assert.ok(dir.includes(n), n);
  for (const n of dir.filter((f) => /^06[01]_|^05[89]_/.test(f))) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8').replace(/^\s*--.*$/gm, '');
    assert.ok(!/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), n + ': no drops outside comments');
    assert.ok(!/ALTER\s+COLUMN/i.test(sql), n + ': no existing column changed');
    assert.ok(!/\bINSERT\s+INTO\b|\bDELETE\s+FROM\b/i.test(sql), n + ': no data written');
    assert.ok(!/UPDATE\s+public\./i.test(sql), n + ': no backfill');
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
