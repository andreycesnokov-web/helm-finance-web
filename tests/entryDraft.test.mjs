import test from 'node:test'
import assert from 'node:assert/strict'
import {entryDraftKey,readEntryDraft,writeEntryDraft} from '../client/src/v2/lib/entryDraft.js'
const A='11111111-1111-1111-1111-111111111111',B='22222222-2222-2222-2222-222222222222'
const draft={type:'expense',amount:'7',wallet_id:'wallet-A',date:'2026-10-03',description:'Synthetic draft',category:''}
function storage(){const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
test('draft reload preserves raw fields separately for actor and Business; never persists credentials',()=>{const s=storage(),key=entryDraftKey(501,A);assert(writeEntryDraft(s,key,{...draft,token:'never-store',request_key:'not-a-draft'}));assert.deepEqual(readEntryDraft(s,key),draft);assert.equal(readEntryDraft(s,entryDraftKey(501,B)),null);assert.equal(readEntryDraft(s,entryDraftKey(502,A)),null);assert(!s.getItem(key).includes('never-store'));assert(!s.getItem(key).includes('request_key'));assert.equal(entryDraftKey(501,null),null)})
test('invalid/blocked storage is honest and clearing A cannot clear B',()=>{const s=storage(),a=entryDraftKey(501,A),b=entryDraftKey(501,B);writeEntryDraft(s,a,draft);writeEntryDraft(s,b,{...draft,type:'income'});writeEntryDraft(s,a,{...draft,amount:'',description:'',category:''});assert.equal(readEntryDraft(s,a),null);assert.equal(readEntryDraft(s,b).type,'income');s.setItem(a,'{bad');assert.equal(readEntryDraft(s,a),null);assert.equal(writeEntryDraft({setItem(){throw Error('blocked')}},a,draft),false)})
