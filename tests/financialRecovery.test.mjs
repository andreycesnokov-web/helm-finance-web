import {test} from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {canonicalFinancialIntent,stableJson} from '../server/lib/financialIntent.mjs'
globalThis.crypto ||= webcrypto
const jwt=(id,nonce)=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({userId:id,nonce})).toString('base64url')+'.unit-signature'
let storage,api,client,posts,reads,receipt,recent,status
const json=(body,code=200)=>new Response(JSON.stringify(body),{status:code})
test.beforeEach(async()=>{
  storage=new Map([['activeBusinessId','A'],['hf_token',jwt(-1,'first')]])
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i]||null,get length(){return storage.size}}
  const fs=await import('node:fs'),nonce=crypto.randomUUID()
  const file=new URL('../client/src/lib/api.js',import.meta.url),recovery=new URL('../client/src/lib/financialRecovery.js',import.meta.url)
  const source=fs.readFileSync(file,'utf8').replace("'./financialRecovery.js'",JSON.stringify(recovery.href+'?'+nonce)).replace("'../../../server/lib/financialIntent.mjs'",JSON.stringify(new URL('../server/lib/financialIntent.mjs',import.meta.url).href))
  api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
  client=await import(recovery.href+'?'+nonce)
  posts=[];reads=[];receipt=null;recent=[];status=null
  globalThis.fetch=async(url,options={})=>{
    if(url.includes('/financial-operations/')){
      reads.push(url)
      if(url.endsWith('/recent'))return json({operations:recent})
      if(status)return json({error:'temporary_recovery_refusal'},status)
      return receipt?json(receipt):json({error:'financial_operation_not_found',outcome:'unknown'},404)
    }
    const body=JSON.parse(options.body);posts.push(body)
    if(status)return json({error:'financial_conflict',outcome:'rolled_back'},status)
    receipt={state:'confirmed',operation:'wallet_create',request_key:body.request_key,result:{wallet:{id:'original-wallet'}},result_is_historical:true}
    throw Error('unit response lost after simulated server acknowledgement')
  }
})
const body={name:'Wallet',type:'bank',currency:'IDR',opening_balance:10,scope:'business'}

test('bill response loss and independent equivalent callers recover the original audited create without another POST',async()=>{
 const bill={type:'payable',counterparty:'Supplier',amount:'30.00',currency:'IDR',scope:'business'};
 let committed;
 globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/financial-operations/recent'))return json({operations:[]});
  if(url.includes('/financial-operations/bill_create/')){reads.push(url);return json({state:'confirmed',result:committed});}
  posts.push(JSON.parse(options.body));committed={debt:{id:123},audit_id:'audit',request_id:posts[0].request_key};throw Error('simulated commit response loss');
 };
 await assert.rejects(api.apiFetch('/debts',jwt(-1,'first'),{method:'POST',body:bill}),e=>e.code==='financial_outcome_unknown');
 const result=await api.apiFetch('/debts',jwt(-1,'second'),{method:'POST',body:{...bill,amount:30,description:null,due_date:null,invoice_date:null,invoice_number:null}});
 assert.equal(result.id,123);assert.equal(posts.length,1);assert.equal(reads.length,1);
 const key=posts[0].request_key;
 await assert.rejects(api.apiFetch('/debts',jwt(-1,'first'),{method:'POST',body:{...bill,amount:31,request_key:key}}),e=>e.code==='idempotency_key_mismatch');
 assert.equal(posts.length,1);
});
test('canonical wallet meaning is equal across Classic/V2 ordering, decimals and omitted defaults; other target/money stays distinct',()=>{
  assert.equal(stableJson(canonicalFinancialIntent('wallet_create',body)),stableJson(canonicalFinancialIntent('wallet_create',{scope:'business',opening_balance:'10.00',entity_name:null,currency:'IDR',name:'Wallet',type:'bank'})))
  assert.notDeepEqual(canonicalFinancialIntent('wallet_create',body),canonicalFinancialIntent('wallet_create',{...body,opening_balance:11}))
  assert.notDeepEqual(canonicalFinancialIntent('wallet_adjust',{target_balance:20},'wallet-A'),canonicalFinancialIntent('wallet_adjust',{target_balance:20},'wallet-B'))
})
test('credential material and explicit Personal body cannot enter canonical Business receipt',()=>{
  assert.throws(()=>canonicalFinancialIntent('wallet_create',{...body,token:'credential'}),/invalid_financial_intent/)
  assert.throws(()=>canonicalFinancialIntent('wallet_create',{...body,scope:'personal'}),/wallet_scope_mismatch/)
})
test('unknown result + renewal same actor recovers by key read only, no second money POST, no token persisted',async()=>{
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.code==='financial_outcome_unknown')
  const key=posts[0].request_key
  localStorage.setItem('hf_token',jwt(-1,'renewed'))
  const result=await api.apiFetch('/wallets',jwt(-1,'renewed'),{method:'POST',body:{...body,opening_balance:'10.0'}})
  assert.equal(result.is_replay,true);assert.equal(result.wallet.id,'original-wallet');assert.equal(posts.length,1)
  assert(reads.some(u=>u.endsWith('/'+key)))
  for(const [k,v] of storage)if(k.startsWith('financialIntent:'))assert(!v.includes('eyJ')&&!v.includes('first')&&!v.includes('renewed')&&!v.includes('Wallet'))
})
test('confirmed tombstone protects a queued second submit; explicit separate action creates a new identity',async()=>{
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}))
  await api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body})
  await api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body})
  assert.equal(posts.length,1)
  client.allowSeparateOperation('-1','A','wallet_create',posts[0].request_key)
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}))
  assert.equal(posts.length,2);assert.notEqual(posts[0].request_key,posts[1].request_key)
})
test('same explicit key edited draft is a conflict; no silently changed payload and no money POST',async()=>{
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}))
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body:{...body,opening_balance:11,request_key:posts[0].request_key}}),e=>e.code==='idempotency_key_mismatch')
  assert.equal(posts.length,1)
})
test('temporary read refusal cannot discard an unresolved key; not-found is never rollback',async()=>{
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}))
  const key=posts[0].request_key
  for(const code of [400,403,409]){status=code;await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.status===code)}
  status=null;const saved=receipt;receipt=null
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.code==='financial_outcome_unknown')
  assert.equal(client.pendingOperations('-1','A')[0].key,key);assert.equal(posts.length,1)
  receipt=saved;assert.equal((await api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body})).is_replay,true)
})
test('after missing local key, server history forces explicit review and never selects an amount/name match',async()=>{
  recent=[{operation:'wallet_create',summary:{name:'Wallet',amount:10},request_key:'server-only-key'}]
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.code==='financial_review_required')
  assert.equal(posts.length,0);assert.equal(client.pendingOperations('-1','A').length,0)
  await client.acknowledgeRecentOperations('-1','A')
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}))
  assert.equal(posts.length,1);assert.notEqual(posts[0].request_key,'server-only-key')
})
test('actor or business change does not reuse old pending identity; stale caller rejected before send',async()=>{
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}))
  localStorage.setItem('hf_token',jwt(-2,'other'))
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.code==='workspace_changed')
  api.setActiveBusinessId('B')
  receipt=null;await assert.rejects(api.apiFetch('/wallets',jwt(-2,'other'),{method:'POST',body}))
  assert.equal(posts.length,2);assert.notEqual(posts[0].request_key,posts[1].request_key)
  assert.equal(client.pendingOperations('-2','B').length,1)
})
test('known first transaction rollback is rejected, and empty success remains unknown without acknowledgement',async()=>{
  status=409
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.data.outcome==='rolled_back')
  assert.equal(client.pendingOperations('-1','A')[0].state,'rejected')
  status=null;globalThis.fetch=async(url,options)=>url.includes('/financial-operations/')?json({operations:[]}):json({})
  await assert.rejects(api.apiFetch('/wallets',jwt(-1,'first'),{method:'POST',body}),e=>e.code==='financial_outcome_unknown')
  assert.equal(client.pendingOperations('-1','A')[0].state,'unknown')
})
