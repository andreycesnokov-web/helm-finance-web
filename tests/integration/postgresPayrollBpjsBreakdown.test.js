'use strict';
// Native PG only. Fresh disposable DB; inherited guard rejects known shared clusters.
// Payroll BPJS breakdown (20261024090000) on top of the production-contract Payroll migration (20261022165230).
// Amounts follow an accountant's real monthly sheet (gross-up to a round take-home); names are synthetic.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {createProdSchemaDatabase}=require('./_prodSchemaDb');
const {assertDisposableUrl}=require('./_disposableDbGuard');
let db,c;const root=path.resolve(__dirname,'../..');let uid=99700;
const sql=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
const COMPAT='20261022165230_payroll_runs_receipt_contract_compat.sql';
const FORWARD='20261024090000_payroll_bpjs_breakdown.sql',DOWN='20261024090000_payroll_bpjs_breakdown_down.sql';
// Gaji bulan ini, PPh 21, BPJS KS, BPJS TK JP, BPJS TK JHT, Gaji bersih.
const SHEET=[[8474663,154663,80000,80000,160000,8000000],[4680000,0,45000,45000,90000,4500000],
 [16430814,1170814,65000,65000,130000,15000000],[13155898,685035,120000,110863,240000,12000000],
 [21739130,1739130,0,0,0,20000000],[4680000,0,45000,45000,90000,4500000],[34883721,4883721,0,0,0,30000000]];
before(async()=>{
 assert.ok(process.env.DATABASE_URL,'Set the confirmed disposable local DATABASE_URL explicitly');
 assertDisposableUrl(process.env.DATABASE_URL,{adminOnly:true});
 const H=require('./_d4Harness');
 db=await createProdSchemaDatabase('hf_payroll_bpjs',[...H.CHAIN,H.D4]);
 if(!db)throw Error('Native PostgreSQL unavailable; no breakdown proof');
 c=new Client({connectionString:db.connectionString,connectionTimeoutMillis:3000});await c.connect();
 await c.query("SET statement_timeout='8s';SET lock_timeout='6s'");
 await assert.rejects(c.query(sql(FORWARD)),/payroll_bpjs_breakdown_requires_payroll_runs/);await c.query('ROLLBACK');
 await c.query(sql(COMPAT));await c.query(sql(FORWARD));
});
after(async()=>{await c?.query('ROLLBACK').catch(()=>{});await c?.end();if(db)await db.drop()});
async function fixture(people=1){const f={biz:randomUUID(),wallet:randomUUID(),actor:++uid,employees:[]};
 await c.query('INSERT INTO users(id) VALUES($1)',[f.actor]);
 await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Native synthetic payroll',$2,'business')",[f.biz,f.actor]);
 await c.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')",[f.biz,f.actor]);
 await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Synthetic bank','IDR','business')",[f.wallet,f.biz,f.actor]);
 for(let i=0;i<people;i++){const e=randomUUID();f.employees.push(e);
  await c.query("INSERT INTO payroll_employees(id,business_id,user_id,name,currency,status) VALUES($1,$2,$3,$4,'IDR','active')",[e,f.biz,f.actor,'Sheet employee '+(i+1)]);}
 return f}
const body=(f,lines)=>({action:'create',period_month:'2026-09',payment_date:'2026-09-25',wallet_id:f.wallet,tax_confirmed:true,lines});
const line=(e,[gross,pph,kes,jp,jht])=>({employee_id:e,salary:String(gross),bonus:'0',earnings:'0',pph21:String(pph),
 bpjs:String(kes+jp+jht),bpjs_kes:String(kes),bpjs_jp:String(jp),bpjs_jht:String(jht),other:'0',employer_bpjs:'0'});
async function act(f,p,key=randomUUID()){return(await c.query('SELECT rpc_payroll_run_action($1,$2,$3,$4) r',[f.biz,f.actor,key,JSON.stringify(p)])).rows[0].r}
async function items(f){return(await c.query(`SELECT e.name,i.item_type,i.amount::bigint::int amount FROM payroll_payment_items i
 JOIN payroll_payments p ON p.id=i.payroll_payment_id JOIN payroll_employees e ON e.id=p.employee_id WHERE p.business_id=$1 ORDER BY e.name,i.item_type`,[f.biz])).rows}
async function count(f){return(await c.query("SELECT (SELECT count(*)::int FROM payroll_runs WHERE business_id=$1) runs,(SELECT count(*)::int FROM payroll_payments WHERE business_id=$1) payments,(SELECT count(*)::int FROM transactions WHERE business_id=$1) transactions",[f.biz])).rows[0]}

test('the accountant sheet month: every take-home matches Gaji bersih, totals match, BPJS split kept, zero cash',async()=>{
 const f=await fixture(SHEET.length);const r=await act(f,body(f,SHEET.map((row,i)=>line(f.employees[i],row))));
 assert.equal(r.cash_changed,false);
 const pays=(await c.query('SELECT e.name,p.gross_amount::bigint::int g,p.deduction_amount::bigint::int d,p.net_amount::bigint::int n,p.transaction_id FROM payroll_payments p JOIN payroll_employees e ON e.id=p.employee_id WHERE p.run_id=$1 ORDER BY e.name',[r.run.id])).rows;
 assert.deepEqual(pays.map(p=>p.n),SHEET.map(s=>s[5]));
 assert.ok(pays.every(p=>p.transaction_id===null));
 const all=await items(f),sum=t=>all.filter(i=>i.item_type===t).reduce((s,i)=>s+i.amount,0);
 assert.equal(pays.reduce((s,p)=>s+p.g,0),104044226);assert.equal(sum('pph21'),8633363);
 assert.equal(sum('bpjs_kes'),355000);assert.equal(sum('bpjs_jp'),345863);assert.equal(sum('bpjs_jht'),710000);
 assert.equal(pays.reduce((s,p)=>s+p.n,0),94000000);
 // The parts fully explain BPJS, so no unsplit `bpjs` item; employees without BPJS get no zero BPJS rows.
 assert.equal(all.filter(i=>i.item_type==='bpjs').length,0);
 assert.deepEqual(all.filter(i=>i.name==='Sheet employee 5').map(i=>i.item_type),['pph21','salary']);
 assert.deepEqual(await count(f),{runs:1,payments:7,transactions:0});
});
test('parts larger than the BPJS total roll the whole run back',async()=>{
 const f=await fixture(2);const good=line(f.employees[0],SHEET[0]),bad={...line(f.employees[1],SHEET[1]),bpjs:'100000'};
 await assert.rejects(act(f,body(f,[good,bad])),/payroll_invalid_amount/);
 await assert.rejects(act(f,body(f,[{...good,bpjs_kes:'-1'}])),/payroll_invalid_amount/);
 assert.deepEqual(await count(f),{runs:0,payments:0,transactions:0});
});
test('a line without parts behaves as before; a partial split keeps the remainder as one BPJS item',async()=>{
 const f=await fixture(2);
 const legacy={employee_id:f.employees[0],salary:'1000000',bonus:'0',earnings:'0',pph21:'0',bpjs:'40000',other:'0',employer_bpjs:'0'};
 const partial={...legacy,employee_id:f.employees[1],bpjs:'300000',bpjs_kes:'100000'};
 await act(f,body(f,[legacy,partial]));
 assert.deepEqual((await items(f)).filter(i=>/bpjs/.test(i.item_type)),
  [{name:'Sheet employee 1',item_type:'bpjs',amount:40000},{name:'Sheet employee 2',item_type:'bpjs',amount:200000},{name:'Sheet employee 2',item_type:'bpjs_kes',amount:100000}]);
 const net=(await c.query('SELECT net_amount::bigint::int n FROM payroll_payments WHERE business_id=$1 ORDER BY net_amount',[f.biz])).rows.map(r=>r.n);
 assert.deepEqual(net,[700000,960000]);
});
test('replay of the same split returns the stored result; a changed split under one key is refused',async()=>{
 const f=await fixture(1),key=randomUUID(),p=body(f,[line(f.employees[0],SHEET[3])]);
 const first=await act(f,p,key);assert.equal((await act(f,p,key)).run.id,first.run.id);
 const changed=structuredClone(p);changed.lines[0].bpjs_jp='100000';changed.lines[0].bpjs_jht='250863';
 await assert.rejects(act(f,changed,key),/idempotency_key_mismatch/);
 assert.equal((await count(f)).runs,1);
});
test('rollback restores the compat function exactly; forward applies again',async()=>{
 await c.query(sql(DOWN));
 const compatBody=sql(COMPAT).match(/CREATE FUNCTION public\.rpc_payroll_run_action[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)[1];
 const live=(await c.query("SELECT prosrc FROM pg_proc WHERE oid='public.rpc_payroll_run_action(uuid,bigint,text,jsonb)'::regprocedure")).rows[0].prosrc;
 assert.equal(live.replace(/\r\n/g,'\n'),compatBody.replace(/\r\n/g,'\n'));
 const f=await fixture(1);await act(f,body(f,[line(f.employees[0],SHEET[0])]));
 assert.deepEqual((await items(f)).filter(i=>/bpjs/.test(i.item_type)).map(i=>[i.item_type,i.amount]),[['bpjs',320000]]);
 await c.query(sql(FORWARD));
 const g=await fixture(1);await act(g,body(g,[line(g.employees[0],SHEET[0])]));
 assert.deepEqual((await items(g)).filter(i=>/bpjs/.test(i.item_type)).map(i=>i.item_type),['bpjs_jht','bpjs_jp','bpjs_kes']);
});
