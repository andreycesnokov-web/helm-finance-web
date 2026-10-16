'use strict';
// D4-A migration safety on real PostgreSQL (production snapshot + release chain):
//   * a wallet is damaged by the REAL pre-D4 import path (D4 happens on its own);
//   * applying 20261016090000_dated_opening_anchor changes no existing row and no balance
//     (row-level checksum of transactions, bank rows, batches and audit, before = after);
//   * the damaged wallet is only diagnosed, then repaired solely by an explicit confirmed request;
//   * down restores the previous functions and keeps audited rows; up can be re-applied;
//   * the migration refuses (fail closed, nothing applied) on a non-canonical database;
//   * the company time-zone rule is identical in SQL and JS.
// Needs DATABASE_URL naming a disposable local PostgreSQL superuser; otherwise it skips.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const H = require('./_d4Harness');
const { validBusinessTimezone } = require('../../server/lib/profileValidation');

const OWNER = 9501;
let db, admin, seed, L, BIZ, damaged, clean, dated, app, damagedBatch;

const checksum = async (c) => (await c.query(`SELECT
  (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.transactions t) AS tx,
  (SELECT md5(coalesce(string_agg(r::text, '|' ORDER BY r.id), '')) FROM public.bank_import_rows r) AS rows,
  (SELECT md5(coalesce(string_agg(b::text, '|' ORDER BY b.id), '')) FROM public.bank_import_batches b) AS batches,
  (SELECT md5(coalesce(string_agg(a::text, '|' ORDER BY a.id), '')) FROM public.audit_events a) AS audit`)).rows[0];

// The pre-D4 reviewed confirm, called exactly as the old server did (no opening).
async function oldConfirm(c, biz, batch) {
  const state = (await c.query('SELECT public.cfo_import_review_state($1,$2,$3) s', [biz, batch.id, OWNER])).rows[0].s;
  const plan = batch.rows.map(r => ({ row_id: r.id, action: 'create', type: r.signed >= 0 ? 'income' : 'expense', category_id: null, counterparty_id: null,
    scope: 'business', matched_transaction_id: null, expected_amount: Math.abs(r.signed), expected_date: r.date, currency: 'IDR',
    normalized_desc: r.desc.toLowerCase(), amount_idr: Math.abs(r.signed), booked_rate: 1, rate_source: 'native' }));
  const intent = { version: 1, operation: 'bank_import_confirm', batch_id: batch.id, review_hash: state.review_hash, rows: [], opening: null };
  return (await c.query('SELECT public.rpc_confirm_bank_import_reviewed($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NULL,$8) r',
    [biz, batch.id, OWNER, crypto.randomUUID(), state.review_hash, JSON.stringify(intent), JSON.stringify(plan), 'review'])).rows[0].r;
}

describe('D4-A migration safety (real PostgreSQL)', () => {
  let skipped = false;
  before(async () => {
    db = await H.createD4Database('hf_d4_mig', { withD4: false });
    if (!db) { skipped = true; return; }
    admin = await H.openAdmin(db.connectionString); seed = H.seeder(admin); L = H.ledgerReader(admin);
    BIZ = await seed.company({ owner: OWNER, name: 'Pre-D4 PT' });
    damaged = await seed.wallet(BIZ, OWNER, { legacy: true });
    damagedBatch = await seed.batch(BIZ, damaged.id, { start: '2026-09-01', end: '2026-10-16', rows: H.movesBetween('2026-09-01', '2026-10-16') });
    const res = await oldConfirm(admin, BIZ, damagedBatch);
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    clean = await seed.wallet(BIZ, OWNER);
    await seed.manual(BIZ, OWNER, clean.id, '2026-10-20', -250_000);
    dated = await seed.wallet(BIZ, OWNER, { date: '2026-08-31', opening: H.truthAt('2026-08-31') });
  });
  after(async () => { await app?.stop(); try { await admin?.end(); } catch { /* */ } if (db) await db.drop(); });

  it('the pre-D4 path really produces D4 (history imported on top of "balance today")', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    assert.strictEqual(await L.today(damaged.id), 46_000_000, '41M + September/October movements counted twice');
  });

  it('applying the migration changes no existing row and no balance', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const before = await checksum(admin);
    const balances = {}; for (const w of [damaged, clean, dated]) balances[w.id] = await L.today(w.id);
    await admin.query(H.migrationSql(H.D4));
    assert.deepStrictEqual(await checksum(admin), before, 'transactions, bank rows, batches and audit are byte-identical');
    for (const w of [damaged, clean, dated]) assert.strictEqual(await L.today(w.id), balances[w.id]);
    const acl = (await admin.query(`SELECT p.proname FROM pg_proc p WHERE (p.proname LIKE 'cfo\\_%' OR p.proname IN ('fn_wallet_balance_at','rpc_wallet_reconciliation','rpc_reanchor_wallet_opening'))
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))`)).rows;
    assert.deepStrictEqual(acl, [], 'no client role may execute the new functions');
  });

  it('the damaged wallet is diagnosed, refused without confirmation, and repaired only by the explicit request', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    app = await H.startServer(db.connectionString);
    const rec = await app.call(`/wallets/${damaged.id}/reconciliation`, { user: OWNER, biz: BIZ });
    assert.strictEqual(rec.status, 200, JSON.stringify(rec.body));
    assert.strictEqual(rec.body.risks.import_before_anchor, true);
    assert.ok(rec.body.risks.mismatched_statements >= 1);
    assert.strictEqual(await L.today(damaged.id), 46_000_000, 'diagnostics wrote nothing');
    const pv = await app.call(`/wallets/${damaged.id}/reanchor-preview?batch_id=${damagedBatch.id}`, { user: OWNER, biz: BIZ });
    assert.strictEqual(pv.status, 200, JSON.stringify(pv.body));
    assert.strictEqual(Number(pv.body.new_anchor_amount), H.truthAt('2026-08-31'));
    assert.strictEqual(Number(pv.body.today_after), 41_000_000); assert.strictEqual(Number(pv.body.today_effect), -5_000_000);
    const opening = { reason: 'Statement imported on top of the opening balance (D4)', expected_anchor_id: damaged.openingId,
      expected_new_anchor: pv.body.new_anchor_amount, expected_today_after: pv.body.today_after };
    const key = crypto.randomUUID();
    const r0 = await app.call(`/wallets/${damaged.id}/reanchor-opening`, { method: 'POST', user: OWNER, biz: BIZ, body: { request_key: key, batch_id: damagedBatch.id, opening } });
    assert.strictEqual(r0.status, 409, JSON.stringify(r0.body)); assert.strictEqual(r0.body.code, 'reanchor_changes_today_unconfirmed');
    assert.strictEqual(await L.today(damaged.id), 46_000_000);
    const body = { request_key: crypto.randomUUID(), batch_id: damagedBatch.id, opening: { ...opening, confirm_today_change: true } };
    const r = await app.call(`/wallets/${damaged.id}/reanchor-opening`, { method: 'POST', user: OWNER, biz: BIZ, body });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    for (const d of H.CONTROL_DATES.filter(x => x >= '2026-08-31')) assert.strictEqual(await L.balanceAt(damaged.id, d), H.truthAt(d), d);
    assert.strictEqual(await L.today(damaged.id), 41_000_000);
    const again = await app.call(`/wallets/${damaged.id}/reanchor-opening`, { method: 'POST', user: OWNER, biz: BIZ, body });
    assert.strictEqual(again.status, 200); assert.strictEqual(again.body.replayed, true);
    const n = (await admin.query(`SELECT count(*) n FROM public.transactions WHERE wallet_id=$1 AND source IN ('opening_reanchor','opening_reanchor_reversal')`, [damaged.id])).rows[0].n;
    assert.strictEqual(Number(n), 2, 'replay wrote nothing');
    const audit = (await admin.query(`SELECT count(*) n FROM public.audit_events WHERE entity_id=$1 AND action='opening_reanchored'`, [damaged.id])).rows[0].n;
    assert.strictEqual(Number(audit), 1);
    assert.strictEqual(await L.today(clean.id), 41_000_000 - 250_000, 'other wallets untouched');
  });

  it('down restores the previous functions and keeps audited rows; up applies again', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const before = await checksum(admin);
    await admin.query(H.migrationSql(H.D4_DOWN));
    const fns = (await admin.query(`SELECT proname FROM pg_proc WHERE proname IN ('cfo_reanchor_math','cfo_apply_reanchor','rpc_reanchor_wallet_opening','cfo_business_tz')`)).rows;
    assert.deepStrictEqual(fns, []);
    const def = (await admin.query(`SELECT pg_get_functiondef('public.cfo_import_review_state(uuid,uuid,bigint)'::regprocedure) d`)).rows[0].d;
    assert.match(def, /'version',2/); assert.doesNotMatch(def, /needs_anchor_choice/);
    assert.deepStrictEqual(await checksum(admin), before, 'down never deletes ledger rows');
    assert.strictEqual(await L.today(damaged.id), 41_000_000);
    await admin.query(H.migrationSql(H.D4));
    assert.match((await admin.query(`SELECT pg_get_functiondef('public.cfo_import_review_state(uuid,uuid,bigint)'::regprocedure) d`)).rows[0].d, /needs_anchor_choice/);
  });

  it('fails closed on a non-canonical database and applies nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const db2 = await H.createD4Database('hf_d4_pre', { withD4: false });
    const c = await H.openAdmin(db2.connectionString);
    try {
      await c.query(`CREATE OR REPLACE FUNCTION public.rpc_confirm_bank_import_reviewed(p_business uuid,p_batch uuid,p_actor bigint,p_request_key uuid,p_review_hash text,
        p_intent jsonb,p_plan jsonb,p_opening jsonb DEFAULT NULL,p_flow text DEFAULT 'review') RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`);
      await assert.rejects(c.query(H.migrationSql(H.D4)), /d4_requires_canonical_reviewed_confirm/);
      await c.query('ROLLBACK').catch(() => {});
      assert.strictEqual((await c.query(`SELECT to_regprocedure('public.cfo_business_tz(uuid)') p`)).rows[0].p, null, 'nothing applied');
    } finally { await c.end(); await db2.drop(); }
  });

  it('company time zone: SQL and JS agree; POSIX and abbreviations fall back; a legacy opening is dated in the company zone', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const zones = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'America/Argentina/Buenos_Aires', 'GMT+7', 'UTC+7', '+07:00', 'WIB', 'Etc/GMT-7', 'Asia/Nowhere', '', null];
    for (const z of zones) {
      const id = await seed.company({ owner: OWNER, timezone: z, name: 'TZ ' + z });
      const sql = (await admin.query('SELECT public.cfo_business_tz($1) z', [id])).rows[0].z;
      assert.strictEqual(sql, z && validBusinessTimezone(z) ? z : 'Asia/Jakarta', `zone ${JSON.stringify(z)}`);
    }
    const mak = await seed.company({ owner: OWNER, timezone: 'Asia/Makassar', name: 'Makassar' });
    const jkt = await seed.company({ owner: OWNER, timezone: 'Asia/Jakarta', name: 'Jakarta' });
    const posix = await seed.company({ owner: OWNER, timezone: 'GMT+7', name: 'Posix' });
    const at = '2026-10-16 16:30:00+00';                       // 23:30 WIB · 00:30 WITA next day · 09:30 in "GMT+7" (POSIX = UTC−7)
    const day = async (biz) => { const w = await seed.wallet(biz, OWNER, { legacy: true, createdAt: at });
      return (await admin.query(`SELECT public.cfo_wallet_anchor_state($1,$2)->'anchor'->>'date' d`, [biz, w.id])).rows[0].d; };
    assert.strictEqual(await day(jkt), '2026-10-16');
    assert.strictEqual(await day(mak), '2026-10-17');
    assert.strictEqual(await day(posix), '2026-10-16', 'an invalid zone falls back to Asia/Jakarta, never to UTC−7');
  });
});
