import {test} from 'node:test'
import assert from 'node:assert/strict'
import {apiFetch} from '../client/src/lib/api.js'
const stored=new Map()
globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,String(v)),removeItem:k=>stored.delete(k)}
// Keyed cases are strengthened in financialRecovery.test.mjs: manual resubmit
// reads the receipt, and a separate identical booking needs explicit new intent.
test('network loss on a non-receipted money PATCH is unknown, sent once and never claims success',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('fetch failed')}
 await assert.rejects(apiFetch('/transactions/1','synthetic',{method:'PATCH',body:{amount:10}}),e=>e.code==='financial_outcome_unknown'&&e.data.outcome==='unknown'&&e.data.automatic_retry===false)
 assert.equal(calls,1)
})
test('HTTP200 HTML cannot become import success',async()=>{
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>'<html>proxy</html>'})
 await assert.rejects(apiFetch('/bank-imports/x/confirm','synthetic',{method:'POST',body:{rows:[]}}),e=>e.code==='financial_outcome_unknown')
})
test('reading a statement file is not a money mutation: an unreadable file returns its reason',async()=>{
 const answer={ok:false,reason:'unknown_format',file_name:'export.csv',is_sheet:false}
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify(answer)})
 assert.deepEqual(await apiFetch('/bank-import/read','synthetic',{method:'POST',body:{document_id:'d'}}),answer)
 // The batch and confirm writes keep the strict financial acknowledgement.
 await assert.rejects(apiFetch('/bank-import/batches','synthetic',{method:'POST',body:{rows:[]}}),e=>e.code==='financial_outcome_unknown')
})
test('empty/error-shaped HTTP success cannot acknowledge a financial PATCH',async()=>{
 for(const text of ['',JSON.stringify({ok:false,error:'proxy_failure'})]){
  globalThis.fetch=async()=>({ok:true,status:200,text:async()=>text})
  await assert.rejects(apiFetch('/transactions/1','synthetic',{method:'PATCH',body:{amount:10}}),e=>e.code==='financial_outcome_unknown')
 }
})
test('controlled database conflict retains status/code/actionable message',async()=>{
 globalThis.fetch=async()=>({ok:false,status:409,text:async()=>JSON.stringify({error:'financial_conflict',message:'Refresh before repeating.',outcome:'rolled_back',automatic_retry:false})})
 await assert.rejects(apiFetch('/transactions/1','synthetic',{method:'PATCH',body:{amount:10}}),e=>e.status===409&&e.code==='financial_conflict'&&e.message==='Refresh before repeating.'&&e.data.outcome==='rolled_back')
})
test('gateway/backend5xx never imply a rolled-back non-receipted money mutation',async()=>{
 for(const status of [500,502,503,504]){
  let calls=0;globalThis.fetch=async()=>{calls++;return{ok:false,status,text:async()=>'<html>gateway</html>'}}
  await assert.rejects(apiFetch('/transactions/1','synthetic',{method:'PATCH',body:{amount:10}}),e=>e.code==='financial_outcome_unknown'&&e.data.outcome==='unknown')
  assert.equal(calls,1)
 }
})
