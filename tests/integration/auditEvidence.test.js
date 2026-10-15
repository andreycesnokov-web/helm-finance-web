'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {tapEvidence,loadEvidence,modes,concurrency}=require('./_auditEvidence');
const good='# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
test('audit rejects successful TAP with a silently skipped nested isolation script',()=>{assert.equal(tapEvidence('# [SKIP] Supabase not reachable\n'+good,0).complete,false);assert.equal(tapEvidence('# isolation SKIPPED\n'+good,0).complete,false)});
test('audit requires a successful process, complete final counters and executed assertions',()=>{assert.equal(tapEvidence(good,0).complete,true);for(const [log,exit]of[[good,1],[good,null],[good.replace('# fail 0','# fail 1'),0],[good.replace('# skipped 0','# skipped 1'),0],['# pass 2',0],[good.replace('# tests 2','# tests 0').replace('# pass 2','# pass 0'),0]])assert.equal(tapEvidence(log,exit).complete,false)});
test('nested TAP summary does not override the outer final failure',()=>{assert.equal(tapEvidence('# '+good.replaceAll('\n','\n# ')+'\n'+good.replace('# fail 0','# fail 1'),0).complete,false)});
function trial(mode,n){return {mode,concurrency:n,attempts:1,succeeded:1,errors:{},correctness:{ok:true,final_balances:[{ok:true,expected:5,actual:5}],cross_business_provenance:0},raw_latency_ms:[1],raw_gate_roundtrip_ms:[0.5],throughput_ops_s:1,timeout_count:0,deadlock_count:0}}
const all=()=>({results:modes.flatMap(m=>concurrency.map(n=>trial(m,n)))});
test('twenty duplicate load records cannot stand in for twenty distinct trials',()=>{assert.equal(loadEvidence(all(),0).complete,true);assert.equal(loadEvidence({results:Array.from({length:20},()=>trial(modes[0],1))},0).complete,false)});
test('load gate rejects hidden financial failure, missing raw evidence and process failure',()=>{for(const mutate of [x=>x.results[0].correctness.final_balances[0].actual=4,x=>x.results[0].raw_latency_ms=[],x=>x.results[0].errors['40P01']=1,x=>x.results[0].succeeded=0]){const data=all();mutate(data);assert.equal(loadEvidence(data,0).complete,false)}assert.equal(loadEvidence(all(),1).complete,false)});
