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
                  incoming_payments: [], transactions: [], debts: [], audit_events: [],
                  incoming_payment_match_candidates: [] };
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
  dbState.incoming_payment_match_candidates = [];
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
          // Model 048's provider-transaction partial unique index, so a route relying on the
          // DB to stop a duplicate gateway transaction is actually tested against one.
          if (table === 'incoming_payments') {
            for (const r of arr) {
              if (r.provider_transaction_id && rows().some((x) => x.business_id === r.business_id
                  && (x.provider || '') === (r.provider || '')
                  && x.provider_transaction_id === r.provider_transaction_id)) {
                return Promise.resolve({ data: null, error: { code: '23505',
                  message: 'duplicate key value violates unique constraint' } }).then(resolve, reject);
              }
            }
          }
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

// ── Gateway settlement import (PR3) ──────────────────────────────────────────────────────
const GW = '/api/incoming-payments/gateway-import';
const stlRow = (o = {}) => ({ provider_transaction_id: 'TX-1', gross_amount: 100000, fee_amount: 2500, ...o });
const stlBatch = (o = {}) => ({ provider: 'midtrans', provider_settlement_id: 'STL-1', currency: 'IDR', rows: [stlRow()], ...o });
const gwImport = (body, biz = BIZ_A, user = OWNER_A) => api('POST', GW, { token: tok(user), business: biz, body });

test('flag OFF: the gateway import and provider list are 404', async () => {
  process.env[FLAG] = 'false';
  assert.strictEqual((await gwImport(stlBatch())).status, 404);
  assert.strictEqual((await api('GET', '/api/incoming-payments/providers', { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

test('the provider list is advisory and names the Indonesian gateways', async () => {
  const r = await api('GET', '/api/incoming-payments/providers', { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 200);
  for (const p of ['midtrans', 'doku', 'xendit', 'hitpay', 'duitku', 'ipaymu']) {
    assert.ok(r.body.providers.includes(p), `${p} missing from the provider list`);
  }
});

test('a settlement batch imports and separates gross, fee and net', async () => {
  const r = await gwImport(stlBatch());
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.summary.created, 1);
  const p = dbState.incoming_payments[0];
  assert.strictEqual(p.source_type, 'manual_gateway_import');
  assert.strictEqual(p.provider, 'midtrans');
  assert.strictEqual(p.gross_amount, 100000);
  assert.strictEqual(p.fee_amount, 2500);
  assert.strictEqual(p.net_amount, 97500);
  assert.strictEqual(p.provider_settlement_id, 'STL-1');
});

test('any provider imports through the same endpoint — no per-gateway path', async () => {
  for (const provider of ['midtrans', 'doku', 'xendit', 'hitpay', 'duitku', 'ipaymu', 'brandnewpay']) {
    const r = await gwImport(stlBatch({ provider, rows: [stlRow({ provider_transaction_id: `TX-${provider}` })] }));
    assert.strictEqual(r.status, 201, `${provider} failed to import`);
  }
  assert.strictEqual(dbState.incoming_payments.length, 7);
  assert.strictEqual((await gwImport(stlBatch({ provider: 'brandnewpay', rows: [stlRow({ provider_transaction_id: 'TX-NEW' })] }))).body.provider_known, false);
});

test('a settlement import creates NO transaction and NO debt', async () => {
  await gwImport(stlBatch({ rows: [stlRow(), stlRow({ provider_transaction_id: 'TX-2' })] }));
  assert.strictEqual(dbState.transactions.length, 0);
  assert.strictEqual(dbState.debts.length, 0);
  assert.ok(dbState.incoming_payments.every((p) => p.linked_transaction_id === null && p.linked_debt_id === null));
});

test('imported settlement rows are draft and unmatched', async () => {
  await gwImport(stlBatch());
  const p = dbState.incoming_payments[0];
  assert.strictEqual(p.status, 'draft');
  assert.strictEqual(p.reconciliation_status, 'unmatched');
  assert.strictEqual(p.reviewed_by_user_id ?? null, null);
});

test('re-uploading the same settlement reports duplicates, not new money', async () => {
  await gwImport(stlBatch());
  const again = await gwImport(stlBatch());
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.summary.duplicates, 1);
  assert.strictEqual(again.body.summary.created, 0);
  assert.strictEqual(dbState.incoming_payments.length, 1, 'the same gateway transaction was recorded twice');
});

test('the same provider transaction under a DIFFERENT key is still blocked by the DB', async () => {
  await gwImport(stlBatch());
  // The idempotency pre-check misses (different key), so the provider-transaction index must
  // be what stops it.
  const again = await gwImport(stlBatch({ rows: [stlRow({ idempotency_key: 'a-different-key' })] }));
  assert.strictEqual(again.body.summary.duplicates, 1);
  assert.strictEqual(dbState.incoming_payments.length, 1);
});

test('the same provider transaction in another business does not collide', async () => {
  await gwImport(stlBatch(), BIZ_A, OWNER_A);
  const b = await gwImport(stlBatch(), BIZ_B, OWNER_B);
  assert.strictEqual(b.status, 201);
  assert.strictEqual(dbState.incoming_payments.length, 2);
});

test('a bad row rejects the WHOLE batch, naming its index', async () => {
  const r = await gwImport(stlBatch({ rows: [stlRow(), stlRow({ provider_transaction_id: 'TX-2', gross_amount: -1 })] }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.row_index, 1);
  assert.strictEqual(dbState.incoming_payments.length, 0, 'a partially imported settlement looks complete but is not');
});

test('an unknown-fee settlement row must state its net', async () => {
  const r = await gwImport(stlBatch({ rows: [stlRow({ fee_amount: undefined })] }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'missing_net_amount');
  const good = await gwImport(stlBatch({ rows: [stlRow({ fee_amount: undefined, gross_amount: 1000000, net_amount: 967810 })] }));
  assert.strictEqual(good.status, 201);
  assert.strictEqual(dbState.incoming_payments[0].fee_amount, null);
});

test('a settlement cannot be imported into another business or with its wallet', async () => {
  assert.strictEqual((await gwImport(stlBatch(), BIZ_B, OWNER_A)).status, 403);
  assert.strictEqual((await gwImport({ ...stlBatch(), wallet_id: WALLET_B })).status, 403);
  assert.strictEqual(dbState.incoming_payments.length, 0);
});

test('an employee cannot import a settlement', async () => {
  assert.strictEqual((await gwImport(stlBatch(), BIZ_A, EMPLOYEE_A)).status, 403);
});

test('settlement imports are audited', async () => {
  await gwImport(stlBatch());
  const rows = dbState.audit_events.filter((a) => a.action === 'created_from_gateway_import');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].business_id, BIZ_A);
});

// ── Match candidates (PR4) ───────────────────────────────────────────────────────────────
const cand = (id) => `${URL_LIST}/${id}/candidates`;

function seedTargets() {
  // A receivable and an income transaction in BIZ_A that a 1,000,000 receipt should match,
  // plus look-alikes in BIZ_B that it must never match.
  // PRODUCTION SHAPE (B4-1): the candidate route feeds the matcher raw rows from select(*),
  // which carry database columns only. remaining_amount is computed by computeDebtStatus and
  // is never present here, so the fixture must not supply it.
  dbState.debts = [
    { id: 11, business_id: BIZ_A, type: 'receivable', status: 'open',
      original_amount: 1000000, amount: 1000000, paid_amount: 0,
      due_date: '2026-08-10', counterparty: 'PT Maju Jaya', currency: 'IDR' },
    { id: 12, business_id: BIZ_B, type: 'receivable', status: 'open',
      original_amount: 1000000, amount: 1000000, paid_amount: 0,
      due_date: '2026-08-10', counterparty: 'PT Maju Jaya', currency: 'IDR' },
    { id: 13, business_id: BIZ_A, type: 'payable', status: 'open',
      original_amount: 1000000, amount: 1000000, paid_amount: 0,
      due_date: '2026-08-10', counterparty: 'PT Maju Jaya', currency: 'IDR' },
  ];
  dbState.transactions = [
    { id: 21, business_id: BIZ_A, type: 'income', amount_idr: 1000000, transaction_date: '2026-08-10',
      counterparty_name: 'PT Maju Jaya', currency_original: 'IDR' },
    { id: 22, business_id: BIZ_B, type: 'income', amount_idr: 1000000, transaction_date: '2026-08-10',
      counterparty_name: 'PT Maju Jaya', currency_original: 'IDR' },
  ];
}
const matchable = (o = {}) => receipt({
  gross_amount: 1000000, net_amount: 1000000, payer_name: 'PT Maju Jaya',
  transaction_at: '2026-08-10T00:00:00.000Z', ...o,
});
async function paymentWithCandidates() {
  seedTargets();
  const created = await createAsOwner(matchable());
  const id = created.body.payment.id;
  const gen = await api('POST', cand(id), { token: tok(OWNER_A), business: BIZ_A });
  return { id, gen };
}

test('flag OFF: candidate routes are 404', async () => {
  process.env[FLAG] = 'false';
  assert.strictEqual((await api('POST', cand('x'), { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await api('GET', cand('x'), { token: tok(OWNER_A), business: BIZ_A })).status, 404);
});

test('candidates are generated for a matching receivable and income transaction', async () => {
  const { gen } = await paymentWithCandidates();
  assert.strictEqual(gen.status, 200);
  assert.strictEqual(gen.body.count, 2);
  assert.ok(gen.body.candidates.every((c) => c.score > 0 && c.match_reasons.length));
});

test('candidates NEVER include another business receivable or transaction', async () => {
  const { gen } = await paymentWithCandidates();
  const ids = gen.body.candidates.map((c) => c.target_debt_id ?? c.target_transaction_id);
  assert.ok(!ids.includes(12), 'another company receivable was proposed');
  assert.ok(!ids.includes(22), 'another company transaction was proposed');
  assert.ok(gen.body.candidates.every((c) => c.business_id === BIZ_A));
});

test('a payable is never proposed for incoming money', async () => {
  const { gen } = await paymentWithCandidates();
  assert.ok(!gen.body.candidates.map((c) => c.target_debt_id).includes(13));
});

test('generating candidates creates NO transaction and NO debt, and mutates neither', async () => {
  seedTargets();
  const debtsBefore = JSON.parse(JSON.stringify(dbState.debts));
  const txBefore = JSON.parse(JSON.stringify(dbState.transactions));
  await paymentWithCandidates();
  assert.deepStrictEqual(dbState.debts, debtsBefore, 'a receivable was mutated by matching');
  assert.deepStrictEqual(dbState.transactions, txBefore, 'a transaction was mutated by matching');
});

test('a payment with candidates is candidate, which is still not matched', async () => {
  const { id } = await paymentWithCandidates();
  const p = dbState.incoming_payments.find((x) => x.id === id);
  assert.strictEqual(p.reconciliation_status, 'candidate');
  assert.notStrictEqual(p.reconciliation_status, 'matched');
  assert.strictEqual(p.status, 'draft', 'matching silently reviewed the payment');
});

test('re-running the engine refreshes rather than accumulating', async () => {
  const { id } = await paymentWithCandidates();
  const again = await api('POST', cand(id), { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(again.body.count, 2);
  assert.strictEqual(dbState.incoming_payment_match_candidates.length, 2);
});

test('candidates for another business payment are a 404', async () => {
  const { id } = await paymentWithCandidates();
  assert.strictEqual((await api('GET', cand(id), { token: tok(OWNER_B), business: BIZ_B })).status, 404);
  assert.strictEqual((await api('POST', cand(id), { token: tok(OWNER_B), business: BIZ_B })).status, 404);
});

test('an employee cannot generate or read candidates', async () => {
  const { id } = await paymentWithCandidates();
  assert.strictEqual((await api('POST', cand(id), { token: tok(EMPLOYEE_A), business: BIZ_A })).status, 403);
  assert.strictEqual((await api('GET', cand(id), { token: tok(EMPLOYEE_A), business: BIZ_A })).status, 403);
});

// ── Accepting is a human decision, and books nothing ─────────────────────────────────────
test('an accountant cannot accept a match — that needs approval rights', async () => {
  const { id, gen } = await paymentWithCandidates();
  const r = await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(ACCOUNTANT_A), business: BIZ_A, body: { status: 'accepted' } });
  assert.strictEqual(r.status, 403);
});

test('accepting links the payment but does NOT settle the debt or book revenue', async () => {
  const { id, gen } = await paymentWithCandidates();
  const c = gen.body.candidates.find((x) => x.target_type === 'debt');
  const debtBefore = JSON.parse(JSON.stringify(dbState.debts.find((d) => d.id === 11)));

  const r = await api('PATCH', `${cand(id)}/${c.id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  assert.strictEqual(r.status, 200);

  const p = dbState.incoming_payments.find((x) => x.id === id);
  assert.strictEqual(p.reconciliation_status, 'matched');
  assert.strictEqual(p.linked_debt_id, 11);
  // The receivable itself is untouched: not paid, not reduced, not closed.
  assert.deepStrictEqual(dbState.debts.find((d) => d.id === 11), debtBefore);
  assert.strictEqual(dbState.transactions.length, 2, 'accepting created a ledger transaction');
  // And accepting a match is not an accounting review.
  assert.strictEqual(p.status, 'draft');
});

test('a candidate cannot be decided twice', async () => {
  const { id, gen } = await paymentWithCandidates();
  const c = gen.body.candidates[0];
  await api('PATCH', `${cand(id)}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  const again = await api('PATCH', `${cand(id)}/${c.id}`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'rejected' } });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.error, 'already_decided');
});

test('a second candidate cannot be accepted once the payment is matched', async () => {
  const { id, gen } = await paymentWithCandidates();
  await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  const second = await api('PATCH', `${cand(id)}/${gen.body.candidates[1].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.body.error, 'already_matched');
});

test('rejecting a candidate leaves the payment unmatched', async () => {
  const { id, gen } = await paymentWithCandidates();
  const r = await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'rejected' } });
  assert.strictEqual(r.status, 200);
  const p = dbState.incoming_payments.find((x) => x.id === id);
  assert.notStrictEqual(p.reconciliation_status, 'matched');
  assert.strictEqual(p.linked_debt_id ?? null, null);
});

test('only accepted or rejected are valid decisions', async () => {
  const { id, gen } = await paymentWithCandidates();
  const r = await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'matched' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'invalid_decision');
});

test('a re-run never overwrites a human decision', async () => {
  const { id, gen } = await paymentWithCandidates();
  await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'rejected' } });
  await api('POST', cand(id), { token: tok(OWNER_A), business: BIZ_A });
  const c = dbState.incoming_payment_match_candidates.find((x) => x.id === gen.body.candidates[0].id);
  assert.strictEqual(c.status, 'rejected', 'the engine overwrote a reviewer decision');
});

test('match decisions are audited', async () => {
  const { id, gen } = await paymentWithCandidates();
  await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  const rows = dbState.audit_events.filter((a) => a.entity_type === 'incoming_payment_match_candidate');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].action, 'candidate_accepted');
});

// ── Review queue (PR5) ───────────────────────────────────────────────────────────────────
const QUEUE = '/api/incoming-payments/review-queue';
const recon = (id) => `${URL_LIST}/${id}/reconciliation`;
const queue = (biz = BIZ_A, user = OWNER_A) => api('GET', QUEUE, { token: tok(user), business: biz });

test('flag OFF: the review queue and the ignore action are 404', async () => {
  process.env[FLAG] = 'false';
  assert.strictEqual((await queue()).status, 404);
  assert.strictEqual((await api('PATCH', recon('x'), { token: tok(OWNER_A), business: BIZ_A, body: { reconciliation_status: 'ignored' } })).status, 404);
});

test('an unmatched receipt appears in the queue as having no candidate', async () => {
  await createAsOwner(receipt({ payer_name: 'Budi' }));
  const r = await queue();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.counts.outstanding, 1);
  assert.strictEqual(r.body.counts.no_candidate, 1);
  assert.strictEqual(r.body.items[0].queue_state, 'no_candidate');
});

test('a receipt with no candidate is SHOWN, not hidden', async () => {
  // Unexplained cash is exactly what the queue exists to surface.
  await createAsOwner(receipt({ gross_amount: 12345, net_amount: 12345 }));
  const r = await queue();
  assert.strictEqual(r.body.items.length, 1);
  assert.strictEqual(r.body.items[0].payment.gross_amount, 12345);
});

test('the queue carries each receipt candidates inline', async () => {
  await paymentWithCandidates();
  const r = await queue();
  const item = r.body.items[0];
  assert.strictEqual(item.queue_state, 'candidates_pending_review');
  assert.strictEqual(item.candidates.length, 2);
  // Best first, so a reviewer reads the strongest proposal at the top.
  assert.ok(Number(item.candidates[0].score) >= Number(item.candidates[1].score));
});

test('the queue NEVER shows another business receipts', async () => {
  await createAsOwner(receipt({ payer_name: 'A-only' }), BIZ_A);
  await api('POST', URL_LIST, { token: tok(OWNER_B), business: BIZ_B, body: receipt({ payer_name: 'B-only' }) });
  const a = await queue(BIZ_A, OWNER_A);
  assert.strictEqual(a.body.items.length, 1);
  assert.strictEqual(a.body.items[0].payment.payer_name, 'A-only');
  const b = await queue(BIZ_B, OWNER_B);
  assert.strictEqual(b.body.items[0].payment.payer_name, 'B-only');
});

test('an employee cannot open the queue', async () => {
  assert.strictEqual((await queue(BIZ_A, EMPLOYEE_A)).status, 403);
});

test('totals use the NET that landed, and refuse to sum mixed currencies', async () => {
  await createAsOwner(receipt({ gross_amount: 100000, fee_amount: 2500, net_amount: undefined }));
  let r = await queue();
  assert.strictEqual(r.body.unresolved_total, 97500, 'the total used gross rather than what landed');
  assert.strictEqual(r.body.unresolved_total_currency, 'IDR');

  await createAsOwner(receipt({ currency: 'USD', gross_amount: 50, net_amount: 50 }));
  r = await queue();
  assert.strictEqual(r.body.unresolved_total, null, 'mixed currencies were summed into a meaningless number');
  assert.match(r.body.unresolved_total_note, /mixed currencies/);
});

// ── Resolving ────────────────────────────────────────────────────────────────────────────
test('a receipt can be set aside as ignored and leaves the queue', async () => {
  const created = await createAsOwner(receipt());
  const id = created.body.payment.id;
  const r = await api('PATCH', recon(id), { token: tok(OWNER_A), business: BIZ_A, body: { reconciliation_status: 'ignored' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.payment.reconciliation_status, 'ignored');
  assert.strictEqual((await queue()).body.counts.outstanding, 0);
});

test('ignoring books nothing', async () => {
  const created = await createAsOwner(receipt());
  await api('PATCH', recon(created.body.payment.id), { token: tok(OWNER_A), business: BIZ_A, body: { reconciliation_status: 'ignored' } });
  assert.strictEqual(dbState.transactions.length, 0);
  assert.strictEqual(dbState.debts.length, 0);
  assert.strictEqual(dbState.incoming_payments[0].status, 'draft', 'ignoring silently reviewed the payment');
});

test('only "ignored" is settable here — matching is not done through this route', async () => {
  const created = await createAsOwner(receipt());
  for (const bad of ['matched', 'candidate', 'unmatched']) {
    const r = await api('PATCH', recon(created.body.payment.id),
      { token: tok(OWNER_A), business: BIZ_A, body: { reconciliation_status: bad } });
    assert.strictEqual(r.status, 400, `${bad} should not be settable`);
    assert.strictEqual(r.body.error, 'invalid_reconciliation_status');
  }
});

test('a matched payment cannot be ignored', async () => {
  const { id, gen } = await paymentWithCandidates();
  await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  const r = await api('PATCH', recon(id), { token: tok(OWNER_A), business: BIZ_A, body: { reconciliation_status: 'ignored' } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'already_matched');
});

test('another business cannot ignore this payment', async () => {
  const created = await createAsOwner(receipt());
  const r = await api('PATCH', recon(created.body.payment.id),
    { token: tok(OWNER_B), business: BIZ_B, body: { reconciliation_status: 'ignored' } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(dbState.incoming_payments[0].reconciliation_status, 'unmatched');
});

test('an accountant cannot set a receipt aside', async () => {
  const created = await createAsOwner(receipt());
  const r = await api('PATCH', recon(created.body.payment.id),
    { token: tok(ACCOUNTANT_A), business: BIZ_A, body: { reconciliation_status: 'ignored' } });
  assert.strictEqual(r.status, 403);
});

test('a matched AND reviewed payment is done and leaves the queue', async () => {
  const { id, gen } = await paymentWithCandidates();
  await api('PATCH', `${cand(id)}/${gen.body.candidates[0].id}`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'accepted' } });
  // Matched but not yet reviewed: still outstanding, because accounting review is a
  // separate decision from matching.
  let r = await queue();
  assert.strictEqual(r.body.counts.matched_awaiting_review, 1);
  await api('PATCH', `${URL_LIST}/${id}/status`, { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } });
  r = await queue();
  assert.strictEqual(r.body.counts.outstanding, 0);
});

test('setting a receipt aside is audited', async () => {
  const created = await createAsOwner(receipt());
  await api('PATCH', recon(created.body.payment.id), { token: tok(OWNER_A), business: BIZ_A, body: { reconciliation_status: 'ignored' } });
  const rows = dbState.audit_events.filter((a) => a.action === 'reconciliation_ignored');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].business_id, BIZ_A);
});

// ── Self-audit regression: the queue must be clearable ───────────────────────────────────
test('a REJECTED receipt leaves the queue without being mislabelled as ignored', async () => {
  // Previously only `ignored` or matched+reviewed cleared a row, so a reviewer who rejected a
  // receipt had no way to clear it except marking it `ignored` — which means something else
  // and would corrupt the one signal this queue exists to produce.
  const created = await createAsOwner(receipt());
  const id = created.body.payment.id;
  assert.strictEqual((await queue()).body.counts.outstanding, 1);

  const r = await api('PATCH', `${URL_LIST}/${id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'rejected' } });
  assert.strictEqual(r.status, 200);

  assert.strictEqual((await queue()).body.counts.outstanding, 0, 'a rejected receipt is stuck in the queue');
  // And rejecting still books nothing.
  assert.strictEqual(dbState.transactions.length, 0);
  assert.strictEqual(dbState.debts.length, 0);
});

test('a reviewed-but-unmatched receipt STAYS outstanding', async () => {
  // Reviewing without matching is not resolution: the money is still unexplained.
  const created = await createAsOwner(receipt());
  await api('PATCH', `${URL_LIST}/${created.body.payment.id}/status`,
    { token: tok(OWNER_A), business: BIZ_A, body: { status: 'reviewed' } });
  assert.strictEqual((await queue()).body.counts.outstanding, 1);
});

test('a failed candidate source read reports an error, never "no matches found"', async () => {
  // Answering 200 with zero candidates when the query actually failed is a confident, wrong
  // financial statement: it says we looked and found nothing, when we never looked.
  const created = await createAsOwner(matchable());
  const id = created.body.payment.id;
  const realFrom = supabase.from;
  supabase.from = (t) => (t === 'debts'
    ? { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'relation unavailable' } }) }) }) }
    : realFrom(t));
  try {
    const r = await api('POST', cand(id), { token: tok(OWNER_A), business: BIZ_A });
    assert.strictEqual(r.status, 500);
    assert.strictEqual(r.body.error, 'candidate_sources_unavailable');
  } finally {
    supabase.from = realFrom;
  }
});
