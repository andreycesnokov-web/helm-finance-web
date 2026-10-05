'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {retrieve}=require('../../server/lib/indonesiaTaxKnowledge.cjs');
const root=path.resolve(__dirname,'../../knowledge/indonesia_tax_kb');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const cards=read('cards.json'),sources=read('sources.json').sources,questions=read('quality/questions.json');
const sourceLink=ref=>{
 const s=sources.find(s=>s.id===ref.source_id);
 return `[${s.document_number}, ${ref.provision}, PDF pages ${ref.pages.join(', ')||'not downloaded'}](${s.download_url}${ref.pages.length?'#page='+ref.pages[0]:''})`;
};
let cardDoc='# Research cards RU / EN / ID\n\nThese are explanations and educational examples, not official translations or verified company-specific rules. Official Indonesian text is separate in the index and archive. No licensed review occurred.\n';
for(const c of cards){
 cardDoc+='\n## '+c.id+' '+c.topic+'\n\nRequired facts: '+c.required_fields.join(', ')+'.\n\nConditions: '+c.conditions.join(' ')+ '\n';
 for(const l of ['ru','en','id']) cardDoc+='\n### '+l.toUpperCase()+'\n\n'+c.translations[l]+'\n\n'+c.examples[l]+'\n';
 cardDoc+='\nAssumptions: '+c.assumptions.join(', ')+'.\n\nPrimary provisions:\n\n'+c.source_refs.map(ref=>'- '+sourceLink(ref)).join('\n')+'\n\nGaps: '+c.gaps.join('; ')+'.\n';
}
fs.writeFileSync(path.join(root,'CARDS.md'),cardDoc);
const results=[];
let report='# Retrieval evaluation and answer examples\n\n26 substantive cases ×3 languages =78 executions. This evaluates deterministic retrieval, input handling, citations, missing data and non-activation. It does not evaluate an LLM, certify a translation, establish current law or substitute for professional review.\n\n| Case | Kind | RU question | Retrieval checks |\n|---|---|---|---|\n';
let examples='# Deterministic example answers\n\nGenerated from the read-only retrieval output. Research explanation, example and source are separate. Applicability remains undetermined. For historical questions the card describes reference provisions; temporal warnings must be retained. These are not live `/api/accountant/ask` answers.\n';
for(const q of questions){
 const answers=['ru','en','id'].map(language=>{
  const r=retrieve({question:q.questions[language],language,period:q.period,company:q.company});
  const checks={status:r.status===q.expected_status,sources:q.expected_sources.every(id=>r.sources.some(s=>s.id===id)),
   missing:q.required_missing.every(f=>r.missing_information.includes(f)),undetermined:r.applicability.status==='undetermined',
   no_activation:r.production_rule_activation===false,no_professional_claim:r.trust.professional_review===null};
  return {language,checks,result:r};
 });
 results.push({case:q.id,expected:q,answers});
 const pass=answers.every(a=>Object.values(a.checks).every(Boolean));
 report+=`| ${q.id} | ${q.kind} | ${q.questions.ru.replace(/\|/g,'/')} | ${pass?'PASS':'FAIL'} |\n`;
 report+='';
 examples+='\n## '+q.id+' '+q.kind+'\n\nPeriod: '+(q.period||'missing')+'. Expected answer requirements: '+q.must.join(' ')+'\n';
 for(const {language,result:r} of answers){
  const card=cards.find(c=>c.topic===q.topic);
  examples+='\n### '+language.toUpperCase()+' — '+q.questions[language]+'\n\n'+r.notice+'\n';
  if(card&&r.status!=='out_of_scope'){
   examples+='\nExplanation (applicability undetermined): '+card.translations[language]+'\n\nEducational example: '+card.examples[language]+'\n\nAssumptions: '+card.assumptions.join(', ')+'.\n\nSources:\n\n'+card.source_refs.map(ref=>'- '+sourceLink(ref)).join('\n')+'\n';
  }
  examples+='\nMissing information: '+(r.missing_information.join(', ')||'none identified; review still required')+'.\n\nGaps: '+r.gaps.join('; ')+'.\n';
  if(r.contradictions.length)examples+='\nContradictions: '+r.contradictions.map(i=>i.issue).join(' ')+'\n';
 }
}
report+='\nAutomated tests also compare RU/EN/ID source sets and missing fields, normalize numeric examples, validate date inputs, reject a tampered archive, preserve company inputs and enforce undetermined applicability even with a complete profile. Python tests cover official URLs/redirects, dedup/version history, failed refresh and single-writer locking.\n\nEach fixture records exact expected sources, mandatory semantic constraints and clarification/refusal conditions in questions.json. Semantic constraints were reviewed against the corresponding authored card; no automated LLM judge or independent tax translator was used. Source-reading and currency gaps remain in REVIEW_GAPS.md.\n';
fs.writeFileSync(path.join(root,'quality/results.json'),JSON.stringify(results,null,2)+'\n');
fs.writeFileSync(path.join(root,'quality/RESULTS.md'),report);
fs.writeFileSync(path.join(root,'quality/EXAMPLE_ANSWERS.md'),examples);
console.log('evaluated',results.length*3,'failed',results.filter(q=>q.answers.some(a=>Object.values(a.checks).some(v=>!v))).length);
