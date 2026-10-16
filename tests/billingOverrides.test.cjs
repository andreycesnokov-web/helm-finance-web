'use strict';
// Precedence of commercial terms in the pure access projection (mirrors billing_effective_terms in SQL):
// base version = admin grant > verified paid period > trial; customer overrides then adjust that base;
// overrides never create access; for the same key the later start wins; trial length is fixed on the account.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {computeBusinessAccess}=require('../server/lib/businessAccess');
const company={id:'co-1'};
const base={id:'v1',plan:'control',terms_version:'t',features:{documents:true,payroll:false},limits:{users:2,documents:3},limit_policies:{documents:'soft'}};
const pro={id:'v2',plan:'pro',terms_version:'t',features:{documents:true,payroll:true},limits:{users:9,documents:100}};
const at='2026-10-16T12:00:00.000Z',start='2026-10-16T00:00:00.000Z',end72='2026-10-19T00:00:00.000Z';
const ov=(o)=>({business_id:'co-1',audit_id:'a',reason:'Signed deal',starts_at:'2026-10-16T01:00:00.000Z',ends_at:null,revoked_at:null,...o});
const snap=(x={})=>({business_id:'co-1',environment:'sandbox',version:3,selected_plan_version_id:'v1',trial_started_at:start,trial_ends_at:end72,trial_hours:72,
 plan_versions:[base,pro],grants:[],service_periods:[],overrides:[],...x});
const access=(s,time=at)=>computeBusinessAccess(company,new Date(time),s);

test('a 72-hour trial fixed on the account is valid and ends exactly at 72 hours',()=>{
 assert.equal(access(snap()).restricted,false);assert.equal(access(snap()).trial_hours,72);
 assert.equal(access(snap(),'2026-10-19T00:00:00.000Z').restricted,true);
 // The same dates without trial_hours would be a tampered 168h trial: refused.
 assert.equal(access(snap({trial_hours:null})).restricted,true);
});
test('overrides adjust the effective plan: limit, feature and discount; other terms stay from the plan',()=>{
 const a=access(snap({overrides:[ov({id:'o1',kind:'limit',key:'users',value:12}),ov({id:'o2',kind:'feature',key:'payroll',value:true}),ov({id:'o3',kind:'discount',key:null,value:{percent:20}})]}));
 assert.equal(a.limits.users,12);assert.equal(a.limits.documents,3);assert.equal(a.features.payroll,true);assert.equal(a.discount_percent,20);
 assert.deepEqual(a.limit_policies,{documents:'soft'});assert.equal(a.overrides_active.length,3);
});
test('overrides apply on top of an admin grant too (grant chooses the base, overrides adjust it)',()=>{
 const a=access(snap({grants:[{id:'g',business_id:'co-1',plan_version_id:'v2',starts_at:start,ends_at:'2026-11-01T00:00:00.000Z',audit_id:'a',reason:'Pilot access'}],
  overrides:[ov({id:'o1',kind:'limit',key:'users',value:12})]}));
 assert.equal(a.effective_access_source,'admin_override');assert.equal(a.effective_plan,'pro');assert.equal(a.limits.users,12);assert.equal(a.limits.documents,100);
});
test('overrides never create access when no plan is effective',()=>{
 const a=access(snap({overrides:[ov({id:'o1',kind:'feature',key:'documents',value:true})]}),'2026-10-20T00:00:00.000Z');
 assert.equal(a.restricted,true);assert.deepEqual(a.features,{});assert.deepEqual(a.overrides_active,[]);
});
test('revoked, future, expired and foreign overrides are ignored; for one key the later start wins',()=>{
 const a=access(snap({overrides:[
  ov({id:'r',kind:'limit',key:'users',value:50,revoked_at:'2026-10-16T02:00:00.000Z'}),
  ov({id:'f',kind:'limit',key:'users',value:60,starts_at:'2026-10-17T00:00:00.000Z'}),
  ov({id:'e',kind:'limit',key:'users',value:70,ends_at:'2026-10-16T05:00:00.000Z'}),
  ov({id:'x',kind:'limit',key:'users',value:80,business_id:'other'}),
  ov({id:'early',kind:'limit',key:'documents',value:10,starts_at:'2026-10-16T01:00:00.000Z'}),
  ov({id:'late',kind:'limit',key:'documents',value:20,starts_at:'2026-10-16T03:00:00.000Z'})]}));
 assert.equal(a.limits.users,2);assert.equal(a.limits.documents,20);
});
test('malformed override values are ignored rather than trusted',()=>{
 const a=access(snap({overrides:[ov({id:'a',kind:'limit',key:'users',value:-5}),ov({id:'b',kind:'feature',key:'payroll',value:'yes'}),ov({id:'c',kind:'limit',key:'documents',value:1.5})]}));
 assert.equal(a.limits.users,2);assert.equal(a.features.payroll,false);assert.equal(a.limits.documents,3);
});
