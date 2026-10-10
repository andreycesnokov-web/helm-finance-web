'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {equal,items,evidence,score} = require('./scoring');
const {report,currentBaseline} = require('./run');
const fixture = {id:'one',fixture_kind:'synthetic_text',source_text:'Total 0',expected:{
  fields:{amount:0,reference:null},line_items:[{description:'A',amount:1}],duplicate_of:null,
  evidence:{amount:{quote:'Total 0'}},document_type:'invoice',purpose:'payment_request',technical_routes:['parser','vision']}};
test('missing/blank/null/boolean must not equal numeric zero',()=>{
  for(const v of [undefined,null,'',false]) assert.equal(equal(v,0),false);
  assert.equal(equal(0,0),true); assert.equal(equal('0',0),true);
  assert.equal(equal(undefined,null),false); assert.equal(equal(null,null),true);
});
test('missing answer retains every expected field and item denominator',()=>{
  const [r]=score([fixture],[]);assert.equal(r.missing,true);assert.equal(r.fields.length,2);
  assert.equal(r.fields.filter(f=>f.correct).length,0);assert.equal(r.line_items.expected,1);
  assert.equal(r.duplicate_ok,false);
});
test('extra fields are surfaced; null extras are not fabricated data',()=>{
  const [r]=score([fixture],[{id:'one',fields:{unexpected:5,nullable:null}}]);
  assert.deepEqual(r.extra_unscored_fields,['unexpected']);assert.equal(r.fully_verified,false);
});
test('line items penalize repeated, missing, and extra rows or populated columns',()=>{
  const e=[{description:'A',amount:1}];assert.equal(items([...e,...e],e).exact,false);
  assert.equal(items([],e).matched,0);assert.equal(items([{...e[0],invented:1}],e).matched,0);
  assert.equal(items(undefined,[]).exact,false);
});
test('duplicate is explicit; missing null is not a true negative',()=>{
  assert.equal(score([fixture],[{id:'one'}])[0].duplicate_ok,false);
  assert.equal(score([fixture],[{id:'one',duplicate_of:'other'}])[0].duplicate_false_positive,true);
});
test('candidate ID collisions and unknown IDs are rejected',()=>{
  assert.throws(()=>score([fixture],[{id:'one'},{id:'one'}]));assert.throws(()=>score([fixture],[{id:'other'}]));
});
test('multiple technical routes do not change product purpose correctness',()=>{
  for(const route of ['parser','vision']) assert.equal(score([fixture],[{id:'one',route}])[0].route_ok,true);
  assert.equal(score([fixture],[{id:'one',route:'vision',purpose:'wrong'}])[0].purpose_ok,false);
});
test('evidence requires source quote AND supporting value',()=>{
  assert.equal(evidence({quote:'Total 500'},500,{text:'Total 50'}),'quote_not_in_source');
  assert.equal(evidence({quote:'Total 50'},5,{text:'Total 50'}),'value_not_supported');
  assert.equal(evidence({quote:'Total Rp 12.500.000'},12500000,{text:'Total Rp 12.500.000'}),'supported');
  assert.equal(evidence({quote:'Total 0'},0,{text:'Total 0'}),'supported');
});
test('page and cell claims must match a real source location',()=>{
  assert.equal(evidence({page:1,quote:'Total 50'},50,{text:'Total 50'}),'unverifiable_location');
  assert.equal(evidence({page:2,quote:'Total 50'},50,{pages:{1:'Total 50',2:'Nothing'}}),'quote_not_in_source');
  assert.equal(evidence({cell:'Sheet!B2',quote:'50'},50,{cells:{'Sheet!B2':'60'}}),'quote_not_in_source');
  assert.equal(evidence({quote:'50'},50,null),'unverifiable_source');
});
test('baseline only runs five complete text fixtures; cannot measure duplicate recall',()=>{
  const r=report(currentBaseline(),true);assert.equal(r.seed_cases,12);assert.equal(r.scored_text_cases,5);
  assert.equal(r.original_file_tests,0);assert.equal(r.duplicate_recall,null);assert.equal(r.cost_per_correct_document,null);
});
test('missing cost stays unknown, not zero',()=>assert.equal(report([],false).reported_api_cost_usd,null));
