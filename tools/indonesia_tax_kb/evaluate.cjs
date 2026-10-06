'use strict';
// Audit fixtures are read ONLY here and in tests, never by the retrieval module.
const fs=require('node:fs'),path=require('node:path');
const {retrieve}=require('../../server/lib/indonesiaTaxKnowledge.cjs');
const root=path.resolve(__dirname,'../../knowledge/indonesia_tax_kb'),read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const questions=read('quality/questions.json'),gold=read('quality/provision_expectations.json'),baseline=read('quality/baseline_749937d/runtime_results_78.json');
const norm=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
const records=[];
function assess(result,wants){
 const found=[...result.fragments,...result.reference_fragments,...result.historical_materials];
 const byId=new Map(found.map(f=>[f.id,f]));
 const retrieved=wants.every(w=>norm(found.filter(f=>f.source_id===w.source_id&&f.locator.article===w.article&&f.role===w.role).map(f=>f.text).join('\n')).includes(norm(w.text_anchor)));
 const claims=result.claims.every(c=>c.evidence_ids.length&&c.evidence_ids.every(id=>{
  const e=result.claim_evidence.find(e=>e.provision_id===id);if(!e)return false;
  const support=e.fragment_ids.map(id=>byId.get(id));
  return support.every(f=>f&&f.sha256===e.sha256&&f.provision_id===id&&f.locator.article===e.article&&f.role===e.role&&f.temporal_status!=='outside_period')&&norm(support.map(f=>f.text).join('\n')).includes(norm(e.text_anchor));
 }));
 const limits=result.applicability.status!=='established'&&result.numerical_use.calculations.length===0&&result.claims.every(c=>c.kind==='document_explanation');
 return {provision_retrieval:retrieved,claim_text_binding:claims,numerical_and_applicability_guards:limits};
}
let report='# Before / after78 scenarios\n\nBaseline SHA749937d1df368302e4f05480504445db0eea08d1 is preserved in baseline_749937d/.\nRuntime uses no question IDs or gold pages. New checks require provision identity, literal text anchors and exact bound versions. PASS is technical grounding/guard evidence, not tax correctness, translator review or licensed sign-off. No model calls.\n\n| Case | Language | Before page/safety check | After same page/safety check | After provision/text binding | Returned document claims | Answer |\n|---|---|---|---|---|---:|---|\n';
let examples='# Actual grounded outputs (78 runs)\n\nArchived document explanations only. Numeric and company conclusions are separately blocked. Full raw outputs are in results.json.\n';
for(const q of questions)for(const language of ['ru','en','id']){
 const result=retrieve({question:q.questions[language],language,period:q.period,company:q.company});
 const before=baseline.find(b=>b.case_id===q.id&&b.language===language);
 const found=[...result.fragments,...result.reference_fragments,...result.historical_materials];
 const pagePass=before.target_pages.every(([source_id,page])=>found.some(f=>f.source_id===source_id&&f.locator.page===page));
 const checks=assess(result,gold[q.id]);
 const record={case_id:q.id,language,question:q.questions[language],expected:q,gold:gold[q.id],
  before_page_verdict:before.targeted_retrieval_verdict,after_same_page_verdict:pagePass?'PASS':'FAIL',
  checks,verdict:Object.values(checks).every(Boolean)?'PASS':'FAIL',semantic_tax_review:'NOT_PERFORMED',actual:result};
 records.push(record);
 report+=`| ${q.id} | ${language} | ${record.before_page_verdict} | ${record.after_same_page_verdict} | ${record.verdict} | ${result.claims.length} | ${result.answer_status} |\n`;
 examples+='\n## '+q.id+' / '+language+'\n\nQuestion: '+record.question+'\n\nExpected: '+q.must.join(' ')+'\n\n'+result.notice+'\n';
 for(const c of result.claims){
  examples+='\n**'+c.id+'** — '+c.text+'\n\nBasis:\n\n';
  for(const id of c.evidence_ids){const e=result.claim_evidence.find(e=>e.provision_id===id);
   examples+='- ['+e.source_id+' article'+e.article+' / '+e.paragraphs+' / PDF'+e.pages.join(',')+']('+e.links[0]+'), SHA '+e.sha256+', fragment IDs: '+e.fragment_ids.join(',')+'.\n';}
 }
 examples+='\nBlocked claims: '+result.blocked_claims.map(c=>c.id+' ('+c.blockers.map(b=>b.code).join(',')+')').join('; ')+'.\n\nClarifications:\n\n'+result.clarifying_questions.map(q=>'- '+q.text).join('\n')+'\n\nChecks: '+JSON.stringify(checks)+'. Verdict: '+record.verdict+'.\n';
}
const summary={baseline_sha:'749937d1df368302e4f05480504445db0eea08d1',runs:records.length,
 before_page_pass:records.filter(r=>r.before_page_verdict==='PASS').length,before_page_fail:records.filter(r=>r.before_page_verdict==='FAIL').length,
 after_same_page_pass:records.filter(r=>r.after_same_page_verdict==='PASS').length,after_same_page_fail:records.filter(r=>r.after_same_page_verdict==='FAIL').length,
 after_provision_pass:records.filter(r=>r.checks.provision_retrieval).length,after_claim_binding_pass:records.filter(r=>r.checks.claim_text_binding).length,
 after_guards_pass:records.filter(r=>r.checks.numerical_and_applicability_guards).length,
 substantive_explanations:records.filter(r=>r.actual.claims.length).length,nonempty_scope_runs:records.filter(r=>r.actual.status!=='out_of_scope').length,
 model_calls:0,professional_review:null,semantic_tax_review:'NOT_PERFORMED'};
report+='\n## Counts and interpretation\n\n```json\n'+JSON.stringify(summary,null,2)+'\n```\n\n75 in-scope runs check actual provisions;3 out-of-scope runs check handling rather than source recall. The2017 rent cases correctly return historical evidence without pretending it was operative in2017. See EXPECTATION_CHANGES.md for corrections to flawed page-only gold. Refusal alone cannot pass: every other in-scope case must return supported general explanations in the Node suite.\n';
report+='\n## Failure groups fixed\n\nThe40 previous FAILs: tied Cyrillic/English words against Indonesian text and three arbitrary slices; document-registry membership mistaken for proof; page continuity and note/amendment boundaries lost. Topic/concept routing now resolves complete identified provision bundles; claims bind exact fragments/SHA/text anchors; gates remove unsupported, outside-period, stale-version and unverified numeric outputs. Topic dictionaries are generic and new paraphrases are tested. Retrieval currently favors recall within the small eight-topic corpus; precision/latency across a much larger corpus remain future evaluation work.\n';
fs.writeFileSync(path.join(root,'quality/results.json'),JSON.stringify(records,null,2)+'\n');
fs.writeFileSync(path.join(root,'quality/comparison_summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(root,'quality/RESULTS.md'),report);fs.writeFileSync(path.join(root,'quality/EXAMPLE_ANSWERS.md'),examples);
const csvEscape=v=>'"'+String(v).replace(/"/g,'""')+'"';
const columns=['case','language','question','expected','before_page','after_same_page','provision_text','claims_binding','guards','actual_claims','blockers','source_provisions','semantic_tax_review'];
const csv=[columns.join(',')];
for(const r of records)csv.push([r.case_id,r.language,r.question,r.expected.must.join(' '),r.before_page_verdict,r.after_same_page_verdict,
 r.checks.provision_retrieval?'PASS':'FAIL',r.checks.claim_text_binding?'PASS':'FAIL',r.checks.numerical_and_applicability_guards?'PASS':'FAIL',
 r.actual.claims.map(c=>c.id+': '+c.text).join('\n'),r.actual.blockers.map(b=>b.code).join(';'),r.actual.claim_evidence.map(e=>e.source_id+':'+e.article+':'+e.sha256).join(';'),'NOT_PERFORMED'].map(csvEscape).join(','));
fs.writeFileSync(path.join(root,'quality/results_78.csv'),'\uFEFF'+csv.join('\n')+'\n');
const sources=read('sources.json').sources,cards=read('cards.json'),claims=read('claims.json').claims;
let doc='# Eight cards RU/EN/ID — atomic statement catalogue\n\nEach claim has a stable ID, common evidence/period restrictions and localized text. Dependent conclusions are stored for review but are not returned by retrieve while currency/quality is unconfirmed. Original unbound text/examples are preserved in the baseline only.\n';
for(const card of cards){doc+='\n## '+card.id+' / '+card.topic+'\n';
 for(const c of claims.filter(c=>c.topic===card.topic)){doc+='\n### '+c.id+' / '+c.kind+'\n\n';
  for(const language of ['ru','en','id'])doc+='**'+language.toUpperCase()+':** '+c.translations[language]+'\n\n';
  doc+='Period limitations: '+JSON.stringify(c.period)+'. Binding: '+c.binding_status+'. Professional review: none.\n\n';
  for(const e of c.supports)doc+='- ['+e.source_id+' article'+e.article+' / '+e.paragraphs+' / pages'+e.pages.join(',')+']('+e.links[0]+'), SHA '+e.sha256+', IDs '+e.fragment_ids.join(',')+', use='+e.use+'.\n';
 }}
fs.writeFileSync(path.join(root,'CARDS.md'),doc);
console.log(JSON.stringify(summary));
if(records.some(r=>r.verdict==='FAIL'))process.exitCode=1;
