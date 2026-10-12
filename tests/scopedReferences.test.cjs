const test=require('node:test'),assert=require('node:assert/strict');
const {referencePatch,TYPES}=require('../server/lib/scopedReferences');
test('reference input cannot carry ownership, permissions or rewrite system provenance',()=>{
 for(const field of ['business_id','user_id','is_system','source','sort_order','id']) assert.throws(()=>referencePatch({name:'safe',[field]:'attack'},true,'slug'),/invalid_reference_fields/);
 assert.throws(()=>referencePatch({name:'safe',code:'operating'},false,'code'),/invalid_reference_fields/);
});
test('name and state are explicit, bounded, and do not silently coerce',()=>{
 assert.deepEqual(referencePatch({name:'  A  '},true,'slug'),{name:'A'});
 assert.deepEqual(referencePatch({is_active:false},false,'slug'),{is_active:false});
 for(const name of [null,123,' ', 'A'.repeat(121)]) assert.throws(()=>referencePatch({name},true,'slug'));
 for(const state of ['false',0,null]) assert.throws(()=>referencePatch({is_active:state},false,'slug'));
 assert.throws(()=>referencePatch({},false,'code'));
});
test('reference tables and machine code input are closed allowlists',()=>{
 assert.deepEqual(TYPES.map(x=>x.table),['business_directions','activity_types']);
 assert.deepEqual(referencePatch({name:'A',code:'operating'},true,'code'),{name:'A',code:'operating'});
 assert.throws(()=>referencePatch({name:'A',code:'finance,or(scope.eq.personal)'},true,'code'));
});
