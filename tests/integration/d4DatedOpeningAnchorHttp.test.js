'use strict';
// D4-A over real Express/JWT and real PostgreSQL (production schema snapshot + every release
// migration + 20261016090000_dated_opening_anchor). Workspace: Business.
// Proves on the database itself (independent balance formula, every control date):
//   M1–M16 the re-anchor arithmetic (ordinary, back-dated manual rows, overlap + chain, repeated
//   import, gap, dated anchor, exclusion, same-day ambiguity, CAS, rollback), plus concurrency,
//   plan-exact preview, refusals that must never auto-correct, role and tenant isolation.
// Needs DATABASE_URL naming a disposable local PostgreSQL superuser; otherwise it skips.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const H = require('./_d4Harness');

const OWNER = 9401, ACCOUNTANT = 9402, OTHER_OWNER = 9403;
let db, admin, app, seed, L, BIZ, OTHER_BIZ, otherWallet, otherBefore;
const T = H.truthAt;

const rowsOf = (batch, over = {}) => batch.rows.map((r, i) => ({ row_id: r.id, transaction_type: r.signed >= 0 ? 'income' : 'expense', scope: 'business', ...(over[i] || {}) }));
const review = (batchId, user = OWNER, biz = BIZ) => app.call(`/bank-imports/${batchId}/review`, { user, biz });
const preview = (batchId, rows, same_day, user = OWNER) => app.call(`/bank-imports/${batchId}/reanchor-preview`, { method: 'POST', user, biz: BIZ, body: { rows, ...(same_day ? { same_day } : {}) } });
async function confirm(batchId, rows, opening, { user = OWNER, requestKey = crypto.randomUUID(), hash } = {}) {
  const rv = hash ? null : await review(batchId, user);
  if (rv) assert.strictEqual(rv.status, 200, JSON.stringify(rv.body));
  const body = { request_key: requestKey, review_hash: hash || rv.body.reviewed.review_hash, rows, ...(opening ? { opening } : {}) };
  return { ...(await app.call(`/bank-imports/${batchId}/confirm`, { method: 'POST', user, biz: BIZ, body })), body_sent: body };
}
const reanchor = (anchorId, newAnchor, todayAfter, extra = {}) => ({ mode: 'reanchor', reason: 'Statement history imported before the opening date',
  expected_anchor_id: anchorId, expected_new_anchor: String(newAnchor), expected_today_after: String(todayAfter), ...extra });

async function assertTruth(wallet, from, label, todayExpected = T('2026-10-16')) {
  for (const d of H.CONTROL_DATES.filter(x => x >= from)) {
    const indep = await L.balanceAt(wallet, d), fn = await L.fnBalanceAt(BIZ, wallet, d);
    assert.strictEqual(indep, T(d), `${label}: independent balance on ${d}`);
    assert.strictEqual(Number(fn.balance), T(d), `${label}: fn_wallet_balance_at on ${d}`);
  }
  assert.strictEqual(await L.today(wallet), todayExpected, `${label}: today`);
}
const sep1oct16 = () => H.movesBetween('2026-09-01', '2026-10-16');

describe('D4-A dated opening anchors (real PostgreSQL)', () => {
  let skipped = false;

  before(async () => {
    db = await H.createD4Database('hf_d4_http');
    if (!db) { skipped = true; return; }
    admin = await H.openAdmin(db.connectionString);
    seed = H.seeder(admin); L = H.ledgerReader(admin);
    BIZ = await seed.company({ owner: OWNER, name: 'D4 Anchor PT' });
    await seed.member(BIZ, ACCOUNTANT, 'accountant');
    OTHER_BIZ = await seed.company({ owner: OTHER_OWNER, name: 'Other PT' });
    otherWallet = await seed.wallet(OTHER_BIZ, OTHER_OWNER, { legacy: true });
    await seed.manual(OTHER_BIZ, OTHER_OWNER, otherWallet.id, '2026-09-10', -1_234_000);
    otherBefore = { today: await L.today(otherWallet.id), count: await L.count(otherWallet.id) };
    app = await H.startServer(db.connectionString);
  });

  after(async () => {
    try {
      if (!skipped) { // tenant isolation, checked after every scenario ran
        assert.strictEqual(await L.today(otherWallet.id), otherBefore.today, 'other company balance unchanged');
        assert.strictEqual(await L.count(otherWallet.id), otherBefore.count, 'other company rows unchanged');
      }
    } finally {
      await app?.stop(); try { await admin?.end(); } catch { /* */ }
      if (db) await db.drop();
    }
  });

  it('M1–M4 ordinary history: refused without a choice; exact re-anchor; replay; repeated file books nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });            // pre-070 opening: no flag, no date
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const n0 = await L.count(w.id);
    const r0 = await confirm(b.id, rowsOf(b));
    assert.strictEqual(r0.status, 409, JSON.stringify(r0.body)); assert.strictEqual(r0.body.code, 'import_before_opening_anchor');
    assert.strictEqual(await L.count(w.id), n0, 'M1 nothing written');
    const rv = await review(b.id);
    assert.strictEqual(rv.body.reviewed.opening_state, 'needs_anchor_choice');
    assert.strictEqual(rv.body.reviewed.anchor.date_source, 'created_at');
    assert.strictEqual(rv.body.reviewed.anchor.date, '2026-10-16');
    const pv = await preview(b.id, rowsOf(b));
    assert.strictEqual(pv.status, 200, JSON.stringify(pv.body));
    assert.strictEqual(Number(pv.body.new_anchor_amount), T('2026-08-31')); assert.strictEqual(pv.body.new_anchor_date, '2026-08-31');
    assert.strictEqual(Number(pv.body.today_effect), 0); assert.strictEqual(Number(pv.body.today_after), T('2026-10-16'));
    const key = crypto.randomUUID();
    const r = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after), { requestKey: key });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await assertTruth(w.id, '2026-08-31', 'M2');
    const n1 = await L.count(w.id);
    assert.strictEqual(n1, n0 + 6 + 2, 'six statement rows + reversal + moved anchor');
    const replay = await app.call(`/bank-imports/${b.id}/confirm`, { method: 'POST', user: OWNER, biz: BIZ, body: r.body_sent });
    assert.strictEqual(replay.status, 200); assert.strictEqual(replay.body.replayed, true, 'M3 replay');
    assert.strictEqual(await L.count(w.id), n1, 'M3 replay wrote nothing');
    const again = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const rr = await confirm(again.id, rowsOf(again));
    assert.strictEqual(rr.status, 409, JSON.stringify(rr.body)); assert.ok(['statement_overlap_unmatched', 'import_before_opening_anchor'].includes(rr.body.code), rr.body.code);
    const rx = await confirm(again.id, rowsOf(again, Object.fromEntries(again.rows.map((_, i) => [i, { match_action: 'exclude' }]))));
    assert.strictEqual(rx.status, 200, JSON.stringify(rx.body));
    assert.strictEqual(await L.count(w.id), n1, 'M4 repeated statement booked nothing');
    await assertTruth(w.id, '2026-08-31', 'M4');
  });

  it('M5–M6 back-dated manual rows: the today change is refused until confirmed, then exact; audited', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER);                              // flagged, undated (070+)
    await seed.manual(BIZ, OWNER, w.id, '2026-08-20', -4_000_000, 'Rent August');
    const oct10 = await seed.manual(BIZ, OWNER, w.id, '2026-10-10', -3_000_000, 'Payroll October');
    assert.strictEqual(await L.today(w.id), 34_000_000, 'double counted before any import (D4b)');
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const iOct10 = b.rows.findIndex(r => r.date === '2026-10-10');
    const plan = rowsOf(b, { [iOct10]: { match_action: 'link', matched_transaction_id: oct10 } });
    const pv = await preview(b.id, plan);
    assert.strictEqual(Number(pv.body.today_effect), 7_000_000); assert.strictEqual(Number(pv.body.today_after), 41_000_000);
    assert.strictEqual(pv.body.counted_rows, 5, 'the linked row is not new money');
    const n0 = await L.count(w.id);
    const r0 = await confirm(b.id, plan, reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after));
    assert.strictEqual(r0.status, 409, JSON.stringify(r0.body)); assert.strictEqual(r0.body.code, 'reanchor_changes_today_unconfirmed');
    assert.strictEqual(await L.count(w.id), n0, 'M5 rollback: no statement row was booked either');
    assert.strictEqual((await admin.query('SELECT status FROM public.bank_import_batches WHERE id=$1', [b.id])).rows[0].status, 'review_required');
    const r = await confirm(b.id, plan, reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after, { confirm_today_change: true }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await assertTruth(w.id, '2026-08-31', 'M6');
    const audit = (await admin.query(`SELECT before_json, after_json, actor_role FROM public.audit_events WHERE entity_type='wallet' AND entity_id=$1 AND action='opening_reanchored'`, [w.id])).rows;
    assert.strictEqual(audit.length, 1);
    assert.strictEqual(Number(audit[0].before_json.balance_today), 34_000_000 + 4_000_000 + 5_000_000 - 1_000_000, 'balance after the import, before the move');
    assert.strictEqual(Number(audit[0].after_json.balance_today_after), 41_000_000); assert.strictEqual(audit[0].actor_role, 'owner');
    assert.ok(audit[0].after_json.reason);
  });

  it('M7–M9 overlapping earlier statement: chain re-anchor to 31.07; a re-worded duplicate is refused', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b1 = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const p1 = await preview(b1.id, rowsOf(b1));
    assert.strictEqual((await confirm(b1.id, rowsOf(b1), reanchor(w.openingId, p1.body.new_anchor_amount, p1.body.today_after))).status, 200);
    const reanchorId = Number((await admin.query(`SELECT id FROM public.transactions WHERE wallet_id=$1 AND source='opening_reanchor'`, [w.id])).rows[0].id);
    const b2 = await seed.batch(BIZ, w.id, { start: '2026-08-01', end: '2026-09-15', rows: H.movesBetween('2026-08-01', '2026-09-15') });
    const plan2 = rowsOf(b2, Object.fromEntries(b2.rows.map((r, i) => [i, r.date >= '2026-09-01' ? { match_action: 'exclude' } : {}])));
    const r0 = await confirm(b2.id, plan2);
    assert.strictEqual(r0.status, 409); assert.strictEqual(r0.body.code, 'import_before_opening_anchor', 'M7');
    const pv = await preview(b2.id, plan2);
    assert.strictEqual(Number(pv.body.new_anchor_amount), T('2026-07-31')); assert.strictEqual(pv.body.new_anchor_date, '2026-07-31');
    assert.strictEqual(pv.body.counted_rows, 2, 'excluded duplicates never move the anchor');
    const r = await confirm(b2.id, plan2, reanchor(reanchorId, pv.body.new_anchor_amount, pv.body.today_after));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await assertTruth(w.id, '2026-07-31', 'M8 chain');
    const n = await L.count(w.id);
    const reworded = H.movesBetween('2026-08-01', '2026-09-15').map(m => m[0] === '2026-09-12' ? [m[0], m[1], 'SUPPLIER INV PT ABC'] : m);
    const b3 = await seed.batch(BIZ, w.id, { start: '2026-08-01', end: '2026-09-15', rows: reworded });
    const plan3 = rowsOf(b3, Object.fromEntries(b3.rows.map((r, i) => [i, r.date === '2026-09-12' ? {} : { match_action: 'exclude' }])));
    const r3 = await confirm(b3.id, plan3);
    assert.strictEqual(r3.status, 409, JSON.stringify(r3.body)); assert.strictEqual(r3.body.code, 'statement_overlap_unmatched', 'M9');
    assert.strictEqual(await L.count(w.id), n);
  });

  it('M10 gap between statement end and the opening: today stays right, history flagged, alignment refused', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-09-30', rows: H.movesBetween('2026-09-01', '2026-09-30') });
    const pv = await preview(b.id, rowsOf(b));
    const n0 = await L.count(w.id);
    const ra = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, Number(pv.body.today_after) - 1_000_000,
      { align_target: String(T('2026-08-31')), confirm_today_change: true }));
    assert.strictEqual(ra.status, 409, JSON.stringify(ra.body)); assert.strictEqual(ra.body.code, 'reanchor_gap_uncovered');
    assert.strictEqual(await L.count(w.id), n0, 'nothing written');
    const r = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(await L.today(w.id), 41_000_000, 'today unchanged');
    const rec = await app.call(`/wallets/${w.id}/reconciliation`, { user: OWNER, biz: BIZ });
    assert.strictEqual(rec.status, 200, JSON.stringify(rec.body));
    const s = rec.body.statements.find(x => x.batch_id === b.id);
    assert.strictEqual(Number(s.delta_start), -1_000_000); assert.strictEqual(Number(s.delta_end), -1_000_000, 'Δ_S = Δ_E = −(October movements missing)');
  });

  it('M11 a dated opening created through the API needs no choice and reconciles to zero', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const cw = await app.call('/wallets', { method: 'POST', user: OWNER, biz: BIZ, body: { name: 'Dated BCA', currency: 'IDR', type: 'bank', scope: 'business',
      opening_balance: T('2026-08-31'), opening_balance_date: '2026-08-31', request_key: crypto.randomUUID() } });
    assert.ok([200, 201].includes(cw.status), JSON.stringify(cw.body));
    const id = cw.body.wallet?.id || cw.body.id;
    const op = (await admin.query(`SELECT transaction_date::text d FROM public.transactions WHERE wallet_id=$1 AND source='wallet_opening_balance'`, [id])).rows[0];
    assert.strictEqual(op.d, '2026-08-31');
    const bad = await app.call('/wallets', { method: 'POST', user: OWNER, biz: BIZ, body: { name: 'Bad date', currency: 'IDR', type: 'bank', scope: 'business',
      opening_balance: 1, opening_balance_date: '2026-02-30', request_key: crypto.randomUUID() } });
    assert.strictEqual(bad.status, 400);
    const b = await seed.batch(BIZ, id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const r = await confirm(b.id, rowsOf(b));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await assertTruth(id, '2026-08-31', 'M11');
    const rec = await app.call(`/wallets/${id}/reconciliation`, { user: OWNER, biz: BIZ });
    const s = rec.body.statements[0];
    assert.strictEqual(Number(s.delta_start), 0); assert.strictEqual(Number(s.delta_end), 0);
  });

  it('M12 excluding the covered rows keeps today and books nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-09-30', rows: H.movesBetween('2026-09-01', '2026-09-30') });
    const n0 = await L.count(w.id);
    const r = await confirm(b.id, rowsOf(b, { 0: { match_action: 'exclude' }, 1: { match_action: 'exclude' }, 2: { match_action: 'exclude' } }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(await L.count(w.id), n0); assert.strictEqual(await L.today(w.id), 41_000_000);
    const st = (await admin.query(`SELECT count(*) n FROM public.bank_import_rows WHERE batch_id=$1 AND review_status='excluded'`, [b.id])).rows[0];
    assert.strictEqual(Number(st.n), 3, 'rows kept as evidence');
  });

  it('M13–M14 same-day rows of a legacy opening need an explicit decision; "after" books them after the opening', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true, createdAt: '2026-10-16 14:00:00+07' });
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', closing: T('2026-10-16') - 500_000,
      rows: H.movesBetween('2026-09-01', '2026-10-16', [['2026-10-16', -500_000, 'Late fee']]) });
    const pv0 = await preview(b.id, rowsOf(b));
    assert.strictEqual(pv0.status, 409); assert.strictEqual(pv0.body.code, 'legacy_same_day_ambiguous');
    const r0 = await confirm(b.id, rowsOf(b), reanchor(w.openingId, 36_000_000, 40_500_000));
    assert.strictEqual(r0.status, 409, JSON.stringify(r0.body)); assert.strictEqual(r0.body.code, 'legacy_same_day_ambiguous', 'M13');
    const pv = await preview(b.id, rowsOf(b), 'after');
    assert.strictEqual(Number(pv.body.new_anchor_amount), 36_000_000); assert.strictEqual(Number(pv.body.today_after), 40_500_000);
    const r = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after, { same_day: 'after' }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    for (const d of ['2026-08-31', '2026-09-30', '2026-10-10']) assert.strictEqual(await L.balanceAt(w.id, d), T(d), d);
    assert.strictEqual(await L.balanceAt(w.id, '2026-10-16'), 40_500_000); assert.strictEqual(await L.today(w.id), 40_500_000, 'M14');
  });

  it('M15 stale preview (CAS) and M16 rollback when a confirmed value no longer matches', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const rv = await review(b.id);
    await seed.manual(BIZ, OWNER, w.id, '2026-10-12', -200_000, 'Late manual entry');
    const n0 = await L.count(w.id);
    const r = await confirm(b.id, rowsOf(b), reanchor(w.openingId, 36_000_000, 41_000_000), { hash: rv.body.reviewed.review_hash });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, 'import_review_conflict', 'M15');
    assert.strictEqual(await L.count(w.id), n0);
    const pv = await preview(b.id, rowsOf(b));
    const wrong = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, Number(pv.body.today_after) + 1, { confirm_today_change: true }));
    assert.strictEqual(wrong.status, 409, JSON.stringify(wrong.body)); assert.strictEqual(wrong.body.code, 'import_reanchor_conflict');
    assert.strictEqual(await L.count(w.id), n0, 'M16 the statement rows booked before the check were rolled back');
    assert.strictEqual(Number((await admin.query('SELECT count(*) n FROM public.bank_import_confirm_requests WHERE batch_id=$1', [b.id])).rows[0].n), 0, 'no receipt');
    const ok = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after, { confirm_today_change: true }));
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(await L.today(w.id), 41_000_000, 'the back-dated −200k is inside the asserted opening');
  });

  it('concurrency: two simultaneous re-anchors commit once; a parallel ledger write is serialized, never half-applied', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const rv = await review(b.id), pv = await preview(b.id, rowsOf(b));
    const op = reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after);
    const n0 = await L.count(w.id);
    const rs = await Promise.all([1, 2].map(() => confirm(b.id, rowsOf(b), op, { hash: rv.body.reviewed.review_hash })));
    assert.deepStrictEqual(rs.map(r => r.status).sort(), [200, 409], JSON.stringify(rs.map(r => r.body)));
    assert.strictEqual(await L.count(w.id), n0 + 8);
    await assertTruth(w.id, '2026-08-31', 'concurrent');
    // A re-anchor racing a direct ledger write on another connection: all-or-nothing either way.
    const w2 = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b2 = await seed.batch(BIZ, w2.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const rv2 = await review(b2.id), pv2 = await preview(b2.id, rowsOf(b2));
    const other = await H.openAdmin(db.connectionString);
    const [rc] = await Promise.all([
      confirm(b2.id, rowsOf(b2), reanchor(w2.openingId, pv2.body.new_anchor_amount, pv2.body.today_after), { hash: rv2.body.reviewed.review_hash }),
      other.query(`INSERT INTO public.transactions (business_id,user_id,created_by_user_id,type,amount_original,amount_idr,currency_original,booked_rate,rate_source,source,category,wallet_id,scope,transaction_date)
        VALUES ($1,$2,$2,'expense',100000,100000,'IDR',1,'native','manual','Other expenses',$3,'business','2026-10-20')`, [BIZ, OWNER, w2.id]),
    ]);
    await other.end();
    const reanchored = Number((await admin.query(`SELECT count(*) n FROM public.transactions WHERE wallet_id=$1 AND source IN ('opening_reanchor','opening_reanchor_reversal')`, [w2.id])).rows[0].n);
    if (rc.status === 200) { assert.strictEqual(reanchored, 2); assert.strictEqual(await L.today(w2.id), 41_000_000 - 100_000); await assertTruth(w2.id, '2026-08-31', 'race', 41_000_000 - 100_000); }
    else { assert.strictEqual(rc.body.code, 'import_review_conflict'); assert.strictEqual(reanchored, 0); assert.strictEqual(await L.count(w2.id), 2); }
  });

  it('refusals: unknown history, inconsistent statement, unconfirmed bank opening — nothing is ever auto-corrected', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    await admin.query(`INSERT INTO public.transactions (business_id,user_id,created_by_user_id,type,amount_original,amount_idr,currency_original,booked_rate,rate_source,source,category,wallet_id,scope)
      VALUES ($1,$2,$2,'expense',50000,50000,'IDR',1,'native','manual','Other expenses',$3,'business')`, [BIZ, OWNER, w.id]);   // undated
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const n0 = await L.count(w.id);
    const r1 = await confirm(b.id, rowsOf(b), reanchor(w.openingId, 1, 1));
    assert.strictEqual(r1.status, 422, JSON.stringify(r1.body)); assert.strictEqual(r1.body.code, 'import_opening_history_unknown');
    assert.strictEqual(await L.count(w.id), n0);
    const w2 = await seed.wallet(BIZ, OWNER, { legacy: true });
    const bad = await seed.batch(BIZ, w2.id, { start: '2026-09-01', end: '2026-10-16', closing: T('2026-10-16') + 777, rows: sep1oct16() });
    const pv = await preview(bad.id, rowsOf(bad));
    const r2 = await confirm(bad.id, rowsOf(bad), reanchor(w2.openingId, pv.body.new_anchor_amount, pv.body.today_after, { align_target: String(T('2026-08-31')), confirm_today_change: true }));
    assert.strictEqual(r2.status, 409, JSON.stringify(r2.body)); assert.strictEqual(r2.body.code, 'statement_inconsistent');
    const ok = await seed.batch(BIZ, w2.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const pv3 = await preview(ok.id, rowsOf(ok));
    const r3 = await confirm(ok.id, rowsOf(ok), reanchor(w2.openingId, pv3.body.new_anchor_amount, pv3.body.today_after, { align_target: String(T('2026-08-31') + 5), confirm_today_change: true }));
    assert.strictEqual(r3.status, 409, JSON.stringify(r3.body)); assert.strictEqual(r3.body.code, 'import_opening_conflict', 'align target must equal the bank opening');
    assert.strictEqual(await L.count(w2.id), 1, 'only the opening exists');
  });

  it('roles and tenants: accountant reads but cannot re-anchor; another company and Personal are refused', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const w = await seed.wallet(BIZ, OWNER, { legacy: true });
    const b = await seed.batch(BIZ, w.id, { start: '2026-09-01', end: '2026-10-16', rows: sep1oct16() });
    const pv = await preview(b.id, rowsOf(b), null, ACCOUNTANT);
    assert.strictEqual(pv.status, 200, 'accountant may preview');
    assert.strictEqual(pv.body.can_reanchor, false);
    const r = await confirm(b.id, rowsOf(b), reanchor(w.openingId, pv.body.new_anchor_amount, pv.body.today_after), { user: ACCOUNTANT });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'import_opening_forbidden');
    assert.strictEqual((await app.call(`/wallets/${w.id}/reconciliation`, { user: ACCOUNTANT, biz: BIZ })).status, 200);
    const cross = await app.call(`/bank-imports/${b.id}/review`, { user: OTHER_OWNER, biz: OTHER_BIZ });
    assert.ok([403, 404].includes(cross.status), `other company cannot read our batch (${cross.status})`);
    const crossFix = await app.call(`/wallets/${otherWallet.id}/reanchor-opening`, { method: 'POST', user: OWNER, biz: BIZ,
      body: { request_key: crypto.randomUUID(), batch_id: b.id, opening: { reason: 'x', expected_anchor_id: otherWallet.openingId, expected_new_anchor: '1', expected_today_after: '1' } } });
    assert.strictEqual(crossFix.status, 404, JSON.stringify(crossFix.body));
    const crossRec = await app.call(`/wallets/${otherWallet.id}/reconciliation`, { user: OWNER, biz: BIZ });
    assert.ok([403, 404].includes(crossRec.status), JSON.stringify(crossRec.body));
    const PERS = await seed.company({ owner: OWNER, type: 'personal', name: 'Personal' });
    const pw = await seed.wallet(PERS, OWNER, { legacy: true, scope: 'personal' });
    await assert.rejects(admin.query('SELECT public.rpc_wallet_reconciliation($1,$2,$3)', [PERS, pw.id, OWNER]), /import_review_forbidden/);
    await assert.rejects(admin.query(`SELECT public.rpc_reanchor_wallet_opening($1,$2,$3,'k',$4::jsonb)`, [PERS, pw.id, OWNER,
      JSON.stringify({ version: 1, operation: 'wallet_reanchor', wallet_id: pw.id, batch_id: crypto.randomUUID(), opening: {} })]), /import_review_forbidden/);
    await assert.rejects(admin.query(`SELECT public.cfo_reanchor_math($1,$2,'2026-09-01','[]'::jsonb,NULL)`, [PERS, pw.id]), /import_opening_history_unknown/,
      'a Personal wallet has no Business ledger at all');
  });
});
