'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {input,errorResponse,install}=require('../server/lib/commercialBilling');
const key='ABCDEFAB-1111-4111-8111-111111111111',plan='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const body=()=>({request_key:key,plan_version_id:plan,expected_version:1});
test('idempotency key normalization preserves safe retries',()=>assert.deepEqual(input(body(),key.toLowerCase()),{key:key.toLowerCase(),plan,version:1}));
for(const field of ['trial_ends_at','trial_started_at','allow_fixture','p_allow_fixture','business_id','actor_id','status','price_minor','role'])test('client cannot inject '+field,()=>assert.throws(()=>input({...body(),[field]:'injected'}),/billing_invalid_fields/));
test('different header and body command keys are refused',()=>assert.throws(()=>input(body(),plan),/billing_invalid_key/));
test('unsafe versions and missing keys cannot become writes',()=>{
 for(const n of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1,'1',null])assert.throws(()=>input({...body(),expected_version:n}),/billing_invalid_command/);
 assert.throws(()=>input({...body(),request_key:null}),/billing_invalid_key/);
});
test('ambiguous outcome instructs recovery and never labels a possible commit rollback',()=>{
 let status,result;const res={status(n){status=n;return this},json(v){result=v;return this}};
 errorResponse(res,Error('socket closed after commit'));
 assert.equal(status,503);assert.equal(result.outcome,'unknown');assert.equal(result.automatic_retry,false);assert.equal(result.recover_command,true);
});
test('disabled routes do not call business resolution or data layer',()=>{
 const routes=[],app={get(...a){routes.push(a)},post(...a){routes.push(a)}};
 install(app,{auth(){},requireBusiness(){throw Error('unexpected DB call')},supabase:{rpc(){throw Error('unexpected RPC')}},enabled:false});
 assert.equal(routes.length,6);
 for(const route of routes){let code,result,next=false;route[2]({}, {status(n){code=n;return this},json(v){result=v}},()=>{next=true});assert.equal(code,404);assert.equal(result.error,'not_found');assert.equal(next,false);}
});

test('AI identification reserves AI quota before the general document mutation rule',()=>{
 const {workflow}=require('../server/lib/commercialBilling');
 assert.deepEqual(workflow({method:'POST',originalUrl:'/api/documents/abc/identify'}),{feature:'ai',resource:'ai'});
 assert.deepEqual(workflow({method:'PATCH',originalUrl:'/api/documents/abc'}),{feature:'documents'});
});
