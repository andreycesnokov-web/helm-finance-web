'use strict';
// AC-0 / I-13 (24 Oct 2026): with PostgREST capped at 1000 rows per select (the hosted Supabase default), a company with
// more operations must still see its full balance and runway on Pulse and AI CFO. Seeds 1,100 small synthetic incomes
// once (idempotent by marker), then compares Pulse and AI CFO cash with SQL fn_wallet_ledger_balance.
//   MAXROWS_EXPECT=truncated   (code before the fix) — records the shortfall;  MAXROWS_EXPECT=complete — must match SQL.
// Needs a PostgREST with PGRST_DB_MAX_ROWS=1000 and admit-http.cjs. Synthetic data only.
const assert = require('node:assert/strict'), fs = require('node:fs'), { Client } = require('pg');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), base = process.env.BASE_URL, expect = process.env.MAXROWS_EXPECT;
const db = new Client({ connectionString: process.env.DATABASE_URL });
const api = async (p) => { const r = await fetch(base + '/api' + p, { headers: { authorization: 'Bearer ' + C.owner.token, 'x-business-id': C.biz } }); assert.equal(r.status, 200, p); return r.json(); };
(async () => {
  assert.ok(['truncated', 'complete'].includes(expect), 'MAXROWS_EXPECT=truncated|complete');
  await db.connect();
  assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, process.env.EXPECTED_PG_SYSTEM_ID);
  const have = (await db.query("SELECT count(*)::int n FROM transactions WHERE business_id=$1 AND description LIKE 'AC0 MAXROWS %'", [C.biz])).rows[0].n;
  if (have < 1100) await db.query(`INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description,source)
    SELECT $1,$2,'income',1000,1000,'IDR',$3,'business',current_date - (g % 300),'AC0 MAXROWS ' || g,'manual' FROM generate_series($4::int, 1100) g`, [C.biz, C.owner.user.id, C.wallet, have + 1]);
  const total = Number((await db.query("SELECT count(*)::int n FROM transactions WHERE business_id=$1", [C.biz])).rows[0].n);
  const sql = Number((await db.query("SELECT sum(fn_wallet_ledger_balance(id))::numeric s FROM wallets WHERE business_id=$1", [C.biz])).rows[0].s);
  const pulse = Number((await api('/pulse')).totalBalance), cfo = Number((await api('/ai-cfo/context')).wallets_summary.business_cash);
  const list = (await api('/transactions?period=all')).length;
  const out = { expect, operations: total, transactions_list_rows: list, sql_balance: sql, pulse_balance: pulse, ai_cfo_balance: cfo, pulse_short_by: sql - pulse, ai_cfo_short_by: sql - cfo };
  fs.writeFileSync(`/evidence/AC0_MAXROWS_${expect}.json`, JSON.stringify(out, null, 2));
  assert.ok(total > 1000, 'more than one PostgREST page');
  if (expect === 'complete') { assert.equal(pulse, sql, 'Pulse balance'); assert.equal(cfo, sql, 'AI CFO balance'); assert.equal(list, total, 'GET /transactions?period=all rows'); }
  else assert.ok(pulse !== sql || cfo !== sql, 'the cap did not truncate anything — is PGRST_DB_MAX_ROWS set?');
  console.log(`PASS ${expect}: ${total} operations, list ${list}; SQL ${sql}, Pulse ${pulse} (short ${sql - pulse}), AI CFO ${cfo} (short ${sql - cfo})`);
  await db.end();
})().catch(async (e) => { console.error(e.message); await db.end().catch(() => {}); process.exit(1); });
