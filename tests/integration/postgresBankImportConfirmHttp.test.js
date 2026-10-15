// The REAL bank-import confirm routes (server/index.js) over HTTP against real PostgreSQL with the
// production schema + migration 069. Proves at the API level: a statement with one corrupt row
// imports nothing; two simultaneous confirms import once; a second copy of the statement is
// refused; corrupt periods are refused; without migration 069 nothing is written (no fallback);
// the V1 route goes through the same atomic path.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { createRealPgSupabase } = require('./_realPgSupabase');

const JWT_SECRET = 'bank-import-confirm-http-test-secret-0123456789';
const OWNER = 8101;
const BIZ = crypto.randomUUID(), WALLET = crypto.randomUUID(), CAT = crypto.randomUUID();
const LINES = [[1000000, 'in'], [250000, 'out'], [100000, 'out'], [500000, 'in'], [50000, 'out']];

let db, admin, server, BASE, token, supa;
const n = (v) => Number(v);
const count = async (sql, p) => n((await admin.query(sql, p)).rows[0].n);
const ledger = () => count('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1', [BIZ]);

async function makeBatch({ tag = crypto.randomBytes(3).toString('hex'), start = '2026-05-02', end = '2026-05-06', review = 'suggested' } = {}) {
  const batch = crypto.randomUUID();
  await admin.query(
    `INSERT INTO public.bank_import_batches (id, business_id, wallet_id, uploaded_by_user_id, currency, statement_start, statement_end,
       opening_balance, closing_balance, row_count, status) VALUES ($1, $2, $3, $4, 'IDR', $5, $6, 10000000, 11100000, 5, 'review_required')`,
    [batch, BIZ, WALLET, OWNER, start, end]);
  const rows = [];
  for (const [i, [amount, direction]] of LINES.entries()) {
    const id = crypto.randomUUID();
    const desc = `Line ${i + 1} ${tag}`;
    const date = `2026-05-0${i + 2}`;
    const hash = crypto.createHash('sha256').update([BIZ, WALLET, date, amount.toFixed(2), direction, desc].join('|')).digest('hex').slice(0, 32);
    await admin.query(
      `INSERT INTO public.bank_import_rows (id, batch_id, business_id, row_index, tx_date, description, amount, direction, dedup_hash,
         suggested_type, suggested_transaction_type, review_status, match_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, 'review_required')`,
      [id, batch, BIZ, i, date, desc, amount, direction, hash, direction === 'in' ? 'income' : 'expense', review]);
    rows.push({ id, direction });
  }
  return { batch, rows };
}
const body = (rows) => ({ rows: rows.map(r => ({ row_id: r.id, transaction_type: r.direction === 'in' ? 'income' : 'expense',
  category_id: r.direction === 'in' ? CAT : null, scope: 'business', match_action: 'create_transaction' })) });

// The confirm payload exactly as client/src/pages/BankImport.jsx builds it (row state init +
// confirm()): duplicates cannot be included, matched rows default to "link".
function uiConfirmBody(rows) {
  const state = rows.map(r => {
    const isMatched = r.match_status === 'matched' || !!r.matched_transaction_id || r.suggested_match_type === 'existing_tx';
    return { ...r, _type: r.suggested_transaction_type || r.suggested_type || (r.direction === 'in' ? 'income' : 'expense'),
      _scope: r.suggested_scope || 'business', _action: isMatched ? 'link' : 'create_transaction',
      _include: r.match_status !== 'duplicate' && r.review_status !== 'excluded' };
  });
  const target = state.filter(r => r._include && r.match_status !== 'duplicate' && r.review_status !== 'imported');
  return { rows: target.map(r => {
    const isLink = r._action === 'link' || (r.suggested_match_type && r._action === 'link') || (!r._action && !!r.matched_transaction_id);
    const matchTxId = r.matched_transaction_id || (r.suggested_match_type === 'existing_tx' ? Number(r.suggested_match_id) : null);
    return { row_id: r.id, transaction_type: r._type, category_id: null, counterparty_id: null, scope: r._scope,
      match_action: isLink ? 'link' : 'create_transaction', matched_transaction_id: isLink ? matchTxId : null };
  }) };
}
const ledgerCopies = (desc) => count('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1 AND description = $2', [BIZ, desc]);
async function get(path) {
  const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${token}`, 'x-business-id': BIZ } });
  return { status: r.status, body: await r.json() };
}

async function post(path, payload) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-business-id': BIZ }, body: JSON.stringify(payload || {}) });
  return { status: r.status, body: await r.json() };
}

describe('Bank import confirm over HTTP (real server, real PostgreSQL, production schema)', () => {
  let skipped = false;

  before(async () => {
    db = await createProdSchemaDatabase('hf_confirm_http', ['069_bank_import_atomic_confirm.sql']);
    if (!db) { skipped = true; return; }
    admin = new Client({ connectionString: db.connectionString });
    await admin.connect();
    await admin.query('INSERT INTO public.users (id) VALUES ($1)', [OWNER]);
    await admin.query(`INSERT INTO public.businesses (id, name, owner_user_id, type) VALUES ($1, 'HTTP Test Co', $2, 'business')`, [BIZ, OWNER]);
    await admin.query(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [BIZ, OWNER]);
    await admin.query(`INSERT INTO public.wallets (id, business_id, user_id, name, currency, scope) VALUES ($1, $2, $3, 'Permata IDR', 'IDR', 'business')`, [WALLET, BIZ, OWNER]);
    await admin.query(`INSERT INTO public.cashflow_categories (id, business_id, name, group_type) VALUES ($1, $2, 'Sales', 'income')`, [CAT, BIZ]);

    supa = createRealPgSupabase(db.connectionString);
    const supaPath = require.resolve('@supabase/supabase-js');
    const real = require('@supabase/supabase-js');
    require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { ...real, createClient: () => supa } };
    Object.assign(process.env, { PORT: '0', NODE_ENV: 'test', JWT_SECRET, SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SECRET_KEY: 'test-service-key', BOT_TOKEN: 'fake_bot_token', TELEGRAM_WEBHOOK_SECRET: 'fake_tg_secret' });
    const realListen = http.Server.prototype.listen;
    http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
    try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
    if (!server.listening) await new Promise(r => server.once('listening', r));
    BASE = `http://127.0.0.1:${server.address().port}/api`;
    token = require('jsonwebtoken').sign({ userId: OWNER }, JWT_SECRET, { expiresIn: '1h' });
  });

  after(async () => {
    try { server?.close(); } catch { /* */ }
    try { await supa?.pool.end(); } catch { /* */ }
    try { await admin?.end(); } catch { /* */ }
    if (db) await db.drop();
    setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
  });

  it('one corrupt row → 400 listing it, and NOTHING is written (no partial import)', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    await admin.query('UPDATE public.bank_import_rows SET tx_date = NULL WHERE batch_id = $1 AND row_index = 4', [batch]);
    const before = await ledger();
    const r = await post(`/bank-imports/${batch}/confirm`, body(rows));
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'invalid_rows');
    assert.strictEqual(r.body.error, 'Statement row 5: Row date is missing or not a valid date. Nothing was imported.');
    assert.deepStrictEqual(r.body.rows.map(x => [x.row_index, x.error]), [[4, 'Row date is missing or not a valid date']]);
    assert.strictEqual(await ledger(), before);
    assert.strictEqual(await count(`SELECT count(*) AS n FROM public.bank_import_rows WHERE batch_id = $1 AND (linked_transaction_id IS NOT NULL OR review_status <> 'suggested')`, [batch]), 0);
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.classification_feedback f JOIN public.bank_import_rows r ON r.id = f.bank_import_row_id WHERE r.batch_id = $1', [batch]), 0);
  });

  it('two simultaneous confirms of the same statement → one 200, one 409; imported exactly once', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const before = await ledger();
    // Hold the business confirm lock so both requests pass preflight and reach the database together.
    const holder = new Client({ connectionString: db.connectionString });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('bank_import_confirm:' || $1::text, 0))`, [BIZ]);
    const both = Promise.all([post(`/bank-imports/${batch}/confirm`, body(rows)), post(`/bank-imports/${batch}/confirm`, body(rows))]);
    for (let i = 0; i < 100; i++) {
      const w = await count(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`);
      if (w >= 2) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.strictEqual(await count(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`), 2, 'both requests are inside the database, waiting');
    await holder.query('COMMIT');
    await holder.end();
    const res = await both;
    assert.deepStrictEqual(res.map(r => r.status).sort(), [200, 409]);
    const ok = res.find(r => r.status === 200).body, refused = res.find(r => r.status === 409).body;
    assert.strictEqual(ok.imported, 5);
    assert.strictEqual(ok.reconciliation.status, 'balanced');
    assert.strictEqual(refused.code, 'batch_closed');
    assert.strictEqual(await ledger(), before + 5);
    // A later replay is refused by the pre-check (unchanged contract: 400 "Batch already imported").
    const replay = await post(`/bank-imports/${batch}/confirm`, body(rows));
    assert.strictEqual(replay.status, 400);
    assert.strictEqual(replay.body.error, 'Batch already imported');
    assert.strictEqual(await ledger(), before + 5);
  });

  it('partial confirm, then the same rows again → 200 imported 0 (unchanged contract), nothing written', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch({ review: 'needs_review' });
    const first = await post(`/bank-imports/${batch}/confirm`, body(rows.slice(0, 2)));
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.status, 'partially_imported');
    const before = await ledger();
    const recs = await count('SELECT count(*) AS n FROM public.bank_reconciliations WHERE batch_id = $1', [batch]);
    const again = await post(`/bank-imports/${batch}/confirm`, body(rows.slice(0, 2)));
    assert.strictEqual(again.status, 200);
    assert.deepStrictEqual(Object.keys(again.body).sort(), ['imported', 'linked', 'ok', 'reconciliation', 'status']);
    assert.strictEqual(again.body.imported, 0);
    assert.strictEqual(await ledger(), before);
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.bank_reconciliations WHERE batch_id = $1', [batch]), recs,
      'a repeat no longer stores an empty (always "unbalanced") reconciliation snapshot');
  });

  it('through the REAL upload route: look-alike operations import, a re-uploaded statement does not', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const tag = crypto.randomBytes(3).toString('hex');
    const statement = {
      wallet_id: WALLET, currency: 'IDR', file_name: `june-${tag}.csv`,
      rows: [
        { tx_date: '2026-06-03', amount: 150000, direction: 'out', description: `QRIS COFFEE ${tag}` },
        { tx_date: '2026-06-03', amount: 150000, direction: 'out', description: `QRIS COFFEE ${tag}` },
        { tx_date: '2026-06-04', amount: 5000000, direction: 'out', description: `TRF VENDOR ${tag}`, bank_reference: `R-${tag}` },
        { tx_date: '2026-06-04', amount: 6500, direction: 'out', description: `BIAYA TRF ${tag}`, bank_reference: `R-${tag}` },
      ],
    };
    const createAll = (rows) => ({ rows: rows.map(r => ({ row_id: r.id, transaction_type: 'expense', scope: 'business', match_action: 'create_transaction' })) });
    const up1 = await post('/bank-import/batches', statement);
    assert.strictEqual(up1.status, 200, JSON.stringify(up1.body));
    const before = await ledger();
    const ok = await post(`/bank-imports/${up1.body.batch.id}/confirm`, createAll(up1.body.rows));
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.imported, 4, 'two coffees, the payment and its fee are four real operations');
    assert.strictEqual(await ledger(), before + 4);
    // The same file uploaded again and confirmed with every row forced to "create".
    const up2 = await post('/bank-import/batches', statement);
    assert.strictEqual(up2.status, 200);
    const dup = await post(`/bank-imports/${up2.body.batch.id}/confirm`, createAll(up2.body.rows));
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.code, 'duplicate_of_imported_row');
    assert.strictEqual(await ledger(), before + 4);
  });

  it('the same statement uploaded twice: the second batch is refused (409), nothing written', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const a = await makeBatch({ tag: 'twice' });
    const b = await makeBatch({ tag: 'twice' });
    assert.strictEqual((await post(`/bank-imports/${a.batch}/confirm`, body(a.rows))).status, 200);
    const before = await ledger();
    const r = await post(`/bank-imports/${b.batch}/confirm`, body(b.rows));
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'duplicate_of_imported_row');
    assert.match(r.body.error, /statement row 1 is already imported from another statement batch/);
    assert.strictEqual(await ledger(), before);
  });

  it('UI path: a fuller statement after a truncated one imports exactly the missing copy', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const tag = crypto.randomBytes(3).toString('hex');
    const coffee = { tx_date: '2026-07-03', amount: 45000, direction: 'out', description: `QRIS KOPI ${tag}` };
    const parking = { tx_date: '2026-07-04', amount: 10000, direction: 'out', description: `PARKIR ${tag}` };
    const first = await post('/bank-import/batches', { wallet_id: WALLET, currency: 'IDR', rows: [coffee] });
    assert.strictEqual((await post(`/bank-imports/${first.body.batch.id}/confirm`, uiConfirmBody(first.body.rows))).status, 200);
    assert.strictEqual(await ledgerCopies(coffee.description), 1);

    // The full export has the coffee twice (two real purchases) and a line the first lacked.
    const full = await post('/bank-import/batches', { wallet_id: WALLET, currency: 'IDR', rows: [coffee, coffee, parking] });
    assert.strictEqual(full.status, 200);
    assert.deepStrictEqual(full.body.rows.map(r => r.match_status), ['duplicate', 'review_required', 'review_required'],
      'only as many copies as the ledger already holds are flagged duplicate');
    const r = await post(`/bank-imports/${full.body.batch.id}/confirm`, uiConfirmBody(full.body.rows));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.imported, 2);
    assert.strictEqual(await ledgerCopies(coffee.description), 2, 'both real purchases are in the ledger, once each');
    assert.strictEqual(await ledgerCopies(parking.description), 1);

    // Uploading the full export once more: every line is now in the ledger as often as it occurs.
    const again = await post('/bank-import/batches', { wallet_id: WALLET, currency: 'IDR', rows: [coffee, coffee, parking] });
    assert.deepStrictEqual(again.body.rows.map(r => r.match_status), ['duplicate', 'duplicate', 'duplicate']);
    assert.strictEqual(uiConfirmBody(again.body.rows).rows.length, 0, 'the UI has nothing to send');
  });

  it('UI path: one of two identical operations was entered by hand — one row links to it, the other is created', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const tag = crypto.randomBytes(3).toString('hex');
    const line = { tx_date: '2026-07-08', amount: 120000, direction: 'out', description: `GRAB ${tag}` };
    const manual = (await admin.query(
      `INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type, amount_original, currency_original, amount_idr, wallet_id, transaction_date, description)
       VALUES ($1, $2, $2, 'expense', 120000, 'IDR', 120000, $3, '2026-07-08', 'entered by hand') RETURNING id`, [BIZ, OWNER, WALLET])).rows[0].id;
    const up = await post('/bank-import/batches', { wallet_id: WALLET, currency: 'IDR', rows: [line, line] });
    assert.deepStrictEqual(up.body.rows.map(r => [r.match_status, r.matched_transaction_id === null ? null : n(r.matched_transaction_id)]),
      [['matched', n(manual)], ['review_required', null]], 'the hand-entered transaction is offered to one row only');

    // /suggest must not offer the same transaction to the second row either.
    assert.strictEqual((await post(`/bank-imports/${up.body.batch.id}/suggest`)).status, 200);
    const review = await get(`/bank-imports/${up.body.batch.id}/review`);
    const offered = review.body.rows.filter(r => r.suggested_match_type === 'existing_tx' && n(r.suggested_match_id) === n(manual));
    assert.ok(offered.length <= 1, `suggested to ${offered.length} rows`);

    const before = await ledger();
    const r = await post(`/bank-imports/${up.body.batch.id}/confirm`, uiConfirmBody(review.body.rows));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.linked + r.body.imported, 2);
    assert.strictEqual(r.body.linked, 1);
    assert.strictEqual(await ledger(), before + 1, 'one new transaction; the other row links to the hand-entered one');
  });

  it('two rows of one request linking the same transaction are refused in preflight with a row message', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const tx = (await admin.query(
      `INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type, amount_original, currency_original, amount_idr, wallet_id, transaction_date)
       VALUES ($1, $2, $2, 'expense', 250000, 'IDR', 250000, $3, '2026-05-03') RETURNING id`, [BIZ, OWNER, WALLET])).rows[0].id;
    // Same amount on both rows so the only problem is the shared link target.
    await admin.query(`UPDATE public.bank_import_rows SET amount = 250000 WHERE batch_id = $1 AND row_index IN (1, 2)`, [batch]);
    const before = await ledger();
    const r = await post(`/bank-imports/${batch}/confirm`, { rows: [rows[1], rows[2]].map(x => ({ row_id: x.id, transaction_type: 'expense',
      match_action: 'link', matched_transaction_id: n(tx) })) });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'invalid_rows');
    assert.match(r.body.error, /Statement row 3: Statement row 2 already links to the same transaction; choose Create for one of them/);
    assert.strictEqual(await ledger(), before);
  });

  it('a corrupt statement period (e.g. 2000-12-31 … 2032-12-31) is refused before any write', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch({ start: '2000-12-31', end: '2032-12-31' });
    const before = await ledger();
    const r = await post(`/bank-imports/${batch}/confirm`, body(rows));
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'corrupt_statement_period');
    assert.strictEqual(await ledger(), before);
  });

  it('without migration 069 the confirm refuses (503) and writes nothing — no row-by-row fallback', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const before = await ledger();
    await admin.query('ALTER FUNCTION public.rpc_confirm_bank_import(uuid, uuid, bigint, bigint, jsonb, text) RENAME TO rpc_confirm_bank_import_off');
    try {
      const r = await post(`/bank-imports/${batch}/confirm`, body(rows));
      assert.strictEqual(r.status, 503);
      assert.strictEqual(r.body.code, 'database_schema_mismatch');
    } finally {
      await admin.query('ALTER FUNCTION public.rpc_confirm_bank_import_off(uuid, uuid, bigint, bigint, jsonb, text) RENAME TO rpc_confirm_bank_import');
    }
    assert.strictEqual(await ledger(), before);
    assert.strictEqual(await count(`SELECT count(*) AS n FROM public.bank_import_rows WHERE batch_id = $1 AND review_status <> 'suggested'`, [batch]), 0);
  });

  it('V1 route: a corrupt confirmed row imports nothing; then the batch imports atomically and only once', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch } = await makeBatch({ review: 'confirmed' });
    await admin.query(`UPDATE public.bank_import_rows SET amount = 0 WHERE batch_id = $1 AND row_index = 2`, [batch]);
    const before = await ledger();
    const bad = await post(`/bank-import/batches/${batch}/confirm`);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.code, 'invalid_rows');
    assert.strictEqual(await ledger(), before);
    await admin.query(`UPDATE public.bank_import_rows SET amount = 100000 WHERE batch_id = $1 AND row_index = 2`, [batch]);
    const ok = await post(`/bank-import/batches/${batch}/confirm`);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.imported, 5);
    assert.strictEqual(ok.body.status, 'imported');
    assert.strictEqual(await count(`SELECT count(*) AS n FROM public.bank_import_rows WHERE batch_id = $1 AND match_status = 'confirmed' AND linked_transaction_id IS NOT NULL`, [batch]), 5);
    const again = await post(`/bank-import/batches/${batch}/confirm`);
    assert.strictEqual(again.status, 400);
    assert.strictEqual(await ledger(), before + 5);
  });
});
