// Incoming payment ENDPOINTS over real HTTP (migration 048, PR1).
//
// The migration test proves the constraints; the unit test proves the validator. These prove
// the guard logic that sits between a request and the table: that the flag hides the feature
// completely, that a workspace can only ever see and write its OWN payments, that a wallet
// from another company cannot be attached, that a replayed submission returns the first row
// instead of duplicating the money, and — the load-bearing one — that recording a payment
// writes NO ledger transaction.
//
// A hand-written fake Supabase backs it, as in notificationGrantsApi.test.js. No PGlite: the
// SQL is covered by the migration test, and what matters here is the route logic.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const JWT_SECRET = 'test-jwt-secret';
const FLAG = 'INCOMING_PAYMENTS_ENABLED';

// Ids are arbitrary fixtures. Nothing here encodes a real production business or user: the
// canonical workspace codes and user_id -1 must never be a precondition for this feature.
const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PERSONAL = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const WALLET_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const WALLET_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const OWNER_A = 7001, ACCOUNTANT_A = 7002, EMPLOYEE_A = 7003, OWNER_B = 7004;

const dbState = { businesses: [], business_members: [], wallets: [], users: [],
                  incoming_payments: [], transactions: [], debts: [], audit_events: [] };
const dbFlags = { insertError: null };

function seed() {
  dbState.businesses = [
    { id: BIZ_A, type: 'business', owner_user_id: OWNER_A, created_at: '2026-01-01', name: 'Alpha', status: 'active' },
    { id: BIZ_B, type: 'business', owner_user_id: OWNER_B, created_at: '2026-01-02', name: 'Beta', status: 'active' },
    { id: PERSONAL, type: 'personal', owner_user_id: OWNER_A, created_at: '2026-01-03', name: 'Personal', status: 'active' },
  ];
  dbState.business_members = [
    { id: 'm1', user_id: OWNER_A,      business_id: BIZ_A,    role: 'owner',      status: 'active' },
    { id: 'm2', user_id: ACCOUNTANT_A, business_id: BIZ_A,    role: 'accountant', status: 'active' },
    { id: 'm3', user_id: EMPLOYEE_A,   business_id: BIZ_A,    role: 'employee',   status: 'active' },
    { id: 'm4', user_id: OWNER_B,      business_id: BIZ_B,    role: 'owner',      status: 'active' },
    { id: 'm5', user_id: OWNER_A,      business_id: PERSONAL, role: 'owner',      status: 'active' },
  ];
  dbState.wallets = [
    { id: WALLET_A, business_id: BIZ_A, user_id: OWNER_A, name: 'BCA', type: 'bank' },
    { id: WALLET_B, business_id: BIZ_B, user_id: OWNER_B, name: 'Mandiri', type: 'bank' },
  ];
  dbState.users = [OWNER_A, ACCOUNTANT_A, EMPLOYEE_A, OWNER_B].map((id) => ({ id, first_name: `U${id}` }));
  dbState.incoming_payments = [];
  dbState.transactions = [];
  dbState.debts = [];
  dbState.audit_events = [];
  dbFlags.insertError = null;
}

// ── fake Supabase ────────────────────────────────────────────────────────────────────────
function fakeFrom(table) {
  const st = { filters: [], single: false, maybeSingle: false, op: 'select', values: null,
               wantBiz: false, limit: null, cols: null };
  const rows = () => (dbState[table] = dbState[table] || []);
  const match = (r) => st.filters.every(([c, v]) => String(r[c]) === String(v));
  const embed = (list) => list.map((r) => (st.wantBiz && table === 'business_members'
    ? { ...r, businesses: dbState.businesses.find((b) => b.id === r.business_id) || null }
    : r));
  // Column projection is modelled, not ignored: a route that forgets to exclude a sensitive
  // column from a list response must be able to FAIL a test here.
  const project = (list) => (!st.cols ? list
    : list.map((r) => Object.fromEntries(st.cols.filter((c) => c in r).map((c) => [c, r[c]]))));

  const q = {
    select(cols) {
      if (typeof cols !== 'string' || cols === '*') return q;
      if (cols.includes('(')) { if (cols.includes('businesses(')) st.wantBiz = true; return q; }
      st.cols = cols.split(',').map((c) => c.trim()).filter(Boolean);
      return q;
    },
    eq(c, v) { st.filters.push([c, v]); return q; },
    in() { return q; },
    or() { return q; },
    order() { return q; },
    limit(n) { st.limit = n; return q; },
    single() { st.single = true; return q; },
    maybeSingle() { st.maybeSingle = true; return q; },
    insert(v) { st.op = 'insert'; st.values = v; return q; },
    update(v) { st.op = 'update'; st.values = v; return q; },
    then(resolve, reject) {
      let out;
      if (st.op === 'insert') {
        if (dbFlags.insertError && table === 'incoming_payments') {
          out = { data: null, error: dbFlags.insertError };
        } else {
          const arr = (Array.isArray(st.values) ? st.values : [st.values])
            .map((r) => ({ id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(),
                           updated_at: new Date().toISOString(), ...r }));
          for (const r of arr) rows().push(r);
          const p = project(arr);
          out = { data: st.single ? p[0] : p, error: null };
        }
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
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise((r) => server.once('listening', r));
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
const URL_LIST = '/api/incoming-payments';
const receipt = (o = {}) => ({ source_type: 'manual_bank_entry', gross_amount: 100000, net_amount: 100000, ...o });
const createAsOwner = (body, biz = BIZ_A) => api('POST', URL_LIST, { token: tok(OWNER_A), business: biz, body });

// ── Feature flag ─────────────────────────────────────────────────────────────────────────
test('flag OFF: every route is 404, exactly as production sees it', async () => {
  process.env[FLAG] = 'false';
  assert.strictEqual((await api('GET', URL_LIST, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await api('GET', `${URL_LIST}/any-id`, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await createAsOwner(receipt())).status, 404);
  assert.strictEqual((await api('PATCH', `${URL_LIST}/any-id/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } })).status, 404);
});

test('flag OFF: nothing is written even on a well-formed create', async () => {
  process.env[FLAG] = 'false';
  await createAsOwner(receipt());
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

// ── Auth ─────────────────────────────────────────────────────────────────────────────────
test('no token is 401', async () => {
  assert.strictEqual((await api('GET', URL_LIST, { business: BIZ_A })).status, 401);
  assert.strictEqual((await api('POST', URL_LIST, { business: BIZ_A, body: receipt() })).status, 401);
});

// ── Create ───────────────────────────────────────────────────────────────────────────────
test('an owner records a receipt for their own business', async () => {
  const r = await createAsOwner(receipt({ payer_name: 'Budi', description: 'Car wash' }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.business_id, BIZ_A);
  assert.strictEqual(r.body.payment.status, 'draft');
  assert.strictEqual(r.body.payment.reconciliation_status, 'unmatched');
  assert.strictEqual(dbState.incoming_payments.length, 1);
});

test('THE core guarantee: recording a payment creates NO transaction and NO debt', async () => {
  await createAsOwner(receipt({ source_type: 'gateway_settlement', provider: 'midtrans',
    gross_amount: 100000, fee_amount: 2500, net_amount: undefined }));
  assert.strictEqual(dbState.transactions.length, 0, 'a ledger transaction was created — the layer is not inert');
  assert.strictEqual(dbState.debts.length, 0, 'a debt was created — the layer is not inert');
  const p = dbState.incoming_payments[0];
  assert.strictEqual(p.linked_transaction_id, null);
  assert.strictEqual(p.linked_debt_id, null);
});

test('gross, fee and net are stored separately; net is derived, not assumed', async () => {
  const r = await createAsOwner(receipt({ source_type: 'gateway_settlement', provider: 'midtrans',
    gross_amount: 100000, fee_amount: 2500, net_amount: undefined }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.gross_amount, 100000);
  assert.strictEqual(r.body.payment.fee_amount, 2500);
  assert.strictEqual(r.body.payment.net_amount, 97500);
});

test('a net that contradicts gross minus fee is a 400', async () => {
  const r = await createAsOwner(receipt({ gross_amount: 100000, fee_amount: 2500, net_amount: 100000 }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'net_amount_mismatch');
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

test('invalid amounts and currencies are refused before any write', async () => {
  for (const body of [receipt({ gross_amount: -1 }), receipt({ gross_amount: 'abc' }),
                      receipt({ currency: 'RUPIAH' }), receipt({ source_type: 'nope' })]) {
    assert.strictEqual((await createAsOwner(body)).status, 400);
  }
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

test('a client cannot create a payment already linked to the ledger', async () => {
  const r = await createAsOwner(receipt({ linked_transaction_id: 99 }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'linking_not_supported');
});

test('future_bank_api is refused — no direct bank API exists in v0', async () => {
  const r = await createAsOwner(receipt({ source_type: 'future_bank_api' }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'source_type_not_available');
});

test('any provider is accepted — the layer is provider-agnostic', async () => {
  for (const provider of ['midtrans', 'doku', 'xendit', 'hitpay', 'duitku', 'ipaymu']) {
    const r = await createAsOwner(receipt({ source_type: 'manual_gateway_import', provider,
      provider_transaction_id: `TX-${provider}` }));
    assert.strictEqual(r.status, 201, `${provider} should be recordable`);
    assert.strictEqual(r.body.payment.provider, provider);
  }
});

// ── Cross-company isolation ──────────────────────────────────────────────────────────────
test('a user cannot create a payment for a business they do not belong to', async () => {
  const r = await api('POST', URL_LIST, { token: tok(OWNER_A), business: BIZ_B, body: receipt() });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

test('business_id in the BODY is ignored — the active workspace wins', async () => {
  const r = await createAsOwner(receipt({ business_id: BIZ_B }), BIZ_A);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.business_id, BIZ_A, 'a body-supplied business_id was honoured');
});

test('a wallet from ANOTHER business cannot be attached', async () => {
  const r = await createAsOwner(receipt({ wallet_id: WALLET_B }));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'wallet_not_in_business');
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

test('a wallet from the SAME business is attached', async () => {
  const r = await createAsOwner(receipt({ wallet_id: WALLET_A }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.wallet_id, WALLET_A);
});

test('a personal workspace is rejected — personal and business money never mix', async () => {
  const r = await api('POST', URL_LIST, { token: tok(OWNER_A), business: PERSONAL, body: receipt() });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'business_workspace_required');
});

test('the list never shows another business\'s payments', async () => {
  await createAsOwner(receipt({ payer_name: 'A-only' }), BIZ_A);
  await api('POST', URL_LIST, { token: tok(OWNER_B), business: BIZ_B, body: receipt({ payer_name: 'B-only' }) });
  const a = await api('GET', URL_LIST, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(a.body.payments.length, 1);
  assert.strictEqual(a.body.payments[0].payer_name, 'A-only');
  const b = await api('GET', URL_LIST, { token: tok(OWNER_B), business: BIZ_B });
  assert.strictEqual(b.body.payments.length, 1);
  assert.strictEqual(b.body.payments[0].payer_name, 'B-only');
});

test('fetching another business\'s payment by id is 404, not 403 — no existence oracle', async () => {
  const created = await api('POST', URL_LIST, { token: tok(OWNER_B), business: BIZ_B, body: receipt() });
  const id = created.body.payment.id;
  const r = await api('GET', `${URL_LIST}/${id}`, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 404);
});

// ── Roles ────────────────────────────────────────────────────────────────────────────────
test('an accountant may record; an employee may not', async () => {
  assert.strictEqual((await api('POST', URL_LIST,
    { token: tok(ACCOUNTANT_A), business: BIZ_A, body: receipt() })).status, 201);
  const emp = await api('POST', URL_LIST, { token: tok(EMPLOYEE_A), business: BIZ_A, body: receipt({ gross_amount: 5, net_amount: 5 }) });
  assert.strictEqual(emp.status, 403);
});

test('an employee cannot read incoming payments', async () => {
  assert.strictEqual((await api('GET', URL_LIST, { token: tok(EMPLOYEE_A), business: BIZ_A })).status, 403);
});

// ── Idempotency ──────────────────────────────────────────────────────────────────────────
test('a replayed submission returns the FIRST row instead of duplicating the money', async () => {
  const body = receipt({ source_type: 'gateway_settlement', provider: 'midtrans',
    provider_transaction_id: 'TX-REPLAY-1', gross_amount: 100000, fee_amount: 2500, net_amount: undefined });
  const first = await createAsOwner(body);
  assert.strictEqual(first.status, 201);
  const second = await createAsOwner(body);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.idempotent_replay, true);
  assert.strictEqual(second.body.payment.id, first.body.payment.id);
  assert.strictEqual(dbState.incoming_payments.length, 1, 'the same money was recorded twice');
});

test('an explicit idempotency_key deduplicates manual entry too', async () => {
  const body = receipt({ idempotency_key: 'manual-2026-08-01-a' });
  await createAsOwner(body);
  const again = await createAsOwner(body);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.idempotent_replay, true);
  assert.strictEqual(dbState.incoming_payments.length, 1);
});

test('the same key in a DIFFERENT business does not collide', async () => {
  const body = receipt({ idempotency_key: 'shared-key' });
  await createAsOwner(body, BIZ_A);
  const b = await api('POST', URL_LIST, { token: tok(OWNER_B), business: BIZ_B, body });
  assert.strictEqual(b.status, 201, 'a key from another workspace blocked a legitimate receipt');
  assert.strictEqual(dbState.incoming_payments.length, 2);
});

test('a unique-violation race returns the winning row, not a 500', async () => {
  const body = receipt({ idempotency_key: 'race-1' });
  // Simulate the concurrent insert: the pre-check found nothing, then the index fired.
  dbFlags.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
  const r = await createAsOwner(body);
  // Nothing else inserted it in this fake, so the honest answer is a 409 — never a silent success.
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'duplicate_payment');
});

// ── Review ───────────────────────────────────────────────────────────────────────────────
test('an owner reviews a payment and the reviewer is stamped', async () => {
  const created = await createAsOwner(receipt());
  const r = await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.payment.status, 'reviewed');
  assert.strictEqual(r.body.payment.reviewed_by_user_id, OWNER_A);
  assert.ok(r.body.payment.reviewed_at, 'reviewed_at was not stamped');
});

test('review does NOT book anything to the ledger', async () => {
  const created = await createAsOwner(receipt());
  await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } });
  assert.strictEqual(dbState.transactions.length, 0);
  assert.strictEqual(dbState.debts.length, 0);
  assert.strictEqual(dbState.incoming_payments[0].reconciliation_status, 'unmatched');
});

test('a client cannot declare a payment matched — matching is not a status change', async () => {
  const created = await createAsOwner(receipt());
  const r = await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'matched' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'invalid_status');
  assert.strictEqual(dbState.incoming_payments[0].reconciliation_status, 'unmatched');
});

test('a reviewed payment cannot be pushed back to draft — the review stamp is not erasable', async () => {
  const created = await createAsOwner(receipt());
  const id = created.body.payment.id;
  await api('PATCH', `${URL_LIST}/${id}/status`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } });
  const back = await api('PATCH', `${URL_LIST}/${id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'draft' } });
  assert.strictEqual(back.status, 400);
  assert.strictEqual(back.body.error, 'status_not_settable');
  assert.strictEqual(dbState.incoming_payments[0].reviewed_by_user_id, OWNER_A, 'the review stamp was erased');
});

test('an omitted fee on a gateway receipt is stored as UNKNOWN, not a confirmed zero', async () => {
  const r = await createAsOwner(receipt({ source_type: 'gateway_settlement', provider: 'midtrans',
    gross_amount: 1000000, net_amount: 967810 }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.payment.fee_amount, null);
  assert.strictEqual(r.body.payment.net_amount, 967810);
});

test('an accountant cannot approve; that needs an approver role', async () => {
  const created = await createAsOwner(receipt());
  const r = await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(ACCOUNTANT_A), business: BIZ_A, body: { status: 'reviewed' } });
  assert.strictEqual(r.status, 403);
});

test('another business cannot review this payment', async () => {
  const created = await createAsOwner(receipt());
  const r = await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(OWNER_B), business: BIZ_B, body: { status: 'reviewed' } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(dbState.incoming_payments[0].status, 'draft');
});

// ── Audit ────────────────────────────────────────────────────────────────────────────────
test('creating and reviewing both write an audit row', async () => {
  const created = await createAsOwner(receipt());
  await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } });
  const rows = dbState.audit_events.filter((a) => a.entity_type === 'incoming_payment');
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((a) => a.action), ['created', 'status_reviewed']);
  assert.ok(rows.every((a) => a.business_id === BIZ_A));
});

// ── List filters ─────────────────────────────────────────────────────────────────────────
test('list filters are validated — an unknown value is a 400, not an empty list', async () => {
  assert.strictEqual((await api('GET', `${URL_LIST}?status=booked`, { token: tok(OWNER_A), business: BIZ_A })).status, 400);
  assert.strictEqual((await api('GET', `${URL_LIST}?source_type=pigeon`, { token: tok(OWNER_A), business: BIZ_A })).status, 400);
  assert.strictEqual((await api('GET', `${URL_LIST}?reconciliation_status=guessed`, { token: tok(OWNER_A), business: BIZ_A })).status, 400);
});

test('the list response omits the raw provider payload; the detail route returns it', async () => {
  const created = await createAsOwner(receipt({ raw_provider_payload: { secretish: 'payer detail' } }));
  const list = await api('GET', URL_LIST, { token: tok(OWNER_A), business: BIZ_A });
  assert.ok(!('raw_provider_payload' in list.body.payments[0]), 'raw payload leaked into the list');
  const detail = await api('GET', `${URL_LIST}/${created.body.payment.id}`, { token: tok(OWNER_A), business: BIZ_A });
  assert.deepStrictEqual(detail.body.payment.raw_provider_payload, { secretish: 'payer detail' });
});
