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
const OWNER_A = -1, CFO_A = -2, MANAGER_A = -3, OWNER_B = -4, CFO_B = -5;

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
    { id: 'm-owner-b', user_id: OWNER_B, business_id: BIZ_B, role: 'owner',   status: 'active', joined_at: '2026-01-02', display_name: 'Owner B' },
    { id: 'm-cfo-b',   user_id: CFO_B,   business_id: BIZ_B, role: 'cfo',     status: 'active', joined_at: '2026-01-05', display_name: 'CFO B' },
  ];
  dbState.users = [OWNER_A, CFO_A, MANAGER_A, OWNER_B, CFO_B].map((id) => ({ id, first_name: `U${id}`, username: `u${id}` }));
  dbState.grants = [];
  dbState.audit = [];
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
    upsert(v, opts) { state.op = 'upsert'; state.values = v; state.onConflict = opts?.onConflict; return q; },
    then(resolve, reject) {
      let out;
      if (state.op === 'insert') {
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
const supabase = { from: fakeFrom, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) }, auth: {} };

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
