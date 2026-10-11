// Company-admin notification grants — the policy resolver's grant path and the loader.
//
// Grants ADD to the owner-only baseline for CEO/CFO, and only when an explicit grant names them.
// The three properties that matter and how they are covered:
//   * a grant never bypasses role validation — the live role is re-read, so a forged/stale grant
//     for a manager or an ex-CFO is inert;
//   * a grant is business-scoped — a grant in A has no effect in B;
//   * fail-closed — an unknown category, a missing grant, or a lookup error adds nobody.

const { test } = require('node:test');
const assert = require('node:assert');

const P = require('../../server/lib/notificationPolicy');
const G = require('../../server/lib/notificationGrants');

const GRANTS_FLAG = 'COMPANY_NOTIFICATION_GRANTS_ENABLED';
const BIZ = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const OWNER = -1;
const CFO = -2;
const CEO = -3;
const MANAGER = -4;
const ADMIN = -5;
const EMPLOYEE = -6;

// ── fake Supabase ───────────────────────────────────────────────────────────
const scenario = { members: [], grants: [], failTables: new Set() };
function reset() { scenario.members = []; scenario.grants = []; scenario.failTables = new Set(); }
const member = (userId, role, status = 'active', businessId = BIZ) =>
  ({ user_id: userId, business_id: businessId, role, status });
const grantRow = (userId, category, enabled = true, businessId = BIZ) =>
  ({ user_id: userId, business_id: businessId, category, enabled });

function tableRows(table) {
  if (table === 'business_members') return scenario.members;
  if (table === 'business_member_notification_grants') return scenario.grants;
  return [];
}
function match(row, filters) {
  return filters.every(([c, v]) => String(row[c]) === String(v));
}
function fakeFrom(table) {
  const filters = [];
  const q = {
    select() { return q; },
    eq(c, v) { filters.push([c, v]); return q; },
    in(c, v) { filters.push(['__in', { c, v }]); return q; },
    then(resolve, reject) {
      if (scenario.failTables.has(table))
        return Promise.resolve({ data: null, error: { message: `simulated ${table} failure` } }).then(resolve, reject);
      let rows = tableRows(table).filter((r) =>
        filters.every(([c, v]) => c === '__in' ? v.v.map(String).includes(String(r[v.c])) : String(r[c]) === String(v)));
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return q;
}
const supabase = { from: fakeFrom };

// Run the full path the transport runs: load grants (flag-gated), then resolve.
async function audienceWithGrants(category, { businessId = BIZ, flag = 'true' } = {}) {
  const prev = process.env[GRANTS_FLAG];
  if (flag === undefined) delete process.env[GRANTS_FLAG]; else process.env[GRANTS_FLAG] = flag;
  try {
    const grants = await G.loadBusinessGrants({ supabase, businessId });
    return await P.resolveNotificationAudience({ supabase, category, businessId, grants });
  } finally {
    if (prev === undefined) delete process.env[GRANTS_FLAG]; else process.env[GRANTS_FLAG] = prev;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner baseline is untouched
// ─────────────────────────────────────────────────────────────────────────────

test('with the flag OFF the new table is never queried and only the owner receives', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'company_financial', true)];   // present, but must be ignored
  scenario.failTables.add('business_member_notification_grants'); // querying it would surface here
  const r = await audienceWithGrants('company_financial', { flag: undefined });
  assert.deepStrictEqual(r.userIds, [OWNER], 'flag-off behaviour is not owner-only');
});

test('flag OFF: loadBusinessGrants returns null without touching the table', async () => {
  reset();
  scenario.failTables.add('business_member_notification_grants');
  const prev = process.env[GRANTS_FLAG]; delete process.env[GRANTS_FLAG];
  try {
    assert.strictEqual(await G.loadBusinessGrants({ supabase, businessId: BIZ }), null);
  } finally { if (prev !== undefined) process.env[GRANTS_FLAG] = prev; }
});

test('flag ON but no grants: CEO/CFO receive nothing, owner still does', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CEO, 'ceo'), member(CFO, 'cfo')];
  const r = await audienceWithGrants('company_financial');
  assert.deepStrictEqual(r.userIds, [OWNER]);
  assert.ok(r.dropped.some((d) => d.reason === 'no_grant'), 'the un-granted CEO/CFO were not recorded as dropped');
});

// ─────────────────────────────────────────────────────────────────────────────
// A grant admits exactly one category, for exactly the granted user
// ─────────────────────────────────────────────────────────────────────────────

test('a category grant admits ONLY that category', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'company_financial', true)];
  const fin = await audienceWithGrants('company_financial');
  assert.deepStrictEqual(fin.userIds.slice().sort((a, b) => a - b), [CFO, OWNER].sort((a, b) => a - b));
  const tax = await audienceWithGrants('tax_compliance');
  assert.deepStrictEqual(tax.userIds, [OWNER], 'a company_financial grant leaked into tax_compliance');
});

test('a grant with enabled=false suppresses (revoke)', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'company_financial', false)];
  const r = await audienceWithGrants('company_financial');
  assert.deepStrictEqual(r.userIds, [OWNER]);
});

test('a grant reaches only the granted user, not other CEO/CFO', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CEO, 'ceo'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'company_financial', true)];
  const r = await audienceWithGrants('company_financial');
  assert.ok(r.userIds.includes(CFO) && !r.userIds.includes(CEO), 'the grant reached the wrong member');
});

// ─────────────────────────────────────────────────────────────────────────────
// Grants never bypass role validation
// ─────────────────────────────────────────────────────────────────────────────

for (const [role, uid] of [['manager', MANAGER], ['admin', ADMIN], ['employee', EMPLOYEE]]) {
  test(`a forged grant for a ${role} does NOT deliver`, async () => {
    reset();
    scenario.members = [member(OWNER, 'owner'), member(uid, role)];
    scenario.grants = [grantRow(uid, 'company_financial', true)];   // forged: role is not grantable
    const r = await audienceWithGrants('company_financial');
    assert.deepStrictEqual(r.userIds, [OWNER], `a ${role} received via a forged grant`);
  });
}

test('a stale grant is inert after a CFO is demoted to manager', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'manager')];   // was CFO, now manager
  scenario.grants = [grantRow(CFO, 'company_financial', true)];          // grant left behind
  const r = await audienceWithGrants('company_financial');
  assert.deepStrictEqual(r.userIds, [OWNER], 'a demoted member kept receiving via a stale grant');
});

test('an inactive or removed granted CFO receives nothing', async () => {
  for (const status of ['inactive', 'removed']) {
    reset();
    scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo', status)];
    scenario.grants = [grantRow(CFO, 'company_financial', true)];
    const r = await audienceWithGrants('company_financial');
    assert.deepStrictEqual(r.userIds, [OWNER], `a ${status} CFO received via a grant`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Business isolation
// ─────────────────────────────────────────────────────────────────────────────

test('a grant in business A has no effect in business B', async () => {
  reset();
  scenario.members = [
    member(OWNER, 'owner', 'active', BIZ),  member(CFO, 'cfo', 'active', BIZ),
    member(OWNER, 'owner', 'active', BIZ_B), member(CFO, 'cfo', 'active', BIZ_B),
  ];
  scenario.grants = [grantRow(CFO, 'company_financial', true, BIZ)];   // granted in A only
  const inA = await audienceWithGrants('company_financial', { businessId: BIZ });
  assert.ok(inA.userIds.includes(CFO), 'the grant did not apply in its own business');
  const inB = await audienceWithGrants('company_financial', { businessId: BIZ_B });
  assert.ok(!inB.userIds.includes(CFO), "business A's grant leaked into business B");
  assert.deepStrictEqual(inB.userIds, [OWNER]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed
// ─────────────────────────────────────────────────────────────────────────────

test('a grants lookup failure narrows to owner-only, never widens', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'company_financial', true)];
  scenario.failTables.add('business_member_notification_grants');     // load errors → null
  const r = await audienceWithGrants('company_financial');
  assert.deepStrictEqual(r.userIds, [OWNER], 'a grant lookup failure added a recipient');
});

test('an unknown category grants to nobody', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'nonsense_category', true)];
  const r = await audienceWithGrants('nonsense_category');
  assert.deepStrictEqual(r.userIds, []);
  assert.ok(r.dropped.some((d) => d.reason === 'unknown_category'));
});

test('grantEnabled only honours a strict boolean true', () => {
  for (const v of [true]) assert.strictEqual(P.grantEnabled({ [CFO]: { company_financial: v } }, CFO, 'company_financial'), true);
  for (const v of ['true', 1, {}, 'yes', undefined, null, false, 0])
    assert.strictEqual(P.grantEnabled({ [CFO]: { company_financial: v } }, CFO, 'company_financial'), false,
      `a non-true value (${JSON.stringify(v)}) was read as a grant`);
});

test('the loader only maps ENABLED rows, and honours business scope', async () => {
  reset();
  scenario.grants = [
    grantRow(CFO, 'company_financial', true, BIZ),
    grantRow(CEO, 'tax_compliance', false, BIZ),      // disabled → excluded
    grantRow(MANAGER, 'company_financial', true, BIZ_B), // other business → excluded
  ];
  process.env[GRANTS_FLAG] = 'true';
  const map = await G.loadBusinessGrants({ supabase, businessId: BIZ });
  delete process.env[GRANTS_FLAG];
  assert.deepStrictEqual(map, { [CFO]: { company_financial: true } });
});

test('duplicate CEO/CFO membership rows still de-dupe to one recipient', async () => {
  reset();
  scenario.members = [member(OWNER, 'owner'), member(CFO, 'cfo'), member(CFO, 'cfo')];
  scenario.grants = [grantRow(CFO, 'company_financial', true)];
  const r = await audienceWithGrants('company_financial');
  assert.strictEqual(r.userIds.filter((u) => u === CFO).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// UI helper surface
// ─────────────────────────────────────────────────────────────────────────────

test('categoriesForRole lets CEO/CFO see the grantable categories, and never manager/employee', () => {
  for (const role of ['ceo', 'cfo']) {
    const cats = P.categoriesForRole(role);
    for (const c of P.GRANTABLE_CATEGORIES) assert.ok(cats.includes(c), `${role} cannot be offered ${c}`);
  }
  for (const role of ['manager', 'employee', 'admin']) {
    const cats = P.categoriesForRole(role);
    for (const c of P.GRANTABLE_CATEGORIES)
      assert.ok(!cats.includes(c), `${role} was offered grantable category ${c}`);
  }
});

test('GRANTABLE_CATEGORIES is exactly the six business-scoped ones', () => {
  assert.deepStrictEqual(
    P.GRANTABLE_CATEGORIES.slice().sort(),
    ['company_financial', 'tax_compliance', 'payables_receivables', 'documents_review', 'team_approvals', 'ai_cfo_summary'].sort());
});

// ─────────────────────────────────────────────────────────────────────────────
// Defence in depth — the in-loop re-checks, exercised with a LEAKY client whose query ignores
// its own filters. Mutation testing found these: with a faithful fake, the query filter alone
// satisfied every case and the re-checks were never run. The cost of a filter silently lapsing
// here is a wrong recipient or a cross-tenant read, so each layer is pinned on its own.
// ─────────────────────────────────────────────────────────────────────────────

// A client that returns exactly `rows`, ignoring every .eq()/.in() — i.e. the filter "stopped
// being applied". `spy` records which tables were queried.
function leaky(rows, spy) {
  return { from(table) {
    if (spy) spy.push(table);
    const q = { select: () => q, eq: () => q, in: () => q,
      then: (res) => Promise.resolve({ data: rows, error: null }).then(res) };
    return q;
  } };
}

test('loader: a disabled row that leaks past the query filter is still excluded', async () => {
  process.env[GRANTS_FLAG] = 'true';
  const map = await G.loadBusinessGrants({
    supabase: leaky([
      { user_id: CFO, category: 'company_financial', enabled: false, business_id: BIZ },
      { user_id: CEO, category: 'tax_compliance', enabled: true, business_id: BIZ },
    ]), businessId: BIZ });
  delete process.env[GRANTS_FLAG];
  assert.deepStrictEqual(map, { [CEO]: { tax_compliance: true } }, 'a disabled grant survived the re-check');
});

test('loader: a cross-business row that leaks past the query filter is still excluded', async () => {
  process.env[GRANTS_FLAG] = 'true';
  const map = await G.loadBusinessGrants({
    supabase: leaky([
      { user_id: CFO, category: 'company_financial', enabled: true, business_id: BIZ_B },  // wrong business
      { user_id: CEO, category: 'company_financial', enabled: true, business_id: BIZ },
    ]), businessId: BIZ });
  delete process.env[GRANTS_FLAG];
  assert.deepStrictEqual(map, { [CEO]: { company_financial: true } }, "another business's grant leaked in");
});

test('loader: with the flag OFF the grants table is never queried', async () => {
  const spy = [];
  const prev = process.env[GRANTS_FLAG]; delete process.env[GRANTS_FLAG];
  try {
    const map = await G.loadBusinessGrants({ supabase: leaky([], spy), businessId: BIZ });
    assert.strictEqual(map, null);
    assert.deepStrictEqual(spy, [], 'the table was queried despite the flag being off');
  } finally { if (prev !== undefined) process.env[GRANTS_FLAG] = prev; }
});

test('resolver: a non-grantable role that leaks past the query is still refused', async () => {
  // The membership query returns a manager despite the role filter; the eligibility re-check must
  // still exclude them. This is the role bypass a forged grant would attempt.
  const leakyMembers = { from(table) {
    const rows = table === 'business_members'
      ? [member(OWNER, 'owner'), member(MANAGER, 'manager')]   // manager should never be eligible
      : [];
    const q = { select: () => q, eq: () => q, in: () => q,
      then: (res) => Promise.resolve({ data: rows, error: null }).then(res) };
    return q;
  } };
  const r = await P.resolveNotificationAudience({
    supabase: leakyMembers, category: 'company_financial', businessId: BIZ,
    grants: { [MANAGER]: { company_financial: true } },
  });
  assert.deepStrictEqual(r.userIds, [OWNER], 'a manager was admitted via a leaked row + grant');
});

// ─────────────────────────────────────────────────────────────────────────────
// Two mutations survive here and both are EQUIVALENT — the mutated code produces identical output
// on every reachable input, so no test is added (a test asserting their mere textual presence
// would test the spelling, not a property):
//
//   1. `grantsActive = Boolean(grants)` in place of `grants && isGrantableCategory(category)`.
//      The business branch only executes for business-scoped categories, and GRANTABLE_CATEGORIES
//      IS exactly the business-scoped set — so isGrantableCategory(category) is always true there.
//      The guard is defensive redundancy that documents intent; it can never change the outcome.
//
//   2. `map[...] = row.enabled` in place of `= true` in the loader. Only rows with enabled===true
//      survive both the query's `.eq('enabled', true)` and the in-loop `enabled !== true` re-check,
//      so `row.enabled` is provably `true` at that assignment.
//
// Both are kept as code: the first states intent at a boundary, the second is a clearer literal.
// ─────────────────────────────────────────────────────────────────────────────
