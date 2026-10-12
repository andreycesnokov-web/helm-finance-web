const test=require('node:test'),assert=require('node:assert/strict');
const{creationInput}=require('../server/lib/companyCreation');
test('company creation rejects forged ownership/scope and malformed inputs before any RPC',()=>{
 const currencies=['IDR','USD'];assert.deepEqual(creationInput({name:' Company ',timezone:'Asia/Jakarta'},currencies),{name:'Company',base_currency:'IDR',timezone:'Asia/Jakarta'});
 for(const body of [null,[],{name:42},{name:'  '},{name:'x',owner_user_id:1},{name:'x',type:'personal'},{name:'x',plan:'founder'},{name:'x',business_id:'foreign'},{name:'x',timezone:'Not/AZone'},{name:'x',base_currency:'FAKE'},{name:'x',country:{}},{name:'x'.repeat(121)}])assert.throws(()=>creationInput(body,currencies));
});
