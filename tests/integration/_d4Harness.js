'use strict';
// Shared harness for the D4-A (dated opening anchor) tests: a disposable database with the real
// production schema snapshot + every release migration, a known "bank truth", seed helpers that
// write exactly what the application writes, and the real Express server over real PostgreSQL.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { createRealPgSupabase } = require('./_realPgSupabase');

const CHAIN = [
  '069_bank_import_atomic_confirm.sql', '070_atomic_business_balance.sql', '071_financial_records_restrict_user_delete.sql',
  '20261010143341_import_balance_compat.sql', '20261011001823_financial_writer_protocol.sql',
  '20261011222631_intercompany_balances_security_invoker.sql', '20261012032717_durable_financial_recovery.sql',
  '20261012110000_durable_company_creation.sql', '20261012123000_atomic_team_membership.sql',
  '20261013001000_atomic_business_profile.sql', '20261013031755_historical_bank_import_review_receipts.sql',
  '20261013062733_private_import_receipt_immutability.sql', '20261013114500_atomic_bill_creation.sql',
  '20261014040810_operation_document_control.sql',
];
const D4 = '20261016090000_dated_opening_anchor.sql';
const D4_DOWN = '20261016090000_dated_opening_anchor_down.sql';
const migrationSql = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', name), 'utf8');

// Bank truth (IDR). End-of-day balances: 31.07 30M · 31.08 36M · 15.09 41.5M · 30.09 40M · 10.10 42M · 16.10 41M.
const TRUTH_OPEN = { date: '2026-07-31', balance: 30_000_000 };
const MOVES = [
  ['2026-08-05', 10_000_000, 'Client A payment'], ['2026-08-20', -4_000_000, 'Rent August'],
  ['2026-09-03', 8_000_000, 'Client B payment'], ['2026-09-12', -2_500_000, 'Supplier invoice'], ['2026-09-25', -1_500_000, 'Tax payment'],
  ['2026-10-02', 5_000_000, 'Client C payment'], ['2026-10-10', -3_000_000, 'Payroll October'], ['2026-10-15', -1_000_000, 'Bank fees'],
];
const truthAt = (d) => MOVES.filter(m => m[0] <= d).reduce((s, m) => s + m[1], TRUTH_OPEN.balance);
const CONTROL_DATES = ['2026-07-31', '2026-08-31', '2026-09-15', '2026-09-30', '2026-10-10', '2026-10-16'];
const prevDay = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

async function createD4Database(prefix, { withD4 = true } = {}) {
  return createProdSchemaDatabase(prefix, withD4 ? [...CHAIN, D4] : CHAIN);
}

function seeder(admin) {
  const q = (sql, params) => admin.query(sql, params);
  return {
    async company({ owner, id = crypto.randomUUID(), type = 'business', timezone = 'Asia/Jakarta', name = 'D4 Test Co' }) {
      await q('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [owner]);
      await q(`INSERT INTO public.businesses (id, name, owner_user_id, type, status, country, base_currency, timezone)
        VALUES ($1, $2, $3, $4, 'active', 'Indonesia', 'IDR', $5)`, [id, name, owner, type, timezone]);
      await q(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [id, owner]);
      return id;
    },
    async member(biz, user, role) {
      await q('INSERT INTO public.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [user]);
      await q(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [biz, user, role]);
    },
    // A wallet with its opening as the application wrote it. legacy=true: pre-070 row (no flag, no date).
    async wallet(biz, owner, { opening = truthAt('2026-10-16'), createdAt = '2026-10-16 07:00:00+07', date = null, legacy = false, name, scope = 'business' } = {}) {
      const id = crypto.randomUUID();
      await q(`INSERT INTO public.wallets (id, business_id, user_id, name, currency, type, scope) VALUES ($1, $2, $3, $4, 'IDR', 'bank', $5)`,
        [id, biz, owner, name || 'BCA ' + id.slice(0, 6), scope]);
      const r = await q(`INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type, amount_original, amount_idr, currency_original,
          booked_rate, rate_source, source, category, description, wallet_id, scope, is_opening_balance, transaction_date, created_at)
        VALUES ($1, $2, $2, 'income', $3, $3, 'IDR', 1, 'native', 'wallet_opening_balance', 'Opening balance', 'Opening balance', $4, $8, $5, $6, $7)
        RETURNING id`, [biz, owner, opening, id, !legacy, date, createdAt, scope]);
      return { id, openingId: Number(r.rows[0].id) };
    },
    async manual(biz, owner, wallet, date, signed, description = 'Manual entry') {
      const r = await q(`INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type, amount_original, amount_idr, currency_original,
          booked_rate, rate_source, source, category, description, wallet_id, scope, transaction_date)
        VALUES ($1, $2, $2, $3, $4, $4, 'IDR', 1, 'native', 'manual', 'Other expenses', $5, $6, 'business', $7) RETURNING id`,
        [biz, owner, signed >= 0 ? 'income' : 'expense', Math.abs(signed), description, wallet, date]);
      return Number(r.rows[0].id);
    },
    // A reviewed statement batch exactly as upload + parse leave it. dedup = date|amount|direction|desc.
    async batch(biz, wallet, { start, end, opening = truthAt(prevDay(start)), closing = truthAt(end), rows }) {
      const id = crypto.randomUUID();
      await q(`INSERT INTO public.bank_import_batches (id, business_id, wallet_id, currency, statement_start, statement_end, opening_balance, closing_balance, row_count, status)
        VALUES ($1, $2, $3, 'IDR', $4, $5, $6, $7, $8, 'review_required')`, [id, biz, wallet, start, end, opening, closing, rows.length]);
      const ids = [];
      for (const [i, [date, signed, desc]] of rows.entries()) {
        const rid = crypto.randomUUID(); ids.push({ id: rid, date, signed, desc });
        await q(`INSERT INTO public.bank_import_rows (id, business_id, batch_id, row_index, tx_date, description, amount, direction, match_status, review_status, dedup_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'review_required', NULL, $9)`,
          [rid, biz, id, i, date, desc, Math.abs(signed), signed >= 0 ? 'in' : 'out', crypto.createHash('sha256').update(`${wallet}|${date}|${Math.abs(signed)}|${signed >= 0 ? 'in' : 'out'}|${desc}`).digest('hex').slice(0, 32)]);
      }
      return { id, rows: ids };
    },
  };
}

const movesBetween = (start, end, extra = []) => [...MOVES.filter(m => m[0] >= start && m[0] <= end), ...extra];

// Ledger facts read straight from the table with an INDEPENDENT formula (not the new functions).
function ledgerReader(admin) {
  return {
    async balanceAt(wallet, date) {
      const r = await admin.query(`SELECT coalesce(sum(CASE WHEN t.type='income' THEN t.amount_original WHEN t.type IN ('expense','payroll') THEN -t.amount_original
          WHEN t.type='correction' THEN t.amount_original ELSE 0 END),0)::numeric AS b
        FROM public.transactions t JOIN public.businesses b ON b.id=t.business_id
        WHERE t.wallet_id=$1 AND coalesce(t.transaction_date, (t.created_at AT TIME ZONE coalesce(nullif(b.timezone,''),'Asia/Jakarta'))::date) <= $2`, [wallet, date]);
      return Number(r.rows[0].b);
    },
    async today(wallet) {
      const r = await admin.query(`SELECT coalesce(sum(CASE WHEN type='income' THEN amount_original WHEN type IN ('expense','payroll') THEN -amount_original
          WHEN type='correction' THEN amount_original ELSE 0 END),0)::numeric AS b FROM public.transactions WHERE wallet_id=$1`, [wallet]);
      return Number(r.rows[0].b);
    },
    async count(wallet) { return Number((await admin.query('SELECT count(*) n FROM public.transactions WHERE wallet_id=$1', [wallet])).rows[0].n); },
    async fnBalanceAt(biz, wallet, date) {
      return (await admin.query('SELECT public.fn_wallet_balance_at($1,$2,$3) AS r', [biz, wallet, date])).rows[0].r;
    },
  };
}

// Boots server/index.js once per process (node --test runs each file in its own process).
async function startServer(connectionString, { jwtSecret = 'd4-anchor-test-secret-0123456789abcdef' } = {}) {
  const supa = createRealPgSupabase(connectionString);
  const lib = require.resolve('@supabase/supabase-js'), real = require(lib);
  require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: { ...real, createClient: () => supa } };
  Object.assign(process.env, { PORT: '0', NODE_ENV: 'test', JWT_SECRET: jwtSecret, SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SECRET_KEY: 'test-service-key', BOT_TOKEN: 'fake_bot_token', TELEGRAM_WEBHOOK_SECRET: 'fake_tg_secret', INCOMING_PAYMENTS_ENABLED: 'false' });
  let server;
  const listen = http.Server.prototype.listen, interval = global.setInterval;
  http.Server.prototype.listen = function patched(...a) { server = this; return listen.apply(this, a); };
  global.setInterval = (...a) => { const t = interval(...a); t.unref(); return t; };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = listen; global.setInterval = interval; }
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const BASE = `http://127.0.0.1:${server.address().port}/api`;
  const jwt = require('jsonwebtoken');
  const token = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '30m' });
  async function call(pathname, { method = 'GET', body, user, biz } = {}) {
    const r = await fetch(BASE + pathname, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token(user)}`, 'x-business-id': biz },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  return {
    call,
    async stop() {
      if (server?.listening) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
      try { await supa.pool.end(); } catch { /* */ }
    },
  };
}

async function openAdmin(connectionString) { const c = new Client({ connectionString }); await c.connect(); return c; }

module.exports = { CHAIN, D4, D4_DOWN, migrationSql, TRUTH_OPEN, MOVES, truthAt, CONTROL_DATES, prevDay, movesBetween,
  createD4Database, seeder, ledgerReader, startServer, openAdmin };
