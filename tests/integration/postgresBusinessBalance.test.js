'use strict';
// REAL PostgreSQL only. Creates/drops its own synthetic database on loopback.
// BALANCE_PG_URL must address a local disposable PostgreSQL administrative DB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const input = process.env.BALANCE_PG_URL;
if (!input) throw new Error('Set BALANCE_PG_URL to a local disposable PostgreSQL (see runbook)');
const url = new URL(input);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External PostgreSQL forbidden');
const database = `cfo_balance_test_${process.pid}_${Date.now()}`;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const W = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const X = '33333333-3333-4333-8333-333333333333';
const F = '44444444-4444-4444-8444-444444444444';
let admin, c, d, observer;
const sqlFile = name => fs.readFileSync(path.join(root, name), 'utf8');
async function client() { const u = new URL(input); u.pathname = `/${database}`; const x = new Client({ connectionString: u.href }); await x.connect(); await x.query("SET statement_timeout='10s'; SET lock_timeout='8s'"); return x; }
before(async () => {
  admin = new Client({ connectionString: input }); await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  c = await client(); d = await client(); observer = await client();
  await c.query(sqlFile('tests/fixtures/balance/schema.sql'));
  await c.query(sqlFile('migrations/066_debt_payment_idempotency_and_atomic_rpc.sql'));
  await c.query(sqlFile('migrations/067_business_wallet_transfers_atomic_task30.sql'));
  await c.query('INSERT INTO businesses(id,owner_user_id,name,type) VALUES ($1,101,\'A\',\'business\'),($2,202,\'B\',\'business\')', [A,B]);
  await c.query("INSERT INTO wallets(id,user_id,business_id,name,currency,type) VALUES ($1,101,$5,'A cash','IDR','bank'),($2,101,$5,'A other','IDR','bank'),($3,202,$6,'B cash','IDR','bank'),($4,101,$5,'A USD','USD','bank')",[W,V,X,F,A,B]);
});
after(async () => {
  for (const x of [c,d,observer]) if (x) { await x.query('ROLLBACK').catch(()=>{}); await x.end(); }
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); await admin.end(); }
});
async function reset(opening = 100, other = 100) {
  await c.query('TRUNCATE transactions,debts,debt_payment_idempotency,payroll_payments,payroll_payment_items,bank_import_rows,bank_import_batches RESTART IDENTITY CASCADE');
  await insert(opening<0?'correction':'income',opening,W); await insert('income',other,V);
  await c.query("INSERT INTO debts(id,business_id,type,counterparty,amount,original_amount,currency,scope) VALUES (1,$1,'payable','D1',70,70,'IDR','business'),(2,$1,'payable','D2',70,70,'IDR','business')",[A]);
}
async function insert(type,amount,w=W,extra={}) {
  const r=await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,currency_original,amount_idr,wallet_id,source,scope,transaction_date,description) VALUES ($1,101,$2,$3,$4,$3,$5,$6,'business','2026-10-10','seed') RETURNING *",[extra.business || A,type,amount,extra.currency || 'IDR',w,extra.source || 'manual']); return r.rows[0];
}
async function balance(w=W,x=c) { const r=await x.query('SELECT fn_wallet_ledger_balance($1)::text b',[w]); return r.rows[0].b; }
async function patch(t,updates,x=c,biz=A,user=101,financial=true) { return x.query('SELECT rpc_patch_business_transaction($1,$2,$3,$4,$5,$6) result',[biz,user,t.id,t.balance_version,updates,financial]); }
function pay(x,debt=1,key='key1',amount=70,w=W) { return x.query("SELECT rpc_record_debt_payment($1,101,$2,$3,$4,'IDR',$4,1,'test','2026-10-10',$5,$6,NULL,now()) result",[A,debt,w,amount,key,`hash:${debt}:${w}:${amount}`]); }
function transfer(x,id,amount=70,from=W,to=V) { return x.query("SELECT rpc_execute_wallet_transfer($1,101,$2,$3,$4,'IDR',$4,1,$4,'IDR',$4,1,'test',NULL,'2026-10-10',$5,'business') result",[A,from,to,amount,id]); }
async function rejected(p,code) { await assert.rejects(p,e=>e.message.startsWith(code+':')); }
async function snapshot() { const r=await c.query("SELECT jsonb_build_object('tx',(SELECT COALESCE(jsonb_agg(t ORDER BY id),'[]') FROM transactions t),'debt',(SELECT COALESCE(jsonb_agg(t ORDER BY id),'[]') FROM debts t),'idem',(SELECT COALESCE(jsonb_agg(t ORDER BY key),'[]') FROM debt_payment_idempotency t),'payroll',(SELECT COALESCE(jsonb_agg(t ORDER BY id),'[]') FROM payroll_payments t),'items',(SELECT COALESCE(jsonb_agg(t ORDER BY id),'[]') FROM payroll_payment_items t)) state");return r.rows[0].state; }
// Observe the second backend actually waiting on the first backend. No random
// timer establishes ordering, and no Promise.all pretends to be a barrier.
async function waiting(blocker,blocked) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const r=await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) waiting',[blocker.processID,blocked.processID]);
    if(r.rows[0].waiting) return;
    await new Promise(r=>setImmediate(r));
  }
  throw new Error('Second independent connection did not block at the expected gate');
}
async function race(first,second,expectedCode) {
  await c.query('BEGIN'); await first(c);
  const pending=second(d).then(value=>({value}),error=>({error}));
  await waiting(c,d); await c.query('COMMIT');
  const r=await pending;
  if(expectedCode) assert.ok(r.error?.message.startsWith(expectedCode+':'),r.error?.message || 'unexpected success');
  else assert.ok(!r.error,r.error?.message);
  return r;
}

test('baseline: direct PATCH bypass and two independently prechecked payments reproduce negative balances',async()=>{
  await reset(); const expense=await insert('expense',10);
  await c.query('UPDATE transactions SET amount_original=150 WHERE id=$1',[expense.id]);
  const baseline=await c.query("SELECT sum(CASE type WHEN 'income' THEN amount_original WHEN 'expense' THEN -amount_original ELSE 0 END)::text b FROM transactions WHERE wallet_id=$1",[W]);
  assert.equal(baseline.rows[0].b,'-50.00');
  await reset();
  // Both prechecks see 100 before any payout, as in #156.
  for(const x of [c,d]) { const r=await x.query('SELECT sum(amount_original)::text b FROM transactions WHERE wallet_id=$1',[W]);assert.equal(r.rows[0].b,'100.00'); }
  await race(x=>pay(x,1,'baseline1'),x=>pay(x,2,'baseline2'));
  const r=await c.query("SELECT sum(CASE type WHEN 'income' THEN amount_original WHEN 'expense' THEN -amount_original ELSE 0 END)::text b FROM transactions WHERE wallet_id=$1",[W]);assert.equal(r.rows[0].b,'-40.00');
  await c.query(sqlFile('migrations/070_atomic_business_balance.sql'));
  // Migration is re-applicable without rewriting historical rows.
  await c.query(sqlFile('migrations/070_atomic_business_balance.sql'));
});
test('100 minus existing expense 10: PATCH to 150 refuses without any changed row',async()=>{
  await reset(); const t=await insert('expense',10); const before=await snapshot();
  await rejected(patch(t,{amount_original:150,amount_idr:150}),'insufficient_balance'); assert.deepEqual(await snapshot(),before); assert.equal(await balance(),'90.00');
});
test('income reduction and income move protect the old wallet; expense move protects the new wallet',async()=>{
  await reset(); await insert('expense',90); const t=(await c.query("SELECT * FROM transactions WHERE wallet_id=$1 AND type='income'",[W])).rows[0];
  await rejected(patch(t,{amount_original:50}),'insufficient_balance'); await rejected(patch(t,{wallet_id:V}),'insufficient_balance');
  await reset(100,20);const e=await insert('expense',30);await rejected(patch(e,{wallet_id:V}),'insufficient_balance');assert.equal(await balance(),'70.00');assert.equal(await balance(V),'20.00');
});
test('allowed amount, date, metadata and move preserve exact native balances',async()=>{
  await reset(); let t=await insert('expense','10.01'); let r=await patch(t,{amount_original:'20.02',amount_idr:'20.02'});t=r.rows[0].result;
  assert.equal(await balance(),'79.98');r=await patch(t,{wallet_id:V,transaction_date:'2026-10-01'});t=r.rows[0].result;
  assert.equal(await balance(),'100.00');assert.equal(await balance(V),'79.98');await patch(t,{description:'new'},c,A,101,false);
});
test('different debts / different keys: second concurrent 70 payment refuses, all its records roll back',async()=>{
  await reset();await race(x=>pay(x,1,'one'),x=>pay(x,2,'two'),'insufficient_balance');
  assert.equal(await balance(),'30.00'); const r=await c.query("SELECT (SELECT count(*) FROM debt_payment_idempotency)::int i,(SELECT paid_amount FROM debts WHERE id=2)::text paid,(SELECT count(*) FROM transactions WHERE type='expense')::int tx");assert.deepEqual(r.rows[0],{i:1,paid:'0',tx:1});
});
test('payment then PATCH and PATCH then payment use the same gate',async()=>{
  await reset();const t=await insert('expense',10);
  await race(x=>pay(x,1,'pay'),x=>patch(t,{amount_original:40},x),'insufficient_balance');assert.equal(await balance(),'20.00');
  await reset();const u=await insert('expense',10);
  await race(x=>patch(u,{amount_original:40},x),x=>pay(x,1,'pay2'),'insufficient_balance');assert.equal(await balance(),'60.00');
});
test('transfer / payment and two transfers cannot overspend; transfer legs are atomic',async()=>{
  await reset();await race(x=>transfer(x,'aaaaaaaa-1111-4111-8111-111111111111'),x=>pay(x,1,'payment'),'insufficient_balance');assert.equal(await balance(),'30.00');assert.equal(await balance(V),'170.00');
  await reset();await race(x=>transfer(x,'aaaaaaaa-1111-4111-8111-111111111111'),x=>transfer(x,'aaaaaaaa-2222-4222-8222-222222222222'),'insufficient_balance');
  const r=await c.query('SELECT count(*)::int n FROM transactions WHERE transfer_id IS NOT NULL');assert.equal(r.rows[0].n,2);
});
test('same payment/transfer id replays; reused transfer id with different payload refuses',async()=>{
  await reset();await race(x=>pay(x,1,'same'),x=>pay(x,1,'same'));assert.equal(await balance(),'30.00');
  await reset();const id='aaaaaaaa-1111-4111-8111-111111111111';await race(x=>transfer(x,id),x=>transfer(x,id));assert.equal(await balance(),'30.00');await rejected(transfer(c,id,20),'idempotency_key_mismatch');
});
test('concurrent PATCH same version refuses stale update instead of losing it',async()=>{
  await reset();const t=await insert('expense',10);await race(x=>patch(t,{amount_original:20},x),x=>patch(t,{amount_original:30},x),'transaction_version_conflict');assert.equal(await balance(),'80.00');
});
test('forced failure after insert or first transfer leg rolls back every record',async()=>{
  await reset(); const before=await snapshot();
  await c.query("CREATE FUNCTION public.test_fail_debt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_failure'; END $$; CREATE TRIGGER test_fail_debt BEFORE UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION public.test_fail_debt()");
  await assert.rejects(pay(c),/synthetic_failure/);assert.deepEqual(await snapshot(),before);await c.query('DROP TRIGGER test_fail_debt ON debts; DROP FUNCTION test_fail_debt()');
  await c.query("CREATE FUNCTION public.test_fail_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.transfer_id IS NOT NULL AND NEW.type='income' THEN RAISE EXCEPTION 'synthetic_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_credit BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION public.test_fail_credit()");
  await assert.rejects(transfer(c,'aaaaaaaa-1111-4111-8111-111111111111'),/synthetic_failure/);assert.deepEqual(await snapshot(),before);await c.query('DROP TRIGGER test_fail_credit ON transactions; DROP FUNCTION test_fail_credit()');
});
test('company and currency boundaries hold in the RPC, not just in HTTP',async()=>{
  await reset();const t=await insert('expense',10);const before=await snapshot();
  await rejected(patch(t,{description:'stolen'},c,B,202,false),'transaction_not_found');
  await rejected(patch(t,{wallet_id:X}),'currency_mismatch');await rejected(patch(t,{wallet_id:F}),'currency_mismatch');
  await rejected(patch(t,{amount_original:20},c,A,202),'business_write_forbidden');assert.deepEqual(await snapshot(),before);
  await c.query('SET ROLE authenticated');await assert.rejects(patch(t,{amount_original:20}),/permission denied/);await c.query('RESET ROLE');
  // A previously corrupted wallet currency cannot be hidden by moving the row.
  await c.query("UPDATE wallets SET currency='USD' WHERE id=$1",[W]);
  await rejected(patch(t,{wallet_id:V}),'currency_mismatch');
  await c.query("UPDATE wallets SET currency='IDR' WHERE id=$1",[W]);
  assert.deepEqual(await snapshot(),before);
});
test('statement, opening, payroll, historical debt payments and transfer financial edits stay immutable',async()=>{
  await reset(); const opening=await insert('income',10,W,{source:'wallet_opening_balance'});await rejected(patch(opening,{amount_original:20}),'opening_balance_cannot_be_modified');
  await pay(c,1,'linked',10);const debtTx=(await c.query("SELECT t.* FROM transactions t JOIN debt_payment_idempotency i ON i.transaction_id=t.id WHERE key='linked'")).rows[0];
  // A later payment overwrites debts.linked_transaction_id; old payment remains protected by idempotency history.
  await pay(c,1,'linked2',10);await rejected(patch(debtTx,{transaction_date:'2026-10-09'}),'debt_payment_amount_immutable');
  const p=await insert('payroll',5);await c.query("INSERT INTO payroll_payments(business_id,transaction_id,user_id,employee_name,amount,currency,payment_date) VALUES ($1,$2,101,'Synthetic',5,'IDR','2026-10-10')",[A,p.id]);await rejected(patch(p,{amount_original:6}),'payroll_financial_fields_immutable');
  const batch='aaaaaaaa-9999-4999-8999-999999999999',row='aaaaaaaa-8888-4888-8888-888888888888';const t=await insert('expense',5);
  await c.query('INSERT INTO bank_import_batches(id,business_id,wallet_id) VALUES ($1,$2,$3)',[batch,A,W]);await c.query('INSERT INTO bank_import_rows(id,batch_id,business_id,row_index,linked_transaction_id) VALUES ($1,$2,$3,1,$4)',[row,batch,A,t.id]);await rejected(patch(t,{wallet_id:V}),'statement_financial_fields_immutable');await patch(t,{category:'Reviewed'},c,A,101,false);
  await transfer(c,'aaaaaaaa-1111-4111-8111-111111111111',5);const tr=(await c.query('SELECT * FROM transactions WHERE transfer_id IS NOT NULL LIMIT 1')).rows[0];await rejected(patch(tr,{amount_original:6}),'transfer_financial_fields_immutable');
});
test('negative wallet allows improvement / neutral edit, refuses worsening; overdraft remains allowed',async()=>{
  await reset(-100);const t=await insert('income',10);await rejected(patch(t,{amount_original:5}),'wallet_balance_negative');let r=await patch(t,{amount_original:20});let u=r.rows[0].result;
  await patch(u,{description:'neutral',transaction_date:'2026-09-01'});assert.equal(await balance(),'-80.00');
  await c.query("UPDATE wallets SET type='overdraft' WHERE id=$1",[W]);await insert('expense',20);assert.equal(await balance(),'-100.00');await c.query("UPDATE wallets SET type='bank' WHERE id=$1",[W]);
});
test('ordinary direct writes share the gate; tiny cent overdraft and non-finite values cannot bypass',async()=>{
  await reset('0.10');await insert('expense','0.10');await rejected(insert('expense','0.01'),'insufficient_balance');assert.equal(await balance(),'0.00');
  await reset();await c.query('BEGIN');await pay(c,1,'direct1');const pending=d.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id,scope) VALUES ($1,'expense',70,'IDR',$2,'business')",[A,W]).then(v=>({v}),e=>({e}));await waiting(c,d);await c.query('COMMIT');assert.match((await pending).e.message,/insufficient_balance/);
  await rejected(insert('income','NaN'),'invalid_amount');
});
test('whole batch is independent of row order and rejects atomically',async()=>{
  await reset(0);
  await c.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id) VALUES ($1,'expense',70,'IDR',$2),($1,'income',100,'IDR',$2)",[A,W]);assert.equal(await balance(),'30.00');
  const before=await snapshot();await rejected(c.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id) VALUES ($1,'expense',50,'IDR',$2),($1,'income',10,'IDR',$2)",[A,W]),'insufficient_balance');assert.deepEqual(await snapshot(),before);
});
test('historical import provenance and corrections stay exempt; manual caller cannot forge import id',async()=>{
  await reset(0);const batch='aaaaaaaa-9999-4999-8999-999999999999',row='aaaaaaaa-8888-4888-8888-888888888888';
  await c.query("INSERT INTO bank_import_batches(id,business_id,wallet_id,currency) VALUES ($1,$2,$3,'IDR')",[batch,A,W]);
  await c.query("INSERT INTO bank_import_rows(id,batch_id,business_id,row_index,amount,tx_date) VALUES ($1,$2,$3,1,70,'2026-10-10')",[row,batch,A]);
  await c.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id,transaction_date,bank_import_row_id) VALUES ($1,'expense',70,'IDR',$2,'2026-10-10',$3)",[A,W,row]);assert.equal(await balance(),'-70.00');
  await rejected(c.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id,transaction_date,bank_import_row_id) VALUES ($1,'expense',80,'IDR',$2,'2026-10-10',$3)",[A,W,row]),'invalid_import_provenance');
  await insert('correction',-30);assert.equal(await balance(),'-100.00');
  await insert('income',50);assert.equal(await balance(),'-50.00');
});
test('unsupported amount precision is rejected, not silently rounded in linked operations',async()=>{
  await reset();const t=await insert('expense',10);const before=await snapshot();
  await rejected(patch(t,{amount_original:'10.001'}),'invalid_amount_precision');
  await rejected(pay(c,1,'precision','0.001'),'invalid_amount_precision');
  await rejected(transfer(c,'aaaaaaaa-1111-4111-8111-111111111111','0.001'),'invalid_amount_precision');assert.deepEqual(await snapshot(),before);
});
test('reserved opening source is not a cash check exemption; real negative opening still works',async()=>{
  await reset(0);await rejected(insert('expense',10,W,{source:'wallet_opening_balance'}),'insufficient_balance');
  await c.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id,source,is_opening_balance) VALUES ($1,'expense',10,'USD',$2,'wallet_opening_balance',true)",[A,F]);assert.equal(await balance(F),'-10.00');
  await rejected(c.query("INSERT INTO transactions(business_id,type,amount_original,currency_original,wallet_id,source,is_opening_balance) VALUES ($1,'expense',10,'USD',$2,'wallet_opening_balance',true)",[A,F]),'invalid_opening_balance');
});
test('old unkeyed payment stays immutable after its note is renamed',async()=>{
  await reset();const t=await insert('expense',10,W,{source:'A cash'});await c.query("UPDATE transactions SET description='Payment: Old vendor' WHERE id=$1",[t.id]);
  const old=(await c.query('SELECT * FROM transactions WHERE id=$1',[t.id])).rows[0];const renamed=(await patch(old,{description:'Renamed'},c,A,101,false)).rows[0].result;
  await rejected(patch(renamed,{amount_original:20}),'debt_payment_amount_immutable');
});
function batch(x,id,amount=70) {
  return x.query('SELECT rpc_insert_business_transactions($1,101,$2) result',[A,JSON.stringify([
    {type:'expense',amount_original:amount,currency_original:'IDR',wallet_id:W,transfer_id:id,transaction_date:'2026-10-10'},
    {type:'income',amount_original:amount,currency_original:'IDR',wallet_id:V,transfer_id:id,transaction_date:'2026-10-10'}])]);
}
test('batch transfer replay is rechecked under the gate, including distinct keys and precision',async()=>{
  await reset();const id='aaaaaaaa-1111-4111-8111-111111111111';const r=await race(x=>batch(x,id),x=>batch(x,id));assert.equal(r.value.rows[0].result.saved,0);assert.equal(await balance(),'30.00');
  await rejected(batch(c,id,20),'idempotency_key_mismatch');
  await reset();await race(x=>batch(x,id),x=>batch(x,'aaaaaaaa-2222-4222-8222-222222222222'),'insufficient_balance');assert.equal(await balance(),'30.00');
  await reset();await rejected(batch(c,id,'0.001'),'invalid_amount_precision');assert.equal(await balance(),'100.00');
});
test('cancellation is all-or-nothing and cannot remove a spent transfer credit',async()=>{
  await reset(100,0);const id='aaaaaaaa-1111-4111-8111-111111111111';await transfer(c,id);await insert('expense',50,V);
  const before=await snapshot();await rejected(c.query('SELECT rpc_delete_wallet_transfer($1,$2)',[A,id]),'insufficient_balance');assert.deepEqual(await snapshot(),before);
  await insert('income',50,V);await c.query('SELECT rpc_delete_wallet_transfer($1,$2)',[A,id]);assert.equal(await balance(),'100.00');assert.equal(await balance(V),'0.00');
});
test('deletion / opposite transfers / name-addressed writes use consistent locking and cash math',async()=>{
  await reset();await insert('expense',90);const income=(await c.query("SELECT * FROM transactions WHERE wallet_id=$1 AND type='income'",[W])).rows[0];await rejected(c.query('DELETE FROM transactions WHERE id=$1',[income.id]),'insufficient_balance');
  await reset();await race(x=>transfer(x,'aaaaaaaa-1111-4111-8111-111111111111',70,W,V),x=>transfer(x,'aaaaaaaa-2222-4222-8222-222222222222',70,V,W));assert.equal(await balance(),'100.00');assert.equal(await balance(V),'100.00');
  await reset();await insert('expense',70,null,{source:'A cash'});await rejected(insert('expense',40,null,{source:'A cash'}),'insufficient_balance');assert.equal(await balance(),'30.00');
});
test('service_role can execute; authenticated cannot forge RPC actor; unsupported isolation fails closed',async()=>{
  await reset();const t=await insert('expense',10);await c.query('SET ROLE service_role');await patch(t,{description:'service'},c,A,101,false);await c.query('RESET ROLE');
  const grants=await c.query("SELECT count(*)::int n FROM information_schema.routine_privileges WHERE routine_name IN ('rpc_patch_business_transaction','rpc_record_debt_payment','rpc_execute_wallet_transfer','rpc_record_business_payroll') AND grantee IN ('PUBLIC','authenticated','anon')");assert.equal(grants.rows[0].n,0);
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await rejected(patch(t,{description:'snapshot'},c,A,101,false),'ledger_isolation_unsupported');await c.query('ROLLBACK');
});
function payroll(x,amount=20,items=null) {
  items ||= [{item_type:'salary',label:'Salary',amount,direction:'addition'}];
  return x.query('SELECT rpc_record_business_payroll($1,101,$2,$3,$4) result',[A,
    {type:'payroll',amount_original:amount,amount_idr:amount,currency_original:'IDR',wallet_id:W,scope:'business',transaction_date:'2026-10-10'},
    {employee_name:'Synthetic',amount,gross_amount:amount,deduction_amount:0,net_amount:amount,currency:'IDR',payment_type:'salary',payment_date:'2026-10-10',wallet_id:W,status:'paid'},JSON.stringify(items)]);
}
test('payroll / payment share the gate and invalid payroll item rolls back transaction plus payment',async()=>{
  await reset();await race(x=>payroll(x,70),x=>pay(x,1,'payroll-race'),'insufficient_balance');assert.equal(await balance(),'30.00');
  const counts=await c.query('SELECT (SELECT count(*) FROM payroll_payments)::int p,(SELECT count(*) FROM payroll_payment_items)::int i');assert.deepEqual(counts.rows[0],{p:1,i:1});
  await reset();const before=await snapshot();await assert.rejects(payroll(c,20,[{item_type:'salary',label:'Salary',amount:20,direction:'bad'}]),/payroll_payment_items_direction_check/);assert.deepEqual(await snapshot(),before);
  const none=await c.query('SELECT count(*)::int n FROM payroll_payment_items');assert.equal(none.rows[0].n,0);
});
test('cross-currency transfer preserves explicitly supplied native legs without reinterpreting them',async()=>{
  await reset();await c.query("SELECT rpc_execute_wallet_transfer($1,101,$2,$3,70,'IDR',70,1,1,'USD',70,70,'test',NULL,'2026-10-10',$4,'business')",[A,W,F,'aaaaaaaa-1111-4111-8111-111111111111']);assert.equal(await balance(),'30.00');assert.equal(await balance(F),'1.00');
  await rejected(c.query("SELECT rpc_record_debt_payment($1,101,1,$2,10,'USD',10,1,'test','2026-10-10','wrong','wrong',NULL,now())",[A,F]),'debt_currency_mismatch');
});
test('real Express HTTP plus real PostgreSQL: PATCH, RPC absence, permissions, replay and stale version',async()=>{
  // Keep the original 25 SQL qualification cases. This HTTP case now needs the
  // full integrated schema and receipt migration; never emulate the new RPC.
  const {createIntegratedDatabase}=require('./_integratedSchemaDb');
  process.env.DATABASE_URL=input;const full=await createIntegratedDatabase('cfo_balance_http');
  const legacyClient=c;c=new Client({connectionString:full.connectionString});await c.connect();
  await c.query('INSERT INTO users(id) VALUES(101),(202),(303)');
  await c.query("INSERT INTO businesses(id,owner_user_id,name,type) VALUES($1,101,'A','business'),($2,202,'B','business')",[A,B]);
  await c.query("INSERT INTO wallets(id,user_id,business_id,name,currency,type,scope) VALUES($1,101,$5,'A cash','IDR','bank','business'),($2,101,$5,'A other','IDR','bank','business'),($3,202,$6,'B cash','IDR','bank','business'),($4,101,$5,'A USD','USD','bank','business')",[W,V,X,F,A,B]);
  await reset();await c.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES ($1,101,'owner','active'),($2,202,'owner','active'),($1,303,'auditor','active')",[A,B]);
  const { createRealPgSupabase }=require('./_realPgSupabase');
  const db=createRealPgSupabase(full.connectionString);const Module=require('node:module');const load=Module._load;
  const http=require('node:http');const listen=http.Server.prototype.listen;let server;
  http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args);};
  Object.assign(process.env,{PORT:'0',NODE_ENV:'test',JWT_SECRET:'synthetic-balance-http-secret',SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SECRET_KEY:'synthetic',BOT_TOKEN:'synthetic',TELEGRAM_WEBHOOK_SECRET:'synthetic'});
  Module._load=function(name){return name==='@supabase/supabase-js'?{createClient:()=>db}:load.apply(this,arguments);};
  try {
    require('../../server/index');
    if(!server.listening)await new Promise(r=>server.once('listening',r));
    const jwt=require('jsonwebtoken');
    async function api(method,url,body,user=101,biz=A){const token=jwt.sign({userId:user,authChannel:'email'},process.env.JWT_SECRET);const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{Authorization:`Bearer ${token}`,'x-business-id':biz,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
    let t=await insert('expense',10);const before=await snapshot();let r=await api('PATCH',`/api/transactions/${t.id}`,{amount:150});assert.equal(r.status,409);assert.equal(r.data.error,'insufficient_balance');assert.deepEqual(await snapshot(),before);
    r=await api('PATCH',`/api/transactions/${t.id}`,{amount:'9007199254740993'});assert.equal(r.status,400);assert.equal(r.data.error,'invalid_amount_precision');assert.deepEqual(await snapshot(),before);
    r=await api('PATCH',`/api/transactions/${t.id}`,{amount:20,expected_version:0});assert.equal(r.status,200);assert.equal(r.data.balance_version,1);assert.equal(await balance(),'80.00');
    r=await api('PATCH',`/api/transactions/${t.id}`,{description:'stale',expected_version:0});assert.equal(r.status,409);assert.equal(r.data.error,'transaction_version_conflict');
    r=await api('PATCH',`/api/transactions/${t.id}`,{type:'income'});assert.equal(r.status,400);
    r=await api('PATCH',`/api/transactions/${t.id}`,{amount:30},303);assert.equal(r.status,403);
    r=await api('PATCH',`/api/transactions/${t.id}`,{amount:30},202,B);assert.equal(r.status,404);
    const rpc=db.rpc;db.rpc=async()=>({data:null,error:{code:'PGRST202',message:'function not found in schema cache'}});
    r=await api('PATCH',`/api/transactions/${t.id}`,{amount:30});assert.equal(r.status,503);assert.equal(r.data.error,'balance_rpc_unavailable');assert.equal(await balance(),'80.00');db.rpc=rpc;
    // The old 066 function still exists, but the new backend must not fall back
    // to it when its required guarded entry point is genuinely absent.
    const signature=(await c.query("SELECT oid::regprocedure::text signature FROM pg_proc WHERE proname='rpc_record_debt_payment_guarded'")).rows[0].signature;
    await c.query(`ALTER FUNCTION ${signature} RENAME TO test_missing_guarded`);
    try { r=await api('POST','/api/debts/1/pay',{wallet_id:W,amount:10,date:'2026-10-10',idempotency_key:'missing-guarded'});assert.equal(r.status,503,JSON.stringify(r));assert.equal(r.data.error,'balance_rpc_unavailable');assert.equal(await balance(),'80.00'); }
    finally { await c.query(`ALTER FUNCTION ${signature.replace('rpc_record_debt_payment_guarded','test_missing_guarded')} RENAME TO rpc_record_debt_payment_guarded`); }
    // Both HTTP requests read the same version before either enters the RPC.
    // A read barrier establishes overlap; real PostgreSQL chooses one winner.
    const from=db.from;let reads=0;let release;const barrier=new Promise(r=>{release=r;});
    db.from=function(table){const q=from(table);const run=q._run.bind(q);q._run=async()=>{const r=await run();if(table==='transactions'&&q.op==='select'&&q.cols.includes('balance_version')){reads++;if(reads===2)release();await barrier;}return r;};return q;};
    const results=await Promise.all([api('PATCH',`/api/transactions/${t.id}`,{amount:30}),api('PATCH',`/api/transactions/${t.id}`,{amount:40})]);db.from=from;
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(results.find(x=>x.status===409).data.error,'transaction_version_conflict');
    await reset();const transferId='aaaaaaaa-1111-4111-8111-111111111111';
    r=await api('POST','/api/wallets/transfer',{from_wallet_id:W,to_wallet_id:V,amount:70,transfer_id:transferId,date:'2026-10-10'});assert.equal(r.status,201,JSON.stringify(r));
    r=await api('POST','/api/wallets/transfer',{from_wallet_id:W,to_wallet_id:V,amount:70,transfer_id:transferId,date:'2026-10-10'});assert.equal(r.status,200);assert.equal(r.data.is_replay,true);
    r=await api('POST','/api/wallets/transfer',{from_wallet_id:W,to_wallet_id:V,amount:20,transfer_id:transferId,date:'2026-10-10'});assert.equal(r.status,409);assert.equal(r.data.error,'idempotency_key_mismatch');
    await reset();r=await api('POST','/api/debts/1/pay',{wallet_id:W,amount:70,date:'2026-10-10',idempotency_key:'complete'});assert.equal(r.status,200,JSON.stringify(r));const completed=await snapshot();
    r=await api('POST','/api/debts/1/pay',{wallet_id:W,amount:70,date:'2026-10-10',idempotency_key:'complete'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.is_replay,true);assert.deepEqual(await snapshot(),completed);
    await reset();r=await api('POST','/api/payroll/payments',{employee_name:'Synthetic',wallet_id:W,currency:'IDR',amount:20,payment_date:'2026-10-10'});assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.data.error,'payroll_bank_link_required');assert.equal(await balance(),'100.00');
    await reset();r=await api('POST','/api/transactions/batch',{request_key:'full-http-batch',transactions:[{type:'expense',amount:20,wallet_id:W,currency:'IDR',scope:'business',transaction_date:'2026-10-10'}]});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.saved,1);assert.equal(await balance(),'80.00');
  } finally {
    Module._load=load;http.Server.prototype.listen=listen;
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.pool.end();
    await c.end();c=legacyClient;await full.drop();
  }
});
