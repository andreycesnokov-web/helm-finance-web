'use strict';
const fs=require('node:fs'),path=require('node:path');
const {getCard}=require('../../server/lib/indonesiaTaxKnowledgeCards.cjs');
const root=path.resolve(__dirname,'../../knowledge/indonesia_tax_kb');
const defs=JSON.parse(fs.readFileSync(path.join(root,'tooltip_definitions.json'))),cards=[];
let md='# Accountant cards RU / EN / ID\n\nRuntime snapshots; no model, no company applicability or current-law certification. Short display: name + summary + mandatory archival notice. Sections below are expanded detail. Empty sections are unavailable, never filled from a model.\n';
for(const d of defs)for(const language of ['ru','en','id']){
 const c=getCard({topic_id:d.topic_id,language});cards.push(c);
 md+='\n## '+d.topic_id+' / '+language.toUpperCase()+' / '+c.status+'\n\n'+c.name+'\n\n'+c.required_notice+'\n';
 for(const field of ['abbreviation','what_is','how_it_works','detailed_explanation']){
  md+='\n### '+field+'\n\n';md+=c[field].length?c[field].map(s=>s.text+' ['+s.id+'; '+s.evidence_ids.join(', ')+']').join('\n\n')+'\n':'unavailable\n';
 }
 md+='\n### what_to_check\n\n'+c.what_to_check.map(q=>'- '+q.text).join('\n')+'\n';
 md+='\nRelated: '+c.related_topic_ids.join(', ')+'.\n\nAsk Accountant: '+c.ask_accountant.question+'\n\nGaps: '+(c.gaps.join(', ')||'none in documentary card; legal currency unconfirmed')+'\n';
 for(const e of c.claim_evidence)md+='\n- ['+e.source_id+' article '+e.article+' / '+e.paragraphs+' / pages '+e.pages.join(', ')+']('+e.links[0]+') SHA '+e.sha256+'; fragments '+e.fragment_ids.join(', ')+'\n';
}
fs.writeFileSync(path.join(root,'tooltip_cards.json'),JSON.stringify(cards,null,2)+'\n');
fs.writeFileSync(path.join(root,'TOOLTIPS_RU_EN_ID.md'),md);
const examples=[];
for(const language of ['ru','en','id'])for(const [kind,topic_id,period] of [['available','pph21',null],['partial','npwp_nik',null],['unavailable','pph_final_rent','2017-06-01']]){
 const card=getCard({topic_id,language,period});if(card.status!==kind)throw new Error('example_status_mismatch');
 examples.push({example_kind:kind,input:{topic_id,language,period},actual_card:card});
}
fs.writeFileSync(path.join(root,'tooltip_examples.json'),JSON.stringify(examples,null,2)+'\n');
console.log('Exported live cards:',cards.length);
