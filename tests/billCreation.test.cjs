'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{creationRequest,amountIdentity}=require('../server/lib/billCreation');
const key='01234567-89ab-4cde-8123-456789abcdef',body={request_key:key,type:'payable',counterparty:' STAGE supplier ',amount:'030.00',scope:'business'};
test('equivalent manual creation fields keep exact stable identity and defaults',()=>{
 const a=creationRequest(body),b=creationRequest({...body,request_key:key.toUpperCase(),amount:30,currency:'idr',description:'',due_date:null});
 assert.deepEqual(a,b);assert.equal(a.payload.amount,'30');assert.equal(a.payload.counterparty,'STAGE supplier');
 assert.notDeepEqual(a,creationRequest({...body,counterparty:'different supplier'}));
 assert.notDeepEqual(a,creationRequest({...body,type:'receivable'}));
});
test('positive native numeric18,2 amounts cannot round or enter nonfinite values',()=>{
 assert.equal(amountIdentity('9999999999999999.99'),'9999999999999999.99');assert.equal(amountIdentity('0.0100'),'0.01');
 for(const amount of [0,'0.000',-1,'NaN',NaN,Infinity,'1e2','1.001','10000000000000000.00',Number.MAX_SAFE_INTEGER+1,null,{},true])assert.throws(()=>creationRequest({...body,amount}),{code:'bill_invalid_amount'});
});
test('scope, actor, paid fields, secrets and unsupported metadata cannot enter a creation receipt',()=>{
 assert.throws(()=>creationRequest({...body,scope:'personal'}),{code:'bill_business_required'});
 for(const field of ['actor_user_id','business_id','paid_amount','approval_status','token','invoice_date'])assert.throws(()=>creationRequest({...body,[field]:'forged'}),{code:'bill_invalid_request'});
 assert.throws(()=>creationRequest({...body,request_key:'unbound'}),{code:'bill_invalid_request'});
});
test('manual due date validation does not invent or shift an invalid calendar date',()=>{
 assert.equal(creationRequest({...body,due_date:'2028-02-29'}).payload.due_date,'2028-02-29');
 for(const due_date of ['2026-02-29','2026-13-01','0000-01-01','2026-10-13T12:00:00Z',123])assert.throws(()=>creationRequest({...body,due_date}),{code:'bill_invalid_value'});
});
