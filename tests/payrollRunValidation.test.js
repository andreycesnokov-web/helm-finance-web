'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {payload}=require('../server/lib/payrollRuns');
const body=()=>({action:'create',period_month:'2026-08',payment_date:'2026-08-25',wallet_id:randomUUID(),tax_confirmed:true,lines:[{employee_id:randomUUID(),salary:'1000000',bonus:'0',earnings:'0',pph21:'0',bpjs:'0',other:'0',employer_bpjs:'50000'}]});
test('request validation preserves explicit zero tax and blocks malformed dates and fractional/negative IDR',()=>{
 assert.equal(payload(body()).lines[0].pph21,'0');
 for(const date of ['2026-02-31','2026-13-01','2026-08-25T00:00:00Z'])assert.throws(()=>payload({...body(),payment_date:date}),/period/);
 for(const key of ['salary','pph21','employer_bpjs'])for(const val of [-1,'1.2','NaN',null]){const b=body();b.lines[0][key]=val;assert.throws(()=>payload(b),/amount/)}
 assert.throws(()=>payload({...body(),tax_confirmed:false}),/confirmation/)
});
test('BPJS parts are optional, validated like every amount and may not exceed the BPJS total',()=>{
 const b=body();Object.assign(b.lines[0],{bpjs:'320000',bpjs_kes:'80000',bpjs_jp:'80000',bpjs_jht:'160000'});
 assert.deepEqual(payload(b).lines[0],{...b.lines[0],employee_id:b.lines[0].employee_id.toLowerCase()});
 assert.equal('bpjs_kes' in payload(body()).lines[0],false);
 const over=body();Object.assign(over.lines[0],{bpjs:'100000',bpjs_kes:'80000',bpjs_jp:'80000'});assert.throws(()=>payload(over),/amount/);
 for(const val of [-1,'1.2','',null]){const x=body();x.lines[0].bpjs='100';x.lines[0].bpjs_jht=val;assert.throws(()=>payload(x),/amount/)}
 const unknown=body();unknown.lines[0].bpjs_other='1';assert.throws(()=>payload(unknown),/invalid_line/);
});
test('duplicate employees, unknown fields, stale version shape and invalid action are refused',()=>{
 const b=body();b.lines.push({...b.lines[0]});assert.throws(()=>payload(b),/duplicate/);
 assert.throws(()=>payload({...body(),status:'paid'}),/invalid_request/);
 assert.throws(()=>payload({action:'approve',run_id:randomUUID(),version:'1'}),/invalid_request/);
 assert.throws(()=>payload({action:'pay_now'}),/invalid_request/);
});
test('early receipt replay refuses a downgraded payroll role before reading private receipts',async()=>{
 const recovery=require('../server/lib/financialRecovery');let read=false,status=0,result;
 const supabase={from(){read=true;throw Error('Must not query')}};
 const res={status(n){status=n;return this},json(value){result=value;return this}};
 assert.equal(await recovery.replay(supabase,{user:{userId:1}},res,{role:'accountant',business:{id:randomUUID()}},'payroll_run','known-key',{}),true);
 assert.equal(status,403);assert.equal(result.error,'financial_recovery_forbidden');assert.equal(read,false);
});
