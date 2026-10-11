import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
globalThis.crypto ||= webcrypto;
const api = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(new URL('../client/src/lib/api.js',import.meta.url),'utf8')).toString('base64'));
const stored=new Map();
globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
test('network loss on money request is unknown, sent once and never claims success',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('fetch failed')};
  await assert.rejects(api.apiFetch('/debts/1/pay','synthetic',{method:'POST',headers:{'Idempotency-Key':'same-intent'},body:{amount:10}}),e=>e.code==='financial_outcome_unknown'&&e.data.outcome==='unknown'&&e.data.automatic_retry===false);
  assert.equal(calls,1);
});
test('HTTP 200 HTML does not become false payment/import success',async()=>{
  globalThis.fetch=async()=>({ok:true,status:200,text:async()=>'<html>proxy</html>'});
  await assert.rejects(api.apiFetch('/bank-imports/x/confirm','synthetic',{method:'POST',body:{rows:[]}}),e=>e.code==='financial_outcome_unknown');
});
test('empty or error-shaped HTTP success cannot acknowledge a money movement',async()=>{
  for(const text of ['',JSON.stringify({ok:false,error:'proxy_failure'})]) {
    globalThis.fetch=async()=>({ok:true,status:200,text:async()=>text});
    await assert.rejects(api.apiFetch('/wallets/transfer','synthetic',{method:'POST',body:{amount:1}}),e=>e.code==='financial_outcome_unknown');
  }
});
test('controlled database conflict preserves status/code and actionable message',async()=>{
  globalThis.fetch=async()=>({ok:false,status:409,text:async()=>JSON.stringify({error:'financial_conflict',message:'Refresh before repeating.',outcome:'rolled_back',automatic_retry:false})});
  await assert.rejects(api.apiFetch('/wallets/transfer','synthetic',{method:'POST',body:{}}),e=>e.status===409&&e.code==='financial_conflict'&&e.message==='Refresh before repeating.'&&e.data.outcome==='rolled_back');
});
test('guarded creates retain intent across unknown outcome and reload, then start a new intent after confirmed success',async()=>{
  const bodies=[],body={transactions:[{type:'income',amount:5,wallet_id:'synthetic-wallet'}]};
  globalThis.fetch=async(_url,opts)=>{bodies.push(JSON.parse(opts.body));throw Error('fetch failed')};
  await assert.rejects(api.apiFetch('/transactions/batch','synthetic',{method:'POST',body}));
  const reloaded=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../client/src/lib/api.js',import.meta.url),'utf8')).toString('base64')+'#reload');
  globalThis.fetch=async(_url,opts)=>{bodies.push(JSON.parse(opts.body));return {ok:true,status:200,text:async()=>JSON.stringify({saved:1,is_replay:true})}};
  await reloaded.apiFetch('/transactions/batch','synthetic',{method:'POST',body});
  assert.equal(bodies[0].request_key,bodies[1].request_key);assert.equal(bodies.length,2);
  await reloaded.apiFetch('/transactions/batch','synthetic',{method:'POST',body});assert.notEqual(bodies[1].request_key,bodies[2].request_key);
  assert.ok([...stored.keys()].every(k=>!k.includes('synthetic')));
});
test('payment/transfer unknown outcome retains the first key even if a reopened form generates a different key',async()=>{
  for(const [path,field] of [['/debts/17/pay','idempotency_key'],['/wallets/transfer','transfer_id']]) {
    const sent=[],body={amount:5,wallet_id:'synthetic',[field]:crypto.randomUUID()};
    globalThis.fetch=async(_url,opts)=>{sent.push(JSON.parse(opts.body));throw Error('fetch failed')};
    await assert.rejects(api.apiFetch(path,'synthetic',{method:'POST',body}));
    globalThis.fetch=async(_url,opts)=>{sent.push(JSON.parse(opts.body));return{ok:true,status:200,text:async()=>JSON.stringify({ok:true,is_replay:true})}};
    await api.apiFetch(path,'synthetic',{method:'POST',body:{...body,[field]:crypto.randomUUID()}});
    assert.equal(sent[0][field],sent[1][field]);assert.equal(sent.length,2);
  }
});

test('gateway/backend 5xx preserves the original money intent instead of assuming rollback',async()=>{
  for(const status of [500,502,503,504]) {
    const sent=[],body={name:`Gateway ${status}`,currency:'USD'};
    globalThis.fetch=async(_url,opts)=>{sent.push(JSON.parse(opts.body));return{ok:false,status,text:async()=>'<html>gateway</html>'}};
    await assert.rejects(api.apiFetch('/wallets','synthetic',{method:'POST',body}),e=>e.code==='financial_outcome_unknown');
    globalThis.fetch=async(_url,opts)=>{sent.push(JSON.parse(opts.body));return{ok:true,status:200,text:async()=>JSON.stringify({wallet:{id:'synthetic'},is_replay:true})}};
    await api.apiFetch('/wallets','synthetic',{method:'POST',body});
    assert.equal(sent[0].request_key,sent[1].request_key);
  }
});
