import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {performProfileOperation,recoverProfileOperation,normalizeProfilePatch,saveProfileDraft,readProfileDraft,unconfirmedProfileFields,profileDelta} from '../client/src/v2/lib/profileOperation.js'
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})
const storage=new Map(),token=id=>'x.'+Buffer.from(JSON.stringify({userId:id})).toString('base64url')+'.x',A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002'
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}
const request={token:token(-9),businessId:A,isCurrent:()=>true};function reset(){storage.clear();localStorage.setItem('hf_token',request.token)}
const ack=(body,operation='save')=>({ok:true,state:'confirmed',request_id:body.request_key,audit_id:A,operation,expected_version:body.expected_version,payload:normalizeProfilePatch(body),profile:{business_id:A,profile_version:Number(body.expected_version)+(operation==='save'?1:0),...(operation==='verify'?{verified_profile_version:Number(body.expected_version)}:{})}})
test('response loss retains key and renewal same actor recovers by read only',async()=>{
 reset();let saved,writes=0;const send=async(r,b)=>{writes++;saved=ack(b);throw Error('response lost')},read=async()=>saved
 await assert.rejects(performProfileOperation(request,'save',{brand_name:'native draft'},'1',{send,read}),/response lost/)
 const r=await performProfileOperation({...request,token:token(-9)},'save',{brand_name:'native draft'},'1',{send,read});assert(r.ok);assert.equal(writes,1);assert(![...storage.entries()].filter(([k])=>k.startsWith('profileRequest:')).map(([,v])=>v).join('').includes(request.token))
})
test('absence after unknown write never automatically sends another save',async()=>{
 reset();let writes=0;const send=async()=>{writes++;throw Error('lost')},read=async()=>({state:'not_found'})
 await assert.rejects(performProfileOperation(request,'save',{brand_name:'x'},1,{send,read}),/lost/);await assert.rejects(performProfileOperation(request,'save',{brand_name:'x'},1,{send,read}),{code:'profile_pending_review'});assert.equal(writes,1)
})
test('invalid/foreign/empty acknowledgement and readback refusal cannot confirm',async()=>{
 for(const kind of ['empty','foreign','read_refused']){reset();let saved;const send=async(r,b)=>{saved=ack(b);return kind==='empty'?{}:kind==='foreign'?{...saved,profile:{...saved.profile,business_id:B}}:saved},read=async()=>{throw Object.assign(Error('forbidden read'),{status:403})}
  await assert.rejects(performProfileOperation(request,'save',{brand_name:'x'},1,{send,read}));assert([...storage.values()].some(x=>x.includes('in_flight')))
 }
})
test('changed actor cannot follow up, confirm, read or clear old draft',async()=>{
 reset();let reads=0;await assert.rejects(performProfileOperation(request,'save',{brand_name:'x'},1,{send:async(r,b)=>{localStorage.setItem('hf_token',token(-10));return ack(b)},read:async()=>{reads++}}),{code:'profile_actor_changed'});assert.equal(reads,0)
 await assert.rejects(recoverProfileOperation(request,'save',{read:async()=>{reads++}}),{code:'profile_actor_changed'});assert.equal(reads,0)
})
test('draft fields remain actor/Business bound and normalization matches typed writer',()=>{
 reset();saveProfileDraft(request,{form:{employee_count:'0',bpjs_registered:'false',additional_kbli:'11111, 22222',brand_name:'draft'},before:{profile_version:1,brand_name:'before'},verification:{brand_name:'user_declared'}})
 const d=readProfileDraft(request);assert.equal(d.form.employee_count,0);assert.equal(d.form.bpjs_registered,false);assert.deepEqual(d.form.additional_kbli,['11111','22222']);assert.equal(readProfileDraft({...request,businessId:B}),null)
 assert(!Object.hasOwn(normalizeProfilePatch({business_id:B,user_id:1,brand_name:'x'}),'business_id'))
})
test('confirmed tombstone protects queued duplicate save, then explicit changed payload is separate',async()=>{
 reset();let saved,writes=0;const send=async(r,b)=>{writes++;return saved=ack(b)},read=async()=>saved
 await performProfileOperation(request,'save',{brand_name:'x'},1,{send,read});await performProfileOperation(request,'save',{brand_name:'x'},2,{send,read});assert.equal(writes,1)
 await performProfileOperation(request,'save',{brand_name:'changed'},2,{send,read});assert.equal(writes,2)
})
test('canonical document provenance confirms its checked source but rejects substitutions or missing fields',()=>{
 const body={employee_count:'0',field_verification:{brand_name:'user_declared',nib:{state:'extracted',document_id:A}}}
 const row={employee_count:0,field_verification:{brand_name:{state:'user_declared'},nib:{state:'extracted',document_id:A,file_id:B}}}
 assert.deepEqual(unconfirmedProfileFields(body,row),[])
 assert.deepEqual(unconfirmedProfileFields(body,{...row,field_verification:{...row.field_verification,nib:{state:'extracted',document_id:B}}}),['field_verification'])
 assert.deepEqual(unconfirmedProfileFields(body,{field_verification:row.field_verification}),['employee_count'])
})
test('lost confirmation response is recovered read-only and bound to the saved version',async()=>{
 reset();let saved,writes=0;const send=async(r,b)=>{writes++;saved=ack(b,'verify');throw Error('response lost')},read=async()=>saved
 await assert.rejects(performProfileOperation(request,'verify',{},'3',{send,read}),/response lost/)
 const r=await recoverProfileOperation(request,'verify',{read});assert.equal(r.profile.verified_profile_version,3);assert.equal(writes,1)
 await assert.rejects(performProfileOperation(request,'verify',{},'3',{send,read:async()=>({...saved,profile:{...saved.profile,verified_profile_version:2}})}),{code:'profile_save_unconfirmed'});assert.equal(writes,1)
})
test('legacy forms send changed supported values only and retain an absent-profile baseline',()=>{
 reset();const before={business_id:A,profile_version:1,employee_count:2,field_verification:{nib:{state:'extracted',document_id:A,file_id:B}},nib:'00111'}
 assert.deepEqual(profileDelta({...before,employee_count:'3',profile_status:'verified'},before),{employee_count:3})
 saveProfileDraft(request,{form:{brand_name:'draft from empty profile'},before:null,verification:{}});assert.equal(readProfileDraft(request).before,null)
 const changed=profileDelta({...before,field_verification:{...before.field_verification,nib:{state:'user_declared'}}},before);assert.deepEqual(changed.field_verification.nib,{state:'user_declared'})
})
