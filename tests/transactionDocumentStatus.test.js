'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {enrich}=require('../server/lib/transactionDocumentStatus');
test('document status pages past the API row cap, stays scoped, and does not depend on the visible document list',async()=>{
 let scope,ids;const data=Array.from({length:1002},(_,i)=>({id:i,transaction_id:i===1001?2:1}));
 const supabase={from(table){assert.equal(table,'document_transaction_links');return{select(){return this},eq(k,v){scope=[k,v];return this},in(k,v){ids=v;return this},order(){return this},async range(start,end){return{data:data.slice(start,end+1)}}}}};
 const rows=[{id:1},{id:2},{id:3}];await enrich(supabase,'company-a',rows);
 assert.deepEqual(scope,['business_id','company-a']);assert.deepEqual(ids,[1,2,3]);
 assert.equal(rows[1].document_link_count,1);assert.equal(rows[2].document_link_count,0);assert.equal(rows[2].document_link_status_known,true);
});
test('a failed status read is unknown, never a claim that the transaction is unlinked',async()=>{
 const rows=[{id:1}];await enrich({from(){throw Error('synthetic outage')}},'company-a',rows);
 assert.equal(rows[0].document_link_status_known,false);assert.equal(rows[0].document_link_count,undefined);
});
