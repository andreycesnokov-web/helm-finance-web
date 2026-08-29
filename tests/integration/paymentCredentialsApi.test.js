// Credential vault ENDPOINTS over real HTTP (migration 052).
//
// The assertions that matter are negative and security-critical: the flag hides the feature
// before any DB access, a missing key fails CLOSED rather than storing plaintext, no
// response or audit row ever contains a secret or its key material, and configuring a
// credential mutates no ledger table.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const JWT_SECRET = 'test-jwt-secret';
const FLAG = 'PAYMENT_CREDENTIALS_VAULT_ENABLED';
const KEY_ENV = 'PAYMENT_CREDENTIALS_ENCRYPTION_KEY';
const GOOD_KEY = crypto.randomBytes(32).toString('base64');

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CONN_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';   // BIZ_A, sandbox
const CONN_PROD = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; // BIZ_A, production
const CONN_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';   // BIZ_B, sandbox
const OWNER_A = 7001, ACCOUNTANT_A = 7002, EMPLOYEE_A = 7003, OWNER_B = 7004;
const ADMIN = -1;

const SECRET = 'SB-Mid-server-SUPERSECRETVALUE9999';

const dbState = { businesses: [], business_members: [], wallets: [], users: [],
                  payment_provider_connections: [], payment_provider_credentials: [],
                  transactions: [], debts: [], incoming_payments: [], audit_events: [] };
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
  dbState.payment_provider_connections = [
    { id: CONN_A, business_id: BIZ_A, provider: 'xendit', environment: 'sandbox', display_name: 'Xendit sandbox', status: 'disconnected' },
    { id: CONN_PROD, business_id: BIZ_A, provider: 'midtrans', environment: 'production', display_name: 'Midtrans live', status: 'disconnected' },
    { id: CONN_B, business_id: BIZ_B, provider: 'xendit', environment: 'sandbox', display_name: 'Beta sandbox', status: 'disconnected' },
  ];
  dbState.users = [OWNER_A, ACCOUNTANT_A, EMPLOYEE_A, OWNER_B, ADMIN].map(id => ({ id }));
  dbState.wallets = [];
  dbState.payment_provider_credentials = [];
  dbState.transactions = []; dbState.debts = []; dbState.incoming_payments = [];
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
          updated_at: new Date().toISOString(), revoked_at: null, revoked_by_user_id: null, ...r }));
        // Model 052's partial unique index: one ACTIVE credential per (connection, type).
        if (table === 'payment_provider_credentials') {
          for (const r of arr) {
            if (r.status === 'active' && rows().some(x => x.connection_id === r.connection_id
                && x.credential_type === r.credential_type && x.status === 'active')) {
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
    JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: 's', PORT: '0',
    [FLAG]: 'true', [KEY_ENV]: GOOD_KEY, ADMIN_TELEGRAM_IDS: String(ADMIN),
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise(r => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { if (server) server.close(); });
beforeEach(() => { seed(); process.env[FLAG] = 'true'; process.env[KEY_ENV] = GOOD_KEY; });

const tok = (u) => jwt.sign({ userId: u }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { token, business, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (business) headers['x-business-id'] = business;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const credUrl = (connId) => `/api/payment-connections/${connId}/credentials`;
const post = (body, conn = CONN_A, biz = BIZ_A, user = OWNER_A) =>
  api('POST', credUrl(conn), { token: tok(user), business: biz, body });
const creds = () => dbState.payment_provider_credentials;
const validBody = (o = {}) => ({ credential_type: 'server_key', value: SECRET, ...o });

// ── Flag ─────────────────────────────────────────────────────────────────────────────────
test('flag OFF: every credential route is 404 and NO table is touched', async () => {
  process.env[FLAG] = 'false';
  dbTouches.tables = [];
  assert.strictEqual((await api('GET', credUrl(CONN_A), { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await post(validBody())).status, 404);
  assert.strictEqual((await api('DELETE', `${credUrl(CONN_A)}/x`, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await api('GET', '/api/admin/payment-credentials', { token: tok(ADMIN) })).status, 404);
  assert.deepStrictEqual(dbTouches.tables, [], `DB touched with the flag off: ${dbTouches.tables}`);
  assert.strictEqual(creds().length, 0);
});

// ── Fails closed without a key ───────────────────────────────────────────────────────────
test('a MISSING encryption key fails closed - no plaintext fallback', async () => {
  delete process.env[KEY_ENV];
  const r = await post(validBody());
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.error, 'credential_vault_not_configured');
  assert.strictEqual(creds().length, 0, 'a credential was stored without a key');
});

test('a WRONG-LENGTH key also fails closed', async () => {
  process.env[KEY_ENV] = crypto.randomBytes(16).toString('base64');
  const r = await post(validBody());
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.error, 'credential_vault_not_configured');
  assert.strictEqual(creds().length, 0);
});

test('the not-configured error never echoes the submitted secret', async () => {
  delete process.env[KEY_ENV];
  const r = await post(validBody());
  assert.ok(!JSON.stringify(r.body).includes(SECRET));
});

// ── Storage is ciphertext only ───────────────────────────────────────────────────────────
test('the stored row contains ciphertext and NEVER the plaintext', async () => {
  const r = await post(validBody());
  assert.strictEqual(r.status, 201);
  const row = creds()[0];
  const blob = JSON.stringify(row);
  assert.ok(!blob.includes(SECRET), 'the plaintext secret was stored');
  assert.ok(row.encrypted_value && row.encryption_iv && row.encryption_tag, 'ciphertext triple missing');
  assert.ok(!Buffer.from(row.encrypted_value, 'base64').toString('utf8').includes(SECRET));
  // No plaintext-named column was invented on the way in.
  for (const k of ['value', 'plaintext', 'secret', 'api_key']) assert.ok(!(k in row), `${k} was written`);
});

test('the stored row is decryptable back to the original secret', async () => {
  await post(validBody());
  const row = creds()[0];
  const VAULT = require('../../server/lib/credentialVault');
  const plain = VAULT.decrypt(row, { business_id: BIZ_A, connection_id: CONN_A, credential_type: 'server_key' });
  assert.strictEqual(plain, SECRET, 'stored ciphertext does not round-trip');
});

test('fingerprint and last4 are derived, and last4 is only a tail', async () => {
  await post(validBody());
  const row = creds()[0];
  assert.match(row.value_fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!row.value_fingerprint.includes(SECRET));
  assert.strictEqual(row.value_last4, SECRET.slice(-4));
});

// ── No plaintext or key material ever leaves the API ─────────────────────────────────────
test('the CREATE response is metadata only', async () => {
  const r = await post(validBody());
  const blob = JSON.stringify(r.body);
  assert.ok(!blob.includes(SECRET), 'the secret came back in the response');
  // Checked as exact key names, not substrings: value_last4 and value_fingerprint are
  // intended metadata and legitimately contain the word "value".
  for (const k of ['encrypted_value', 'encryption_iv', 'encryption_tag', 'plaintext']) {
    assert.ok(!blob.includes(k), `${k} appeared in the create response`);
  }
  assert.deepStrictEqual(Object.keys(r.body.credential).filter(k =>
    ['encrypted_value','encryption_iv','encryption_tag','value','plaintext','secret'].includes(k)), [])
  assert.strictEqual(r.body.credential.credential_type, 'server_key');
  assert.strictEqual(r.body.credential.value_last4, SECRET.slice(-4));
});

test('the GET response is metadata only', async () => {
  await post(validBody());
  const r = await api('GET', credUrl(CONN_A), { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 200);
  const blob = JSON.stringify(r.body);
  assert.ok(!blob.includes(SECRET));
  for (const k of ['encrypted_value', 'encryption_iv', 'encryption_tag']) {
    assert.ok(!blob.includes(k), `${k} appeared in the list response`);
  }
  assert.strictEqual(r.body.credentials.length, 1);
  assert.strictEqual(r.body.credentials[0].status, 'active');
});

test('the ADMIN response is metadata only', async () => {
  await post(validBody());
  const r = await api('GET', '/api/admin/payment-credentials', { token: tok(ADMIN) });
  assert.strictEqual(r.status, 200);
  const blob = JSON.stringify(r.body);
  assert.ok(!blob.includes(SECRET));
  for (const k of ['encrypted_value', 'encryption_iv', 'encryption_tag', 'value_fingerprint']) {
    assert.ok(!blob.includes(k), `${k} appeared in the admin response`);
  }
  assert.strictEqual(r.body.credentials[0].business_name, 'Alpha');
  assert.strictEqual(r.body.credentials[0].value_last4, SECRET.slice(-4));
});

test('the audit trail carries no secret, ciphertext or fingerprint', async () => {
  await post(validBody());
  const blob = JSON.stringify(dbState.audit_events);
  assert.ok(!blob.includes(SECRET), 'the secret reached the append-only audit log');
  for (const k of ['encrypted_value', 'encryption_iv', 'encryption_tag', 'value_fingerprint']) {
    assert.ok(!blob.includes(k), `${k} reached the audit log`);
  }
  assert.strictEqual(dbState.audit_events[0].action, 'credential_created');
});

// ── Sandbox only ─────────────────────────────────────────────────────────────────────────
test('a PRODUCTION connection refuses credentials in v1', async () => {
  const r = await post(validBody(), CONN_PROD);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'production_credentials_not_enabled');
  assert.strictEqual(creds().length, 0);
});

// ── Ledger safety ────────────────────────────────────────────────────────────────────────
test('THE core guarantee: storing a credential mutates no ledger table', async () => {
  await post(validBody());
  await post(validBody({ credential_type: 'client_key' }));
  assert.strictEqual(dbState.transactions.length, 0);
  assert.strictEqual(dbState.debts.length, 0);
  assert.strictEqual(dbState.incoming_payments.length, 0);
  assert.strictEqual(dbState.wallets.length, 0);
  // The connection row itself is not repurposed as a credential store.
  const conn = dbState.payment_provider_connections.find(c => c.id === CONN_A);
  assert.ok(!JSON.stringify(conn).includes(SECRET));
});

// ── Rotation ─────────────────────────────────────────────────────────────────────────────
test('re-adding the same type ROTATES: the previous credential is revoked, not deleted', async () => {
  const first = (await post(validBody())).body.credential;
  const second = await post(validBody({ value: 'SB-Mid-server-ROTATEDVALUE7777' }));
  assert.strictEqual(second.status, 201);
  assert.strictEqual(second.body.rotated, true);
  assert.strictEqual(creds().length, 2, 'history was discarded instead of revoked');
  const old = creds().find(c => c.id === first.id);
  assert.strictEqual(old.status, 'revoked');
  assert.ok(old.revoked_at && old.revoked_by_user_id === OWNER_A);
  assert.strictEqual(creds().filter(c => c.status === 'active').length, 1);
});

test('the first credential of a type is created, not rotated', async () => {
  assert.strictEqual((await post(validBody())).body.rotated, false);
});

// ── Revoke ───────────────────────────────────────────────────────────────────────────────
test('DELETE revokes and does NOT hard-delete', async () => {
  const c = (await post(validBody())).body.credential;
  const r = await api('DELETE', `${credUrl(CONN_A)}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.credential.status, 'revoked');
  assert.strictEqual(creds().length, 1, 'the row was deleted instead of revoked');
  assert.strictEqual(creds()[0].status, 'revoked');
  // The ciphertext is retained as history; it is simply no longer active.
  assert.ok(creds()[0].encrypted_value);
});

test('revoking twice is a 409, not a silent no-op', async () => {
  const c = (await post(validBody())).body.credential;
  await api('DELETE', `${credUrl(CONN_A)}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A });
  const again = await api('DELETE', `${credUrl(CONN_A)}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.error, 'already_revoked');
});

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────
test('another business cannot read, write or revoke on this connection', async () => {
  const c = (await post(validBody())).body.credential;
  assert.strictEqual((await api('GET', credUrl(CONN_A), { token: tok(OWNER_B), business: BIZ_B })).status, 404);
  assert.strictEqual((await post(validBody(), CONN_A, BIZ_B, OWNER_B)).status, 404);
  assert.strictEqual((await api('DELETE', `${credUrl(CONN_A)}/${c.id}`, { token: tok(OWNER_B), business: BIZ_B })).status, 404);
  assert.strictEqual(creds()[0].status, 'active', 'another business revoked this credential');
});

test('a credential id from another connection is not reachable', async () => {
  const c = (await post(validBody())).body.credential;
  const r = await api('DELETE', `${credUrl(CONN_PROD)}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 404);
});

// ── Roles ────────────────────────────────────────────────────────────────────────────────
test('an accountant may read metadata but not write; an employee may do neither', async () => {
  await post(validBody());
  assert.strictEqual((await api('GET', credUrl(CONN_A), { token: tok(ACCOUNTANT_A), business: BIZ_A })).status, 200);
  assert.strictEqual((await post(validBody({ credential_type: 'api_key' }), CONN_A, BIZ_A, ACCOUNTANT_A)).status, 403);
  assert.strictEqual((await api('GET', credUrl(CONN_A), { token: tok(EMPLOYEE_A), business: BIZ_A })).status, 403);
  assert.strictEqual((await post(validBody({ credential_type: 'api_key' }), CONN_A, BIZ_A, EMPLOYEE_A)).status, 403);
});

test('a non-admin cannot reach the admin credential monitor', async () => {
  const r = await api('GET', '/api/admin/payment-credentials', { token: tok(OWNER_A) });
  assert.ok([401, 403].includes(r.status), `expected 401/403, got ${r.status}`);
});

// ── Validation surfaced over HTTP ────────────────────────────────────────────────────────
test('invalid input is refused before anything is stored', async () => {
  for (const body of [validBody({ value: 'short' }), validBody({ credential_type: 'root_password' }),
                      validBody({ value: undefined }), validBody({ credential_type: undefined })]) {
    assert.strictEqual((await post(body)).status, 400);
  }
  assert.strictEqual(creds().length, 0);
});
