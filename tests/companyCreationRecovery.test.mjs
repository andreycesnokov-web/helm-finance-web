import test from 'node:test'
import assert from 'node:assert/strict'
import * as creation from '../client/src/lib/companyCreation.js'
const token=id=>'header.'+Buffer.from(JSON.stringify({userId:id})).toString('base64url')+'.unit-signature'
const body={name:'Synthetic company',base_currency:'IDR',timezone:'Asia/Jakarta'},id='00112233-4455-6677-8899-aabbccddeeff'
let storage,posts,reads,result,queue
test.beforeEach(()=>{
 storage=new Map([['hf_token',token(-1)]]);posts=[];reads=[];result=null;queue=Promise.resolve()
 globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_key,fn)=>{const run=queue.then(fn);queue=run.catch(()=>{});return run}}}})
 globalThis.fetch=async(url,options)=>{
  assert(!options.headers['x-business-id'],'actor-only namespace has no company header')
  if(options.method==='POST'){
   posts.push(options);result={creation_request_id:options.headers['Idempotency-Key'],business:{id,type:'business',name:body.name}}
   throw Error('unit-only response loss after simulated commit')
  }
  reads.push(url);return new Response(JSON.stringify(result?{state:'completed',result}:{state:'not_found',safe_replay_same_key:true}))
 }
})
test('registration loss/reload checks the actor receipt without a second creation and preserves draft',async()=>{
 creation.saveCompanyDraft(token(-1),{name:body.name,token:'must-not-store'})
 await assert.rejects(creation.submitCompanyCreation(token(-1),body),{code:'company_creation_outcome_unknown'})
 const pending=creation.pendingCompanyCreation(token(-1));assert.equal(pending.state,'pending')
 assert.equal((await creation.checkCompanyCreation(token(-1))).result.business.id,id)
 assert.equal((await creation.submitCompanyCreation(token(-1),body)).business.id,id);assert.equal(posts.length,1);assert.equal(reads.length,1)
 assert.equal(creation.companyDraft(token(-1)).name,body.name)
 for(const[k,v]of storage)if(k.startsWith('company'))assert(!v.includes('unit-signature')&&!v.includes('must-not-store'))
 creation.finishCompanyCreation(token(-1));assert.equal(creation.pendingCompanyCreation(token(-1)),null)
})
test('unknown cannot be replaced by changed payload, a different actor or an unconfirmed clear',async()=>{
 await assert.rejects(creation.submitCompanyCreation(token(-1),body))
 await assert.rejects(creation.submitCompanyCreation(token(-1),{...body,name:'Changed'}),{code:'company_creation_pending'})
 assert.throws(()=>creation.finishCompanyCreation(token(-1)),{code:'company_creation_pending'})
 assert.equal(creation.pendingCompanyCreation(token(-2)),null);localStorage.setItem('hf_token',token(-2))
 await assert.rejects(creation.checkCompanyCreation(token(-1)),{code:'company_context_changed'});assert.equal(posts.length,1)
})
test('not-found remains pending; lost key is not recovered by guessing a company name',async()=>{
 await assert.rejects(creation.submitCompanyCreation(token(-1),body));const key=creation.pendingCompanyCreation(token(-1)).key
 result=null;assert.equal((await creation.checkCompanyCreation(token(-1))).state,'not_found');assert.equal(creation.pendingCompanyCreation(token(-1)).key,key)
 localStorage.removeItem('companyCreation:v1:-1');assert.equal(await creation.checkCompanyCreation(token(-1)),null);assert.equal(posts.length,1)
})
test('unavailable durable storage or tab serialization and invalid timezone fail before sending',async()=>{
 await assert.rejects(creation.submitCompanyCreation(token(-1),{...body,timezone:'Not/AZone'}),{code:'invalid_company_timezone'})
 navigator.locks=null;await assert.rejects(creation.submitCompanyCreation(token(-1),body),{code:'company_serialization_required'})
 navigator.locks={request:(_key,fn)=>fn()};localStorage.setItem=()=>{throw Error('blocked')}
 await assert.rejects(creation.submitCompanyCreation(token(-1),body),{code:'company_recovery_storage_required'});assert.equal(posts.length,0)
})
