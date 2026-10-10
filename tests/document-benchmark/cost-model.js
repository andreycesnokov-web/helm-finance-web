#!/usr/bin/env node
'use strict';
const catalog = require('./model-catalog.json');
const assumptions = {
  input_tokens:6000, output_tokens:600, additional_attempts_per_call:0.05,
  result_cache_hit:0.20, parser_usd:0.001, storage_usd:0.002, external_ocr_usd:0,
  hourly_review_usd:8, quick_confirmation_seconds:15, correction_minutes:3
};
function calculate({routes,correction_rate=0.10}, a=assumptions) {
  const firstApi = routes.reduce((sum,{id,share})=>{
    const p=catalog.models.find(m=>m.id===id);
    if(!p) throw new Error('Unverified model ID');
    return sum+share*(a.input_tokens*p.input+a.output_tokens*p.output)/1e6;
  },0)*(1-a.result_cache_hit);
  const retries = firstApi*a.additional_attempts_per_call;
  const confirmation = a.quick_confirmation_seconds/3600*a.hourly_review_usd;
  const correction = correction_rate*a.correction_minutes/60*a.hourly_review_usd;
  return {api_first_attempts:firstApi,retries_assuming_full_billing:retries,
    parser:a.parser_usd,storage:a.storage_usd,external_ocr:a.external_ocr_usd,
    human_quick_confirmation_all_documents:confirmation,human_extra_correction:correction,
    total:firstApi+retries+a.parser_usd+a.storage_usd+a.external_ocr_usd+confirmation+correction,
    cost_per_correct_document:null};
}
const variants=[
  {name:'Current-reader planning example (assumed 55% Vision, no cache)',routes:[{id:'claude-sonnet-4-5-20250929',share:0.55}],cache:0},
  {name:'A: universal Opus, hypothetical result cache',routes:[{id:'claude-opus-5',share:1}]},
  {name:'B: parser + Flash, 12% also escalated',routes:[{id:'gemini-3.8-flash',share:0.55},{id:'claude-opus-5',share:0.12}]},
  {name:'C: parser + Flash-Lite, 8% also escalated',routes:[{id:'gemini-3.5-flash-lite',share:0.38},{id:'claude-opus-5',share:0.08}]}
];
if(require.main===module) console.log(JSON.stringify({
  status:'ILLUSTRATIVE ONLY. No measured savings, quality rates, token volumes, routing shares or review durations.',
  tariff_date:catalog.verified_at,assumptions,
  notes:['Every document receives a 15-second confirmation; 10% additionally need 3-minute correction.',
    'A-C cache and route shares are hypothetical, not implemented; current reader example has no cache.',
    'Retry cost assumes each extra attempt bills a full read; timeouts may cost money without returned usage.',
    'Parser/storage allowances and zero external OCR are assumptions; no cloud invoice measured.',
    'Reasoning/image/page tokenization and long-context/promo changes require recalculation.',
    'No provider benchmark executed; cost per correct document is unknown.'],
  variants:variants.map(v=>{const costs=calculate(v,{...assumptions,result_cache_hit:v.cache??assumptions.result_cache_hit});
    return {name:v.name,routes:v.routes,costs,per_100:costs.total*100,per_1000:costs.total*1000,per_10000:costs.total*10000};})
},null,2));
module.exports={calculate,assumptions};
