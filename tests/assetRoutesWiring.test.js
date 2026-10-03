// P-11 asset routes wiring (static over server/index.js). Run: node tests/assetRoutesWiring.test.js
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const block = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n});', i)); };
console.log('\nAsset routes wiring');

t('GET /api/assets: Business only, finance roles, scoped, read-only, graceful before 063', () => {
  const h = block("app.get('/api/assets'");
  assert.ok(h.includes('business_workspace_required') && h.includes('canViewBusinessFinance(biz.role)'));
  assert.ok(/from\('assets'\)\.select\('\*'\)\s*\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(h));
  assert.ok(h.includes('available: false'));
});

t('POST /api/assets: role, links verified in this business, life from verified rules only, audit', () => {
  const h = block("app.post('/api/assets'");
  assert.ok(h.includes('business_workspace_required') && h.includes('ASSETS.canEditAssets(biz.role)'));
  assert.ok(h.includes('ASSETS.assetFromBody(req.body || {}, await verifiedDepreciationGroups())'));
  assert.ok(/\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(/business_id: biz\.business\.id, created_by_user_id: req\.user\.userId/.test(h));
  assert.ok(/recordAudit\([\s\S]*asset_created/.test(h));
  const g = block('async function verifiedDepreciationGroups(');
  assert.ok(g.includes("eq('obligation_type', 'depreciation')") && g.includes("eq('status', 'active')") && g.includes('effectiveRuleActive('));
});

t('POST /api/assets/:id/dispose: role, scoped read and write, audit', () => {
  const h = block("app.post('/api/assets/:id/dispose'");
  assert.ok(h.includes('ASSETS.canEditAssets(biz.role)') && h.includes('business_workspace_required'));
  assert.ok(/\.update\([\s\S]*\.eq\('id', before\.id\)\.eq\('business_id', biz\.business\.id\)/.test(h));
  assert.ok(/recordAudit\([\s\S]*asset_disposed/.test(h));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
