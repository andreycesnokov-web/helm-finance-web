// Payment connection ENDPOINTS over real HTTP (migration 051).
//
// Proves the guards between a request and the table: that the flag hides the feature
// completely and BEFORE any database access, that a credential is refused rather than
// stored, that a workspace only ever sees its own connections, and -- the load-bearing one
// -- that configuring a connection mutates no ledger table.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const JWT_SECRET = 'test-jwt-secret';
const FLAG = 'PAYMENT_CONNECTIONS_ENABLED';

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WALLET_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const WALLET_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const OWNER_A = 7001, ACCOUNTANT_A = 7002, EMPLOYEE_A = 7003, OWNER_B = 7004;
const ADMIN = -1;   // isAdminUser treats the canonical negative id as platform admin

const dbState = { businesses: [], business_members: [], wallets: [], users: [],
                  payment_provider_connections: [], transactions: [], debts: [],
                  incoming_payments: [], audit_events: [] };
// Counts every table the fake is asked to read, so "404 before DB touch" is provable.
const dbTouches = { tables: [] };

function seed() {
  dbState.businesses = [
    { id: BIZ_A, type: 'business', owner_user_id: OWNER_A, created_at: '2026-01-01', name: 'Alpha', business_code: 'HF-BIZ-A', status: 'active' },
    { id: BIZ_B, type: 'business', owner_user_id: OWNER_B, created_at: '2026-01-02', name: 'Beta', business_code: 'HF-BIZ-B', status: 'active' },
  ];
  dbState.business_members = [
    { id: 'm1', user_id: OWNER_A, business_id: BIZ_A, role: 'owner', status: 'active' },
    { id: 'm2', user_id: ACCOUNTANT_A, business_id: BIZ_A, role: 'accountant', status: 'active' },
    { id: 'm3', user_id: EMPLOYEE_A, business_id: BIZ_A, role: 'employee', status: 'active' },
    { id: 'm4', user_id: OWNER_B, business_id: BIZ_B, role: 'owner', status: 'active' },
    { id: 'm5', user_id: ADMIN, business_id: BIZ_A, role: 'owner', status: 'active' },
  ];
  dbState.wallets = [
    { id: WALLET_A, business_id: BIZ_A, name: 'Midtrans wallet' },
    { id: WALLET_B, business_id: BIZ_B, name: 'Beta wallet' },
  ];
  dbState.users = [OWNER_A, ACCOUNTANT_A, EMPLOYEE_A, OWNER_B, ADMIN].map(id => ({ id }));
  dbState.payment_provider_connections = [];
  dbState.transactions = [];
  dbState.debts = [];
  dbState.incoming_payments = [];
  dbState.audit_events = [];
  dbTouches.tables = [];
}

function fakeFrom(table) {
  dbTouches.tables.push(table);
  const st = { filters: [], ins: [], single: false, maybeSingle: false, op: 'select',
               values: null, wantBiz: false, limit: null, cols: null };
  const rows = () => (dbState[table] = dbState[table] || []);
  const match = (r) => st.filters.every(([c, v]) => String(r[c]) === String(v))
    && st.ins.every(({ c, v }) => v.map(String).includes(String(r[c])));
  const embed = (list) => list.map(r => (st.wantBiz && table === 'business_members'
    ? { ...r, businesses: dbState.businesses.find(b => b.id === r.business_id) || null } : r));
  const project = (list) => (!st.cols ? list
    : list.map(r => Object.fromEntries(st.cols.filter(c => c in r).map(c => [c, r[c]]))));
  const q = {
    select(cols) {
      if (typeof cols !== 'string' || cols === '*') return q;
      if (cols.includes('(')) { if (cols.includes('businesses(')) st.wantBiz = true; return q; }
      st.cols = cols.split(',').map(c => c.trim()).filter(Boolean);
      return q;
    },
    eq(c, v) { st.filters.push([c, v]); return q; },
    in(c, v) { st.ins.push({ c, v }); return q; },
    or() { return q; }, order() { return q; },
    limit(n) { st.limit = n; return q; },
    single() { st.single = true; return q; },
    maybeSingle() { st.maybeSingle = true; return q; },
    insert(v) { st.op = 'insert'; st.values = v; return q; },
    update(v) { st.op = 'update'; st.values = v; return q; },
    then(resolve, reject) {
      let out;
      if (st.op === 'insert') {
        const arr = (Array.isArray(st.values) ? st.values : [st.values]).map(r => ({
          id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(), last_sync_at: null, last_webhook_at: null,
          last_error: null, ...r }));
        // Model 051's partial unique index on (business, provider, environment, account).
        if (table === 'payment_provider_connections') {
          for (const r of arr) {
            if (r.provider_account_id && rows().some(x => x.business_id === r.business_id
                && x.provider === r.provider && x.environment === r.environment
                && x.provider_account_id === r.provider_account_id)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }).then(resolve, reject);
            }
          }
        }
        for (const r of arr) rows().push(r);
        const p = project(arr);
        out = { data: st.single ? p[0] : p, error: null };
      } else if (st.op === 'update') {
        const hits = rows().filter(match);
        for (const r of hits) Object.assign(r, st.values, { updated_at: new Date().toISOString() });
        const p = project(hits);
        out = { data: st.single ? (p[0] || null) : p, error: null };
      } else {
        let list = embed(rows().filter(match));
        if (st.limit) list = list.slice(0, st.limit);
        list = project(list);
        out = (st.single || st.maybeSingle) ? { data: list[0] || null, error: null } : { data: list, error: null };
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
  require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true,
    exports: { ...real, createClient: () => supabase } };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k', BOT_TOKEN: 'b',
    JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: 's', PORT: '0', [FLAG]: 'true',
    ADMIN_TELEGRAM_IDS: String(ADMIN),   // isAdminUser reads this allow-list
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise(r => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { if (server) server.close(); });
beforeEach(() => { seed(); process.env[FLAG] = 'true'; });

const tok = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { token, business, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (business) headers['x-business-id'] = business;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const URL_LIST = '/api/payment-connections';
const conn = (o = {}) => ({ provider: 'midtrans', ...o });
const create = (body, biz = BIZ_A, user = OWNER_A) => api('POST', URL_LIST, { token: tok(user), business: biz, body });
const rows = () => dbState.payment_provider_connections;

// ── Flag ─────────────────────────────────────────────────────────────────────────────────
test('flag OFF: every route is 404 and NO table is touched', async () => {
  process.env[FLAG] = 'false';
  dbTouches.tables = [];
  assert.strictEqual((await api('GET', URL_LIST, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await create(conn())).status, 404);
  assert.strictEqual((await api('PATCH', `${URL_LIST}/x`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'connected' } })).status, 404);
  assert.strictEqual((await api('GET', '/api/admin/payment-connections', { token: tok(ADMIN) })).status, 404);
  // The whole point of checking the flag before requireBusiness: nothing is read at all.
  assert.deepStrictEqual(dbTouches.tables, [], `DB was touched with the flag off: ${dbTouches.tables}`);
  assert.strictEqual(rows().length, 0);
});

// ── Credentials ──────────────────────────────────────────────────────────────────────────
test('a request carrying a credential is REFUSED and nothing is written', async () => {
  for (const field of ['secret_key', 'api_key', 'webhook_secret', 'credentials']) {
    const r = await create(conn({ [field]: 'sk_live_secret' }));
    assert.strictEqual(r.status, 400, `${field} was not refused`);
    assert.strictEqual(r.body.error, 'credentials_not_accepted');
    assert.ok(!JSON.stringify(r.body).includes('sk_live_secret'), 'the secret was echoed back');
  }
  assert.strictEqual(rows().length, 0);
});

test('no stored connection ever carries a credential-shaped key', async () => {
  await create(conn({ provider_account_id: 'G123', display_name: 'Main' }));
  const keys = Object.keys(rows()[0]);
  assert.deepStrictEqual(keys.filter(k => /secret|api_?key|token|password|credential/i.test(k)), []);
});

// ── Create ───────────────────────────────────────────────────────────────────────────────
test('an owner records a connection, sandbox and disconnected by default', async () => {
  const r = await create(conn({ display_name: 'Midtrans Main' }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.connection.provider, 'midtrans');
  assert.strictEqual(r.body.connection.environment, 'sandbox');
  assert.strictEqual(r.body.connection.status, 'disconnected');
  assert.strictEqual(r.body.connection.business_id, BIZ_A);
});

test('THE core guarantee: configuring a connection mutates no ledger table', async () => {
  await create(conn({ provider: 'xendit', status: 'connected', linked_wallet_id: WALLET_A }));
  assert.strictEqual(dbState.transactions.length, 0, 'a transaction was created');
  assert.strictEqual(dbState.debts.length, 0, 'a debt was created');
  assert.strictEqual(dbState.incoming_payments.length, 0, 'an incoming payment was created');
  // And the wallet row itself is untouched -- no balance field written.
  assert.deepStrictEqual(dbState.wallets.find(w => w.id === WALLET_A),
    { id: WALLET_A, business_id: BIZ_A, name: 'Midtrans wallet' });
});

test('every supported provider can be connected', async () => {
  for (const provider of ['midtrans', 'xendit', 'doku', 'hitpay', 'duitku', 'ipaymu', 'manual', 'bank']) {
    assert.strictEqual((await create(conn({ provider }))).status, 201, `${provider} failed`);
  }
  assert.strictEqual(rows().length, 8);
});

test('an unsupported provider is refused', async () => {
  const r = await create(conn({ provider: 'brandnewpay' }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'invalid_provider');
});

test('a client cannot plant the error status', async () => {
  assert.strictEqual((await create(conn({ status: 'error' }))).body.error, 'status_not_settable');
});

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────
test('a user cannot create a connection for a business they do not belong to', async () => {
  assert.strictEqual((await create(conn(), BIZ_B, OWNER_A)).status, 403);
  assert.strictEqual(rows().length, 0);
});

test('business_id in the body is ignored - the active workspace wins', async () => {
  const r = await create(conn({ business_id: BIZ_B }), BIZ_A);
  assert.strictEqual(r.body.connection.business_id, BIZ_A);
});

test('a wallet from ANOTHER business cannot be linked', async () => {
  const r = await create(conn({ linked_wallet_id: WALLET_B }));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'wallet_not_in_business');
  assert.strictEqual(rows().length, 0);
});

test('a wallet from the SAME business links fine', async () => {
  const r = await create(conn({ linked_wallet_id: WALLET_A }));
  assert.strictEqual(r.body.connection.linked_wallet_id, WALLET_A);
});

test('the list never shows another business connections', async () => {
  await create(conn({ display_name: 'A-only' }), BIZ_A, OWNER_A);
  await create(conn({ display_name: 'B-only' }), BIZ_B, OWNER_B);
  const a = await api('GET', URL_LIST, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(a.body.connections.length, 1);
  assert.strictEqual(a.body.connections[0].display_name, 'A-only');
});

// ── Roles ────────────────────────────────────────────────────────────────────────────────
test('an accountant may read but not create; an employee may do neither', async () => {
  assert.strictEqual((await api('GET', URL_LIST, { token: tok(ACCOUNTANT_A), business: BIZ_A })).status, 200);
  assert.strictEqual((await create(conn(), BIZ_A, ACCOUNTANT_A)).status, 403);
  assert.strictEqual((await api('GET', URL_LIST, { token: tok(EMPLOYEE_A), business: BIZ_A })).status, 403);
  assert.strictEqual((await create(conn(), BIZ_A, EMPLOYEE_A)).status, 403);
});

// ── Patch ────────────────────────────────────────────────────────────────────────────────
test('status and display name can be updated', async () => {
  const c = (await create(conn())).body.connection;
  const r = await api('PATCH', `${URL_LIST}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A,
    body: { status: 'connected', display_name: 'Renamed' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.connection.status, 'connected');
  assert.strictEqual(r.body.connection.display_name, 'Renamed');
});

test('provider and environment are immutable', async () => {
  const c = (await create(conn())).body.connection;
  for (const body of [{ provider: 'xendit' }, { environment: 'production' }]) {
    const r = await api('PATCH', `${URL_LIST}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A, body });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'field_not_patchable');
  }
  assert.strictEqual(rows()[0].provider, 'midtrans');
});

test('another business cannot patch this connection - 404, not 403', async () => {
  const c = (await create(conn())).body.connection;
  const r = await api('PATCH', `${URL_LIST}/${c.id}`, { token: tok(OWNER_B), business: BIZ_B, body: { status: 'connected' } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(rows()[0].status, 'disconnected');
});

test('patching does not touch the ledger either', async () => {
  const c = (await create(conn())).body.connection;
  await api('PATCH', `${URL_LIST}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'connected' } });
  assert.strictEqual(dbState.transactions.length, 0);
  assert.strictEqual(dbState.debts.length, 0);
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

// ── Duplicates ───────────────────────────────────────────────────────────────────────────
test('the same provider account twice is a 409', async () => {
  await create(conn({ provider_account_id: 'G123' }));
  const again = await create(conn({ provider_account_id: 'G123' }));
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.error, 'connection_exists');
  assert.strictEqual(rows().length, 1);
});

// ── Admin monitor ────────────────────────────────────────────────────────────────────────
test('the admin monitor lists connections across businesses, read-only', async () => {
  await create(conn({ display_name: 'A' }), BIZ_A, OWNER_A);
  await create(conn({ provider: 'xendit', display_name: 'B' }), BIZ_B, OWNER_B);
  const r = await api('GET', '/api/admin/payment-connections', { token: tok(ADMIN) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.connections.length, 2);
  const a = r.body.connections.find(c => c.display_name === 'A');
  assert.strictEqual(a.business_name, 'Alpha');
  assert.strictEqual(a.business_code, 'HF-BIZ-A');
  for (const k of ['provider','environment','status','last_sync_at','last_webhook_at','last_error','created_at']) {
    assert.ok(k in a, `admin row missing ${k}`);
  }
});

test('a non-admin cannot reach the admin monitor', async () => {
  const r = await api('GET', '/api/admin/payment-connections', { token: tok(OWNER_A) });
  assert.ok([401, 403].includes(r.status), `expected 401/403, got ${r.status}`);
});

// ── Audit ────────────────────────────────────────────────────────────────────────────────
test('create and update are audited, with no credential in the payload', async () => {
  const c = (await create(conn({ provider_account_id: 'G123' }))).body.connection;
  await api('PATCH', `${URL_LIST}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'connected' } });
  const evts = dbState.audit_events.filter(a => a.entity_type === 'payment_provider_connection');
  assert.deepStrictEqual(evts.map(e => e.action), ['created', 'updated']);
  assert.ok(!/secret|api_?key|token|password/i.test(JSON.stringify(evts)), 'audit payload looks credential-shaped');
});
