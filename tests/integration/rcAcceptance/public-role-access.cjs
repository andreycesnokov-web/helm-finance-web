'use strict';
// AC-0 / I-7 (24 Oct 2026): what the public Supabase roles can actually do through the real PostgREST API.
// anon = the publishable key shipped in the client bundle; authenticated = any person who signs in with Supabase Auth
// (a real GoTrue password login of a synthetic user). Targets the synthetic company of admit-http.cjs. Every call is
// recorded with its status; the company's rows and the user-id sequence are counted before and after.
//   PUBLIC_ACCESS_EXPECT=exposed  (before the patch): no row of the company may be read or changed (RLS), but the
//                                 grants let the calls through to RLS / the function bodies — exposure, not bypass.
//   PUBLIC_ACCESS_EXPECT=closed   (after the patch): every call is refused by privileges before reaching data.
// Never run against production: the target must be the disposable cluster (EXPECTED_PG_SYSTEM_ID).
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomBytes } = require('node:crypto'), { Client } = require('pg');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), platform = process.env.PLATFORM_URL, expect = process.env.PUBLIC_ACCESS_EXPECT;
assert.ok(['exposed', 'closed'].includes(expect), 'PUBLIC_ACCESS_EXPECT=exposed|closed');
const db = new Client({ connectionString: process.env.DATABASE_URL }), rows = [];
async function call(role, key, method, path, body) {
  const r = await fetch(platform + '/rest/v1/' + path, { method, signal: AbortSignal.timeout(15000),
    headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: 'Bearer ' + key, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 120); }
  const affected = Array.isArray(data) ? data.length : null;
  rows.push({ role, method, path: path.replace(C.biz, '<company>'), status: r.status, rows_returned: affected, code: data && data.code || null,
    message: data && typeof data.message === 'string' ? data.message.replace(C.biz, '<company>').slice(0, 80) : null });
  return { status: r.status, data, affected };
}
const counts = async () => (await db.query(`SELECT
  (SELECT count(*) FROM transactions WHERE business_id=$1)::int tx, (SELECT count(*) FROM wallets WHERE business_id=$1)::int wallets,
  (SELECT count(*) FROM debts WHERE business_id=$1)::int debts, (SELECT count(*) FROM audit_events WHERE business_id=$1)::int audit,
  (SELECT count(*) FROM financial_documents WHERE business_id=$1)::int docs, (SELECT count(*) FROM businesses WHERE id=$1)::int biz,
  (SELECT last_value FROM app_user_id_seq)::text user_seq`, [C.biz])).rows[0];
(async () => {
  await db.connect();
  assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, process.env.EXPECTED_PG_SYSTEM_ID);
  // A real Supabase Auth session for a synthetic person: what any signed-up user holds.
  const svc = { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json' };
  const email = 'public.role.' + Date.now() + '@example.invalid', password = randomBytes(24).toString('hex');
  const created = await fetch(platform + '/auth/v1/admin/users', { method: 'POST', headers: svc, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.ok([200, 201].includes(created.status), 'synthetic GoTrue user');
  const tok = await (await fetch(platform + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
  assert.ok(tok.access_token, 'GoTrue sign-in');
  const roles = { anon: process.env.SUPABASE_ANON_KEY, authenticated: tok.access_token };
  const before = await counts();
  for (const [role, key] of Object.entries(roles)) {
    const reads = [`transactions?business_id=eq.${C.biz}&select=id,amount_original`, `businesses?id=eq.${C.biz}&select=id,name`, `wallets?business_id=eq.${C.biz}&select=id`,
      `audit_events?business_id=eq.${C.biz}&select=id`, `users?select=id&limit=5`, `intercompany_balances?select=*&limit=5`];
    for (const p of reads) { const r = await call(role, key, 'GET', p); if (r.status === 200) assert.equal(r.affected, 0, `${role} read rows through ${p}`); }
    const upd = await call(role, key, 'PATCH', `transactions?business_id=eq.${C.biz}`, { description: 'public-role probe' });
    if (upd.status < 300) assert.equal(upd.affected, 0, role + ' updated rows');
    const del = await call(role, key, 'DELETE', `audit_events?business_id=eq.${C.biz}`);
    if (del.status < 300) assert.equal(del.affected, 0, role + ' deleted audit rows');
    await call(role, key, 'POST', 'transactions', { business_id: C.biz, wallet_id: C.wallet, type: 'income', amount_original: '1', currency_original: 'IDR', description: 'public-role probe' });
    await call(role, key, 'POST', 'rpc/rpc_reset_business_financial', { p_business: C.biz, p_actor_user_id: C.owner.user.id });
    await call(role, key, 'POST', 'rpc/rpc_document_archive', { p_document_id: '00000000-0000-0000-0000-000000000000', p_business_id: C.biz, p_actor: C.owner.user.id, p_channel: 'web' });
    await call(role, key, 'POST', 'rpc/fn_deposit_balance', { p_account: '00000000-0000-0000-0000-000000000000' });
    await call(role, key, 'POST', 'rpc/next_app_user_id', {});
  }
  const after = await counts();
  // Never a change to the company's data, whatever the grants.
  for (const k of ['tx', 'wallets', 'debts', 'audit', 'docs', 'biz']) assert.equal(after[k], before[k], 'company rows changed: ' + k);
  const seqMoved = after.user_seq !== before.user_seq;
  // Refused by privileges = 42501 "permission denied for …"; a 42501 raised by RLS or a function body means the call
  // got past the grants.
  // The denied object must be the one called (e.g. a denial on fn_ledger_writer_lock inside a trigger means the call
  // passed the table's own grants).
  const target = (r) => r.path.startsWith('rpc/') ? r.path.slice(4).split('?')[0] : r.path.split('?')[0];
  const refusedByGrant = (r) => r.status >= 400 && r.code === '42501' && new RegExp(`^permission denied for (table|function|view) ${target(r)}$`).test(r.message || '');
  const reached = rows.filter((r) => !refusedByGrant(r));
  if (expect === 'closed') {
    assert.equal(seqMoved, false, 'public roles still advance app_user_id_seq');
    assert.deepEqual(reached.map((r) => `${r.role} ${r.method} ${r.path} ${r.status} ${r.code}`), [], 'calls still reach data or function bodies');
  }
  fs.writeFileSync(`/evidence/PUBLIC_ROLE_ACCESS_${expect}.json`, JSON.stringify({ candidate: process.env.CFO_RC_SHA || 'unrecorded', expect, before, after, user_seq_advanced_by_public_roles: seqMoved, calls: rows }, null, 2));
  console.log(`PASS ${expect}: ${rows.length} calls by anon/authenticated, company rows unchanged; reached data or bodies: ${reached.length}; user id sequence advanced: ${seqMoved}`);
  for (const r of rows) console.log(`  ${r.role.padEnd(13)} ${r.method.padEnd(6)} ${r.path.slice(0, 50).padEnd(50)} ${r.status} ${r.code || ''} ${r.rows_returned ?? ''} ${r.message || ''}`);
  await db.end();
})().catch(async (e) => { console.error(e.message); await db.end().catch(() => {}); process.exit(1); });
