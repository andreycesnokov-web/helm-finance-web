'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{profileRequest,profileError,registerBusinessProfileOperations}=require('../server/lib/businessProfile');
const A='00000000-0000-4000-8000-000000000001',KEY='00000000-0000-4000-8000-000000000002';
test('request requires reviewed version/key and ignores submitted actor/system columns',()=>{
 const r=profileRequest({expected_version:'0001',request_key:KEY,user_id:17,profile_status:'verified',employee_count:'0',bpjs_registered:'false'});assert.equal(r.expected_version,'1');assert.deepEqual(r.patch,{employee_count:0,bpjs_registered:false})
 assert.throws(()=>profileRequest({brand_name:'x'}),/profile_invalid_request/)
});
test('known transactional errors preserve conflicts and unknown transport never claims rollback',()=>{
 const res={status(s){this.s=s;return this},json(d){this.d=d;return this}};profileError(res,{message:'profile_version_conflict'});assert.equal(res.s,409);assert.equal(res.d.automatic_retry,false);profileError(res,{code:'PGRST202'});assert.equal(res.s,503);assert.equal(res.d.outcome,'unknown')
});
test('actual route plumbing pins JWT actor/Business and delegates to one RPC without direct write fallback',async()=>{
 const routes={},app={put(p,...h){routes[p]=h.at(-1)},post(p,...h){routes[p]=h.at(-1)},get(){}};let call;
 registerBusinessProfileOperations(app,{auth(){},requireBusiness:async()=>({business:{id:A},role:'owner'}),canApprove:()=>true,completeness:()=>({}),warnings:()=>[],supabase:{rpc:async(name,args)=>{call={name,args};return{data:{ok:true,request_id:KEY,audit_id:A,profile:{business_id:A,profile_version:2}}}},from(){throw Error('direct table write prohibited')}}})
 const res={set(){},status(s){this.s=s;return this},json(d){this.d=d;return this}};await routes['/api/accountant/profile']({user:{userId:-9},body:{expected_version:1,request_key:KEY,user_id:123,brand_name:'synthetic'}},res);assert.equal(call.name,'rpc_write_business_profile');assert.equal(call.args.p_actor,-9);assert.equal(call.args.p_business,A);assert(!Object.hasOwn(call.args.p_patch,'user_id'));assert(res.d.ok)
});
