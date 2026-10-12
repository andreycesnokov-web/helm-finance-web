import test from 'node:test'
import assert from 'node:assert/strict'
import {ownProfile,accountBody,readAccountDraft,writeAccountDraft,clearAccountDraft,confirmedAccountProfile} from '../client/src/v2/lib/accountProfile.js'
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}
const token=id=>'x.'+Buffer.from(JSON.stringify({userId:id})).toString('base64url')+'.x',request={token:token(-9),isCurrent:()=>true},body=accountBody(' Updated ','Asia/Singapore'),p={user_id:-9,...body}
test('own profile never accepts another actor or an empty transport success',()=>{
 assert.deepEqual(ownProfile(request,{profile:p}),p);assert.equal(ownProfile(request,{profile:null}),null)
 assert.throws(()=>ownProfile(request,{}),/account_profile_invalid/);assert.throws(()=>ownProfile(request,{profile:{...p,user_id:-10}}),/account_profile_invalid/)
})
test('confirmation requires matching acknowledgement and fresh own read; no hidden retries',async()=>{
 let writes=0,reads=0;const write=async()=>{writes++;return{profile:p}},read=async()=>{reads++;return{profile:p}}
 assert.deepEqual(await confirmedAccountProfile(request,body,{write,read}),p);assert.equal(writes,1);assert.equal(reads,1)
 await assert.rejects(confirmedAccountProfile(request,body,{write,read:async()=>({profile:{...p,display_name:'other'}})}),/account_save_unconfirmed/)
 reads=0;await assert.rejects(confirmedAccountProfile(request,body,{write:async()=>{throw Error('lost_response')},read}),/lost_response/);assert.equal(reads,0)
})
test('switching actor during write stops confirmation and follow-up read',async()=>{
 let active=true,reads=0;await assert.rejects(confirmedAccountProfile({...request,isCurrent:()=>active},body,{write:async()=>{active=false;return{profile:p}},read:async()=>{reads++}}),/account_actor_changed/);assert.equal(reads,0)
})
test('draft/recovery belongs only to actor and contains no token or arbitrary fields',()=>{
 writeAccountDraft(request,{...body,pending:true,token:'must-not-persist',avatar_url:'not-an-allowed-draft-field'})
 assert.deepEqual(readAccountDraft(request),{...body,pending:true});assert.equal(readAccountDraft({...request,token:token(-10)}),null)
 assert(![...storage.values()].join('').includes('must-not-persist'));clearAccountDraft(request);assert.equal(readAccountDraft(request),null)
 assert.throws(()=>writeAccountDraft({...request,isCurrent:()=>false},body),/account_actor_changed/)
})
