'use strict';
// Real stack: money recorded in the funding register is financing in the cash insights (Pulse / Funding page)
// even when its words match no keyword, and it is never revenue in the P&L. Needs admit-http.cjs and an unused
// month: FUNDING_MONTH=2027-08. Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
const MONTH=process.env.FUNDING_MONTH;
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});fs.writeFileSync('/evidence/FUNDING_INSIGHTS_HTTP.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',month:MONTH,results},null,2));console.log('PASS '+name)};
async function api(path,{method='GET',body}={}){const r=await fetch(process.env.BASE_URL+'/api'+path,{method,headers:{authorization:'Bearer '+C.owner.token,'x-business-id':C.biz,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json().catch(()=>null)}}
const last=m=>{const [y,mm]=m.split('-').map(Number);return new Date(Date.UTC(y,mm,0)).toISOString().slice(0,10)};
(async()=>{
 assert.match(MONTH||'',/^\d{4}-(0[1-9]|1[0-2])$/,'Set FUNDING_MONTH to an unused month');
 await db.connect();assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id,C.cluster);
 assert.equal((await db.query("SELECT count(*)::int n FROM transactions WHERE business_id=$1 AND to_char(transaction_date,'YYYY-MM')=$2",[C.biz,MONTH])).rows[0].n,0,'month must be unused');
 const span=`/pulse/advanced-insights?from=${MONTH}-01&to=${last(MONTH)}`;
 // Words that no keyword knows: before the register link this is "needs review", never revenue.
 const desc='Поступление от банка по договору '+MONTH;
 const w=await api('/transactions/batch',{method:'POST',body:{request_key:randomUUID(),transactions:[{type:'income',amount:'120000000',currency:'IDR',wallet_id:C.wallet,transaction_date:MONTH+'-03',description:desc,category:'Поступление по договору',scope:'business'}]}});assert.equal(w.status,200,JSON.stringify(w));
 const txId=(await db.query('SELECT id FROM transactions WHERE business_id=$1 AND description=$2',[C.biz,desc])).rows[0].id;
 const i0=await api(span);assert.equal(i0.status,200);
 assert.equal(i0.data.metrics.other_cash_movement.funding,0);assert.equal(i0.data.metrics.revenue,0);assert.equal(i0.data.metrics.other_cash_movement.needs_review,120000000);
 pass('an unrecognised inflow is "needs review", not revenue and not yet financing');
 // The owner records it in the funding register, linked to that very operation.
 const f=await api('/business-funding',{method:'POST',body:{source_kind:'bank',instrument:'loan',lender_name:'Synthetic bank '+MONTH,amount:120000000,received_on:MONTH+'-03',received_transaction_id:txId,interest_rate_annual:10,schedule:[{due_on:MONTH+'-28',principal:5000000,interest:1000000}]}});
 assert.equal(f.status,200,JSON.stringify(f));
 const i1=await api(span);
 assert.equal(i1.data.metrics.other_cash_movement.funding,120000000);assert.equal(i1.data.metrics.revenue,0);assert.equal(i1.data.metrics.other_cash_movement.needs_review,0);
 pass('once the funding register links it, the same 120,000,000 is financing in the insights (Funding page figure)');
 // A repayment debit: principal alone is financing; a debit that also carries interest is not hidden as financing.
 const pay=async(amount,d)=>{const r=await api('/transactions/batch',{method:'POST',body:{request_key:randomUUID(),transactions:[{type:'expense',amount,currency:'IDR',wallet_id:C.wallet,transaction_date:MONTH+'-'+d,description:'Платёж банку '+d,category:'Платёж банку',scope:'business'}]}});assert.equal(r.status,200);return (await db.query('SELECT id FROM transactions WHERE business_id=$1 AND description=$2 AND transaction_date=$3',[C.biz,'Платёж банку '+d,MONTH+'-'+d])).rows[0].id};
 const principalTx=await pay('5000000','28');
 const rep=f.data.repayments[0];
 const pd=await api(`/business-funding/repayments/${rep.id}/paid`,{method:'POST',body:{paid_on:MONTH+'-28',paid_transaction_id:principalTx}});assert.equal(pd.status,200,JSON.stringify(pd));
 const i2=await api(span);assert.equal(i2.data.metrics.other_cash_movement.funding,125000000);
 pass('a repayment debit equal to the principal (5,000,000) is financing too: 125,000,000 in total');
 // P&L never counts the loan as revenue.
 const pl=await api('/pulse/profit-loss?month='+MONTH+'&currency=IDR');assert.equal(pl.status,200);
 assert.equal(Number(pl.data.periods[MONTH].totals.revenue),0);
 assert.ok(pl.data.excluded.some(x=>x.transaction_id===String(txId)&&x.reason==='financing'),'loan excluded as financing');
 pass('the P&L excludes the loan as financing; revenue stays 0');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.end().catch(()=>{}));
