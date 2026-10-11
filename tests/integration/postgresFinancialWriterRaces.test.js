'use strict';
// Independent real PostgreSQL connections, fresh FULL schema per test. No PGlite fallback.
// Synchronization observes pg_blocking_pids: no randomly timed race sleeps.
const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const {randomUUID}=require('node:crypto');
const {createIntegratedDatabase}=require('./_integratedSchemaDb');
let db,a,b,o,B,C,P,W,V;
const owner=95001;
async function client(){const c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:4000});await c.connect();await c.query("SET statement_timeout='8s';SET lock_timeout='6s'");return c}
beforeEach(async()=>{
  db=await createIntegratedDatabase('hf_writer_race');a=await client();b=await client();o=await client();
  B=randomUUID();C=randomUUID();P=randomUUID();W=randomUUID();V=randomUUID();
  await a.query('INSERT INTO users(id) VALUES($1)',[owner]);
  await a.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Race A',$4,'business'),($2,'Race B',$4,'business'),($3,'Personal',$4,'personal')",[B,C,P,owner]);
  for(const id of[B,C,P])await a.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')",[id,owner]);
  await a.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$3,$4,'Cash A','IDR','business'),($2,$3,$4,'Cash B','IDR','business')",[W,V,B,owner]);
  await insert(a,'income',100,W);await insert(a,'income',100,V);
});
afterEach(async()=>{for(const c of[a,b,o]){await c?.query('ROLLBACK').catch(()=>{});await c?.end()}if(db)await db.drop();db=null});
async function blocked(blocker,waiter){const deadline=Date.now()+5000;while(Date.now()<deadline){if((await o.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) waiting',[blocker.processID,waiter.processID])).rows[0].waiting)return;await new Promise(r=>setImmediate(r))}throw Error('Expected lock barrier not observed')}
async function insert(c,type,amount,w=W,biz=B,cur='IDR',source='manual'){
 return c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,source,scope,transaction_date) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'2026-10-04') RETURNING id",[biz,owner,type,amount,cur,w,source,biz===P?'personal':'business']);
}
async function rpc(c,name,args){const entries=Object.entries(args);return (await c.query(`SELECT public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) r`,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].r}
async function balance(w=W){return Number((await o.query('SELECT fn_wallet_ledger_balance($1) b',[w])).rows[0].b)}
async function pending(fn){return fn().then(value=>({value}),error=>({error}))}
async function race(first,second){await a.query('BEGIN');await first(a);const p=pending(()=>second(b));await blocked(a,b);await a.query('COMMIT');return p}
test('same-wallet concurrent expenses recheck balance, losing write is rolled back',async()=>{
 const r=await race(c=>insert(c,'expense',70),c=>insert(c,'expense',70));assert.match(r.error?.message||'',/^insufficient_balance:/);assert.equal(await balance(),30);
 assert.equal(Number((await o.query("SELECT count(*) n FROM transactions WHERE type='expense'")).rows[0].n),1);
});
test('independent wallet writes serialize at retained gate without cross-wallet money movement',async()=>{
 const r=await race(c=>insert(c,'expense',20,W),c=>insert(c,'expense',30,V));assert.ifError(r.error);assert.equal(await balance(W),80);assert.equal(await balance(V),70);
});
test('metadata currency update cannot race a first ledger write',async()=>{
 const empty=randomUUID();await a.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Empty','USD','business')",[empty,B,owner]);
 const r=await race(c=>c.query("UPDATE wallets SET currency='IDR' WHERE id=$1",[empty]),c=>insert(c,'income',1,empty,B,'USD'));
 assert.match(r.error?.message||'',/^currency_mismatch:/);assert.equal(await balance(empty),0);
 const r2=await race(c=>insert(c,'income',1,empty),c=>c.query("UPDATE wallets SET currency='USD' WHERE id=$1",[empty]));assert.match(r2.error?.message||'',/^wallet_metadata_locked:/);assert.equal(await balance(empty),1);
});
test('legacy NULL-wallet name cannot be renamed after concurrent ledger arrival',async()=>{
 const r=await race(c=>insert(c,'income',5,null,B,'IDR','Cash A'),c=>c.query("UPDATE wallets SET name='Renamed' WHERE id=$1",[W]));assert.match(r.error?.message||'',/^wallet_legacy_name_locked:/);assert.equal(await balance(W),105);
});
test('delete-empty-business vs batch income enters gate BEFORE parent tuple lock, then rechecks counts',async()=>{
 const row={type:'income',amount_original:1,amount_idr:1,currency_original:'IDR',scope:'business',source:'manual',transaction_date:'2026-10-04'};
 const r=await race(c=>rpc(c,'rpc_insert_business_transactions',{p_business_id:C,p_user_id:owner,p_rows:[row]}),c=>rpc(c,'rpc_delete_empty_business',{p_business_id:C,p_user_id:owner,p_confirm:'DELETE BUSINESS'}));
 assert.ifError(r.error);assert.equal(r.value.error,'business_not_empty');assert.equal(Number((await o.query('SELECT count(*) n FROM transactions WHERE business_id=$1',[C])).rows[0].n),1);
});
test('Personal and Business stay separate while sharing retained gate',async()=>{
 const pw=randomUUID();await a.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Personal cash','IDR','personal')",[pw,P,owner]);
 const r=await race(c=>insert(c,'income',3,W),c=>insert(c,'income',7,pw,P));assert.ifError(r.error);assert.equal(await balance(W),103);assert.equal(await balance(pw),7);
 await assert.rejects(rpc(b,'rpc_insert_business_transactions',{p_business_id:P,p_user_id:owner,p_rows:[]}),/business_write_forbidden/);
});
function transfer(from,to,id){return{p_business_id:B,p_user_id:owner,p_from_wallet_id:from,p_to_wallet_id:to,p_source_amount:10,p_source_currency:'IDR',p_source_amount_idr:10,p_source_booked_rate:1,p_target_amount:10,p_target_currency:'IDR',p_target_amount_idr:10,p_target_booked_rate:1,p_rate_source:'identity',p_description:'Race transfer',p_transaction_date:'2026-10-04',p_transfer_id:id,p_scope:'business'}}
test('opposite multi-wallet transfers and keyed repeat create exactly two atomic pairs',async()=>{
 const one=transfer(W,V,randomUUID()),two=transfer(V,W,randomUUID());
 const r=await race(c=>rpc(c,'rpc_execute_wallet_transfer_guarded',one),c=>rpc(c,'rpc_execute_wallet_transfer_guarded',two));assert.ifError(r.error);
 assert.equal(await balance(W),100);assert.equal(await balance(V),100);
 const repeat=await rpc(b,'rpc_execute_wallet_transfer_guarded',two);assert.equal(repeat.is_replay,true);
 assert.equal(Number((await o.query('SELECT count(*) n FROM transactions WHERE transfer_id IS NOT NULL')).rows[0].n),4);
});
test('concurrent same-intent batch repeats wait at gate and commit only one movement',async()=>{
 const row={type:'expense',amount_original:10,amount_idr:10,currency_original:'IDR',wallet_id:W,scope:'business',transaction_date:'2026-10-04'};
 const args={p_business_id:B,p_user_id:owner,p_request_key:randomUUID(),p_intent:{amount:10},p_rows:[row]};
 const r=await race(c=>rpc(c,'rpc_insert_business_transactions_once',args),c=>rpc(c,'rpc_insert_business_transactions_once',args));assert.ifError(r.error);assert.equal(r.value.is_replay,true);assert.equal(await balance(),90);
 assert.equal(Number((await o.query('SELECT count(*) n FROM financial_write_requests')).rows[0].n),1);
 await assert.rejects(rpc(b,'rpc_insert_business_transactions_once',{...args,p_intent:{amount:11}}),/idempotency_key_mismatch/);assert.equal(await balance(),90);
});
test('debt amount edit rechecks native paid floor after concurrent payment',async()=>{
 const d=(await a.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope,approval_status) VALUES($1,$2,'payable','Edit race',100,100,'IDR','business','approved') RETURNING id",[B,owner])).rows[0].id;
 const pay={p_business_id:B,p_user_id:owner,p_debt_id:d,p_wallet_id:W,p_amount:70,p_currency:'IDR',p_amount_idr:70,p_booked_rate:1,p_rate_source:'identity',p_payment_date:'2026-10-04',p_idempotency_key:'edit-race',p_request_hash:'edit-race'};
 const r=await race(c=>rpc(c,'rpc_record_debt_payment_guarded',pay),c=>c.query('UPDATE debts SET original_amount=50,amount=50 WHERE id=$1',[d]));assert.match(r.error?.message||'',/^invalid_amount:/);
 const row=(await o.query('SELECT original_amount::text total,paid_amount::text paid FROM debts WHERE id=$1',[d])).rows[0];assert.equal(Number(row.total),100);assert.equal(Number(row.paid),70);assert.equal(await balance(),30);
});
test('lock timeout/statement timeout/cancel leave no partial writer; no automatic retry',async()=>{
 await a.query('BEGIN');await a.query('SELECT fn_ledger_writer_lock()');
 await b.query("SET lock_timeout='100ms'");await assert.rejects(insert(b,'expense',1),e=>e.code==='55P03');
 await b.query("SET lock_timeout='6s';SET statement_timeout='100ms'");await assert.rejects(insert(b,'expense',1),e=>e.code==='57014');
 await b.query("SET statement_timeout='8s'");const p=pending(()=>insert(b,'expense',1));await blocked(a,b);
 await o.query('SELECT pg_cancel_backend($1)',[b.processID]);const cancelled=await p;assert.equal(cancelled.error?.code,'57014');
 await a.query('ROLLBACK');assert.equal(await balance(),100);
});
test('late failure inside payment RPC rolls back debt, ledger and idempotency',async()=>{
 const d=(await a.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope,approval_status) VALUES($1,$2,'payable','Late',10,10,'IDR','business','approved') RETURNING id",[B,owner])).rows[0].id;
 await a.query("CREATE FUNCTION test_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.paid_amount>0 THEN RAISE EXCEPTION 'late_payment_failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_fail_payment AFTER UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION test_fail_payment()");
 await assert.rejects(rpc(b,'rpc_record_debt_payment_guarded',{p_business_id:B,p_user_id:owner,p_debt_id:d,p_wallet_id:W,p_amount:10,p_currency:'IDR',p_amount_idr:10,p_booked_rate:1,p_rate_source:'identity',p_payment_date:'2026-10-04',p_idempotency_key:'late',p_request_hash:'late-hash'}),/late_payment_failure/);
 assert.equal(await balance(),100);assert.equal(Number((await o.query('SELECT paid_amount FROM debts WHERE id=$1',[d])).rows[0].paid_amount),0);
 assert.equal(Number((await o.query('SELECT count(*) n FROM debt_payment_idempotency')).rows[0].n),0);
});
test('privileged pre-lock SQL remains OUTSIDE supported protocol; controlled 40P01 is explicit',async()=>{
 await a.query('BEGIN');await a.query('SELECT id FROM wallets WHERE id=$1 FOR UPDATE',[W]);
 const pb=pending(()=>insert(b,'income',1));await blocked(a,b);const pa=await pending(()=>insert(a,'income',1));
 // PostgreSQL may choose either victim. Commit the successful A, otherwise roll
 // it back and let B finish; assert the surviving committed movement.
 await a.query(pa.error?'ROLLBACK':'COMMIT');const rb=await pb;
 assert.equal([pa,rb].filter(r=>r.error?.code==='40P01').length,1);assert.equal(await balance(),101);
});
