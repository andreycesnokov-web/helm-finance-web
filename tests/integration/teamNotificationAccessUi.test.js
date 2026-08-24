// client/src/lib/teamNotificationAccess.js — the pure logic behind the grants dialog.
//
// The client has no component test framework, so the component's markup is not tested here (that
// boundary is the same one stated in the PR4b2 tests). What IS tested is the logic that can be got
// wrong: the access summary, the ineligibility copy, and the save DIFF — the last matters because
// sending the whole map instead of the diff would write audit noise on every open/close.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../../client/src/lib/teamNotificationAccess.js'), 'utf8')
  .split('\r\n').join('\n');
function load() {
  const body = SRC.replace(/^export /gm, '');
  const names = [...SRC.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${names.join(', ')} };`)();
}
const M = load();

test('accessSummary: owner, ineligible, none, and counts', () => {
  assert.match(M.accessSummary({ is_owner: true }), /Owner/);
  assert.match(M.accessSummary({ grantable: false }), /Not eligible/);
  assert.strictEqual(M.accessSummary({ grantable: true, granted: {} }), 'No company alerts');
  assert.strictEqual(M.accessSummary({ grantable: true, granted: { a: true } }), '1 category granted');
  assert.strictEqual(M.accessSummary({ grantable: true, granted: { a: true, b: true, c: false } }), '2 categories granted');
});

test('ineligibleReason is null for owner and grantable, set otherwise', () => {
  assert.strictEqual(M.ineligibleReason({ is_owner: true }), null);
  assert.strictEqual(M.ineligibleReason({ grantable: true }), null);
  assert.match(M.ineligibleReason({ grantable: false }), /CEO or CFO/);
});

test('grantsDiff returns only changed categories', () => {
  const original = { company_financial: true, tax_compliance: false };
  const edited = { company_financial: true, tax_compliance: true };
  assert.deepStrictEqual(M.grantsDiff(original, edited), { tax_compliance: true });
  assert.deepStrictEqual(M.grantsDiff(original, original), {});
});

test('hasChanges tracks the diff', () => {
  assert.strictEqual(M.hasChanges({ a: true }, { a: true }), false);
  assert.strictEqual(M.hasChanges({ a: true }, { a: false }), true);
});

test('orderCategories keeps only known categories in stable order', () => {
  const out = M.orderCategories(['ai_cfo_summary', 'company_financial', 'not_real']);
  assert.deepStrictEqual(out, ['company_financial', 'ai_cfo_summary']);
});

test('a source guard: the dialog PUTs the diff, not the whole map', () => {
  const team = fs.readFileSync(path.join(__dirname, '../../client/src/pages/Team.jsx'), 'utf8');
  assert.match(team, /grantsDiff\(original, edited\)/, 'the dialog does not diff before saving');
  assert.match(team, /VITE_COMPANY_NOTIFICATION_GRANTS_ENABLED === 'true'/, 'the UI gate is missing or not a strict check');
  // The write path is the flag-gated PUT to the notification-grants endpoint.
  assert.match(team, /\/team\/members\/\$\{member\.member_id\}\/notification-grants/, 'the save target is wrong');
});
