'use strict';
// Explicit single-session SQL verification. NOT native concurrency, Auth or Storage acceptance.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
let db,uid=98000;
const root=path.resolve(__dirname,'../..');
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/schema/prod_public_schema_2026-10-08.sql'),'utf8'));
 await db.exec('GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;');
 for(const file of require('./_d4Harness').CHAIN)await db.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'));
 const productionCompat=process.env.CFO_PAYROLL_PRODUCTION_COMPAT==='true';
 if(productionCompat)await db.exec(fs.readFileSync(path.join(root,'migrations',require('./_d4Harness').D4),'utf8'));
 const migration=productionCompat?'supabase/migrations/20261022165230_payroll_runs_receipt_contract_compat.sql':'migrations/20261020163121_payroll_runs_no_cash.sql';
 await db.exec(fs.readFileSync(path.join(root,migration),'utf8'));
 await db.exec('SET search_path=public,pg_catalog');
 console.log('Qualification: full-schema embedded PostgreSQL; no independent-session/HTTP/Auth/Storage proof');
});
after(async()=>{await db?.close()});
async function fixture(){
 const b=randomUUID(),w=randomUUID(),e=randomUUID(),owner=++uid;
 await db.query('INSERT INTO users(id) VALUES($1)',[owner]);
 await db.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Synthetic payroll',$2,'business')",[b,owner]);
 await db.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')",[b,owner]);
 await db.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Synthetic bank','IDR','business')",[w,b,owner]);
 await db.query("INSERT INTO payroll_employees(id,business_id,user_id,name,currency,status) VALUES($1,$2,$3,'Synthetic employee','IDR','active')",[e,b,owner]);
 const body={action:'create',period_month:'2026-08',payment_date:'2026-08-25',wallet_id:w,tax_confirmed:true,
  lines:[{employee_id:e,salary:'1000000',bonus:'100000',earnings:'50000',pph21:'10000',bpjs:'20000',other:'5000',employer_bpjs:'50000'}]};
 return {b,w,e,owner,body};
}
async function act(f,p=f.body,key=randomUUID(),actor=f.owner){return (await db.query('SELECT rpc_payroll_run_action($1,$2,$3,$4) result',[f.b,actor,key,JSON.stringify(p)])).rows[0].result}
async function counts(f){return (await db.query(`SELECT (SELECT count(*)::int FROM payroll_runs WHERE business_id=$1) runs,
 (SELECT count(*)::int FROM payroll_payments WHERE business_id=$1) payments,
 (SELECT count(*)::int FROM audit_events WHERE business_id=$1) audits,
 (SELECT count(*)::int FROM financial_write_requests WHERE business_id=$1) receipts,
 (SELECT count(*)::int FROM transactions WHERE business_id=$1) transactions`,[f.b])).rows[0]}
async function payments(id){return (await db.query('SELECT * FROM payroll_payments WHERE run_id=$1',[id])).rows}
test('atomic draft, item arithmetic, explicit zero tax, employer BPJS and replay have zero cash impact',async()=>{
 const f=await fixture(),key=randomUUID(),r=await act(f,f.body,key),p=(await payments(r.run.id))[0];
 assert.equal(p.gross_amount,'1150000');assert.equal(p.net_amount,'1115000');assert.equal(p.employer_bpjs,'50000');
 assert.equal(p.status,'draft');assert.equal(p.transaction_id,null);assert.equal(p.created_by_user_id,f.owner);
 assert.deepEqual(await counts(f),{runs:1,payments:1,audits:1,receipts:1,transactions:0});
 assert.equal((await act(f,f.body,key)).is_replay,true);
 await assert.rejects(act(f,{...f.body,payment_date:'2026-08-26'},key),/idempotency_key_mismatch/);
 const zero=await fixture();zero.body.lines[0].pph21='0';const z=await act(zero);
 assert.equal((await db.query("SELECT amount::text FROM payroll_payment_items WHERE payroll_payment_id=$1 AND item_type='pph21'",[(await payments(z.run.id))[0].id])).rows[0].amount,'0');
});
test('one invalid employee rolls back the whole run, not a partial monthly payout',async()=>{
 const f=await fixture();f.body.lines.push({...f.body.lines[0],employee_id:randomUUID()});
 await assert.rejects(act(f),/payroll_employee_required/);
 assert.deepEqual(await counts(f),{runs:0,payments:0,audits:0,receipts:0,transactions:0});
});
test('duplicate employee/month and invalid deductions are refused',async()=>{
 const f=await fixture();await act(f);await assert.rejects(act(f),/payroll_employee_period_exists/);
 const g=await fixture();g.body.lines[0].pph21='2000000';await assert.rejects(act(g),/payroll_invalid_net/);
 assert.equal((await counts(g)).runs,0);
});
test('draft correction uses version checks and retains before/after line values in audit',async()=>{
 const f=await fixture(),r=await act(f);const edit={...f.body,action:'edit',run_id:r.run.id,version:1};edit.lines=[{...edit.lines[0],bonus:'200000'}];
 const next=await act(f,edit);assert.equal(next.run.version,2);assert.equal((await payments(r.run.id))[0].net_amount,'1215000');
 await assert.rejects(act(f,{action:'approve',run_id:r.run.id,version:1}),/payroll_stale_review/);
 const audit=(await db.query("SELECT before_json,after_json FROM audit_events WHERE entity_id=$1 AND action='payroll_edit'",[r.run.id])).rows[0];
 assert.equal(audit.before_json.payments[0].net_amount,1115000);assert.equal(audit.after_json.payments[0].net_amount,1215000);
});
test('approval does not create cash; cancel permits a replacement run but approved edits fail',async()=>{
 const f=await fixture(),r=await act(f);const approved=await act(f,{action:'approve',run_id:r.run.id,version:1});
 assert.equal(approved.run.status,'scheduled');assert.equal((await payments(r.run.id))[0].status,'scheduled');
 await assert.rejects(act(f,{...f.body,action:'edit',run_id:r.run.id,version:2}),/payroll_draft_required/);
 await act(f,{action:'cancel',run_id:r.run.id,version:2});await act(f);
 assert.equal((await counts(f)).transactions,0);
});
test('current membership, company isolation and anonymous grants fail closed',async()=>{
 const f=await fixture(),g=await fixture();f.body.wallet_id=g.w;await assert.rejects(act(f),/payroll_wallet_required/);f.body.wallet_id=f.w;
 f.body.lines[0].employee_id=g.e;await assert.rejects(act(f),/payroll_employee_required/);f.body.lines[0].employee_id=f.e;
 const r=await act(f);await db.query("UPDATE business_members SET status='removed' WHERE business_id=$1 AND user_id=$2",[f.b,f.owner]);
 await assert.rejects(act(f,{action:'approve',run_id:r.run.id,version:1}),/payroll_forbidden/);
 const grants=(await db.query("SELECT has_table_privilege('anon','public.payroll_runs','SELECT') t, has_function_privilege('anon','public.rpc_payroll_run_action(uuid,bigint,text,jsonb)','EXECUTE') f")).rows[0];
 assert.equal(grants.t,false);assert.equal(grants.f,false);
 await db.exec('SET ROLE anon');try{await assert.rejects(db.query('SELECT * FROM payroll_runs'),/permission denied|row-level security/);await assert.rejects(act(g),/permission denied/)}finally{await db.exec('RESET ROLE')}
});
test('only confirmed existing bank debits can reconcile; exact amount/account and unique allocation are enforced without cash writes',async()=>{
 const f=await fixture(),r=await act(f);await act(f,{action:'approve',run_id:r.run.id,version:1});const p=(await payments(r.run.id))[0];
 await db.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,$2,'income',2000000,2000000,'IDR',$3,'business','2026-08-01')",[f.b,f.owner,f.w]);
 const tx=(await db.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,$2,'expense',1115000,1115000,'IDR',$3,'business','2026-08-26') RETURNING id",[f.b,f.owner,f.w])).rows[0].id;
 const link={action:'link',run_id:r.run.id,version:2,payment_id:p.id,transaction_id:String(tx)};
 await assert.rejects(act(f,link),/payroll_bank_evidence_required/);
 const batch=randomUUID();await db.query("INSERT INTO bank_import_batches(id,business_id,wallet_id,status) VALUES($1,$2,$3,'confirmed')",[batch,f.b,f.w]);
 await db.query("INSERT INTO bank_import_rows(batch_id,business_id,row_index,tx_date,amount,direction,review_status,linked_transaction_id) VALUES($1,$2,1,'2026-08-26',1115000,'out','imported',$3)",[batch,f.b,tx]);
 const balance=(await db.query('SELECT fn_wallet_ledger_balance($1)::text n',[f.w])).rows[0].n;
 const before=(await db.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) j FROM transactions t WHERE business_id=$1',[f.b])).rows[0].j;
 const key=randomUUID(),done=await act(f,link,key);assert.equal(done.run.status,'paid');assert.equal(done.cash_changed,false);
 assert.equal((await act(f,link,key)).is_replay,true);assert.equal(new Date((await payments(r.run.id))[0].payment_date).toISOString().slice(0,10),'2026-08-26');
 assert.equal((await db.query('SELECT fn_wallet_ledger_balance($1)::text n',[f.w])).rows[0].n,balance);
 assert.deepEqual((await db.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) j FROM transactions t WHERE business_id=$1',[f.b])).rows[0].j,before);
 await assert.rejects(act(f,{action:'cancel',run_id:r.run.id,version:3}),/payroll_paid_history_locked/);
 await assert.rejects(db.query('UPDATE transactions SET amount_original=amount_original+1 WHERE id=$1',[tx]),/payroll_paid_history_locked/);
 await assert.rejects(db.query('DELETE FROM transactions WHERE id=$1',[tx]),/payroll_paid_history_locked/);
 f.body.period_month='2026-09';const second=await act(f);await act(f,{action:'approve',run_id:second.run.id,version:1});
 await assert.rejects(act(f,{...link,run_id:second.run.id,payment_id:(await payments(second.run.id))[0].id}),/payroll_transaction_already_allocated/);
 const receipts=(await db.query("SELECT rpc_list_own_financial_receipts($1,$2,'payroll_run') r",[f.b,f.owner])).rows[0].r;
 assert.equal(receipts.rows.length,5);
});
test('audit failure rolls back run, lines, receipt and all cash effects',async()=>{
 const f=await fixture();
 await db.exec("CREATE FUNCTION test_payroll_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='payroll_run' THEN RAISE EXCEPTION 'synthetic_audit_failure';END IF;RETURN NEW;END $$; CREATE TRIGGER test_payroll_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_payroll_audit_failure();");
 try{await assert.rejects(act(f),/synthetic_audit_failure/);assert.deepEqual(await counts(f),{runs:0,payments:0,audits:0,receipts:0,transactions:0})}
 finally{await db.exec('DROP TRIGGER test_payroll_audit ON audit_events;DROP FUNCTION test_payroll_audit_failure()')}
});
test('employee CRUD is company-scoped, validates bank account and preserves audit/stale edit protection',async()=>{
 const f=await fixture(),g=await fixture();
 const employee=async(action,id,patch)=> (await db.query('SELECT rpc_payroll_employee_action($1,$2,$3,$4,$5) r',[f.b,f.owner,action,id,JSON.stringify(patch)])).rows[0].r;
 await assert.rejects(employee('create',null,{name:'Synthetic new employee',default_wallet_id:g.w}),/payroll_wallet_required/);
 const r=await employee('create',null,{name:'Synthetic new employee',default_salary:1000,pay_day:25,default_wallet_id:f.w});
 assert.ok(r.audit_id);assert.equal(r.employee.business_id,f.b);assert.equal(r.employee.created_by_user_id,f.owner);
 const next=await employee('update',r.employee.id,{name:'Renamed employee',expected_updated_at:r.employee.updated_at});
 await assert.rejects(employee('update',r.employee.id,{name:'Stale employee',expected_updated_at:r.employee.updated_at}),/payroll_stale_review/);
 await assert.rejects(employee('update',g.e,{name:'Other company'}),/payroll_employee_required/);
 assert.equal((await employee('archive',r.employee.id,{expected_updated_at:next.employee.updated_at})).employee.status,'archived');
 assert.equal((await counts(f)).transactions,0);
});
test('CFO actor attribution stays separate from owner and private receipts are hidden after role downgrade',async()=>{
 const f=await fixture(),actor=++uid,key=randomUUID();
 await db.query('INSERT INTO users(id) VALUES($1)',[actor]);
 await db.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'cfo','active')",[f.b,actor]);
 const saved=await act(f,f.body,key,actor),p=(await payments(saved.run.id))[0];
 assert.equal(p.user_id,f.owner);assert.equal(p.created_by_user_id,actor);assert.equal(saved.run.created_by_user_id,actor);
 const audit=(await db.query('SELECT actor_user_id,actor_role FROM audit_events WHERE id=$1',[saved.audit_id])).rows[0];
 assert.equal(audit.actor_user_id,actor);assert.equal(audit.actor_role,'cfo');
 const own=(await db.query("SELECT rpc_list_own_financial_receipts($1,$2,'payroll_run') r",[f.b,actor])).rows[0].r;
 const owners=(await db.query("SELECT rpc_list_own_financial_receipts($1,$2,'payroll_run') r",[f.b,f.owner])).rows[0].r;
 assert.equal(own.rows.length,1);assert.equal(owners.rows.length,0);
 for(const role of ['accountant','auditor','manager','employee']){
  await db.query('UPDATE business_members SET role=$1 WHERE business_id=$2 AND user_id=$3',[role,f.b,actor]);
  await assert.rejects(act(f,f.body,key,actor),/payroll_forbidden/);
  await assert.rejects(db.query("SELECT rpc_list_own_financial_receipts($1,$2,'payroll_run') r",[f.b,actor]),/business_write_forbidden/);
 }
 assert.equal((await counts(f)).transactions,0);
});
