'use strict';
const fs=require('node:fs'),path=require('node:path');
const {retrieve}=require('./indonesiaTaxKnowledge.cjs');
const ROOT=path.resolve(__dirname,'../../knowledge/indonesia_tax_kb');
// Editorial definitions contain IDs only. All displayable legal prose comes from the live evidence gate.
function getCard({topic_id,language,period=null,company={},intent='explanation'},root=ROOT){
 const definitions=JSON.parse(fs.readFileSync(path.join(root,'tooltip_definitions.json'),'utf8'));
 const def=definitions.find(d=>d.topic_id===topic_id);if(!def)throw new TypeError('unsupported_card_topic');
 const result=retrieve({question:def.ask[language],language,period,company,topics:[def.search_topic],intent},root);
 const available=new Map(result.claims.map(c=>[c.id,c]));
 const selected=def.claim_ids.map(id=>available.get(id)).filter(Boolean);
 const ids=new Set(selected.flatMap(c=>c.evidence_ids));
 const status=!selected.length?'unavailable':def.gaps.length||selected.length!==def.claim_ids.length?'partial':'available';
 const statements=selected.map(c=>({...c,statement_id:c.id}));
 return {schema_version:1,contract:'indonesia_tax_tooltip_v1',topic_id,language,
  name:def.name,designation_role:'navigation_label_not_legal_determination',status,
  coverage:'archived_document_explanation_only',summary:statements.slice(0,1),
  abbreviation:statements.slice(0,1),
  what_is:topic_id==='npwp_nik'?[]:statements.slice(0,1),how_it_works:statements.slice(1,2),
  section_status:{what_is:topic_id==='npwp_nik'||!statements.length?'unavailable':'available',how_it_works:statements.length>1?'available':'unavailable'},
  what_to_check:def.check_fields.map(field=>({field,text:JSON.parse(fs.readFileSync(path.join(root,'clarifications.json'),'utf8'))[field][language],role:'optional_check_not_assertion'})),
  detailed_explanation:statements,related_topic_ids:def.related_topic_ids,
  claim_ids:selected.map(c=>c.id),claim_evidence:result.claim_evidence.filter(e=>ids.has(e.provision_id)),
  gaps:[...def.gaps,...def.claim_ids.filter(id=>!available.has(id)).map(id=>'claim_unavailable:'+id)],
  required_notice:result.notice,verification:{text:selected.length?'runtime_checked_archival_binding':'no_supported_statements',currency:'unconfirmed',professional_review:null},
  applicability:result.applicability,numerical_use:result.numerical_use,
  blockers:result.blockers,clarifying_questions:result.clarifying_questions,
  ask_accountant:{question:def.ask[language],context:{topic_id,language,period,intent,claim_ids:selected.map(c=>c.id)},role:'user_question_not_instruction'},
  production_rule_activation:false};
}
module.exports={getCard};
