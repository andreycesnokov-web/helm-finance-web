'use strict';
// The reviewed bank-import confirm (both addresses) over real Express/JWT and real PostgreSQL with
// the production schema snapshot plus every release migration from 069 on. Proves:
//   * a missing, reversed, impossible or multi-decade statement period is a clear 400
//     corrupt_statement_period on both routes and writes nothing (it used to reach the client as
//     503 "outcome unknown", because cfo_import_review_state raised before the server check ran);
//   * a well-formed statement still confirms, and two simultaneous confirms of one reviewed
//     version commit exactly once (one 200, one 409);
//   * a revoked session token is refused by the same routes.
// Needs DATABASE_URL naming a disposable local PostgreSQL superuser; otherwise it skips.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { createRealPgSupabase } = require('./_realPgSupabase');

const RELEASE_MIGRATIONS = [
  '069_bank_import_atomic_confirm.sql', '070_atomic_business_balance.sql', '071_financial_records_restrict_user_delete.sql',
  '20261010143341_import_balance_compat.sql', '20261011001823_financial_writer_protocol.sql',
  '20261011222631_intercompany_balances_security_invoker.sql', '20261012032717_durable_financial_recovery.sql',
  '20261012110000_durable_company_creation.sql', '20261012123000_atomic_team_membership.sql',
  '20261013001000_atomic_business_profile.sql', '20261013031755_historical_bank_import_review_receipts.sql',
  '20261013062733_private_import_receipt_immutability.sql', '20261013114500_atomic_bill_creation.sql',
  '20261014040810_operation_document_control.sql', '20261016090000_dated_opening_anchor.sql',
];
const JWT_SECRET = 'bank-import-period-guard-test-secret-0123456789';
const OWNER = 8102;
const BIZ = crypto.randomUUID(), WALLET = crypto.randomUUID();

let db, admin, server, BASE, token, supa;
// A session token that is valid for JWT_SECRET but listed as revoked. The shipped list cannot name a
// test token, so the server loads revokedTokens with this digest appended (same functions, longer list).
const revokedToken = require('jsonwebtoken').sign({ userId: OWNER, purpose: 'revoked' }, JWT_SECRET, { expiresIn: '30m' });
const ledger = async () => Number((await admin.query('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1', [BIZ])).rows[0].n);

async function makeBatch(start, end) {
  const batch = crypto.randomUUID(), r1 = crypto.randomUUID(), r2 = crypto.randomUUID();
  await admin.query(`INSERT INTO public.bank_import_batches (id, business_id, wallet_id, currency, statement_start, statement_end,
      opening_balance, closing_balance, row_count, status) VALUES ($1, $2, $3, 'IDR', $4, $5, 1000, 1070, 2, 'review_required')`,
  [batch, BIZ, WALLET, start, end]);
  await admin.query(`INSERT INTO public.bank_import_rows (id, business_id, batch_id, row_index, tx_date, description, amount, direction,
      match_status, review_status, dedup_hash) VALUES ($1, $3, $4, 0, '2026-01-02', 'Guard credit', 100, 'in', 'review_required', NULL, $1::uuid::text),
      ($2, $3, $4, 1, '2026-01-03', 'Guard debit', 30, 'out', 'review_required', NULL, $2::uuid::text)`, [r1, r2, BIZ, batch]);
  return { batch, r1, r2 };
}
const rowsOf = (f) => [{ row_id: f.r1, transaction_type: 'income', scope: 'business' }, { row_id: f.r2, transaction_type: 'expense', scope: 'business' }];

async function call(path, { method = 'GET', body, bearer = token } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'x-business-id': BIZ },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

describe('Reviewed bank-import confirm: period guard, concurrency, revoked token (real PostgreSQL)', () => {
  let skipped = false;

  before(async () => {
    db = await createProdSchemaDatabase('hf_period_guard', RELEASE_MIGRATIONS);
    if (!db) { skipped = true; return; }
    admin = new Client({ connectionString: db.connectionString });
    await admin.connect();
    await admin.query('INSERT INTO public.users (id) VALUES ($1)', [OWNER]);
    await admin.query(`INSERT INTO public.businesses (id, name, owner_user_id, type, status, country, base_currency)
      VALUES ($1, 'Period Guard Co', $2, 'business', 'active', 'Indonesia', 'IDR')`, [BIZ, OWNER]);
    await admin.query(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [BIZ, OWNER]);
    await admin.query(`INSERT INTO public.wallets (id, business_id, user_id, name, currency, type, scope) VALUES ($1, $2, $3, 'Guard IDR', 'IDR', 'bank', 'business')`, [WALLET, BIZ, OWNER]);
    await admin.query(`INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type, amount_original, amount_idr, currency_original,
      booked_rate, rate_source, source, wallet_id, scope, is_opening_balance, transaction_date)
      VALUES ($1, $2, $2, 'income', 900, 900, 'IDR', 1, 'native', 'wallet_opening_balance', $3, 'business', true, '2026-01-01')`, [BIZ, OWNER, WALLET]);

    supa = createRealPgSupabase(db.connectionString);
    const lib = require.resolve('@supabase/supabase-js'), real = require(lib);
    require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: { ...real, createClient: () => supa } };
    const rtPath = require.resolve('../../server/lib/revokedTokens'), RT = require(rtPath);
    const list = Object.freeze([...RT.REVOKED_TOKEN_HASHES, RT.tokenDigest(revokedToken)]);
    require.cache[rtPath] = { id: rtPath, filename: rtPath, loaded: true, exports: { ...RT, REVOKED_TOKEN_HASHES: list,
      isRevokedToken: (tok) => RT.isRevokedToken(tok, list), verifyAppToken: (tok, s, o) => RT.verifyAppToken(tok, s, o, list) } };
    Object.assign(process.env, { PORT: '0', NODE_ENV: 'test', JWT_SECRET, SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SECRET_KEY: 'test-service-key', BOT_TOKEN: 'fake_bot_token', TELEGRAM_WEBHOOK_SECRET: 'fake_tg_secret', INCOMING_PAYMENTS_ENABLED: 'false' });
    const listen = http.Server.prototype.listen, interval = global.setInterval;
    http.Server.prototype.listen = function patched(...a) { server = this; return listen.apply(this, a); };
    global.setInterval = (...a) => { const t = interval(...a); t.unref(); return t; };
    try { require('../../server/index.js'); } finally { http.Server.prototype.listen = listen; global.setInterval = interval; }
    if (!server.listening) await new Promise(r => server.once('listening', r));
    BASE = `http://127.0.0.1:${server.address().port}/api`;
    token = require('jsonwebtoken').sign({ userId: OWNER }, JWT_SECRET, { expiresIn: '30m' });
  });

  after(async () => {
    if (server?.listening) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    try { await supa?.pool.end(); } catch { /* */ }
    try { await admin?.end(); } catch { /* */ }
    if (db) await db.drop();
  });

  it('a bad statement period is 400 corrupt_statement_period on both routes and writes nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const cases = [[null, null], [null, '2026-01-03'], ['2026-01-03', '2026-01-02'], ['2000-12-31', '2032-12-31']];
    for (const [start, end] of cases) {
      for (const route of ['bank-imports/%/confirm', 'bank-import/batches/%/confirm']) {
        const f = await makeBatch(start, end);
        const before = await ledger();
        const r = await call(`/${route.replace('%', f.batch)}`, { method: 'POST',
          body: { request_key: crypto.randomUUID(), review_hash: crypto.randomBytes(32).toString('hex'), rows: rowsOf(f) } });
        assert.strictEqual(r.status, 400, `${start}…${end} via ${route}: ${JSON.stringify(r.body)}`);
        assert.strictEqual(r.body.code, 'corrupt_statement_period');
        assert.strictEqual(await ledger(), before);
      }
    }
  });

  it('a good statement still confirms; two simultaneous confirms of one reviewed version commit once', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const f = await makeBatch('2026-01-02', '2026-01-03');
    const review = await call(`/bank-imports/${f.batch}/review`);
    assert.strictEqual(review.status, 200, JSON.stringify(review.body));
    assert.ok(review.body.reviewed?.can_confirm, JSON.stringify(review.body.reviewed));
    const before = await ledger();
    const body = { request_key: crypto.randomUUID(), review_hash: review.body.reviewed.review_hash, rows: rowsOf(f) };
    const rs = await Promise.all([call(`/bank-imports/${f.batch}/confirm`, { method: 'POST', body }),
      call(`/bank-imports/${f.batch}/confirm`, { method: 'POST', body: { ...body, request_key: crypto.randomUUID() } })]);
    assert.deepStrictEqual(rs.map(r => r.status).sort(), [200, 409], JSON.stringify(rs));
    assert.strictEqual(await ledger(), before + 2);
  });

  it('a revoked session token is refused (401) by the real auth middleware and the confirm writes nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const f = await makeBatch('2026-01-02', '2026-01-03');
    const review = await call(`/bank-imports/${f.batch}/review`);
    assert.strictEqual(review.status, 200);
    const before = await ledger();
    const denied = await call(`/bank-imports/${f.batch}/review`, { bearer: revokedToken });
    assert.strictEqual(denied.status, 401);
    const r = await call(`/bank-imports/${f.batch}/confirm`, { method: 'POST', bearer: revokedToken,
      body: { request_key: crypto.randomUUID(), review_hash: review.body.reviewed.review_hash, rows: rowsOf(f) } });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(await ledger(), before);
    const receipt = await call(`/debts/1/receipt?token=${encodeURIComponent(revokedToken)}`, { bearer: '' });
    assert.strictEqual(receipt.status, 401, 'the ?token= receipt address is guarded too');
  });
});
