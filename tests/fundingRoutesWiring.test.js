// P-03 funding routes wiring (static over server/index.js). Run: node tests/fundingRoutesWiring.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const block = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n});', i)); };
console.log('\nFunding routes wiring');
const routes = ["app.get('/api/business-funding'", "app.post('/api/business-funding'", "app.post('/api/business-funding/:id/repayments'", "app.post('/api/business-funding/repayments/:rid/paid'"];

t('every route: Business only, role checked, scoped to the active business', () => {
  for (const r of routes) {
    const h = block(r);
    assert.ok(h.includes('business_workspace_required'), r);
    assert.ok(h.includes('canViewBusinessFinance(biz.role)') || h.includes('BFUND.canEditFunding(biz.role)'), r);
    assert.ok(/\.eq\('business_id', biz\.business\.id\)|business_id: biz\.business\.id/.test(h), r);
  }
});

t('every write is audited', () => {
  for (const [r, a] of [[routes[1], 'funding_recorded'], [routes[2], 'funding_repayment_scheduled'], [routes[3], 'funding_repayment_paid']])
    assert.ok(new RegExp(`recordAudit\\([\\s\\S]*${a}`).test(block(r)), a);
});

t('no link to Personal and not the bridge path', () => {
  for (const r of routes) {
    const h = block(r).replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/personal_|wallet_id|funding_transfers|personal-business-connections|\/api\/funding\b/.test(h), r);
  }
  assert.ok(!/app\.(get|post)\('\/api\/funding/.test(src), 'the bridge path /api/funding is not reused');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
