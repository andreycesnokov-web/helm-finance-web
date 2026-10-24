'use strict';
// Native PG only. Fresh disposable DB; inherited guard rejects known shared clusters.
// AC-0 (24 Oct 2026) on the production-schema baseline + writer chain: I-7 grants, I-5 edit/reset audit and append-only
// receipts, I-6 atomic idempotent funding creation, I-12 payments with non-cash settlement + read-only reconciliation,
// I-11 account-of-the-same-company and known-type constraints; every migration rolls back and re-applies.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createProdSchemaDatabase}=require('./_prodSchemaDb');
const {assertDisposableUrl}=require('./_disposableDbGuard');
let db,c,c2;const root=path.resolve(__dirname,'../..');let uid=99700;
const sql=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
const AC0=['20261025090000_public_role_least_privilege','20261025091000_transaction_change_audit','20261025092000_atomic_funding_creation',
  '20261025093000_debt_settlement_integrity','20261025094000_transaction_integrity_constraints'];
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Set the confirmed disposable local DATABASE_URL explicitly');
 assertDisposableUrl(process.env.DATABASE_URL,{adminOnly:true});
 const H=require('./_d4Harness');
 db=await createProdSchemaDatabase('hf_ac0_integrity',[...H.CHAIN,H.D4]);
 if(!db)throw Error('Native PostgreSQL unavailable; no AC-0 proof');
 c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c.connect();
 c2=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c2.connect();
 for(const x of [c,c2])await x.query("SET statement_timeout='10s';SET lock_timeout='8s'");
 preAcl=await aclPrint();
 for(const m of AC0)await c.query(sql(m+'.sql'));
});
let preAcl;
// Privilege fingerprint of the public roles and service_role over the objects that existed before AC-0.
const aclPrint=async()=>(await c.query(`WITH o AS (
  SELECT format('%I.%I', n.nspname, k.relname) obj, k.relacl acl FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public' AND k.relkind IN ('r','v','m','p','S')
  UNION ALL SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), coalesce(p.proacl, acldefault('f', p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 ), g AS (SELECT obj, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END who, a.privilege_type priv FROM o, aclexplode(o.acl) a)
 SELECT who, md5(string_agg(obj||':'||priv, '|' ORDER BY obj, priv)) h FROM g WHERE who IN ('PUBLIC','anon','authenticated') GROUP BY who ORDER BY who`)).rows;
after(async()=>{for(const x of [c,c2]){await x?.query('ROLLBACK').catch(()=>{});await x?.end().catch(()=>{});}if(db)await db.drop()});

async function company(role='owner'){const b=randomUUID(),u=++uid,w=randomUUID(),w2=randomUUID();
 await c.query('INSERT INTO users(id) VALUES($1)',[u]);
 await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Synthetic company',$2,'business')",[b,u]);
 await c.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,$3,'active')",[b,u,role]);
 for(const [id,n] of [[w,'Synthetic bank'],[w2,'Synthetic second bank']])
  await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,$4,'IDR','business')",[id,b,u,n]);
 for(const id of [w,w2])await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description) VALUES($1,$2,'income',50000000,50000000,'IDR',$3,'business','2026-10-01','Synthetic owner deposit')",[b,u,id]);
 const t=(await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,category,description) VALUES($1,$2,'expense',1300000,1300000,'IDR',$3,'business','2026-10-05','Office expenses','Synthetic purchase') RETURNING id",[b,u,w])).rows[0].id;
 return {b,u,w,w2,t}}
const ver=async(t)=>(await c.query('SELECT balance_version v FROM transactions WHERE id=$1',[t])).rows[0].v;
const row=async(t)=>(await c.query('SELECT to_jsonb(t) j FROM transactions t WHERE id=$1',[t])).rows[0].j;
const audits=async(b,action)=>(await c.query('SELECT * FROM audit_events WHERE business_id=$1 AND action LIKE $2 ORDER BY created_at',[b,action])).rows;
const ledger=async(b)=>(await c.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) h FROM transactions t WHERE business_id=$1",[b])).rows[0].h;
const patch=(x,A,t,v,u,fin=false,req=null,who=A.u)=>x.query('SELECT rpc_patch_business_transaction($1,$2,$3,$4,$5,$6,$7,$8) r',[A.b,who,t,v,JSON.stringify(u),fin,req,'web']);
// Audit failure on demand: a test-only trigger that refuses the named audit action.
async function failAudit(action,fn){
 await c.query(`CREATE OR REPLACE FUNCTION _test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action LIKE '${action}' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END$$`);
 await c.query('CREATE TRIGGER _test_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION _test_fail_audit()');
 try{return await fn()}finally{await c.query('DROP TRIGGER _test_fail_audit ON audit_events');await c.query('DROP FUNCTION _test_fail_audit()');}
}

// ── I-7 ──────────────────────────────────────────────────────────────────────
test('I-7: anon and authenticated hold nothing in schema public; service_role keeps its access',async()=>{
 const r=(await c.query(`SELECT
   (SELECT count(*) FROM pg_class k, unnest(ARRAY['anon','authenticated']) r(role) WHERE k.relnamespace='public'::regnamespace AND k.relkind IN ('r','v','m','p')
      AND has_table_privilege(r.role,k.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) tables,
   (SELECT count(*) FROM pg_proc p, unnest(ARRAY['anon','authenticated']) r(role) WHERE p.pronamespace='public'::regnamespace AND has_function_privilege(r.role,p.oid,'EXECUTE')) functions,
   has_function_privilege('service_role','public.rpc_reset_business_financial(uuid,bigint)','EXECUTE') svc_reset,
   has_function_privilege('service_role','public.rpc_create_business_funding(uuid,bigint,text,jsonb,jsonb,text)','EXECUTE') svc_funding,
   has_table_privilege('service_role','public.transactions','SELECT,INSERT,UPDATE,DELETE') svc_tx`)).rows[0];
 assert.deepEqual([Number(r.tables),Number(r.functions),r.svc_reset,r.svc_funding,r.svc_tx],[0,0,true,true,true]);
});

// ── I-5 ──────────────────────────────────────────────────────────────────────
test('I-5: amount, date, account and category change → one audit row with before/after, actor, role, request id',async()=>{
 const A=await company(),v=await ver(A.t);
 await patch(c,A,A.t,v,{amount_original:1400000,amount_idr:1400000,transaction_date:'2026-10-06',wallet_id:A.w2,category:'Rent'},true,'req-ac0-1');
 const [a]=await audits(A.b,'transaction_%');
 assert.equal(a.action,'transaction_financial_update');assert.equal(a.entity_id,String(A.t));
 assert.equal(String(a.actor_user_id),String(A.u));assert.equal(a.actor_role,'owner');assert.equal(a.request_id,'req-ac0-1');assert.equal(a.channel,'web');
 assert.deepEqual(Object.keys(a.after_json.fields).sort(),['amount_idr','amount_original','category','transaction_date','wallet_id']);
 assert.equal(Number(a.before_json.fields.amount_original),1300000);assert.equal(Number(a.after_json.fields.amount_original),1400000);
 assert.equal(a.before_json.fields.wallet_id,A.w);assert.equal(a.after_json.fields.wallet_id,A.w2);
 assert.equal(a.before_json.fields.category,'Office expenses');assert.equal(a.after_json.fields.category,'Rent');
 assert.ok(!JSON.stringify(a).match(/token|password|secret/i),'no secrets in the audit row');
});
test('I-5: a classification-only change is audited as transaction_update; an unchanged save writes nothing',async()=>{
 const A=await company();
 await patch(c,A,A.t,await ver(A.t),{category:'Software'});
 assert.equal((await audits(A.b,'transaction_update')).length,1);
 await patch(c,A,A.t,await ver(A.t),{category:'Software'});
 assert.equal((await audits(A.b,'transaction_%')).length,1,'no audit row for a no-op');
});
test('I-5: a currency change to a currency the account does not hold is refused; nothing changes, nothing audited',async()=>{
 const A=await company(),before=await row(A.t);
 await assert.rejects(patch(c,A,A.t,await ver(A.t),{currency_original:'USD'},true),/currency_mismatch/);
 assert.deepEqual(await row(A.t),before);assert.equal((await audits(A.b,'transaction_%')).length,0);
});
test('I-5: an outsider and another company cannot modify the operation',async()=>{
 const A=await company(),B=await company(),before=await row(A.t);
 await assert.rejects(patch(c,A,A.t,await ver(A.t),{category:'Hack'},false,null,B.u),/./,'non-member actor');
 await assert.rejects(patch(c,B,A.t,await ver(A.t),{category:'Hack'}),/transaction_not_found/,'other company id');
 assert.deepEqual(await row(A.t),before);assert.equal((await audits(A.b,'transaction_%')).length,0);
});
test('I-5: when the audit row cannot be written, the edit fails and the operation is unchanged',async()=>{
 const A=await company(),before=await row(A.t);
 await failAudit('transaction_%',()=>assert.rejects(patch(c,A,A.t,before.balance_version,{amount_original:999,amount_idr:999},true),/synthetic_audit_failure/));
 assert.deepEqual(await row(A.t),before);
});
test('I-5: two concurrent edits from the same version — one wins, the other gets a version conflict',async()=>{
 const A=await company(),v=await ver(A.t);
 await c.query('BEGIN');await patch(c,A,A.t,v,{category:'First'});
 const second=patch(c2,A,A.t,v,{category:'Second'});
 await new Promise(r=>setTimeout(r,300));await c.query('COMMIT');
 await assert.rejects(second,/transaction_version_conflict/);
 assert.equal((await row(A.t)).category,'First');assert.equal((await audits(A.b,'transaction_%')).length,1);
});
test('I-5: the company reset is audited inside its atomic block; an audit failure keeps every row',async()=>{
 const A=await company(),h=await ledger(A.b);
 const failed=await failAudit('financial_data_reset',async()=>(await c.query('SELECT rpc_reset_business_financial($1,$2) r',[A.b,A.u])).rows[0].r);
 assert.equal(failed.ok,false);assert.equal(await ledger(A.b),h,'nothing deleted');
 const ok=(await c.query('SELECT rpc_reset_business_financial($1,$2) r',[A.b,A.u])).rows[0].r;
 assert.equal(ok.ok,true);const [a]=await audits(A.b,'financial_data_reset');
 assert.equal(a.actor_role,'owner');assert.equal(Number(a.after_json.deleted.transactions),3);
});
test('I-5: write receipts are append-only',async()=>{
 const A=await company();
 await c.query("INSERT INTO financial_write_requests(business_id,actor_user_id,operation,request_key,intent,result) VALUES($1,$2,'transaction_batch','rk-1','{}','{}')",[A.b,A.u]);
 await assert.rejects(c.query("UPDATE financial_write_requests SET result='{\"x\":1}' WHERE business_id=$1",[A.b]),/append_only/);
 await assert.rejects(c.query('DELETE FROM financial_write_requests WHERE business_id=$1',[A.b]),/append_only/);
});

// ── I-6 ──────────────────────────────────────────────────────────────────────
const fundRec=(rx=null,extra={})=>({source_kind:'bank',instrument:'loan',lender_name:'Synthetic bank',amount:100000000,currency:'IDR',received_on:'2026-10-02',received_transaction_id:rx,interest_rate_annual:10,...extra});
const fund=(x,A,key,rec,sched=[],who=A.u)=>x.query('SELECT rpc_create_business_funding($1,$2,$3,$4,$5,$6) r',[A.b,who,key,JSON.stringify(rec),JSON.stringify(sched),'web']);
const incomeOf=async(A,amount=100000000)=>(await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description) VALUES($1,$2,'income',$3,$3,'IDR',$4,'business','2026-10-02','Synthetic loan received') RETURNING id",[A.b,A.u,amount,A.w])).rows[0].id;
const fundingRows=async(b)=>(await c.query('SELECT (SELECT count(*) FROM business_funding_records WHERE business_id=$1)::int r,(SELECT count(*) FROM business_funding_repayments WHERE business_id=$1)::int s,(SELECT count(*) FROM audit_events WHERE business_id=$1 AND action=$2)::int a',[b,'funding_recorded'])).rows[0];
test('I-6: record + schedule + audit + receipt in one call; the same key replays; other content under the key is refused',async()=>{
 const A=await company(),rx=await incomeOf(A),h=await ledger(A.b);
 const sched=[{due_on:'2026-11-02',principal:10000000,interest:833333},{due_on:'2026-12-02',principal:10000000,interest:750000}];
 const r1=(await fund(c,A,'k-1',fundRec(rx),sched)).rows[0].r;
 assert.equal(r1.replayed,false);assert.equal(r1.repayments.length,2);
 const r2=(await fund(c,A,'k-1',fundRec(rx),sched)).rows[0].r;
 assert.equal(r2.replayed,true);assert.equal(r2.record.id,r1.record.id);
 await assert.rejects(fund(c,A,'k-1',fundRec(rx,{amount:90000000}),sched),/idempotency_key_reused/);
 assert.deepEqual(await fundingRows(A.b),{r:1,s:2,a:1});assert.equal(await ledger(A.b),h,'funding never moves cash or writes revenue');
});
test('I-6: an invalid schedule writes nothing (all-or-nothing)',async()=>{
 const A=await company();
 await assert.rejects(fund(c,A,'k-x',fundRec(null),[{due_on:'2026-11-02',principal:200000000,interest:0}]),/schedule_exceeds_loan/);
 await assert.rejects(fund(c,A,'k-y',fundRec(null),[{due_on:'2026-11-02',principal:1000000,interest:0},{due_on:'2026-12-02',principal:0,interest:0}]),/check/,'a zero instalment violates the table check');
 await assert.rejects(fund(c,A,'k-z',fundRec(null,{instrument:'equity',interest_rate_annual:null}),[{due_on:'2026-11-02',principal:1,interest:0}]),/equity_has_no_repayments/);
 assert.deepEqual(await fundingRows(A.b),{r:0,s:0,a:0});
});
test('I-6: a received payment backs one record only; it must be this company\'s income; roles enforced',async()=>{
 const A=await company(),B=await company(),M=await company('manager'),rx=await incomeOf(A),expense=A.t,foreign=await incomeOf(B);
 await fund(c,A,'k-a',fundRec(rx));
 await assert.rejects(fund(c,A,'k-b',fundRec(rx)),/transaction_already_linked_to_funding/);
 await assert.rejects(fund(c,A,'k-c',fundRec(expense)),/transaction_not_found_in_this_business/,'an expense is not money received');
 await assert.rejects(fund(c,A,'k-d',fundRec(foreign)),/transaction_not_found_in_this_business/,'other company');
 await assert.rejects(fund(c,M,'k-e',fundRec(null)),/funding_forbidden/);
 await assert.rejects(fund(c,A,'k-f',fundRec(null),[],B.u),/funding_forbidden/,'outsider');
 assert.equal((await fundingRows(A.b)).r,1);
});
test('I-6: concurrent submissions of the same key and of two keys for one payment create one record',async()=>{
 const A=await company(),rx=await incomeOf(A);
 const res=await Promise.allSettled([fund(c,A,'k-same',fundRec(rx)),fund(c2,A,'k-same',fundRec(rx))]);
 assert.equal(res.filter(x=>x.status==='fulfilled').length,2,'the second is a replay');
 const rx2=await incomeOf(A);
 const res2=await Promise.allSettled([fund(c,A,'k-p',fundRec(rx2)),fund(c2,A,'k-q',fundRec(rx2))]);
 assert.equal(res2.filter(x=>x.status==='fulfilled').length,1);assert.match(String(res2.find(x=>x.status==='rejected').reason),/already_linked|duplicate key/);
 assert.equal((await fundingRows(A.b)).r,2);
});

// ── I-11 ─────────────────────────────────────────────────────────────────────
test('I-11: a missing or other company\'s account and an unknown type are refused; a legacy row without account is kept',async()=>{
 const A=await company(),B=await company();
 const ins=(w,type='income',b=A.b)=>c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description) VALUES($1,$2,$3,1000,1000,'IDR',$4,'business','2026-10-03','Synthetic')",[b,A.u,type,w]);
 // Business companies were already covered on insert/update by fn_business_balance_guard; the key is refused first
 // by whichever runs first. Personal workspaces were not (the guard returns early for them) — only the key holds there.
 await assert.rejects(ins(randomUUID()),/transactions_wallet_same_business_fkey|wallet_not_found/);
 await assert.rejects(ins(B.w),/transactions_wallet_same_business_fkey|wallet_not_found/);
 const P=randomUUID(),pw=randomUUID();
 await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Synthetic personal',$2,'personal')",[P,A.u]);
 await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Synthetic wallet','IDR','personal')",[pw,P,A.u]);
 await assert.rejects(ins(A.w,'income',P),/transactions_wallet_same_business_fkey/,'personal row on a company account');
 await assert.rejects(ins(randomUUID(),'income',P),/transactions_wallet_same_business_fkey/,'personal row on a missing account');
 await ins(pw,'income',P);
 await assert.rejects(ins(A.w,'topup'),/transactions_type_known/);
 await ins(null);await ins(A.w,'correction');
 await assert.rejects(c.query('UPDATE wallets SET business_id=$2 WHERE id=$1',[A.w,B.b]),/./,'an account with operations cannot move to another company');
});

// ── I-12 ─────────────────────────────────────────────────────────────────────
async function bill(A,amount=11100000,type='receivable'){
 return (await c.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,status,approval_status,paid_amount) VALUES($1,$2,$3,'Synthetic client',$4,$4,'IDR','open','approved',0) RETURNING id",[A.b,A.u,type,amount])).rows[0].id;}
async function withhold(A,d,amount=200000){
 const w=(await c.query("INSERT INTO withholding_records(business_id,debt_id,tax_type,withholding_amount,status) VALUES($1,$2,'pph23',$3,'reported') RETURNING id",[A.b,d,amount])).rows[0].id;
 await c.query("INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,withholding_record_id,allocated_amount) VALUES($1,$2,'withholding_record',$3,$4)",[A.b,d,w,amount]);}
const pay=(A,d,amount,key)=>c.query("SELECT rpc_record_debt_payment($1,$2,$3,$4,$5,'IDR',$5,1,'base_currency','2026-10-10',$6,$7) r",[A.b,A.u,d,A.w,amount,key,'h-'+key+'-'+amount]);
test('I-12: after a withholding allocation the gross cannot be paid again; cash + withholding settles the bill',async()=>{
 const A=await company(),d=await bill(A);await withhold(A,d);
 await assert.rejects(pay(A,d,11100000,'p-gross'),/payment_exceeds_remaining/,'withholding is not counted twice');
 const r=(await pay(A,d,10900000,'p-net')).rows[0].r;
 assert.equal(r.data.isFullyPaid,true);assert.equal(Number(r.data.remaining),0);
 const b=(await c.query('SELECT status,is_settled,paid_amount FROM debts WHERE id=$1',[d])).rows[0];
 assert.deepEqual([b.status,b.is_settled,Number(b.paid_amount)],['paid',true,10900000]);
});
test('I-12: partial payments accumulate; a duplicate request key does not pay twice',async()=>{
 const A=await company(),d=await bill(A,5000000,'payable');
 await pay(A,d,2000000,'p-1');const replay=(await pay(A,d,2000000,'p-1')).rows[0].r;
 assert.equal(replay.is_replay,true);await pay(A,d,1000000,'p-2');
 const b=(await c.query('SELECT status,paid_amount FROM debts WHERE id=$1',[d])).rows[0];
 assert.deepEqual([b.status,Number(b.paid_amount)],['partial',3000000]);
 assert.equal(Number((await c.query('SELECT count(*) n FROM transactions WHERE debt_payment_id=$1',[d])).rows[0].n),2);
});
test('I-12: reconciliation exposes counter drift, misfit payment rows and orphan allocations without writing anything',async()=>{
 const A=await company(),ok=await bill(A,1000000),drift=await bill(A,2000000),misfit=await bill(A,3000000);
 await pay(A,ok,1000000,'r-ok');await pay(A,drift,500000,'r-drift');
 await c.query('UPDATE debts SET paid_amount=700000 WHERE id=$1',[drift]);
 const tx=(await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description,debt_payment_id) VALUES($1,$2,'expense',100000,100000,'IDR',$3,'business','2026-10-11','Synthetic misfit',$4) RETURNING id",[A.b,A.u,A.w,misfit])).rows[0].id;
 const plain=(await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description) VALUES($1,$2,'income',50000,50000,'IDR',$3,'business','2026-10-11','Synthetic unrelated') RETURNING id",[A.b,A.u,A.w])).rows[0].id;
 await c.query("INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,transaction_id,allocated_amount) VALUES($1,$2,'transaction',$3,50000)",[A.b,misfit,plain]);
 const h=await ledger(A.b),bills=(await c.query('SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY id)::text) h FROM debts d WHERE business_id=$1',[A.b])).rows[0].h;
 const r=(await c.query('SELECT rpc_debt_settlement_reconciliation($1) r',[A.b])).rows[0].r;
 const reasons=r.exceptions.map(e=>`${e.debt_id}:${e.reason}`);
 assert.ok(reasons.includes(`${drift}:counter_differs_from_payments`),JSON.stringify(reasons));
 assert.ok(reasons.includes(`${misfit}:payment_row_does_not_fit_bill`),JSON.stringify(reasons));
 assert.ok(reasons.includes(`${misfit}:counter_differs_from_payments`),JSON.stringify(reasons));
 assert.ok(reasons.includes(`${misfit}:transaction_allocation_without_payment_row`),JSON.stringify(reasons));
 assert.ok(!reasons.some(x=>x.startsWith(ok+':')),'a clean bill has no exception');
 assert.equal(r.writes,false);assert.equal(await ledger(A.b),h);
 assert.equal((await c.query('SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY id)::text) h FROM debts d WHERE business_id=$1',[A.b])).rows[0].h,bills);
 const B=await company();assert.equal((await c.query('SELECT rpc_debt_settlement_reconciliation($1) r',[B.b])).rows[0].r.exceptions.length,0,'other company sees only its own');
 void tx;
});

// ── Rollback ─────────────────────────────────────────────────────────────────
test('every AC-0 migration rolls back in reverse order and re-applies',async()=>{
 for(const m of [...AC0].reverse())await c.query(sql(m+'_down.sql'));
 const back=(await c.query(`SELECT has_function_privilege('anon','public.rpc_reset_business_financial(uuid,bigint)','EXECUTE') anon_reset,
   to_regprocedure('public.rpc_patch_business_transaction(uuid,bigint,bigint,bigint,jsonb,boolean)') IS NOT NULL old_patch,
   to_regclass('public.funding_creation_requests') IS NULL no_receipts,
   NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_type_known') no_check`)).rows[0];
 assert.deepEqual(back,{anon_reset:true,old_patch:true,no_receipts:true,no_check:true});
 // The grants rollback restores exactly the captured production list (whose fingerprint equals production) for every
 // object present here — no more, no less, for PUBLIC/anon/authenticated.
 const down=sql(AC0[0]+'_down.sql'),listed=[...down.matchAll(/^\s+\('(TABLE|SEQUENCE|FUNCTION)', '((?:[^']|'')+)', '([^']+)', '(PUBLIC|anon|authenticated)'\)/gm)];
 assert.equal(listed.length,323,'captured grant rows');
 const actual=new Set((await c.query(`WITH o AS (
   SELECT format('%I.%I', n.nspname, k.relname) obj, k.relacl acl FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public' AND k.relkind IN ('r','v','m','p','S')
   UNION ALL SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), coalesce(p.proacl, acldefault('f', p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  ) SELECT o.obj, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END who, a.privilege_type priv FROM o, aclexplode(o.acl) a`)).rows
   .filter(r=>['PUBLIC','anon','authenticated'].includes(r.who)).map(r=>`${r.obj}|${r.who}|${r.priv}`));
 const exists=new Set((await c.query(`SELECT format('%I.%I', n.nspname, k.relname) o FROM pg_class k JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname='public'
   UNION ALL SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`)).rows.map(r=>r.o));
 const expected=new Set(listed.filter(m=>exists.has(m[2].replace(/''/g,"'"))).flatMap(m=>m[3].split(', ').map(p=>`${m[2].replace(/''/g,"'")}|${m[4]}|${p}`)));
 const missing=[...expected].filter(x=>!actual.has(x)),extra=[...actual].filter(x=>!expected.has(x));
 assert.deepEqual({missing:missing.slice(0,5),extra:extra.slice(0,5)},{missing:[],extra:[]});
 assert.ok(expected.size>100,'a meaningful part of the list exists here'); void preAcl;
 for(const m of AC0)await c.query(sql(m+'.sql'));
 assert.equal((await c.query("SELECT has_function_privilege('anon','public.rpc_reset_business_financial(uuid,bigint)','EXECUTE') a")).rows[0].a,false);
});
