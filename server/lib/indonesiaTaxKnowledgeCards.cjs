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
 const sections=def.section_claim_ids;
 if(def.schema_version!==2||!sections)throw new Error('unsupported_card_definition_schema');
 const roles={what_is:'definition',how_it_works:'mechanism',main_condition:'condition',abbreviation:'abbreviation'};
 for(const [field,role] of Object.entries(roles))for(const id of sections[field]){
  const c=available.get(id);if(c&&!c.presentation_roles.includes(role))throw new Error('card_statement_role_mismatch');
 }
 const statements=field=>field==='summary'&&!sections.what_is.some(id=>available.has(id))?[]:sections[field].map(id=>available.get(id)).filter(Boolean).map(c=>({...c,statement_id:c.id,presentation_role:roles[field]||c.presentation_roles[0]||'expanded_explanation'}));
 const summaryOrder=['what_is','how_it_works','main_condition'].flatMap(field=>sections[field]);
 if(JSON.stringify(summaryOrder)!==JSON.stringify(sections.summary))throw new Error('card_summary_role_order_mismatch');
 const sectionStatus=field=>!sections[field].length||!statements(field).length?'unavailable':statements(field).length===sections[field].length?'available':'partial';
 const status=!selected.length?'unavailable':def.gaps.length||selected.length!==def.claim_ids.length||['what_is','how_it_works','main_condition'].some(f=>sectionStatus(f)!=='available')?'partial':'available';
 return {schema_version:2,contract:'indonesia_tax_tooltip_v2',topic_id,language,
  name:def.name,designation_role:'navigation_label_not_legal_determination',status,
  coverage:'archived_document_explanation_only',summary:statements('summary'),
  abbreviation:{status:sectionStatus('abbreviation'),designation_language:'id',statements:statements('abbreviation')},
  what_is:statements('what_is'),how_it_works:statements('how_it_works'),main_condition:statements('main_condition'),
  section_status:Object.fromEntries(['what_is','how_it_works','main_condition','summary','detailed_explanation'].map(f=>[f,sectionStatus(f)])),
  unavailable_section_notice:{ru:'Для этого раздела недостаточно подтверждённых оснований.',en:'There is insufficient confirmed evidence for this section.',id:'Bukti terkonfirmasi belum cukup untuk bagian ini.'}[language],
  what_to_check:def.check_fields.map(field=>({field,text:JSON.parse(fs.readFileSync(path.join(root,'clarifications.json'),'utf8'))[field][language],role:'optional_check_not_assertion'})),
  detailed_explanation:statements('detailed_explanation'),related_topic_ids:def.related_topic_ids,
  claim_ids:selected.map(c=>c.id),claim_evidence:result.claim_evidence.filter(e=>ids.has(e.provision_id)),
  gaps:[...def.gaps,...def.claim_ids.filter(id=>!available.has(id)).map(id=>'claim_unavailable:'+id)],
  required_notice:selected.length?{ru:'Архивное пояснение. Актуальность и обязанности компании не подтверждены.',en:'Archived explanation; current rules and company applicability are unconfirmed.',id:'Penjelasan arsip; aturan terkini dan penerapan perusahaan belum dikonfirmasi.'}[language]:result.notice,
  verification:{text:selected.length?'runtime_checked_archival_binding':'no_supported_statements',currency:'unconfirmed',professional_review:null},
  applicability:result.applicability,numerical_use:result.numerical_use,
  blockers:result.blockers,clarifying_questions:result.clarifying_questions,
  ask_accountant:{question:def.ask[language],context:{topic_id,language,period,intent,claim_ids:selected.map(c=>c.id)},role:'user_question_not_instruction'},
  production_rule_activation:false};
}
module.exports={getCard};
