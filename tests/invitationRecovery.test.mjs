import test from 'node:test'
import assert from 'node:assert/strict'
import {confirmedInvitation} from '../client/src/v2/lib/invitation.js'
const business='00000000-0000-4000-8000-000000000001',request={token:'test-token',isCurrent:()=>true}
test('invitation requires actual company acknowledgement plus own current membership readback',async()=>{
 const accept=async()=>({ok:true,business_id:business,already_member:true}),read=async()=>({state:'joined',business_id:business,role:'employee'})
 assert.equal((await confirmedInvitation(request,'ST1234',{accept,read})).business_id,business)
 await assert.rejects(confirmedInvitation(request,'ST1234',{accept,read:async()=>({state:'not_joined'})}),/invitation_not_confirmed/)
 await assert.rejects(confirmedInvitation(request,'ST1234',{accept:async()=>({ok:true}),read}),/invitation_not_confirmed/)
})
test('actor switch during acceptance never confirms or follows up under another identity',async()=>{
 let active=true,reads=0;await assert.rejects(confirmedInvitation({token:'test-token',isCurrent:()=>active},'ST1234',{accept:async()=>{active=false;return{ok:true,business_id:business}},read:async()=>{reads++}}),/invitation_actor_changed/);assert.equal(reads,0)
})
