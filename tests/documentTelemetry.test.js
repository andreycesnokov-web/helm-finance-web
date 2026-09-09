'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Anthropic = require('@anthropic-ai/sdk');
const telemetry = require('../server/lib/documentTelemetry');
const OCR = require('../server/lib/documentOcr');
const BIZ = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const SECRET = 'PRIVATE-NPWP-0123456789-BANK-987654321';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const answer = (extra = {}) => ({model:'claude-sonnet-4-5-20250929',
  content:[{type:'text',text:JSON.stringify({text:SECRET,document_type:'invoice',confidence:'medium',fields:{amount:123}})}],
  usage:{input_tokens:1000,output_tokens:100},...extra});
const json = (body, status = 200) => new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json','retry-after':'0.001'}});
const sdk = fetch => new Anthropic({apiKey:'test-not-a-real-key',fetch});
function enable(t) {
  const old = process.env.DOCUMENT_OCR_VISION_ENABLED;
  process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
  t.after(()=>{if(old === undefined) delete process.env.DOCUMENT_OCR_VISION_ENABLED;
    else process.env.DOCUMENT_OCR_VISION_ENABLED=old;});
}
async function read(client, timeoutMs = 1000) {
  const events = [];
  const result = await telemetry.createRun(BIZ,DOC,e=>events.push(e)).execute(()=>
    OCR.readDocumentWithVision(Buffer.from(SECRET),{mime_type:'image/png',file_name:SECRET,client,timeoutMs}));
  return {result,events,call:events.find(e=>e.event==='model_call_finished')};
}

test('flag OFF makes no paid call and emits no model call',async t=>{
  enable(t); delete process.env.DOCUMENT_OCR_VISION_ENABLED;
  let calls=0;const r=await read(sdk(async()=>{calls++;return json(answer());}));
  assert.equal(calls,0);assert.equal(r.result.reason,'ocr_disabled');assert.equal(r.call,undefined);
});
test('successful SDK request: scoped run, actual model, usage, real attempt and tariff',async t=>{
  enable(t);let params;
  const r=await read(sdk(async(url,opts)=>{params=JSON.parse(opts.body);return json(answer());}));
  assert.equal(r.result.ok,true);assert.equal(params.model,'claude-sonnet-4-5');assert.equal(params.max_tokens,1500);
  assert.equal(r.call.requested_model,'claude-sonnet-4-5');assert.equal(r.call.actual_model,'claude-sonnet-4-5-20250929');
  assert.equal(r.call.attempts_observed,1);assert.equal(r.call.retries_observed,0);
  assert.equal(r.call.usage.input_tokens,1000);assert.equal(r.call.usage.cache_read_input_tokens,null);
  assert.equal(r.call.estimated_total_cost_usd,0.0045);assert.equal(r.call.reason,'success');
  assert.equal(r.call.tariff_version,telemetry.TARIFF_VERSION);
  for(const event of r.events){assert.equal(event.business_id,BIZ);assert.equal(event.document_id,DOC);assert.equal(event.run_id,r.call.run_id);}
  assert.equal(r.events.filter(e=>e.event==='model_attempt').length,1);
  assert.ok(r.call.duration_ms>=0);
});
test('missing usage is unknown, never zero',async t=>{
  enable(t);const r=await read(sdk(async()=>json(answer({usage:undefined}))));
  assert.equal(r.call.usage.input_tokens,null);assert.equal(r.call.usage.output_tokens,null);
  assert.equal(r.call.estimated_total_cost_usd,null);assert.equal(r.result.ok,true);
});
test('returned unpriced model and unexpected cache usage do not get an invented tariff',async t=>{
  enable(t);
  const changed=await read(sdk(async()=>json(answer({model:'claude-sonnet-future'}))));
  assert.equal(changed.call.actual_model,'claude-sonnet-future');assert.equal(changed.call.estimated_total_cost_usd,null);
  const cached=await read(sdk(async()=>json(answer({usage:{input_tokens:10,output_tokens:10,cache_creation_input_tokens:100}}))));
  assert.equal(cached.call.estimated_final_response_cost_usd,null);
  assert.equal(telemetry.estimate('claude-sonnet-4-5-20250929',
    telemetry.usageOf(answer({usage:{input_tokens:200001,output_tokens:1}}))),null);
  assert.equal(telemetry.estimate('claude-sonnet-4-5-20250929',
    telemetry.usageOf(answer({usage:{input_tokens:0,output_tokens:0}}))),0);
});
test('SDK internal retry is two attempts but one logical call; retry billing remains unknown',async t=>{
  enable(t);let calls=0;
  const r=await read(sdk(async()=> ++calls===1 ? json({error:{type:'rate_limit_error',message:SECRET}},429) : json(answer())));
  assert.equal(calls,2);assert.equal(r.call.attempts_observed,2);assert.equal(r.call.logical_calls,1);
  assert.equal(r.call.retries_observed,1);assert.equal(r.call.estimated_total_cost_usd,null);
  assert.equal(r.call.estimated_final_response_cost_usd,0.0045);assert.equal(r.call.retry_cost_usd,null);
  assert.deepEqual(r.events.filter(e=>e.event==='model_attempt').map(e=>e.http_status),[429,200]);
  assert.equal(r.events.filter(e=>e.event==='model_call_finished').length,1);
});
test('non-retryable provider error: safe reason/status, no fabricated usage',async t=>{
  enable(t);const r=await read(sdk(async()=>json({error:{type:'invalid_request_error',message:SECRET}},400)));
  assert.equal(r.result.reason,'ocr_request_failed');assert.equal(r.call.reason,'provider_error');
  assert.equal(r.call.http_status,400);assert.equal(r.call.usage.input_tokens,null);
  assert.ok(!JSON.stringify(r.events).includes(SECRET));
});
test('timeout aborts the real SDK fetch signal and keeps the manual fallback',async t=>{
  enable(t);let aborted=false;let calls=0;
  const r=await read(sdk(async(url,opts)=>{calls++;return new Promise((resolve,reject)=>{
    opts.signal.addEventListener('abort',()=>{aborted=true;reject(new Error(SECRET));},{once:true});
  });}),15);
  assert.equal(aborted,true);assert.equal(calls,1);assert.equal(r.result.reason,'ocr_timeout');
  assert.equal(r.call.abort_requested,true);assert.equal(r.call.reason,'timeout');
  assert.equal(r.call.estimated_total_cost_usd,null);
});
test('timeout during SDK retry backoff prevents a further transport attempt',async t=>{
  enable(t);let calls=0;
  const r=await read(sdk(async()=>{calls++;return new Response('{}',{status:429,
    headers:{'content-type':'application/json','retry-after':'0.060'}});}),15);
  await sleep(100);assert.equal(calls,1);assert.equal(r.call.reason,'timeout');
});
test('late response from abort-ignoring provider cannot become a second successful result',async t=>{
  enable(t);let signal;let resolveLate;
  const client={messages:{create(args,opts){signal=opts.signal;return new Promise(resolve=>{resolveLate=resolve;});}}};
  const r=await read(client,10);assert.equal(signal.aborted,true);assert.equal(r.result.reason,'ocr_timeout');
  resolveLate(answer());await sleep(20);
  assert.equal(r.events.filter(e=>e.event==='model_call_finished').length,1);
  assert.equal(r.call.reason,'timeout');assert.equal(r.call.usage.input_tokens,null);
  assert.equal(r.call.attempts_observed,null);
});
test('timers clear on success, provider error and malformed JSON; signal does not abort later',async t=>{
  enable(t);
  for(const mode of ['success','error','malformed']){
    let signal;
    const client={messages:{create(args,opts){signal=opts.signal;if(mode==='error')throw new Error(SECRET);
      return Promise.resolve(mode==='malformed'?answer({content:[{text:'not json'}]}):answer());}}};
    const r=await read(client,15);await sleep(30);assert.equal(signal.aborted,false);
    assert.equal(r.call.reason,{success:'success',error:'provider_error',malformed:'unparseable_response'}[mode]);
  }
});
test('logs contain no bytes, prompt, file name, bank details or raw provider response',async t=>{
  enable(t);const r=await read(sdk(async()=>json(answer())));
  const logs=JSON.stringify(r.events);
  for(const s of [SECRET,Buffer.from(SECRET).toString('base64'),'You are reading','test-not-a-real-key','messages','content','storage_path'])
    assert.ok(!logs.includes(s),s);
});
test('concurrent document runs have isolated IDs; shared client non-document calls are not logged',async t=>{
  enable(t);const client=sdk(async()=>json(answer()));
  const [a,b]=await Promise.all([read(client),read(client)]);
  assert.notEqual(a.call.run_id,b.call.run_id);assert.equal(a.call.attempts_observed,1);assert.equal(b.call.attempts_observed,1);
  const length=a.events.length+b.events.length;
  await client.messages.create({model:'unchanged-other-path',max_tokens:1,messages:[]});
  assert.equal(a.events.length+b.events.length,length);
});
test('broken operational logger does not change reader result',async t=>{
  enable(t);const result=await telemetry.createRun(BIZ,DOC,()=>{throw new Error('logger unavailable');}).execute(()=>
    OCR.readDocumentWithVision(Buffer.from('scan'),{mime_type:'image/png',client:sdk(async()=>json(answer()))}));
  assert.equal(result.ok,true);
});

test('actual shared reader runs stages with scoped reads only, no financial or other DB writes',async t=>{
  enable(t);
  const source=fs.readFileSync(path.join(__dirname,'../server/index.js'),'utf8');
  const reader=source.slice(source.indexOf('async function readDocumentForIntake('),source.indexOf('async function runDocumentIntake('));
  assert.ok(reader.length>1000);
  const accesses=[];const writes=[];const filters=[];const events=[];
  const forbidden=()=>{writes.push('mutation');throw new Error('No writes permitted');};
  const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},
    limit:async()=>({data:[{id:'file',storage_path:SECRET,file_name:SECRET,mime_type:'image/png'}]}),
    insert:forbidden,update:forbidden,delete:forbidden,upsert:forbidden};
  const supabase={from(table){accesses.push(table);assert.equal(table,'document_files');return query;},rpc:forbidden,
    storage:{from:()=>({download:async()=>({data:{arrayBuffer:async()=>Buffer.from('synthetic scan')}})})}};
  const fn=vm.runInNewContext(reader+'\nreadDocumentForIntake',{
    Buffer,supabase,DOC_BUCKET:'synthetic',documentTelemetry:{createRun:(b,d)=>telemetry.createRun(b,d,e=>events.push(e))},
    docOcr:OCR,anthropic:sdk(async()=>json(answer())),extractPdfText:()=>{throw new Error('Not a PDF');},
    docExtract:require('../server/lib/documentExtraction'),docDates:require('../server/lib/documentDates'),
    docParties:require('../server/lib/documentParties'),
  });
  const result=await fn({business:{id:BIZ}},{id:DOC,file_id:'file',document_type:'invoice'});
  assert.equal(result.ocr.ok,true);assert.deepEqual(accesses,['document_files']);assert.deepEqual(writes,[]);
  assert.deepEqual(filters,[['id','file'],['business_id',BIZ]]);
  assert.deepEqual(events.filter(e=>e.event==='stage_finished').map(e=>e.stage),
    ['file_lookup','download','pdf_text','field_parse','vision','dates_parties']);
  assert.ok(!JSON.stringify(events).includes(SECRET));
});
