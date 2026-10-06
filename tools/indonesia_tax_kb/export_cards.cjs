'use strict';
const fs=require('node:fs'),path=require('node:path');
const {getCard}=require('../../server/lib/indonesiaTaxKnowledgeCards.cjs');
const root=path.resolve(__dirname,'../../knowledge/indonesia_tax_kb');
const defs=JSON.parse(fs.readFileSync(path.join(root,'tooltip_definitions.json'))),cards=[];
let md='# Accountant cards RU / EN / ID — tooltip v2\n\nRuntime snapshots; no model, no company applicability or current-law certification. Short display: definition → mechanism → main condition, plus mandatory archival notice. Explicit semantic roles replace array position. Empty sections are unavailable, never filled from a model. Evidence metadata is separate from short prose.\n';
for(const d of defs)for(const language of ['ru','en','id']){
 const c=getCard({topic_id:d.topic_id,language});cards.push(c);
 md+='\n## '+d.topic_id+' / '+language.toUpperCase()+' / '+c.status+'\n\n'+c.name+'\n\n'+c.required_notice+'\n';
 md+='\n### abbreviation / '+c.abbreviation.status+'\n\n'+(c.abbreviation.statements.map(s=>s.text+' ['+s.id+']').join('\n')||'unavailable')+'\n';
 for(const field of ['summary','what_is','how_it_works','main_condition','detailed_explanation']){
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
const baseline=JSON.parse(fs.readFileSync(path.join(root,'quality/tooltip_baseline_0790a108.json')));
let comparison='# Короткие карточки: до / после\n\nДо — сохранённый снимок SHA0790a108; после — свежий вызов getCard v2. Снимок не используется поиском. Краткое сравнение RU; все27 версий ниже в JSON-проверке и TOOLTIPS_RU_EN_ID.md.\n\n|Тема|До: первое пояснение|После: определение → механизм → условие|Статус|\n|---|---|---|---|\n';
for(const c of cards.filter(c=>c.language==='ru')){
 const old=baseline.cards.find(x=>x.topic_id===c.topic_id&&x.language===c.language);
 comparison+='|'+c.topic_id+'|'+old.summary.join(' ')+'|'+(c.summary.map(s=>s.text).join(' ')||'Определение/механизм/расшифровка не подтверждены. Только подробный контекст PPh23.')+'|'+c.status+'|\n';
}
comparison+='\nРасшифровка теперь отдельное подтверждённое название на языке оригинала; у NPWP/NIK — unavailable. SPT/BUT/TER/DPP/pemotong заменены понятными эквивалентами в пояснениях; официальный текст в доказательствах не редактировался. В PPh29 механизм отдельно unavailable.\n';
fs.writeFileSync(path.join(root,'quality/TOOLTIP_BEFORE_AFTER.md'),comparison);
fs.writeFileSync(path.join(root,'quality/tooltip_content_checks.json'),JSON.stringify(cards.map(c=>({topic_id:c.topic_id,language:c.language,status:c.status,short_words:c.summary.map(s=>s.text).join(' ').trim().split(/\s+/u).filter(Boolean).length,summary_roles:c.summary.map(s=>s.presentation_role),section_status:c.section_status,abbreviation_status:c.abbreviation.status,claim_ids:c.claim_ids,evidence_ids:c.claim_evidence.map(e=>e.provision_id),currency_confirmed:false,professional_review:null})),null,2)+'\n');
console.log('Exported live cards:',cards.length);
