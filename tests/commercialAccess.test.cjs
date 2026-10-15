'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {computeBusinessAccess,TRIAL_DURATION_MS}=require('../server/lib/businessAccess');
const company={id:'company-A',plan:'founder',subscription_status:'active'};
const start='2026-10-15T00:00:00.000Z',end='2026-10-22T00:00:00.000Z';
const plan={id:'starter-v1',plan:'starter',terms_version:'1',features:{documents:true},limits:{documents:7}};
const other={...plan,id:'pro-v1',plan:'pro'};
const snapshot=()=>({business_id:company.id,environment:'sandbox',version:1,selected_plan_version_id:plan.id,
  trial_started_at:start,trial_ends_at:end,plan_versions:[structuredClone(plan),structuredClone(other)],service_periods:[],grants:[]});
const resolve=(s=snapshot(),time=start)=>computeBusinessAccess(company,new Date(time),s);
const period=()=>({id:'period-1',business_id:company.id,payment_id:'payment-1',payment_verified:true,
  environment:'sandbox',plan_version_id:plan.id,starts_at:end,ends_at:'2026-11-22T00:00:00Z'});
test('trial spans exactly 168 hours and ends at the exclusive boundary',()=>{
 assert.equal(Date.parse(end)-Date.parse(start),TRIAL_DURATION_MS);
 assert.equal(resolve().trial_seconds_remaining,604800);
 assert.equal(resolve(snapshot(),'2026-10-21T23:59:59.999Z').restricted,false);
 assert.equal(resolve(snapshot(),end).restricted,true);
 assert.equal(resolve(snapshot(),end).subscription_status,'expired');
});
test('future trial does not grant early access',()=>assert.equal(resolve(snapshot(),'2026-10-14T23:59:59Z').restricted,true));
test('trial uses the selected version and changing plans never changes its dates',()=>{
 const s=snapshot();s.selected_plan_version_id=other.id;
 const a=resolve(s);assert.equal(a.effective_plan,'pro');assert.equal(a.trial_ends_at,end);
});
test('stored active status alone never grants paid access in the commercial policy',()=>{
 const s=snapshot();s.trial_started_at=null;s.trial_ends_at=null;
 assert.equal(resolve(s).restricted,true);assert.equal(resolve(s).subscription_status,'not_started');
});
test('expiry needs no scheduler',()=>assert.equal(resolve(snapshot(),'2026-10-23T00:00:00Z').restricted,true));
test('payment at expiry grants its own period independently of stale trial fields',()=>{
 const s=snapshot();s.service_periods.push(period());assert.equal(resolve(s,end).effective_access_source,'subscription');
 s.trial_ends_at='2026-10-21T00:00:00Z';assert.equal(resolve(s,end).subscription_active,true);
});
test('canceled renewal and failed renewal preserve the already paid period',()=>{
 const s=snapshot();s.cancel_at_period_end=true;s.status='past_due';s.service_periods.push(period());
 assert.equal(resolve(s,end).subscription_active,true);assert.equal(resolve(s,end).cancel_at_period_end,true);
 assert.equal(resolve(s,'2026-11-22T00:00:00Z').subscription_active,false);
});
test('refund revocation removes the paid grant without deleting the trial history',()=>{
 const s=snapshot();s.service_periods.push({...period(),revoked_at:end});
 assert.equal(resolve(s,end).restricted,true);assert.equal(resolve(s,end).trial_started_at,start);
});
for(const field of ['payment_id','payment_verified','environment','business_id','plan_version_id'])test('invalid paid evidence denied: '+field,()=>{
 const s=snapshot(),p=period();p[field]=field==='payment_verified'?false:'wrong';if(field==='payment_id')p[field]=null;
 s.service_periods.push(p);assert.equal(resolve(s,end).subscription_active,false);
});
test('company mismatch is refused rather than falling back to another company',()=>{
 assert.throws(()=>resolve({...snapshot(),business_id:'company-B'}),/billing_company_mismatch/);
});
test('unaudited or perpetual admin grants do not open access',()=>{
 const s=snapshot();s.grants=[{id:'g',business_id:company.id,plan_version_id:other.id,starts_at:start,ends_at:null,reason:'test'}];
 assert.equal(resolve(s,end).override_active,false);
});
test('complimentary grant is separate from paid status and expires',()=>{
 const s=snapshot();s.grants=[{id:'g',business_id:company.id,plan_version_id:other.id,starts_at:start,
  ends_at:'2026-10-23T00:00:00Z',audit_id:'audit-1',reason:'Approved test access'}];
 const a=resolve(s,end);assert.equal(a.effective_access_source,'admin_override');assert.equal(a.subscription_active,false);
 assert.equal(a.effective_plan,'pro');assert.equal(resolve(s,'2026-10-23T00:00:00Z').restricted,true);
 s.grants[0].revoked_at=end;assert.equal(resolve(s,end).override_active,false);
});
test('unverified trial extension does not prolong access',()=>{
 const s=snapshot();s.trial_ends_at='2026-10-23T00:00:00Z';assert.equal(resolve(s,end).restricted,true);
 s.trial_extension={audit_id:'a',reason:'Staging approval',before:end,after:s.trial_ends_at};
 assert.equal(resolve(s,end).restricted,false);
});
test('snapshot terms survive catalog archival and result mutation',()=>{
 const s=snapshot();s.plan_versions[0].archived=true;
 const a=resolve(s);a.features.documents=false;a.limits.documents=900;
 assert.equal(resolve(s).features.documents,true);assert.equal(resolve(s).limits.documents,7);
});
test('missing version cannot silently grant unlimited access',()=>{
 const s=snapshot();s.plan_versions=[];assert.equal(resolve(s).restricted,true);assert.deepEqual(resolve(s).limits,{});
});
test('UTC offsets denote the same expiration',()=>{
 assert.equal(resolve(snapshot(),'2026-10-22T08:00:00+08:00').restricted,true);
});
test('timestamps without timezone do not grant access',()=>{
 const s=snapshot();s.trial_started_at='2026-10-15T00:00:00';assert.equal(resolve(s).restricted,true);
});
test('legacy resolver remains unchanged without the commercial snapshot',()=>{
 assert.equal(computeBusinessAccess(company,new Date(end)).effective_plan,'founder');
});

test('scheduled terms switch at the server boundary without extending trial or replacing paid terms',()=>{
 const s=snapshot();s.scheduled_plan_version_id=other.id;s.scheduled_at='2026-10-16T00:00:00Z';
 assert.equal(resolve(s,'2026-10-15T23:59:59Z').effective_plan,'starter');
 assert.equal(resolve(s,s.scheduled_at).effective_plan,'pro');
 assert.equal(resolve(s,end).restricted,true);
 s.service_periods=[{...period(),starts_at:start}];
 assert.equal(resolve(s,s.scheduled_at).effective_plan,'starter');
});
