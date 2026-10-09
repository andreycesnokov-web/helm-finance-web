// Migration 069 — rpc_confirm_bank_import on the REAL production schema, real PostgreSQL,
// two independent connections. Proves: all-or-nothing writes, replay protection, a concurrent
// confirm of the same batch waits and then writes nothing, a sibling batch holding the same
// statement cannot be imported twice (also concurrently), and the API roles cannot call it.
// Run: DATABASE_URL=postgresql://postgres:…@localhost:5432/testdb node --test tests/integration/postgresBankImportAtomicConfirm.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');

const OWNER = 7001, ACTOR = 7002, OTHER_OWNER = 7003;
const BIZ = crypto.randomUUID(), OTHER_BIZ = crypto.randomUUID();
const WALLET = crypto.randomUUID(), OTHER_WALLET = crypto.randomUUID();
const CAT = crypto.randomUUID(), OTHER_CAT = crypto.randomUUID();
const OPENING = 10000000;
// One bank statement: amount, direction. Net +1,100,000 → closing 11,100,000.
const LINES = [[1000000, 'in'], [250000, 'out'], [100000, 'out'], [500000, 'in'], [50000, 'out']];

let db, c1, c2, admin;
const n = (v) => Number(v);

async function count(sql, params) { return n((await admin.query(sql, params)).rows[0].n); }

// Each statement gets its own tag (its own dedup hashes) unless a test passes the same tag twice.
async function makeBatch({ statusRows = 'suggested', tag = crypto.randomBytes(3).toString('hex') } = {}) {
  const batch = crypto.randomUUID();
  await admin.query(
    `INSERT INTO public.bank_import_batches (id, business_id, wallet_id, uploaded_by_user_id, currency,
       statement_start, statement_end, opening_balance, closing_balance, row_count, status)
     VALUES ($1, $2, $3, $4, 'IDR', '2026-05-02', '2026-05-06', $5, $6, $7, 'review_required')`,
    [batch, BIZ, WALLET, OWNER, OPENING, OPENING + 1100000, LINES.length]);
  const rows = [];
  for (const [i, [amount, direction]] of LINES.entries()) {
    const id = crypto.randomUUID();
    const date = `2026-05-0${i + 2}`;
    const desc = `Statement line ${i + 1} ${tag}`;
    // Same statement line ⇒ same dedup hash in every batch that contains it (as rowDedupHash does).
    const hash = crypto.createHash('sha256').update([BIZ, WALLET, date, amount.toFixed(2), direction, desc.toLowerCase()].join('|')).digest('hex').slice(0, 32);
    await admin.query(
      `INSERT INTO public.bank_import_rows (id, batch_id, business_id, row_index, tx_date, description, amount, direction,
         dedup_hash, suggested_type, suggested_transaction_type, review_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)`,
      [id, batch, BIZ, i, date, desc, amount, direction, hash, direction === 'in' ? 'income' : 'expense', statusRows]);
    rows.push({ id, amount, direction, date, desc });
  }
  return { batch, rows };
}

// A statement with explicit lines { amount, direction, date, desc, ref }.
async function makeStatement(lines) {
  const batch = crypto.randomUUID();
  await admin.query(
    `INSERT INTO public.bank_import_batches (id, business_id, wallet_id, uploaded_by_user_id, currency, statement_start, statement_end, row_count, status)
     VALUES ($1, $2, $3, $4, 'IDR', '2026-06-01', '2026-06-30', $5, 'review_required')`, [batch, BIZ, WALLET, OWNER, lines.length]);
  const rows = [];
  for (const [i, l] of lines.entries()) {
    const id = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update([BIZ, WALLET, l.date, l.amount.toFixed(2), l.direction, l.desc.toLowerCase(), l.ref || ''].join('|')).digest('hex').slice(0, 32);
    await admin.query(
      `INSERT INTO public.bank_import_rows (id, batch_id, business_id, row_index, tx_date, description, amount, direction, bank_reference,
         dedup_hash, suggested_type, suggested_transaction_type, review_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 'suggested')`,
      [id, batch, BIZ, i, l.date, l.desc, l.amount, l.direction, l.ref || null, hash, l.direction === 'in' ? 'income' : 'expense']);
    rows.push({ id, amount: l.amount, direction: l.direction, date: l.date, desc: l.desc });
  }
  return { batch, rows };
}

function planFor(rows, overrides = {}) {
  return rows.map((r, i) => ({
    row_id: r.id, action: 'create', type: r.direction === 'in' ? 'income' : 'expense',
    category_id: r.direction === 'in' ? CAT : null, scope: 'business',
    expected_amount: r.amount, expected_date: r.date, currency: 'IDR',
    amount_idr: r.amount, booked_rate: '1', rate_source: 'identity',
    normalized_desc: r.desc.toLowerCase(), ...(overrides[i] || {}),
  }));
}

async function confirm(client, batch, plan, flow = 'review') {
  const r = await client.query(
    'SELECT public.rpc_confirm_bank_import($1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::jsonb, $6::text) AS r',
    [BIZ, batch, OWNER, ACTOR, JSON.stringify(plan), flow]);
  const v = r.rows[0].r;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));

// Waits until the given backend is blocked on a lock (proves the second call really waited).
async function waitBlocked(pid) {
  for (let i = 0; i < 100; i++) {
    const r = await admin.query(`SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (r.rows[0]?.wait_event_type === 'Lock') return r.rows[0].wait_event;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`backend ${pid} never blocked on a lock`);
}

const ledgerFor = (batch) => count(
  `SELECT count(*) AS n FROM public.transactions t JOIN public.bank_import_rows r ON r.linked_transaction_id = t.id WHERE r.batch_id = $1`, [batch]);
const businessTx = () => count('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1', [BIZ]);

describe('rpc_confirm_bank_import (migration 069) on the production schema', () => {
  let skipped = false;

  before(async () => {
    db = await createProdSchemaDatabase('hf_atomic_confirm', ['069_bank_import_atomic_confirm.sql']);
    if (!db) { skipped = true; return; }
    admin = new Client({ connectionString: db.connectionString });
    c1 = new Client({ connectionString: db.connectionString });
    c2 = new Client({ connectionString: db.connectionString });
    await admin.connect(); await c1.connect(); await c2.connect();
    assert.notStrictEqual(c1.processID, c2.processID, 'two independent backends');

    await admin.query('INSERT INTO public.users (id) VALUES ($1), ($2), ($3)', [OWNER, ACTOR, OTHER_OWNER]);
    await admin.query(`INSERT INTO public.businesses (id, name, owner_user_id, type) VALUES ($1, 'Atomic Test Co', $2, 'business'), ($3, 'Other Co', $4, 'business')`, [BIZ, OWNER, OTHER_BIZ, OTHER_OWNER]);
    await admin.query(`INSERT INTO public.wallets (id, business_id, user_id, name, currency, scope) VALUES ($1, $2, $3, 'Permata IDR', 'IDR', 'business'), ($4, $5, $6, 'Other wallet', 'IDR', 'business')`, [WALLET, BIZ, OWNER, OTHER_WALLET, OTHER_BIZ, OTHER_OWNER]);
    await admin.query(`INSERT INTO public.cashflow_categories (id, business_id, name, group_type) VALUES ($1, $2, 'Sales', 'income'), ($3, $4, 'Foreign', 'income')`, [CAT, BIZ, OTHER_CAT, OTHER_BIZ]);
  });

  after(async () => {
    for (const c of [c1, c2, admin]) { try { await c?.end(); } catch { /* */ } }
    if (db) await db.drop();
  });

  it('imports the whole statement in one call: transactions, links, feedback, reconciliation, status', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const out = await confirm(c1, batch, planFor(rows));
    assert.strictEqual(out.imported, 5);
    assert.strictEqual(out.status, 'imported');
    assert.strictEqual(out.reconciliation.status, 'balanced');
    assert.strictEqual(await ledgerFor(batch), 5);
    const tx = (await admin.query(
      `SELECT t.user_id, t.created_by_user_id, t.type, t.amount_original, t.amount_idr, t.category, t.source, t.wallet_id, t.transaction_date::text AS d
         FROM public.transactions t JOIN public.bank_import_rows r ON r.linked_transaction_id = t.id WHERE r.batch_id = $1 ORDER BY r.row_index`, [batch])).rows;
    assert.deepStrictEqual(tx.map(x => [n(x.user_id), n(x.created_by_user_id), x.type, n(x.amount_original), x.category, x.source, x.d]), [
      [OWNER, ACTOR, 'income', 1000000, 'Sales', 'Permata IDR', '2026-05-02'],
      [OWNER, ACTOR, 'expense', 250000, null, 'Permata IDR', '2026-05-03'],
      [OWNER, ACTOR, 'expense', 100000, null, 'Permata IDR', '2026-05-04'],
      [OWNER, ACTOR, 'income', 500000, 'Sales', 'Permata IDR', '2026-05-05'],
      [OWNER, ACTOR, 'expense', 50000, null, 'Permata IDR', '2026-05-06'],
    ]);
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.classification_feedback f JOIN public.bank_import_rows r ON r.id = f.bank_import_row_id WHERE r.batch_id = $1', [batch]), 5);
    assert.strictEqual(await count(`SELECT count(*) AS n FROM public.bank_import_rows WHERE batch_id = $1 AND review_status = 'imported'`, [batch]), 5);
  });

  it('rolls back EVERYTHING when a later row fails (no partial import)', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const before = await businessTx();
    // Row 4 (index 3) points at another business's category → raised inside the loop,
    // after rows 0-2 were already inserted in this transaction.
    const r = await settle(confirm(c1, batch, planFor(rows, { 3: { category_id: OTHER_CAT } })));
    assert.ok(r.error, 'confirm must fail');
    assert.match(r.error.message, /invalid_row: statement row 4 category does not belong/);
    assert.strictEqual(await businessTx(), before, 'no transaction survived');
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.bank_import_rows WHERE batch_id = $1 AND (linked_transaction_id IS NOT NULL OR review_status <> $2)', [batch, 'suggested']), 0, 'no row changed');
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.classification_feedback f JOIN public.bank_import_rows r ON r.id = f.bank_import_row_id WHERE r.batch_id = $1', [batch]), 0, 'no feedback');
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.bank_reconciliations WHERE batch_id = $1', [batch]), 0, 'no reconciliation');
    assert.strictEqual((await admin.query('SELECT status FROM public.bank_import_batches WHERE id = $1', [batch])).rows[0].status, 'review_required');
  });

  it('a replay of the same request writes nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch({ statusRows: 'needs_review' });
    const plan = planFor(rows.slice(0, 2));               // partial confirm: 3 rows stay in review
    const first = await confirm(c1, batch, plan);
    assert.strictEqual(first.imported, 2);
    assert.strictEqual(first.status, 'partially_imported');
    const recBefore = await count('SELECT count(*) AS n FROM public.bank_reconciliations WHERE batch_id = $1', [batch]);
    const again = await confirm(c2, batch, plan);
    assert.strictEqual(again.already_processed, true);
    assert.strictEqual(again.skipped, 2);
    assert.strictEqual(await ledgerFor(batch), 2);
    assert.strictEqual(await count('SELECT count(*) AS n FROM public.bank_reconciliations WHERE batch_id = $1', [batch]), recBefore);
  });

  it('two connections confirming the same batch at once: the second waits, then writes nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const plan = planFor(rows);
    await c1.query('BEGIN');
    const first = await confirm(c1, batch, plan);           // holds the locks until COMMIT
    assert.strictEqual(first.imported, 5);
    const second = settle(confirm(c2, batch, plan));
    const waitedOn = await waitBlocked(c2.processID);
    await c1.query('COMMIT');
    const out = await second;
    assert.ok(out.error, 'second confirm must be refused');
    assert.match(out.error.message, /batch_closed: batch status is imported/);
    assert.ok(['advisory', 'tuple', 'transactionid'].includes(waitedOn), `waited on ${waitedOn}`);
    assert.strictEqual(await ledgerFor(batch), 5, 'exactly one set of transactions');
  });

  it('a sibling batch with the same statement cannot be imported again — also when both run at once', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const a = await makeBatch({ tag: 'sibling' });
    const b = await makeBatch({ tag: 'sibling' });   // the same statement uploaded a second time
    const before = await businessTx();
    await c1.query('BEGIN');
    await confirm(c1, a.batch, planFor(a.rows));
    const second = settle(confirm(c2, b.batch, planFor(b.rows)));
    const waitedOn = await waitBlocked(c2.processID);
    assert.strictEqual(waitedOn, 'advisory', 'sibling batch waits on the business confirm lock');
    await c1.query('COMMIT');
    const out = await second;
    assert.ok(out.error);
    assert.match(out.error.message, /duplicate_of_imported_row: statement row 1 is already imported from another statement batch/);
    assert.strictEqual(await businessTx(), before + 5, 'the statement is in the ledger once');
    assert.strictEqual(await ledgerFor(b.batch), 0);
    // Sequential attempt is refused the same way.
    const again = await settle(confirm(c1, b.batch, planFor(b.rows)));
    assert.match(again.error.message, /duplicate_of_imported_row/);
  });

  it('link: a ledger transaction can back only one statement row; a conflict rolls back the whole request', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const tx = (await admin.query(
      `INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type, amount_original, currency_original, amount_idr, wallet_id, transaction_date)
       VALUES ($1, $2, $2, 'expense', 250000, 'IDR', 250000, $3, '2026-05-03') RETURNING id`, [BIZ, OWNER, WALLET])).rows[0].id;
    const before = await businessTx();
    const plan = planFor(rows, { 1: { action: 'link', matched_transaction_id: n(tx) } });
    const ok = await confirm(c1, batch, plan);
    assert.strictEqual(ok.linked, 1);
    assert.strictEqual(ok.imported, 4);
    assert.strictEqual(await businessTx(), before + 4, 'linked row created no new transaction');

    const other = await makeBatch();      // a different statement whose row 1 has the same amount
    const conflictPlan = planFor(other.rows, { 1: { action: 'link', matched_transaction_id: n(tx) } });
    const beforeConflict = await businessTx();
    const r = await settle(confirm(c1, other.batch, conflictPlan));
    assert.ok(r.error);
    assert.match(r.error.message, /link_conflict: transaction \d+ is already linked to another statement row/);
    assert.strictEqual(await businessTx(), beforeConflict, 'nothing written');
  });

  it('rows whose ledger transaction was deleted do not block the statement (no false duplicate)', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const a = await makeBatch({ tag: 'deleted' });
    await confirm(c1, a.batch, planFor(a.rows));
    // Ledger rows deleted later (links now dangle, as in the 2026-08-27 cascade).
    await admin.query('DELETE FROM public.transactions WHERE id IN (SELECT linked_transaction_id FROM public.bank_import_rows WHERE batch_id = $1)', [a.batch]);
    const b = await makeBatch({ tag: 'deleted' });
    const out = await confirm(c1, b.batch, planFor(b.rows));
    assert.strictEqual(out.imported, 5);
  });

  it('rejects malformed plans and rows without writing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const before = await businessTx();
    for (const [plan, re] of [
      [[], /invalid_plan/],
      [[...planFor(rows.slice(0, 1)), ...planFor(rows.slice(0, 1))], /duplicate row_id/],
      [planFor(rows, { 2: { type: 'gift' } }), /invalid transaction type/],
      [planFor(rows, { 4: { expected_amount: 999 } }), /row_changed/],
      [planFor(rows, { 0: { amount_idr: null } }), /no FX valuation/],
      [[{ ...planFor(rows)[0], row_id: crypto.randomUUID() }], /row_not_in_batch/],
    ]) {
      const r = await settle(confirm(c1, batch, plan));
      assert.ok(r.error, `expected ${re}`);
      assert.match(r.error.message, re);
    }
    await admin.query(`UPDATE public.bank_import_rows SET tx_date = NULL WHERE batch_id = $1 AND row_index = 4`, [batch]);
    const r = await settle(confirm(c1, batch, planFor(rows)));
    assert.match(r.error.message, /invalid_row: statement row 5 has no valid date/);
    assert.strictEqual(await businessTx(), before);
  });

  it('duplicate rule keeps genuine look-alikes: identical lines in one statement, payment + fee with one reference', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const tag = crypto.randomBytes(3).toString('hex');
    const lines = [
      { amount: 150000, direction: 'out', date: '2026-06-03', desc: `QRIS COFFEE ${tag}`, ref: null },   // bought twice the same day
      { amount: 150000, direction: 'out', date: '2026-06-03', desc: `QRIS COFFEE ${tag}`, ref: null },
      { amount: 5000000, direction: 'out', date: '2026-06-04', desc: `TRF VENDOR ${tag}`, ref: `REF-${tag}` },  // payment …
      { amount: 6500, direction: 'out', date: '2026-06-04', desc: `BIAYA TRF ${tag}`, ref: `REF-${tag}` },      // … and its fee
      { amount: 6500, direction: 'out', date: '2026-06-04', desc: `BIAYA TRF ${tag}`, ref: `REF2-${tag}` },     // another fee, other ref
    ];
    const a = await makeStatement(lines);
    const out = await confirm(c1, a.batch, planFor(a.rows));
    assert.strictEqual(out.imported, 5, 'all five real operations reach the ledger');

    // The same statement again: every line is already in the ledger as often as it occurs.
    const b = await makeStatement(lines);
    const again = await settle(confirm(c1, b.batch, planFor(b.rows)));
    assert.match(again.error.message, /duplicate_of_imported_row: statement row 1 /);
    assert.strictEqual(await ledgerFor(b.batch), 0);
  });

  it('a later statement may add the copy an earlier, shorter statement did not have — and only that copy', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const tag = crypto.randomBytes(3).toString('hex');
    const line = { amount: 75000, direction: 'out', date: '2026-06-10', desc: `PARKIR ${tag}` };
    const first = await makeStatement([line]);                 // truncated export: one copy
    await confirm(c1, first.batch, planFor(first.rows));
    const full = await makeStatement([line, line]);            // full export: the line occurs twice
    const both = await settle(confirm(c1, full.batch, planFor(full.rows)));
    assert.match(both.error.message, /duplicate_of_imported_row: statement row 2 /, 'importing both would double one');
    assert.strictEqual(await ledgerFor(full.batch), 0, 'rolled back');
    const one = await confirm(c1, full.batch, planFor(full.rows, { 1: { action: 'exclude' } }));
    assert.strictEqual(one.imported, 1);
    const ledgerCopies = await count(`SELECT count(*) AS n FROM public.transactions WHERE business_id = $1 AND description = $2`, [BIZ, line.desc]);
    assert.strictEqual(ledgerCopies, 2, 'the ledger holds the line exactly as often as the bank shows it');
  });

  it('re-checks under the lock what was validated / priced before the call', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    const before = await businessTx();
    for (const [what, plan, re] of [
      ['date the FX was priced for', planFor(rows, { 2: { expected_date: '2026-05-05' } }), /row_changed: statement row 3 date changed/],
      ['currency the FX was priced in', planFor(rows, { 0: { currency: 'USD' } }), /row_changed: statement currency changed/],
      ['IDR value vs amount', planFor(rows, { 1: { amount_idr: 999 } }), /IDR value does not match its amount/],
      ['amount', planFor(rows, { 3: { expected_amount: undefined } }), /row_changed: statement row 4 amount changed/],
    ]) {
      const r = await settle(confirm(c1, batch, plan));
      assert.ok(r.error, what);
      assert.match(r.error.message, re, what);
    }
    // The batch changed between preflight and the call: currency and a corrupt period.
    await admin.query(`UPDATE public.bank_import_batches SET currency = 'USD' WHERE id = $1`, [batch]);
    assert.match((await settle(confirm(c1, batch, planFor(rows)))).error.message, /row_changed: statement currency changed after validation \(now USD\)/);
    await admin.query(`UPDATE public.bank_import_batches SET currency = 'IDR', statement_start = '2000-12-31', statement_end = '2032-12-31' WHERE id = $1`, [batch]);
    assert.match((await settle(confirm(c1, batch, planFor(rows)))).error.message, /corrupt_statement_period/);
    assert.strictEqual(await businessTx(), before, 'nothing written');
  });

  it('foreign currency: the IDR value must equal amount × booked rate', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    await admin.query(`UPDATE public.bank_import_batches SET currency = 'USD' WHERE id = $1`, [batch]);
    const usd = (over) => planFor(rows).map((p, i) => ({ ...p, currency: 'USD', booked_rate: '16250.5', rate_source: 'test', amount_idr: Math.round(p.expected_amount * 16250.5), ...(over[i] || {}) }));
    const bad = await settle(confirm(c1, batch, usd({ 4: { amount_idr: 1 } })));
    assert.match(bad.error.message, /statement row 5 IDR value does not match amount × rate/);
    const ok = await confirm(c1, batch, usd({}));
    assert.strictEqual(ok.imported, 5);
    const cur = (await admin.query(`SELECT DISTINCT t.currency_original AS c FROM public.transactions t JOIN public.bank_import_rows r ON r.linked_transaction_id = t.id WHERE r.batch_id = $1`, [batch])).rows;
    assert.deepStrictEqual(cur.map(x => x.c), ['USD']);
  });

  it('only the server role may execute it (anon / authenticated are refused)', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const { batch, rows } = await makeBatch();
    for (const role of ['anon', 'authenticated']) {
      await c2.query('BEGIN');
      await c2.query(`SET LOCAL ROLE ${role}`);
      const r = await settle(confirm(c2, batch, planFor(rows)));
      await c2.query('ROLLBACK');
      assert.ok(r.error, `${role} must be refused`);
      assert.match(r.error.message, /permission denied for function rpc_confirm_bank_import/);
    }
    const acl = (await admin.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'rpc_confirm_bank_import'`)).rows[0].acl;
    assert.match(acl, /service_role=X/);
  });
});
