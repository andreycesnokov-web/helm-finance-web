#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {score} = require('./scoring');
const manifest = require('./manifest.json');

function currentBaseline() {
  const X = require('../../server/lib/documentExtraction');
  const prior = [];
  return manifest.cases.filter(c => c.fixture_kind === 'synthetic_text').map(c => {
    const start = performance.now();
    const ex = X.extractFromText(c.source_text, {text_available:true, file_name:c.file_name});
    const dupe = X.findDuplicateDocument(ex.fields || {}, prior);
    const r = {id:c.id, route:'deterministic_text', document_type:ex.document_type,
      purpose:null, fields:ex.fields || {}, line_items:[], evidence:{}, review_required:true,
      duplicate_of:dupe.duplicate ? dupe.match?._benchmark_id || 'unresolved' : null,
      latency_ms:performance.now()-start, cost_usd:0};
    prior.push({...r.fields,_benchmark_id:c.id});
    return r;
  });
}
function report(results, parserOnly) {
  const eligible = manifest.cases.filter(c => c.fixture_kind === 'synthetic_text');
  const rows = score(eligible, results.filter(r => eligible.some(c => c.id === r.id)));
  const n = (a, b) => ({correct:a, denominator:b});
  const fields = rows.flatMap(r => r.fields);
  const positives = rows.filter(r => r.duplicate_positive);
  const costs = rows.map(r => r.cost_usd);
  return {
    scope:parserOnly ? 'parser-only synthetic text; NOT engine or model accuracy' : 'candidate claims on text fixtures; execution not independently verified',
    seed_cases:manifest.cases.length, scored_text_cases:eligible.length,
    original_binary_fixtures:0, original_file_tests:0,
    unverified_cases:manifest.cases.filter(c => c.fixture_kind !== 'synthetic_text').map(c => ({id:c.id,reason:c.fixture_kind})),
    missing_results:rows.filter(r => r.missing).length,
    document_type:n(rows.filter(r => r.type_ok).length,rows.length),
    product_purpose:n(rows.filter(r => r.purpose_ok).length,rows.length),
    technical_route:n(rows.filter(r => r.route_ok).length,rows.length),
    review_first_policy:n(rows.filter(r => r.review_ok).length,rows.length),
    scalar_fields:n(fields.filter(f => f.correct).length,fields.length),
    line_items:{matched:rows.reduce((s,r)=>s+r.line_items.matched,0),
      expected:rows.reduce((s,r)=>s+r.line_items.expected,0),actual:rows.reduce((s,r)=>s+r.line_items.actual,0)},
    duplicate_recall:positives.length ? n(positives.filter(r => r.duplicate_ok).length,positives.length) : null,
    duplicate_false_positives:rows.filter(r => r.duplicate_false_positive).length,
    extra_unscored_fields:rows.reduce((s,r)=>s+r.extra_unscored_fields.length,0),
    fully_verified:rows.filter(r => r.fully_verified).length,
    reported_api_cost_usd:costs.every(c=>c!==null) ? costs.reduce((a,b)=>a+b,0) : null,
    cost_per_correct_document:null,
    limitations:['No upload, storage, PDF decoding, OCR/Vision, spreadsheet parser, production purpose router, or UI.',
      'One partial bank transcript cannot support its expected line items; excluded until ground truth is fixed.',
      'No original page/cell evidence. No positive duplicate case has a usable fixture.',
      'Purpose is not implemented by this parser; review_required=true describes the existing confirmation policy.',
      'Extra non-null fields need ground-truth adjudication, not automatic hallucination labels.',
      '12-case seed cannot establish 99% accuracy. Missing usage/cost never becomes zero.'],
    details:rows
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const baseline = args.includes('--baseline-current');
  const i = args.indexOf('--candidate');
  if (baseline === (i >= 0)) throw new Error('Use --baseline-current OR --candidate results.json[l]');
  let results;
  if (baseline) results = currentBaseline();
  else {
    const text = fs.readFileSync(path.resolve(args[i+1]),'utf8').trim();
    results = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
    // Reject duplicate and unknown IDs even for unscored fixture descriptions.
    score(manifest.cases,results);
  }
  console.log(JSON.stringify(report(results,baseline),null,2));
}
module.exports = {currentBaseline,report};
