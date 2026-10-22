'use strict';
// Native PG only. Fresh disposable DB; inherited guard rejects known shared clusters.
// Requires a working, separately confirmed local DATABASE_URL. No embedded fallback.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createProdSchemaDatabase}=require('./_prodSchemaDb');
const {assertDisposableUrl}=require('./_disposableDbGuard');
let db,a,b,o;const root=path.resolve(__dirname,'../..');let uid=99500;
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Set the confirmed disposable local DATABASE_URL explicitly');
 assertDisposableUrl(process.env.DATABASE_URL,{adminOnly:true});
 db=await createProdSchemaDatabase('hf_payroll_races',require('./_d4Harness').CHAIN);
 if(!db)throw Error('Native PostgreSQL unavailable; no concurrency proof');
 for(const name of ['a','b','o']){const c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c.connect();await c.query("SET statement_timeout='8s';SET lock_timeout='6s'");if(name==='a')a=c;if(name==='b')b=c;if(name==='o')o=c;}
 await a.query(fs.readFileSync(path.join(root,'migrations/20261020163121_payroll_runs_no_cash.sql'),'utf8'));
});
after(async()=>{for(const c of[a,b,o]){await c?.query('ROLLBACK').catch(()=>{});await c?.end()}if(db)await db.drop()});
async function fixture(){const f={biz:randomUUID(),wallet:randomUUID(),employee:randomUUID(),actor:++uid};
 await a.query('INSERT INTO users(id) VALUES($1)',[f.actor]);
 await a.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Native synthetic payroll',$2,'business')",[f.biz,f.actor]);
 await a.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')",[f.biz,f.actor]);
 await a.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Synthetic bank','IDR','business')",[f.wallet,f.biz,f.actor]);
 await a.query("INSERT INTO payroll_employees(id,business_id,user_id,name,currency,status) VALUES($1,$2,$3,'Synthetic employee','IDR','active')",[f.employee,f.biz,f.actor]);
 f.body={action:'create',period_month:'2026-08',payment_date:'2026-08-25',wallet_id:f.wallet,tax_confirmed:true,lines:[{employee_id:f.employee,salary:'1000000',bonus:'0',earnings:'0',pph21:'0',bpjs:'0',other:'0',employer_bpjs:'50000'}]};return f}
async function act(c,f,key,p=f.body){return(await c.query('SELECT rpc_payroll_run_action($1,$2,$3,$4) r',[f.biz,f.actor,key,JSON.stringify(p)])).rows[0].r}
async function barrier(){const deadline=Date.now()+4000;while(Date.now()<deadline){if((await o.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) waiting',[a.processID,b.processID])).rows[0].waiting)return;await new Promise(r=>setImmediate(r))}throw Error('Lock barrier was not observed')}
async function count(f){return(await o.query("SELECT (SELECT count(*)::int FROM payroll_runs WHERE business_id=$1) runs,(SELECT count(*)::int FROM financial_write_requests WHERE business_id=$1) receipts,(SELECT count(*)::int FROM audit_events WHERE business_id=$1) audits,(SELECT count(*)::int FROM transactions WHERE business_id=$1) transactions",[f.biz])).rows[0]}
test('two independent submissions of one key produce one run/audit/receipt and zero cash',async()=>{
 const f=await fixture(),key=randomUUID();await a.query('BEGIN');const first=await act(a,f,key);
 const next=act(b,f,key).then(value=>({value}),error=>({error}));await barrier();await a.query('COMMIT');const result=await next;
 assert.ifError(result.error);assert.equal(result.value.is_replay,true);assert.equal(result.value.run.id,first.run.id);
 assert.deepEqual(await count(f),{runs:1,receipts:1,audits:1,transactions:0});
});
test('different keys cannot concurrently duplicate a monthly employee accrual',async()=>{
 const f=await fixture();await a.query('BEGIN');await act(a,f,randomUUID());
 const next=act(b,f,randomUUID()).then(value=>({value}),error=>({error}));await barrier();await a.query('COMMIT');const result=await next;
 assert.match(result.error?.message||'',/payroll_employee_period_exists/);assert.deepEqual(await count(f),{runs:1,receipts:1,audits:1,transactions:0});
});
test('membership removal participates in the retained writer order and blocks a later action',async()=>{
 const f=await fixture(),run=(await act(a,f,randomUUID())).run;await a.query('BEGIN');await act(a,f,randomUUID(),{action:'approve',run_id:run.id,version:1});
 const revoke=b.query("UPDATE business_members SET status='removed' WHERE business_id=$1 AND user_id=$2",[f.biz,f.actor]).then(value=>({value}),error=>({error}));
 await barrier();await a.query('COMMIT');assert.ifError((await revoke).error);
 await assert.rejects(act(b,f,randomUUID(),{action:'cancel',run_id:run.id,version:2}),/payroll_forbidden/);
 assert.equal((await count(f)).transactions,0);
});
