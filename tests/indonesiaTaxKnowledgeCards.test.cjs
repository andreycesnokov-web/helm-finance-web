'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {getCard}=require('../server/lib/indonesiaTaxKnowledgeCards.cjs');
const {retrieve}=require('../server/lib/indonesiaTaxKnowledge.cjs');
const root=path.resolve(__dirname,'../knowledge/indonesia_tax_kb');
const defs=JSON.parse(fs.readFileSync(path.join(root,'tooltip_definitions.json')));
for(const d of defs)test('live multilingual tooltip '+d.topic_id,()=>{
 const evidence=[];
 for(const language of ['ru','en','id']){
  const c=getCard({topic_id:d.topic_id,language});
  assert.ok(c.claim_ids.length);assert.equal(c.clarifying_questions.length,0);
  assert.equal(c.numerical_use.status,'blocked');assert.equal(c.applicability.eligible_basis_claim_ids.length,0);
  assert.equal(c.verification.professional_review,null);
  const r=retrieve({question:d.ask[language],language,topics:[d.search_topic],intent:'explanation'});
  assert.equal(c.schema_version,2);assert.equal(c.contract,'indonesia_tax_tooltip_v2');
  for(const s of [...c.summary,...c.detailed_explanation,...c.abbreviation.statements]){assert.equal(s.text,r.claims.find(x=>x.id===s.id).text);assert.ok(s.evidence_ids.every(id=>c.claim_evidence.some(e=>e.provision_id===id)));}
  assert.deepEqual(c.what_is.map(s=>s.presentation_role),c.what_is.map(()=>'definition'));
  assert.deepEqual(c.how_it_works.map(s=>s.presentation_role),c.how_it_works.map(()=>'mechanism'));
  assert.deepEqual(c.main_condition.map(s=>s.presentation_role),c.main_condition.map(()=>'condition'));
  assert.deepEqual(c.summary.map(s=>s.id),[...c.what_is,...c.how_it_works,...c.main_condition].map(s=>s.id));
  if(c.summary.length)assert.equal(c.summary[0].presentation_role,'definition');
  assert.ok(c.summary.map(s=>s.text).join(' ').split(/\s+/u).length<=50,'short reading budget');
  assert.ok(!/\b(SPT|BUT|TER|DPP|pemotong)\b/iu.test([...c.summary,...c.detailed_explanation].map(s=>s.text).join(' ')),'unexplained shorthand');
  if(d.topic_id==='npwp_nik'){assert.equal(c.abbreviation.status,'unavailable');assert.equal(c.section_status.what_is,'unavailable');assert.equal(c.section_status.how_it_works,'unavailable');}
  else {assert.equal(c.abbreviation.status,'available');assert.equal(c.abbreviation.statements[0].presentation_role,'abbreviation');assert.notEqual(c.abbreviation.statements[0].text,c.summary[0].text);}
  evidence.push(c.claim_evidence.map(e=>e.provision_id).sort());
 }
 assert.deepEqual(evidence[0],evidence[1]);assert.deepEqual(evidence[1],evidence[2]);
});
function withFixture(fn){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tax-card-roles-'));
 try{fs.cpSync(root,tmp,{recursive:true});fn(tmp);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
test('section roles survive reordering definitions and detail; wrong role is rejected',()=>withFixture(tmp=>{
 const file=path.join(tmp,'tooltip_definitions.json'),data=JSON.parse(fs.readFileSync(file));
 const def=data.find(d=>d.topic_id==='pph_final_rent');def.claim_ids.reverse();def.section_claim_ids.detailed_explanation.reverse();fs.writeFileSync(file,JSON.stringify(data));
 const c=getCard({topic_id:'pph_final_rent',language:'ru'},tmp);
 assert.equal(c.what_is[0].id,'RENT_SHORT_DEFINITION');assert.equal(c.how_it_works[0].id,'RENT_SHORT_MECHANISM');
 def.section_claim_ids.how_it_works=['RENT_SHORT_DEFINITION'];fs.writeFileSync(file,JSON.stringify(data));
 assert.throws(()=>getCard({topic_id:'pph_final_rent',language:'ru'},tmp),/card_statement_role_mismatch/);
}));
test('whole-provision support failure removes short claim even when old keyword remains',()=>withFixture(tmp=>{
 const file=path.join(tmp,'claims.json'),data=JSON.parse(fs.readFileSync(file));
 const c=data.claims.find(c=>c.id==='RENT_SHORT_DEFINITION');assert.ok(c.supports[0].text_anchors[1].length>200);
 c.supports[0].text_anchors[1]+=' missing complete supporting condition';fs.writeFileSync(file,JSON.stringify(data));
 const card=getCard({topic_id:'pph_final_rent',language:'en'},tmp);
 assert.deepEqual(card.what_is,[]);assert.deepEqual(card.summary,[]);assert.equal(card.status,'partial');
 assert.ok(card.blockers.some(b=>b.code==='text_anchor_missing'&&b.claim_id==='RENT_SHORT_DEFINITION'));
}));
test('empty index produces unavailable tooltip without fallback prose',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tax-card-'));
 try{fs.cpSync(root,tmp,{recursive:true});fs.writeFileSync(path.join(tmp,'index.json'),JSON.stringify({fragments:[],provisions:[]}));
  const c=getCard({topic_id:'pph21',language:'ru'},tmp);assert.equal(c.status,'unavailable');assert.deepEqual(c.detailed_explanation,[]);assert.deepEqual(c.summary,[]);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('separate topics and rent scope; missing identity grounding is visible',()=>{
 const a=getCard({topic_id:'pph21',language:'en'}),b=getCard({topic_id:'pph26',language:'en'});
 assert.ok(!a.claim_ids.includes('FOREIGN_SCOPE'));assert.ok(!b.claim_ids.includes('PAYROLL_METHOD'));
 assert.equal(getCard({topic_id:'npwp_nik',language:'id'}).status,'partial');
 assert.throws(()=>getCard({topic_id:'pph_final_other',language:'en'}),/unsupported_card_topic/);
 assert.ok(!getCard({topic_id:'pph25',language:'en'}).claim_ids.includes('ANNUAL_UNDERPAYMENT'));
});
test('targeted clarification has priorities and needs no financial amounts for rental classification',()=>{
 const c=getCard({topic_id:'pph_final_rent',language:'ru',intent:'company_determination'});
 assert.ok(c.clarifying_questions.some(q=>q.field==='rental_object'&&q.priority===1));
 assert.ok(!c.clarifying_questions.some(q=>q.field==='gross_rent'));
 assert.throws(()=>retrieve({question:'PPh21',language:'en',intent:'invalid'}),/invalid_intent/);
});
