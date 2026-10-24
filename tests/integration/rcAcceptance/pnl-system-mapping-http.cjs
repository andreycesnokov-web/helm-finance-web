'use strict';
// Real stack: a company confirms a P&L group for a SHARED system category (migration 20261024120000) and its own
// report classifies the operation, while the shared category row and another company stay untouched.
// Needs admit-http.cjs (session) and an unused month: PNL_SYS_MONTH=2027-09. Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
const MONTH=process.env.PNL_SYS_MONTH;
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});fs.writeFileSync('/evidence/PNL_SYSTEM_MAPPING_HTTP.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',month:MONTH,results},null,2));console.log('PASS '+name)};
async function api(path,{method='GET',body,actor=C.owner,biz=C.biz}={}){const r=await fetch(process.env.BASE_URL+'/api'+path,{method,headers:{authorization:'Bearer '+actor.token,'x-business-id':biz,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json().catch(()=>null)}}
(async()=>{
 assert.match(MONTH||'',/^\d{4}-(0[1-9]|1[0-2])$/,'Set PNL_SYS_MONTH to an unused month');
 await db.connect();assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id,C.cluster);
 assert.equal((await db.query("SELECT count(*)::int n FROM transactions WHERE business_id=$1 AND to_char(transaction_date,'YYYY-MM')=$2",[C.biz,MONTH])).rows[0].n,0,'month must be unused');
 const sys=(await db.query("SELECT id,name FROM cashflow_categories WHERE business_id IS NULL AND is_system AND group_type='outflow' ORDER BY name LIMIT 1")).rows[0];
 assert.ok(sys,'a system outflow category exists');
 // 1. The mapping page lists the shared category for this company, with no group yet.
 const m0=await api('/pnl-mapping');assert.equal(m0.status,200);assert.equal(m0.data.system_category_mapping,true);
 const row0=m0.data.categories.find(c=>c.id===sys.id);assert.equal(row0.scope,'system');
 const startGroup=row0.pnl_group;
 // 2. An operation in that system category, through the real writer.
 const fund=await api('/transactions/batch',{method:'POST',body:{request_key:randomUUID(),transactions:[{type:'income',amount:'10000000',currency:'IDR',wallet_id:C.wallet,transaction_date:MONTH+'-02',description:'System mapping setup funding',category:'Owner funding (loan)',scope:'business'}]}});assert.equal(fund.status,200,JSON.stringify(fund));
 const w=await api('/transactions/batch',{method:'POST',body:{request_key:randomUUID(),transactions:[{type:'expense',amount:'2750000',currency:'IDR',wallet_id:C.wallet,transaction_date:MONTH+'-12',description:'System category operation '+MONTH,category:sys.name,cashflow_category_id:sys.id,scope:'business'}]}});assert.equal(w.status,200,JSON.stringify(w));
 const txId=(await db.query("SELECT id::text FROM transactions WHERE business_id=$1 AND description=$2",[C.biz,'System category operation '+MONTH])).rows[0].id;
 if(startGroup){const clear=await api('/pnl-mapping',{method:'PATCH',body:{mappings:[{category_id:sys.id,pnl_group:null}]}});assert.equal(clear.status,200);}
 const r0=await api('/pulse/profit-loss?month='+MONTH+'&currency=IDR');assert.equal(r0.status,200);
 assert.ok(r0.data.exceptions.some(e=>e.transaction_id===txId&&e.reason==='unclassified_or_ambiguous_category'),'unconfirmed → Needs review');
 pass('without a confirmation the system-category operation is in Needs review',{category:sys.name});
 // 3. The company confirms a group for the shared category; its report now counts it.
 const p=await api('/pnl-mapping',{method:'PATCH',body:{mappings:[{category_id:sys.id,pnl_group:'operating_cost'}]}});assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.data.changed,1);
 const r1=await api('/pulse/profit-loss?month='+MONTH+'&currency=IDR');
 const e=r1.data.entries.find(x=>x.transaction_id===txId);assert.ok(e,'entry present');assert.equal(e.group,'operating_cost');assert.equal(Number(r1.data.periods[MONTH].totals.operating_cost),2750000);
 assert.ok(!r1.data.exceptions.some(x=>x.transaction_id===txId));
 pass('after this company confirms operating cost, its report counts 2,750,000 as operating cost');
 // 4. Nothing shared changed: the system row has no group; the overlay row is this company's only; audit kept.
 assert.equal((await db.query('SELECT pnl_group FROM cashflow_categories WHERE id=$1',[sys.id])).rows[0].pnl_group,null);
 assert.deepEqual((await db.query('SELECT business_id,pnl_group FROM business_category_pnl_groups WHERE category_id=$1',[sys.id])).rows.map(r=>[r.business_id,r.pnl_group]),[[C.biz,'operating_cost']]);
 const audit=(await db.query("SELECT after_json FROM audit_events WHERE business_id=$1 AND action='pnl_mapping_confirmed' ORDER BY id DESC LIMIT 1",[C.biz])).rows[0].after_json;
 assert.deepEqual(audit.map(a=>[a.category_id,a.scope,a.pnl_group]),[[sys.id,'system','operating_cost']]);
 pass('the shared category row keeps no group; the mapping is one audited row for this company');
 // 5. Another company (its own owner) sees the same system category unmapped and cannot change this company's mapping.
 const f0=await api('/pnl-mapping',{actor:C.other,biz:C.foreign});assert.equal(f0.status,200);
 assert.equal(f0.data.categories.find(c=>c.id===sys.id).pnl_group,null,'no leak to another company');
 const outsider='pnl.sys.outsider.'+Date.now()+'@example.invalid';
 const st=await (await fetch(process.env.BASE_URL+'/api/auth/email/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:outsider})})).json();
 const vr=await (await fetch(process.env.BASE_URL+'/api/auth/email/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:outsider,code:st.dev_code})})).json();
 const x=await api('/pnl-mapping',{method:'PATCH',actor:{token:vr.token},body:{mappings:[{category_id:sys.id,pnl_group:'revenue'}]}});assert.ok([403,404,409].includes(x.status),'outsider PATCH '+x.status);
 assert.equal((await db.query('SELECT pnl_group FROM business_category_pnl_groups WHERE business_id=$1 AND category_id=$2',[C.biz,sys.id])).rows[0].pnl_group,'operating_cost');
 pass('another company sees the system category unmapped; an outsider cannot change this company\'s mapping');
 // 6. Clearing the confirmation removes only this company's row; the operation returns to Needs review.
 const c2=await api('/pnl-mapping',{method:'PATCH',body:{mappings:[{category_id:sys.id,pnl_group:null}]}});assert.equal(c2.status,200);
 assert.equal((await db.query('SELECT count(*)::int n FROM business_category_pnl_groups WHERE business_id=$1 AND category_id=$2',[C.biz,sys.id])).rows[0].n,0);
 const r2=await api('/pulse/profit-loss?month='+MONTH+'&currency=IDR');assert.ok(r2.data.exceptions.some(x=>x.transaction_id===txId));
 pass('clearing the confirmation removes only this company\'s row and the operation is back in Needs review');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.end().catch(()=>{}));
