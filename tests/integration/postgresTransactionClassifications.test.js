'use strict';
// Native PG only. Fresh disposable DB; inherited guard rejects known shared clusters.
// Business purpose / accountant review marks (20261024150000) on the production-schema baseline: one row per
// operation of the SAME company, review pair, closed to anon/authenticated, never touches the ledger; rollback.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createProdSchemaDatabase}=require('./_prodSchemaDb');
const {assertDisposableUrl}=require('./_disposableDbGuard');
let db,c;const root=path.resolve(__dirname,'../..');let uid=99900;
const sql=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
const FORWARD='20261024150000_transaction_classifications.sql',DOWN='20261024150000_transaction_classifications_down.sql';
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Set the confirmed disposable local DATABASE_URL explicitly');
 assertDisposableUrl(process.env.DATABASE_URL,{adminOnly:true});
 const H=require('./_d4Harness');
 db=await createProdSchemaDatabase('hf_tx_classifications',[...H.CHAIN,H.D4]);
 if(!db)throw Error('Native PostgreSQL unavailable; no classification proof');
 c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c.connect();
 await c.query("SET statement_timeout='8s';SET lock_timeout='6s'");
 await c.query(sql(FORWARD));
});
after(async()=>{await c?.query('ROLLBACK').catch(()=>{});await c?.end();if(db)await db.drop()});
async function company(){const b=randomUUID(),u=++uid,w=randomUUID();
 await c.query('INSERT INTO users(id) VALUES($1)',[u]);
 await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Synthetic company',$2,'business')",[b,u]);
 await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Synthetic bank','IDR','business')",[w,b,u]);
 // Money in first (the balance guard refuses an account going negative), then the expense to classify.
 await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description) VALUES($1,$2,'income',5000000,5000000,'IDR',$3,'business','2026-10-01','Synthetic owner deposit')",[b,u,w]);
 const t=(await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,category,description) VALUES($1,$2,'expense',1300000,1300000,'IDR',$3,'business','2026-10-05','Office expenses','Synthetic purchase') RETURNING id",[b,u,w])).rows[0].id;
 return {b,u,w,t}}
const ledger=async(b)=>(await c.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) h FROM transactions t WHERE business_id=$1",[b])).rows[0].h;
const mark=(t,b,purpose,extra={})=>c.query('INSERT INTO transaction_classifications(transaction_id,business_id,business_purpose,accountant_reviewed_at,accountant_reviewed_by,accountant_reviewed_role,note) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [t,b,purpose,extra.at||null,extra.by||null,extra.role||null,extra.note||null]);

test('a mark belongs to the operation\'s own company and never changes the ledger',async()=>{
 const A=await company(),B=await company(),h0=await ledger(A.b);
 await mark(A.t,A.b,'personal',{note:'owner purchase'});
 assert.equal(await ledger(A.b),h0,'no ledger row, amount or balance changes');
 await assert.rejects(mark(B.t,A.b,'personal'),/transaction_classification_business_mismatch/);
 await assert.rejects(c.query('UPDATE transaction_classifications SET business_id=$2 WHERE transaction_id=$1',[A.t,B.b]),/transaction_classification_business_mismatch/);
 await assert.rejects(mark(A.t,A.b,'operating'),/duplicate key/,'one row per operation');
});
test('purpose values, review pair and note length are enforced',async()=>{
 const A=await company();
 await assert.rejects(mark(A.t,A.b,'deductible'),/check constraint/);
 await assert.rejects(mark(A.t,A.b,null,{at:new Date().toISOString()}),/review_pair_chk/);
 await assert.rejects(mark(A.t,A.b,null,{at:new Date().toISOString(),by:A.u}),/review_pair_chk/,'a review needs the reviewer role');
 await assert.rejects(mark(A.t,A.b,null,{at:new Date().toISOString(),by:A.u,role:'manager'}),/check constraint/,'only reviewing roles');
 await assert.rejects(mark(A.t,A.b,null,{note:'x'.repeat(501)}),/check constraint/);
 await mark(A.t,A.b,null,{at:new Date().toISOString(),by:A.u,role:'owner'});
 assert.equal((await c.query('SELECT business_purpose FROM transaction_classifications WHERE transaction_id=$1',[A.t])).rows[0].business_purpose,null,'NULL purpose = category decides');
});
test('only service_role may read or write; anon and authenticated get nothing; RLS on',async()=>{
 for(const role of ['anon','authenticated']){
  const r=(await c.query("SELECT has_table_privilege($1,'public.transaction_classifications','SELECT') s,has_table_privilege($1,'public.transaction_classifications','INSERT') i",[role])).rows[0];
  assert.deepEqual([r.s,r.i],[false,false],role);
 }
 assert.equal((await c.query("SELECT has_table_privilege('service_role','public.transaction_classifications','INSERT') i")).rows[0].i,true);
 assert.equal((await c.query("SELECT relrowsecurity r FROM pg_class WHERE oid='public.transaction_classifications'::regclass")).rows[0].r,true);
});
test('rollback drops only the marks (operations untouched) and the migration is re-appliable',async()=>{
 const A=await company();await mark(A.t,A.b,'capital');const h0=await ledger(A.b);
 await assert.rejects(c.query(sql(FORWARD)),/already_installed/);await c.query('ROLLBACK');
 await c.query(sql(DOWN));
 assert.equal((await c.query("SELECT to_regclass('public.transaction_classifications')::text r")).rows[0].r,null);
 assert.equal(await ledger(A.b),h0,'rollback touches no operation');
 await c.query(sql(FORWARD));
 assert.notEqual((await c.query("SELECT to_regclass('public.transaction_classifications')::text r")).rows[0].r,null);
});
