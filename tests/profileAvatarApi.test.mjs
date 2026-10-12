import test from 'node:test'
import assert from 'node:assert/strict'
import {apiFetch,setActiveBusinessId} from '../client/src/lib/api.js'
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}
test('multipart profile upload retains pinned identity and lets the browser set the boundary',async()=>{
 setActiveBusinessId('A');let seen;const body=new FormData();body.append('avatar',new Blob(['image fixture'],{type:'image/png'}),'test.png');
 globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(JSON.stringify({ok:true,avatar_url:'owned synthetic URL'}),{headers:{'content-type':'application/json'}})}
 const request={token:'synthetic',businessId:'A',isCurrent:()=>true};await apiFetch('/me/avatar',request,{method:'POST',body});assert.equal(seen.options.body,body);assert(!Object.hasOwn(seen.options.headers,'Content-Type'));assert.equal(seen.options.headers['x-business-id'],'A');
});
test('avatar image completion is rejected after switching; successful HTML never becomes a photo',async()=>{
 let release,alive=true;globalThis.fetch=()=>new Promise(r=>release=r);const request={token:'synthetic',businessId:'A',isCurrent:()=>alive};
 const read=apiFetch('/me/avatar',request,{responseType:'avatar'});alive=false;release(new Response('image fixture',{headers:{'content-type':'image/png'}}));await assert.rejects(read,{code:'workspace_changed'});
 globalThis.fetch=async()=>new Response('<html>error</html>',{headers:{'content-type':'text/html'}});await assert.rejects(apiFetch('/me/avatar','synthetic',{responseType:'avatar'}),/avatar_response_invalid/);
});
test('avatar response type cannot bypass financial JSON acknowledgement',async()=>{
 globalThis.fetch=async()=>new Response('not JSON',{headers:{'content-type':'image/png'}});
 await assert.rejects(apiFetch('/transactions/42','synthetic',{method:'PATCH',body:{expected_version:1,amount:2},responseType:'avatar'}),{code:'financial_outcome_unknown'});
});
