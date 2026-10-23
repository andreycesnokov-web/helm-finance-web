'use strict';
// Native PG only. Fresh disposable DB; inherited guard rejects known shared clusters.
// Requires a working, separately confirmed local DATABASE_URL. No embedded fallback.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createProdSchemaDatabase}=require('./_prodSchemaDb');
const {assertDisposableUrl}=require('./_disposableDbGuard');
let db,a,b,o;const root=path.resolve(__dirname,'../..');let uid=99500;
// Reuse these independent-connection tests for the alternative D4 contract.
// The environment switch selects only these two committed migration paths.
const compatibility=process.env.CFO_PAYROLL_COMPAT_TEST==='true';
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Set the confirmed disposable local DATABASE_URL explicitly');
 assertDisposableUrl(process.env.DATABASE_URL,{adminOnly:true});
 const H=require('./_d4Harness');
 db=await createProdSchemaDatabase('hf_payroll_races',compatibility?[...H.CHAIN,H.D4]:H.CHAIN);
 if(!db)throw Error('Native PostgreSQL unavailable; no concurrency proof');
 for(const name of ['a','b','o']){const c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c.connect();await c.query("SET statement_timeout='8s';SET lock_timeout='6s'");if(name==='a')a=c;if(name==='b')b=c;if(name==='o')o=c;}
 if(compatibility){
  await assert.rejects(a.query(fs.readFileSync(path.join(root,'migrations/20261020163121_payroll_runs_no_cash.sql'),'utf8')),/payroll_receipt_contract_review_required/);
  await a.query('ROLLBACK');
  assert.equal((await a.query("SELECT to_regclass('public.payroll_runs')::text r")).rows[0].r,null);
 }
 await a.query(fs.readFileSync(path.join(root,compatibility?'supabase/migrations/20261022165230_payroll_runs_receipt_contract_compat.sql':'migrations/20261020163121_payroll_runs_no_cash.sql'),'utf8'));
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

if(compatibility){
 test('D4 compatibility preserves reanchor receipts, scopes replay by actor and rejects changed payload',async()=>{
  const f=await fixture(),other=await fixture(),key=randomUUID();await act(a,f,key);
  await a.query("INSERT INTO financial_write_requests(business_id,actor_user_id,operation,request_key,intent,result) VALUES($1,$2,'wallet_reanchor','existing-reanchor','{}','{}')",[f.biz,f.actor]);
  const read=async(actor)=> (await a.query('SELECT rpc_list_own_financial_receipts($1,$2) r',[f.biz,actor])).rows[0].r;
  const receipts=await read(f.actor);assert.equal(receipts.rows.length,2);
  assert.ok(receipts.rows.some(x=>x.operation==='wallet_reanchor'));
  assert.ok(receipts.rows.some(x=>x.operation==='payroll_run'&&x.request_key===key));
  await assert.rejects(read(other.actor),/business_write_forbidden/);
  await assert.rejects(act(a,f,key,{...f.body,payment_date:'2026-08-26'}),/idempotency_key_mismatch/);
  assert.deepEqual(await count(f),{runs:1,receipts:2,audits:1,transactions:0});
 });
 test('native grants/RLS deny anonymous and authenticated direct access; RPC remains invoker',async()=>{
  const r=(await a.query("SELECT relrowsecurity,has_table_privilege('anon',oid,'SELECT') anon,has_table_privilege('authenticated',oid,'SELECT') authenticated FROM pg_class WHERE oid='public.payroll_runs'::regclass")).rows[0];
  assert.equal(r.relrowsecurity,true);assert.equal(r.anon,false);assert.equal(r.authenticated,false);
  for(const role of['anon','authenticated']){await a.query('SET ROLE '+role);try{await assert.rejects(a.query('SELECT * FROM public.payroll_runs'),/permission denied|row-level security/)}finally{await a.query('RESET ROLE')}}
  for(const fn of['rpc_payroll_run_action(uuid,bigint,text,jsonb)','rpc_list_own_financial_receipts(uuid,bigint,text,timestamptz,text,text)']){
   const p=(await a.query("SELECT prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service FROM pg_proc WHERE oid=$1::regprocedure",[fn])).rows[0];
   assert.equal(p.prosecdef,false);assert.equal(p.anon,false);assert.equal(p.authenticated,false);assert.equal(p.service,true);
  }
 });
 test('audit failure rolls back run, payment items and receipt with zero cash',async()=>{
  const f=await fixture();
  await a.query("CREATE FUNCTION public.ci_fail_payroll_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_audit_failure'; END $$;CREATE TRIGGER ci_fail_payroll_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.ci_fail_payroll_audit()");
  try{await assert.rejects(act(a,f,randomUUID()),/synthetic_audit_failure/)}finally{await a.query('DROP TRIGGER ci_fail_payroll_audit ON public.audit_events;DROP FUNCTION public.ci_fail_payroll_audit()')}
  assert.deepEqual(await count(f),{runs:0,receipts:0,audits:0,transactions:0});
  assert.equal(Number((await a.query('SELECT count(*) n FROM public.payroll_payments WHERE business_id=$1',[f.biz])).rows[0].n),0);
  const ok=await act(a,f,randomUUID());assert.equal(ok.cash_changed,false);
 });
}
