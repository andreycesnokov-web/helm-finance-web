// Bank-import confirm → incoming-payments bridge, over real HTTP (PR2).
//
// The bridge unit test proves the mapping; the 049 migration test proves the DB guarantee.
// This proves the thing that matters operationally: that turning the flag ON adds evidence
// rows without changing what the bank import already did, and that turning it OFF leaves the
// confirm flow byte-identical to before this PR existed.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const JWT_SECRET = 'test-jwt-secret';
const FLAG = 'INCOMING_PAYMENTS_ENABLED';

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WALLET_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const WALLET_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const BATCH_A = '55555555-5555-5555-5555-555555555555';
const OWNER_A = 7001, OWNER_B = 7004;

const dbState = { businesses: [], business_members: [], wallets: [], users: [], transactions: [],
                  debts: [], audit_events: [], incoming_payments: [], bank_import_batches: [],
                  bank_import_rows: [], bank_reconciliations: [], cashflow_categories: [] };

function seed() {
  dbState.businesses = [
    { id: BIZ_A, type: 'business', owner_user_id: OWNER_A, created_at: '2026-01-01', name: 'Alpha', status: 'active' },
    { id: BIZ_B, type: 'business', owner_user_id: OWNER_B, created_at: '2026-01-02', name: 'Beta', status: 'active' },
  ];
  dbState.business_members = [
    { id: 'm1', user_id: OWNER_A, business_id: BIZ_A, role: 'owner', status: 'active' },
    { id: 'm4', user_id: OWNER_B, business_id: BIZ_B, role: 'owner', status: 'active' },
  ];
  dbState.wallets = [
    { id: WALLET_A, business_id: BIZ_A, user_id: OWNER_A, name: 'BCA', type: 'bank', scope: 'business' },
    { id: WALLET_B, business_id: BIZ_B, user_id: OWNER_B, name: 'Mandiri', type: 'bank', scope: 'business' },
  ];
  dbState.users = [{ id: OWNER_A }, { id: OWNER_B }];
  dbState.bank_import_batches = [{
    id: BATCH_A, business_id: BIZ_A, wallet_id: WALLET_A, currency: 'IDR',
    status: 'review_required', opening_balance: null, closing_balance: null, imported_count: 0,
  }];
  // One credit and one debit, both confirmed by the reviewer.
  dbState.bank_import_rows = [
    { id: 'row-credit', batch_id: BATCH_A, business_id: BIZ_A, amount: 250000, direction: 'in',
      description: 'TRF FROM BUDI', bank_reference: 'REF-9', tx_date: '2026-08-01',
      review_status: 'confirmed', dedup_hash: 'hash-credit', final_transaction_type: 'income' },
    { id: 'row-debit', batch_id: BATCH_A, business_id: BIZ_A, amount: 90000, direction: 'out',
      description: 'PLN BILL', bank_reference: 'REF-10', tx_date: '2026-08-02',
      review_status: 'confirmed', dedup_hash: 'hash-debit', final_transaction_type: 'expense' },
  ];
  dbState.transactions = [];
  dbState.debts = [];
  dbState.incoming_payments = [];
  dbState.audit_events = [];
  dbState.bank_reconciliations = [];
  dbState.cashflow_categories = [];
}

// ── fake Supabase (shared shape with incomingPaymentsApi.test.js, incl. column projection) ──
function fakeFrom(table) {
  const st = { filters: [], single: false, maybeSingle: false, op: 'select', values: null,
               wantBiz: false, limit: null, cols: null };
  const rows = () => (dbState[table] = dbState[table] || []);
  const match = (r) => st.filters.every(([c, v]) => String(r[c]) === String(v));
  const embed = (list) => list.map((r) => (st.wantBiz && table === 'business_members'
    ? { ...r, businesses: dbState.businesses.find((b) => b.id === r.business_id) || null } : r));
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
    in() { return q; }, or() { return q; }, order() { return q; },
    limit(n) { st.limit = n; return q; },
    single() { st.single = true; return q; },
    maybeSingle() { st.maybeSingle = true; return q; },
    insert(v) { st.op = 'insert'; st.values = v; return q; },
    update(v) { st.op = 'update'; st.values = v; return q; },
    then(resolve, reject) {
      let out;
      if (st.op === 'insert') {
        const arr = (Array.isArray(st.values) ? st.values : [st.values]).map((r) => ({
          id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
        // Model the 049 partial unique index: one payment per (business, bank row).
        if (table === 'incoming_payments') {
          for (const r of arr) {
            if (r.bank_import_row_id && rows().some((x) => x.business_id === r.business_id
                && x.bank_import_row_id === r.bank_import_row_id)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }).then(resolve, reject);
            }
          }
        }
        for (const r of arr) rows().push(r);
        const p = project(arr);
        out = { data: st.single ? p[0] : p, error: null };
      } else if (st.op === 'update') {
        const hits = rows().filter(match);
        for (const r of hits) Object.assign(r, st.values);
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
const confirm = (biz = BIZ_A, token = OWNER_A, batch = BATCH_A) =>
  api('POST', `/api/bank-import/batches/${batch}/confirm`, { token: tok(token), business: biz });
const payments = () => dbState.incoming_payments;

// ── Flag OFF: existing behaviour is untouched ────────────────────────────────────────────
test('flag OFF: confirm still imports, and creates NO incoming payment', async () => {
  process.env[FLAG] = 'false';
  const r = await confirm();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.imported, 2, 'the existing bank import must be unaffected');
  assert.strictEqual(payments().length, 0, 'the bridge ran with the flag off');
});

test('flag OFF: the confirm response shape is unchanged — no bridge key at all', async () => {
  process.env[FLAG] = 'false';
  const r = await confirm();
  assert.ok(!('incoming_payments' in r.body), 'flag-off responses must not gain a new field');
  assert.deepStrictEqual(Object.keys(r.body).sort(), ['imported', 'ok', 'reconciliation', 'status']);
});

// ── Flag ON: credits become evidence, debits do not ──────────────────────────────────────
test('flag ON: a confirmed CREDIT row creates one incoming payment', async () => {
  const r = await confirm();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.incoming_payments.created, 1);
  assert.strictEqual(payments().length, 1);
  const p = payments()[0];
  assert.strictEqual(p.source_type, 'bank_statement_import');
  assert.strictEqual(p.provider, 'bank');
  assert.strictEqual(p.gross_amount, 250000);
  assert.strictEqual(p.net_amount, 250000);
  assert.strictEqual(p.business_id, BIZ_A);
});

test('flag ON: a DEBIT row creates NOTHING — an expense is not incoming money', async () => {
  await confirm();
  assert.strictEqual(payments().length, 1);
  assert.strictEqual(payments().filter((p) => p.gross_amount === 90000).length, 0,
    'the debit line was recorded as incoming money');
});

test('flag ON: the existing ledger import is unchanged', async () => {
  const r = await confirm();
  // Both rows still become transactions exactly as before; the bridge adds, never replaces.
  assert.strictEqual(r.body.imported, 2);
  assert.strictEqual(dbState.transactions.length, 2);
});

test('the bridge itself creates no transaction and no debt', async () => {
  const before = dbState.transactions.length;
  await confirm();
  // 2 transactions come from the pre-existing import loop; the bridge adds none of its own.
  assert.strictEqual(dbState.transactions.length, before + 2);
  assert.strictEqual(dbState.debts.length, 0);
  assert.strictEqual(payments()[0].linked_transaction_id, null);
  assert.strictEqual(payments()[0].linked_debt_id, null);
});

// ── Inert state ──────────────────────────────────────────────────────────────────────────
test('a bridged payment is draft and unmatched — never pre-reviewed', async () => {
  await confirm();
  const p = payments()[0];
  assert.strictEqual(p.status, 'draft');
  assert.strictEqual(p.reconciliation_status, 'unmatched');
  assert.strictEqual(p.reviewed_by_user_id ?? null, null);
  assert.strictEqual(p.reviewed_at ?? null, null);
});

// ── Provenance ───────────────────────────────────────────────────────────────────────────
test('provenance points back to the exact batch and row', async () => {
  await confirm();
  const p = payments()[0];
  assert.strictEqual(p.bank_import_batch_id, BATCH_A);
  assert.strictEqual(p.bank_import_row_id, 'row-credit');
  assert.strictEqual(p.idempotency_key, 'bank_row:hash-credit');
  assert.strictEqual(p.payer_reference, 'REF-9');
});

test('the bridged payment is visible through the incoming-payments list API', async () => {
  await confirm();
  const list = await api('GET', '/api/incoming-payments', { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.payments.length, 1);
  assert.strictEqual(list.body.payments[0].bank_import_row_id, 'row-credit');
});

// ── Idempotency ──────────────────────────────────────────────────────────────────────────
test('confirming the same batch twice does not duplicate the payment', async () => {
  await confirm();
  dbState.bank_import_batches[0].status = 'partially_imported';   // allow a second confirm
  const second = await confirm();
  assert.strictEqual(second.status, 200);
  assert.strictEqual(payments().length, 1, 'the same statement line was recorded twice');
  assert.strictEqual(second.body.incoming_payments.created, 0);
  assert.strictEqual(second.body.incoming_payments.duplicates, 1);
});

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────
test('another business cannot confirm this batch, so no evidence crosses companies', async () => {
  const r = await confirm(BIZ_B, OWNER_B);
  assert.strictEqual(r.status, 404);
  assert.strictEqual(payments().length, 0);
});

test('a batch carrying another business\'s wallet yields no wallet, never a cross-company link', async () => {
  dbState.bank_import_batches[0].wallet_id = WALLET_B;
  await confirm();
  assert.strictEqual(payments().length, 1);
  assert.strictEqual(payments()[0].wallet_id, null, 'a wallet from another business was stamped on');
});

test('a same-business wallet IS carried through', async () => {
  await confirm();
  assert.strictEqual(payments()[0].wallet_id, WALLET_A);
});

// ── Rows the reviewer did not confirm ────────────────────────────────────────────────────
test('an unconfirmed or excluded credit row is not bridged', async () => {
  dbState.bank_import_rows[0].review_status = 'review_required';
  await confirm();
  assert.strictEqual(payments().length, 0);
});

// ── Audit ────────────────────────────────────────────────────────────────────────────────
test('a bridged payment writes its own audit row', async () => {
  await confirm();
  const rows = dbState.audit_events.filter((a) => a.entity_type === 'incoming_payment');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].action, 'created_from_bank_import');
  assert.strictEqual(rows[0].business_id, BIZ_A);
});

// ── The CASCADE confirm — the route the Bank Import screen actually calls ─────────────────
//
// client/src/pages/BankImport.jsx posts to /api/bank-imports/:batchId/confirm (plural
// "imports"), not the V1 /api/bank-import/batches/:id/confirm. Bridging only V1 left the
// feature dead on the one path production exercises, so these tests drive the cascade route
// specifically. If the bridge is ever unwired from it again, these fail.
const cascadeConfirm = (biz = BIZ_A, token = OWNER_A, batch = BATCH_A) =>
  api('POST', `/api/bank-imports/${batch}/confirm`, { token: tok(token), business: biz,
    // The real payload shape the review screen sends: one entry per reviewed row.
    body: { rows: [
      { row_id: 'row-credit', transaction_type: 'income' },
      { row_id: 'row-debit', transaction_type: 'expense' },
    ] } });

function seedForCascade() {
  // The cascade route reads review_status set by the review queue.
  dbState.bank_import_rows[0].review_status = 'confirmed';
  dbState.bank_import_rows[1].review_status = 'confirmed';
  dbState.bank_import_batches[0].status = 'review_required';
}

test('CASCADE confirm: flag ON bridges the credit row', async () => {
  seedForCascade();
  const r = await cascadeConfirm();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(payments().length, 1, 'the UI confirm path produced no incoming payment');
  assert.strictEqual(payments()[0].bank_import_row_id, 'row-credit');
  assert.strictEqual(payments()[0].source_type, 'bank_statement_import');
});

test('CASCADE confirm: the debit row is still never bridged', async () => {
  seedForCascade();
  await cascadeConfirm();
  assert.strictEqual(payments().filter((p) => p.gross_amount === 90000).length, 0);
});

test('CASCADE confirm: flag OFF changes nothing and adds no response key', async () => {
  seedForCascade();
  process.env[FLAG] = 'false';
  const r = await cascadeConfirm();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(payments().length, 0);
  assert.ok(!('incoming_payments' in r.body), 'flag-off cascade response gained a new field');
});

test('CASCADE confirm: re-confirming does not duplicate the payment', async () => {
  seedForCascade();
  await cascadeConfirm();
  const second = await cascadeConfirm();
  assert.strictEqual(payments().length, 1);
  assert.strictEqual(second.body.incoming_payments.duplicates, 1);
});

test('CASCADE confirm: another business cannot reach this batch', async () => {
  seedForCascade();
  const r = await cascadeConfirm(BIZ_B, OWNER_B);
  assert.notStrictEqual(r.status, 200);
  assert.strictEqual(payments().length, 0);
});

test('BOTH confirm routes bridge, and they agree on the result', async () => {
  // V1 first, then the cascade on the same batch: the second must find the row already
  // bridged rather than recording the same money twice.
  seedForCascade();
  const v1 = await confirm();
  assert.strictEqual(v1.body.incoming_payments.created, 1);
  const cascade = await cascadeConfirm();
  assert.strictEqual(cascade.body.incoming_payments.created, 0);
  assert.strictEqual(cascade.body.incoming_payments.duplicates, 1);
  assert.strictEqual(payments().length, 1);
});
