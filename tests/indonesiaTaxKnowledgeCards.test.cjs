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
  for(const s of c.detailed_explanation){assert.equal(s.text,r.claims.find(x=>x.id===s.id).text);assert.ok(s.evidence_ids.every(id=>c.claim_evidence.some(e=>e.provision_id===id)));}
  assert.deepEqual(c.summary[0],c.detailed_explanation[0]);
  evidence.push(c.claim_evidence.map(e=>e.provision_id).sort());
 }
 assert.deepEqual(evidence[0],evidence[1]);assert.deepEqual(evidence[1],evidence[2]);
});
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
