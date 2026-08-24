// Company-admin grant ENDPOINTS over real HTTP.
//
// The policy/loader tests prove who receives. These prove the owner-only, business-scoped API
// that writes the grants: that a non-owner cannot touch it, that the flag hides it entirely, that
// a member of another business cannot be edited through this workspace, that unknown categories
// and un-grantable roles are refused, and that a change writes an audit row.
//
// A hand-written fake Supabase backs it — enough to satisfy the active-workspace resolver's
// `businesses(*)` embed and the routes' reads/writes. No PGlite: the routes here are guard logic,
// not SQL, and the SQL is covered by the migration test.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const JWT_SECRET = 'test-jwt-secret';
const GRANTS_FLAG = 'COMPANY_NOTIFICATION_GRANTS_ENABLED';
const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OWNER_A = -1, CFO_A = -2, MANAGER_A = -3, OWNER_B = -4, CFO_B = -5, ADMIN_A = -6;

// ── in-memory tables ──────────────────────────────────────────────────────────
const dbState = { business_members: [], businesses: [], users: [], grants: [], audit: [] };
function seed() {
  dbState.businesses = [
    { id: BIZ_A, type: 'business', owner_user_id: OWNER_A, created_at: '2026-01-01', name: 'Alpha', status: 'active' },
    { id: BIZ_B, type: 'business', owner_user_id: OWNER_B, created_at: '2026-01-02', name: 'Beta', status: 'active' },
  ];
  dbState.business_members = [
    { id: 'm-owner-a', user_id: OWNER_A, business_id: BIZ_A, role: 'owner',   status: 'active', joined_at: '2026-01-01', display_name: 'Owner A' },
    { id: 'm-cfo-a',   user_id: CFO_A,   business_id: BIZ_A, role: 'cfo',     status: 'active', joined_at: '2026-01-03', display_name: 'CFO A' },
    { id: 'm-mgr-a',   user_id: MANAGER_A, business_id: BIZ_A, role: 'manager', status: 'active', joined_at: '2026-01-04', display_name: 'Mgr A' },
    { id: 'm-adm-a',   user_id: ADMIN_A, business_id: BIZ_A, role: 'admin',   status: 'active', joined_at: '2026-01-06', display_name: 'Adm A' },
    { id: 'm-owner-b', user_id: OWNER_B, business_id: BIZ_B, role: 'owner',   status: 'active', joined_at: '2026-01-02', display_name: 'Owner B' },
    { id: 'm-cfo-b',   user_id: CFO_B,   business_id: BIZ_B, role: 'cfo',     status: 'active', joined_at: '2026-01-05', display_name: 'CFO B' },
  ];
  dbState.users = [OWNER_A, CFO_A, MANAGER_A, OWNER_B, CFO_B, ADMIN_A].map((id) => ({ id, first_name: `U${id}`, username: `u${id}` }));
  dbState.grants = [];
  dbState.audit = [];
  dbFlags.rpcMode = 'ok';
  dbFlags.disableFail = false;
  dbFlags.rpcCalls = [];
}

// ── fake Supabase (embed-aware for businesses(*)) ─────────────────────────────
function fakeFrom(table) {
  const state = { table, filters: [], ins: [], single: false, op: 'select', values: null, onConflict: null };
  const rowsFor = (t) => t === 'audit_events' ? dbState.audit
    : t === 'business_member_notification_grants' ? dbState.grants : (dbState[t] || []);
  const apply = () => rowsFor(table).filter((r) =>
    state.filters.every(([c, v]) => String(r[c]) === String(v))
    && state.ins.every(({ c, v }) => v.map(String).includes(String(r[c]))));
  const embed = (rows) => rows.map((r) => {
    if (table === 'business_members' && state.wantBiz) {
      const b = dbState.businesses.find((x) => x.id === r.business_id) || null;
      return { ...r, businesses: b };
    }
    return r;
  });
  const q = {
    select(cols) { if (typeof cols === 'string' && cols.includes('businesses(')) state.wantBiz = true; return q; },
    eq(c, v) { state.filters.push([c, v]); return q; },
    in(c, v) { state.ins.push({ c, v }); return q; },
    order() { return q; },
    limit() { return q; },
    single() { state.single = true; return q; },
    maybeSingle() { state.single = true; return q; },
    insert(v) { state.op = 'insert'; state.values = v; return q; },
    update(v) { state.op = 'update'; state.values = v; return q; },
    upsert(v, opts) { state.op = 'upsert'; state.values = v; state.onConflict = opts?.onConflict; return q; },
    then(resolve, reject) {
      let out;
      if (state.op === 'update') {
        const hits = apply();
        for (const row of hits) Object.assign(row, state.values);
        out = { data: hits, error: null };
      } else if (state.op === 'insert') {
        const arr = Array.isArray(state.values) ? state.values : [state.values];
        for (const row of arr) rowsFor(table).push({ ...row });
        out = { data: arr, error: null };
      } else if (state.op === 'upsert') {
        const arr = Array.isArray(state.values) ? state.values : [state.values];
        for (const row of arr) {
          const keys = (state.onConflict || '').split(',').map((s) => s.trim());
          const idx = dbState.grants.findIndex((g) => keys.every((k) => String(g[k]) === String(row[k])));
          if (idx >= 0) dbState.grants[idx] = { ...dbState.grants[idx], ...row };
          else dbState.grants.push({ ...row });
        }
        out = { data: arr, error: null };
      } else {
        const rows = embed(apply());
        out = state.single ? { data: rows[0] || null, error: null } : { data: rows, error: null };
      }
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return q;
}
// Emulate the two Postgres functions against dbState so the endpoint tests exercise the real
// atomic path. `rpcMode` lets a test force the failure cases the SQL would produce.
//   'ok'          — behave like the function (default)
//   'error'       — the transaction failed (e.g. audit insert error) → { error }
//   'unconfirmed' — a null/zero-row result the API must NOT treat as success → { data: null }
const dbFlags = { rpcMode: 'ok', disableFail: false, rpcCalls: [] };
function rpcApply(args) {
  const { p_business_id, p_user_id, p_granted_by, p_actor_role, p_changes } = args;
  const m = dbState.business_members.find(x => x.business_id === p_business_id && x.user_id === p_user_id
    && x.status === 'active' && ['ceo', 'cfo'].includes(x.role));
  if (!m) return { data: null, error: { message: 'member_not_grantable' } };
  let changed = 0;
  for (const [cat, enabled] of Object.entries(p_changes)) {
    const idx = dbState.grants.findIndex(g => g.business_id === p_business_id && g.user_id === p_user_id && g.category === cat);
    const prev = idx >= 0 ? dbState.grants[idx].enabled === true : false;
    if (idx >= 0) dbState.grants[idx] = { ...dbState.grants[idx], enabled, granted_by_user_id: p_granted_by };
    else dbState.grants.push({ business_id: p_business_id, user_id: p_user_id, category: cat, enabled, granted_by_user_id: p_granted_by });
    if (prev !== enabled) {
      dbState.audit.push({ entity_type: 'notification_grant', action: enabled ? 'granted' : 'revoked', business_id: p_business_id });
      changed++;
    }
  }
  return { data: { changed }, error: null };
}
function rpcDisable(args) {
  const { p_business_id, p_user_id } = args;
  let changed = 0;
  for (const g of dbState.grants) {
    if (g.business_id === p_business_id && g.user_id === p_user_id && g.enabled === true) {
      g.enabled = false;
      dbState.audit.push({ entity_type: 'notification_grant', action: 'auto_revoked', business_id: p_business_id });
      changed++;
    }
  }
  return { data: { changed }, error: null };
}
const supabase = {
  from: fakeFrom,
  rpc: async (name, args) => {
    dbFlags.rpcCalls.push(name);
    if (name === 'apply_notification_grants') {
      if (dbFlags.rpcMode === 'error') return { data: null, error: { message: 'audit down' } };
      if (dbFlags.rpcMode === 'unconfirmed') return { data: null, error: null };
      return rpcApply(args);
    }
    if (name === 'disable_member_notification_grants') {
      if (dbFlags.disableFail) return { data: null, error: { message: 'disable down' } };
      return rpcDisable(args);
    }
    return { data: null, error: null };
  },
  storage: { from: () => ({}) }, auth: {},
};

let server = null, BASE = null, jwt = null;
before(async () => {
  seed();
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true,
    exports: { ...real, createClient: () => supabase },
  };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k', BOT_TOKEN: 'b',
    JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: 's', PORT: '0', [GRANTS_FLAG]: 'true',
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { if (server) server.close(); });

const tok = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { token, business, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (business) headers['x-business-id'] = business;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const GET = '/api/team/notification-grants';
const PUT = (mid) => `/api/team/members/${mid}/notification-grants`;

test('GET requires the owner: a CFO is 403', async () => {
  seed();
  assert.strictEqual((await api('GET', GET, { token: tok(CFO_A), business: BIZ_A })).status, 403);
});

test('GET as owner returns the grant matrix, CFO grantable, manager not', async () => {
  seed();
  const r = await api('GET', GET, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 200);
  const cfo = r.body.members.find((m) => m.member_id === 'm-cfo-a');
  const mgr = r.body.members.find((m) => m.member_id === 'm-mgr-a');
  assert.strictEqual(cfo.grantable, true);
  assert.strictEqual(mgr.grantable, false);
  // No raw user_id is exposed in the row.
  assert.ok(!('user_id' in cfo), 'user_id leaked to the client');
});

test('PUT grants a category to a CFO and writes an audit row', async () => {
  seed();
  const r = await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.granted.company_financial, true);
  assert.ok(dbState.grants.some((g) => g.business_id === BIZ_A && g.user_id === CFO_A && g.category === 'company_financial' && g.enabled === true));
  assert.ok(dbState.audit.some((a) => a.entity_type === 'notification_grant' && a.action === 'granted'),
    'no audit row was written for the grant');
});

test('PUT is idempotent and revoke writes a revoked audit row', async () => {
  seed();
  await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  const r = await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: false } } });
  assert.strictEqual(r.body.granted.company_financial, false);
  assert.strictEqual(dbState.grants.filter((g) => g.user_id === CFO_A && g.category === 'company_financial').length, 1, 'revoke created a duplicate row');
  assert.ok(dbState.audit.some((a) => a.action === 'revoked'));
});

test('PUT rejects an unknown category with 400 and writes nothing', async () => {
  seed();
  const r = await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { not_a_category: true } } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(dbState.grants.length, 0);
});

test('PUT rejects a non-boolean value with 400', async () => {
  seed();
  const r = await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: 'yes' } } });
  assert.strictEqual(r.status, 400);
});

test('PUT on a manager (un-grantable role) is 409', async () => {
  seed();
  const r = await api('PUT', PUT('m-mgr-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(dbState.grants.length, 0);
});

test('a non-owner cannot write grants (403)', async () => {
  seed();
  const r = await api('PUT', PUT('m-cfo-a'), { token: tok(CFO_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 403);
});

test("owner of business B cannot edit business A's member", async () => {
  seed();
  // Owner B authenticates but names business A they do not belong to → workspace not accessible.
  const viaA = await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_B), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(viaA.status, 403, 'owner B reached into business A');
  // Owner B in their OWN workspace cannot target A's member id → 404 (not in this business).
  const viaB = await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_B), business: BIZ_B, body: { grants: { company_financial: true } } });
  assert.strictEqual(viaB.status, 404, "A's member was editable from business B");
  assert.strictEqual(dbState.grants.length, 0);
});

test('with the flag OFF both endpoints are 404', async () => {
  seed();
  const prev = process.env[GRANTS_FLAG];
  process.env[GRANTS_FLAG] = 'false';
  try {
    assert.strictEqual((await api('GET', GET, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
    assert.strictEqual((await api('PUT', PUT('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } })).status, 404);
    assert.strictEqual(dbState.grants.length, 0, 'a write happened while the flag was off');
  } finally { process.env[GRANTS_FLAG] = prev; }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 Blocker 2 — grant change and audit are atomic
// ─────────────────────────────────────────────────────────────────────────────

const TG = (mid) => `/api/team/members/${mid}/notification-grants`;

test('atomic success: one grant row and exactly one audit event', async () => {
  seed();
  const r = await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(dbState.grants.filter(g => g.user_id === CFO_A && g.category === 'company_financial' && g.enabled).length, 1);
  assert.strictEqual(dbState.audit.filter(a => a.entity_type === 'notification_grant').length, 1);
});

test('audit failure: the grant change does not commit and the API returns a safe error', async () => {
  seed();
  dbFlags.rpcMode = 'error';   // the transaction (grant + audit) failed
  const r = await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 500);
  // The CLEAN fail-closed path (grant_write_failed), not an uncaught crash (grants_write_failed).
  assert.strictEqual(r.body.error, 'grant_write_failed', 'the failure was not handled by the explicit guard');
  assert.ok(!/audit down|supabase|sql/i.test(JSON.stringify(r.body)), 'a raw technical detail leaked to the client');
  assert.strictEqual(dbState.grants.length, 0, 'a grant persisted despite the atomic failure');
});

test('unconfirmed RPC result: the API does not claim success', async () => {
  seed();
  dbFlags.rpcMode = 'unconfirmed';   // null/zero-row, nothing confirmed
  const r = await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 500, 'an unconfirmed result was treated as success');
  // Must be the explicit guard rejecting a non-confirming result, not a null-deref crash.
  assert.strictEqual(r.body.error, 'grant_write_failed', 'an unconfirmed result was not caught by the explicit guard');
});

test('idempotent repeat writes no duplicate audit event', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  const before = dbState.audit.length;
  const r = await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.changed, 0, 'a no-op repeat reported a change');
  assert.strictEqual(dbState.audit.length, before, 'the repeat wrote a duplicate audit row');
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 Blocker 1 — losing eligibility disables grants; re-promotion does not restore
// ─────────────────────────────────────────────────────────────────────────────

const PATCH = (mid) => `/api/team/members/${mid}`;
const grantEnabled = (uid, cat) => dbState.grants.some(g => g.user_id === uid && g.category === cat && g.enabled === true);

test('demote CFO to manager disables their grants; re-promote does NOT restore', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  assert.ok(grantEnabled(CFO_A, 'company_financial'));

  assert.strictEqual((await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'manager' } })).status, 200);
  assert.ok(!grantEnabled(CFO_A, 'company_financial'), 'demotion did not disable the grant');

  assert.strictEqual((await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'cfo' } })).status, 200);
  assert.ok(!grantEnabled(CFO_A, 'company_financial'), 're-promotion silently restored the stale grant');
});

test('deactivate CFO (status inactive) disables their grants', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { status: 'inactive' } });
  assert.ok(!grantEnabled(CFO_A, 'company_financial'));
});

test('removing a member disables their grants; a re-add starts from all-off', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  const del = await api('DELETE', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A });
  assert.ok(del.status < 500, `remove failed: ${del.status}`);
  assert.ok(!grantEnabled(CFO_A, 'company_financial'), 'removal did not disable the grant');
});

test('an ADMIN cannot reactivate a stale grant by flipping roles', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  await api('PATCH', PATCH('m-cfo-a'), { token: tok(ADMIN_A), business: BIZ_A, body: { role: 'manager' } });
  await api('PATCH', PATCH('m-cfo-a'), { token: tok(ADMIN_A), business: BIZ_A, body: { role: 'cfo' } });
  assert.ok(!grantEnabled(CFO_A, 'company_financial'), 'an admin reactivated a stale grant');
  assert.strictEqual((await api('PUT', TG('m-cfo-a'), { token: tok(ADMIN_A), business: BIZ_A, body: { grants: { company_financial: true } } })).status, 403);
});

test('an unrelated member change does not disable another members grants', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  await api('PATCH', PATCH('m-mgr-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'employee' } });
  assert.ok(grantEnabled(CFO_A, 'company_financial'), 'an unrelated change revoked the CFO grant');
});

test('a Business A member change cannot affect Business B grants', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  await api('PUT', TG('m-cfo-b'), { token: tok(OWNER_B), business: BIZ_B, body: { grants: { company_financial: true } } });
  await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'manager' } });
  assert.ok(!grantEnabled(CFO_A, 'company_financial'), 'business A grant was not disabled');
  assert.ok(grantEnabled(CFO_B, 'company_financial'), 'business A change reached business B');
});

test('an active CFO with a grant is unaffected by a same-role update', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'cfo' } });
  assert.ok(grantEnabled(CFO_A, 'company_financial'), 'a same-role update disabled an active CFO grant');
});

test('flag OFF: neither endpoint queries the grants table or RPC', async () => {
  seed();
  const prev = process.env[GRANTS_FLAG];
  process.env[GRANTS_FLAG] = 'false';
  try {
    assert.strictEqual((await api('GET', GET, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
    assert.strictEqual((await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } })).status, 404);
    // A role change while the flag is off must not attempt the disable RPC (table may not exist).
    const patch = await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'manager' } });
    assert.strictEqual(patch.status, 200, 'a role change failed while grants were off');
    assert.strictEqual(dbState.grants.length, 0, 'a grant table write happened while the flag was off');
  } finally { process.env[GRANTS_FLAG] = prev; }
});

test('PATCH fails closed if the grant cleanup cannot confirm (role does NOT change)', async () => {
  seed();
  await api('PUT', TG('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { grants: { company_financial: true } } });
  dbFlags.disableFail = true;   // the disable RPC cannot confirm
  const r = await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'manager' } });
  assert.strictEqual(r.status, 500, 'a failed grant cleanup still let the role change through');
  assert.strictEqual(r.body.error, 'grant_cleanup_failed');
  // The role must NOT have changed — the demotion was aborted because grants could not be cleared.
  assert.strictEqual(dbState.business_members.find(m => m.id === 'm-cfo-a').role, 'cfo', 'the role changed despite the cleanup failing');
});

test('flag OFF: a role change never calls the disable RPC', async () => {
  seed();
  const prev = process.env[GRANTS_FLAG];
  process.env[GRANTS_FLAG] = 'false';
  try {
    dbFlags.rpcCalls = [];
    const r = await api('PATCH', PATCH('m-cfo-a'), { token: tok(OWNER_A), business: BIZ_A, body: { role: 'manager' } });
    assert.strictEqual(r.status, 200);
    assert.ok(!dbFlags.rpcCalls.includes('disable_member_notification_grants'),
      'the disable RPC was called while the feature flag was off');
  } finally { process.env[GRANTS_FLAG] = prev; }
});
