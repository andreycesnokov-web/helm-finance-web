'use strict';
const modes=['independent_writes','mixed','long_import_A','personal_parallel_business','metadata_parallel_money'];
const concurrency=[1,5,20,50];
function tapEvidence(log,exitCode){
  const counts={};for(const m of log.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)\s*$/gm))counts[m[1]]=Number(m[2]);
  const hiddenSkip=/\[SKIP\]|\bSKIP(?:PED)?\s*[—-]|isolation SKIPPED/i.test(log);
  const complete=exitCode===0&&!hiddenSkip&&counts.tests>0&&counts.pass===counts.tests
    &&counts.fail===0&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0;
  return {complete,counts,hiddenSkip};
}
function loadEvidence(value,exitCode){
  const trials=value?.results?.filter(x=>Number.isInteger(x.concurrency))||[];
  const keys=trials.map(t=>`${t.mode}:${t.concurrency}`);
  const expected=modes.flatMap(m=>concurrency.map(n=>`${m}:${n}`));
  const coverage=keys.length===20&&new Set(keys).size===20&&expected.every(k=>keys.includes(k));
  const healthy=trials.every(t=>t.attempts>0&&t.succeeded===t.attempts&&t.errors&&Object.keys(t.errors).length===0
    &&t.correctness?.ok===true&&t.correctness.final_balances?.length>0&&t.correctness.final_balances.every(b=>b.ok===true&&b.expected===b.actual)
    &&t.correctness.cross_business_provenance===0&&t.raw_latency_ms?.length===t.attempts&&t.raw_gate_roundtrip_ms?.length===t.attempts
    &&t.raw_latency_ms.every(n=>Number.isFinite(n)&&n>=0)&&t.raw_gate_roundtrip_ms.every(n=>Number.isFinite(n)&&n>=0)
    &&Number.isFinite(t.throughput_ops_s)&&t.throughput_ops_s>0&&t.timeout_count===0&&t.deadlock_count===0);
  return {complete:exitCode===0&&coverage&&healthy,coverage,healthy,trials:trials.length};
}
module.exports={tapEvidence,loadEvidence,modes,concurrency};
