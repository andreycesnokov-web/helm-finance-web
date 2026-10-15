'use strict';
// The payment simulation (POST /api/decisions/debts/:id/payment) over real Express/JWT and real
// PostgreSQL. A bank statement imported TODAY carries the bank's past dates in transaction_date;
// created_at is today. The simulation must measure burn by transaction_date, as Pulse does —
// otherwise the whole statement lands in a one-day window, daily burn is inflated many times and
// every payment is flagged "not recommended, runway critical".
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
];
const JWT_SECRET = 'decision-snapshot-dates-test-secret-0123456789';
const OWNER = 8203;
const BIZ = crypto.randomUUID(), WALLET = crypto.randomUUID();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let db, admin, server, BASE, token, supa, debtId;

describe('Payment simulation burn follows transaction_date (real PostgreSQL)', () => {
  let skipped = false;

  before(async () => {
    db = await createProdSchemaDatabase('hf_decision_dates', RELEASE_MIGRATIONS);
    if (!db) { skipped = true; return; }
    admin = new Client({ connectionString: db.connectionString });
    await admin.connect();
    await admin.query('INSERT INTO public.users (id) VALUES ($1)', [OWNER]);
    await admin.query(`INSERT INTO public.businesses (id, name, owner_user_id, type, status, country, base_currency)
      VALUES ($1, 'Decision Dates Co', $2, 'business', 'active', 'Indonesia', 'IDR')`, [BIZ, OWNER]);
    await admin.query(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [BIZ, OWNER]);
    await admin.query(`INSERT INTO public.wallets (id, business_id, user_id, name, currency, type, scope) VALUES ($1, $2, $3, 'Ops IDR', 'IDR', 'bank', 'business')`, [WALLET, BIZ, OWNER]);
    const tx = (type, amount, date, extra = {}) => admin.query(`INSERT INTO public.transactions (business_id, user_id, created_by_user_id, type,
      amount_original, amount_idr, currency_original, booked_rate, rate_source, source, wallet_id, scope, is_opening_balance, transaction_date, category)
      VALUES ($1, $2, $2, $3, $4, $4, 'IDR', 1, 'native', $5, $6, 'business', $7, $8, $9)`,
    [BIZ, OWNER, type, amount, extra.source || 'bank_import', WALLET, !!extra.opening, date, extra.category || null]);
    // Opening balance recorded today; the statement rows are dated 20 and 10 days ago but created now.
    await tx('income', 50000000, daysAgo(0), { opening: true, source: 'wallet_opening_balance' });
    await tx('expense', 6000000, daysAgo(20), { category: 'Аренда' });
    await tx('expense', 3000000, daysAgo(10), { category: 'Зарплата' });
    debtId = (await admin.query(`INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ($1, 'payable', 'Vendor Dates', 3000000, 3000000, 'IDR') RETURNING id`, [BIZ])).rows[0].id;

    supa = createRealPgSupabase(db.connectionString);
    const lib = require.resolve('@supabase/supabase-js'), real = require(lib);
    require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: { ...real, createClient: () => supa } };
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

  it('a statement imported today is measured over its own dates, not compressed into one day', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const r = await fetch(`${BASE}/decisions/debts/${debtId}/payment`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-business-id': BIZ },
      body: JSON.stringify({ amount: 3000000, wallet_id: WALLET }) });
    const body = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(body));
    // Cash 41M; 9M of expenses over a 21-day window (oldest row 20 days ago) ≈ 428,571 a day.
    // After the 3M payment: 38M / 428,571 ≈ 89 days. A one-day window would give about 4 days.
    assert.strictEqual(body.current.cash, 41000000);
    assert.ok(body.after.runway_days >= 80 && body.after.runway_days <= 100, `runway after payment: ${body.after.runway_days}`);
    assert.notStrictEqual(body.recommendation, 'not_recommended', JSON.stringify(body.factors));
  });
});
