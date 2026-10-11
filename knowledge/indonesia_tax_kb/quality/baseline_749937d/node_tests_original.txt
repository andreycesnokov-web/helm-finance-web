'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {retrieve,validate,loadCheckedIndex}=require('../server/lib/indonesiaTaxKnowledge.cjs');
const root=path.resolve(__dirname,'../knowledge/indonesia_tax_kb');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const questions=read('quality/questions.json');
test('at least20 substantive fixtures covering essential cases',()=>{
 assert.ok(questions.length>=20);
 for(const kind of ['simple','missing','exception','past','amended','repealed','out_of_scope','unsupported_premise','injection']) assert.ok(questions.some(q=>q.kind===kind),kind);
});
for(const q of questions) {
 test(q.id+' '+q.kind+': equivalent retrieval and safeguards RU/EN/ID',()=>{
  const answers=['ru','en','id'].map(language=>retrieve({question:q.questions[language],language,period:q.period,company:q.company}));
  for(const r of answers){
   assert.equal(r.status,q.expected_status);
   assert.equal(r.applicability.status,'undetermined');
   assert.equal(r.production_rule_activation,false);
   assert.equal(r.trust.professional_review,null);
   for(const id of q.expected_sources) assert.ok(r.sources.some(s=>s.id===id),q.id+' expected '+id+' in '+r.language);
   for(const field of q.required_missing) assert.ok(r.missing_information.includes(field),q.id+' missing '+field+' in '+r.language);
   for(const f of r.fragments){assert.equal(f.instructions_allowed,false);assert.ok(f.source_link.includes('#page='));assert.equal(f.content_role,'official_text');}
   if(q.kind==='past') assert.ok(r.gaps.some(g=>/historical|transition|review/.test(g)));
   if(q.kind==='out_of_scope'){assert.equal(r.fragments.length,0);assert.equal(r.explanations.length,0);}
  }
  const evidence=r=>r.sources.map(s=>s.id).sort();
  assert.deepEqual(evidence(answers[0]),evidence(answers[1]));assert.deepEqual(evidence(answers[1]),evidence(answers[2]));
  assert.deepEqual(answers[0].missing_information.slice().sort(),answers[1].missing_information.slice().sort());
  assert.deepEqual(answers[1].missing_information.slice().sort(),answers[2].missing_information.slice().sort());
 });
}
test('bad periods and unsupported inputs fail rather than assume today',()=>{
 for(const period of ['2026-02-30','2026','yesterday',{},'2026-13-01']) assert.throws(()=>validate({question:'PPh23',language:'en',period}));
 assert.throws(()=>validate({question:'PPh23',language:'fr'}));
 assert.throws(()=>validate({question:'',language:'en'}));
 assert.throws(()=>validate({question:'PPh23',language:'en',topics:['unknown']}));
});
test('all cards have parallel facts, assumptions, sources, examples and review limits',()=>{
 const cards=read('cards.json');assert.equal(cards.length,8);
 for(const c of cards){
  assert.ok(c.assumptions.includes('educational_only'));assert.equal(c.professional_review,null);
  for(const l of ['ru','en','id']) {assert.ok(c.translations[l].length>300);assert.ok(c.examples[l].length>70);}
  // Normalize decimal punctuation and magnitude words, rather than equating juta with one rupiah.
  const norm=s=>[...s.replace(/P3B/g,'treaty').matchAll(/(\d+(?:[.,]\d+)*)(?:\s*(million|млн|juta|thousand|тыс|ribu))?/g)].map(m=>{
    const num=Number(m[1].replace(/[.,](?=\d{3}(?:\D|$))/g,'').replace(',','.'));
    const scale=/million|млн|juta/.test(m[2]||'')?1e6:/thousand|тыс|ribu/.test(m[2]||'')?1e3:1;
    return num*scale;
  }).sort((a,b)=>a-b);
  assert.deepEqual(norm(c.examples.en),norm(c.examples.id),c.id+' educational numbers EN/ID');
  assert.deepEqual(norm(c.examples.ru),norm(c.examples.en),c.id+' educational numbers RU/EN');
 }
});
test('selected primary fragments are content-addressed and extraction-bound',()=>{
 const index=loadCheckedIndex();assert.ok(index.fragments.length>50);
 assert.equal(new Set(index.fragments.map(f=>f.id)).size,index.fragments.length);
 for(const f of index.fragments) assert.ok(f.text_quality.includes('not_OCR_certified'));
});
test('tampered archived original is rejected by retrieval',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tax-kb-test-'));
 try{
  fs.cpSync(root,dir,{recursive:true});
  const f=read('index.json').fragments[0];fs.appendFileSync(path.join(dir,'store/blobs',f.sha256+'.pdf'),'tampered');
  assert.throws(()=>retrieve({question:'PPh23',language:'en'},dir),/source_integrity_failure/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('complete profile does not imply certified applicability; caller data never stored',()=>{
 const c=read('cards.json').find(c=>c.topic==='pph23');
 const company=Object.fromEntries(c.required_fields.map(f=>[f,'declared']));company.country='ID';
 const before=JSON.stringify(company);
 const r=retrieve({question:'PPh23',language:'en',period:'2026-10-01',company});
 assert.equal(r.applicability.status,'undetermined');assert.equal(JSON.stringify(company),before);
 assert.equal(r.missing_information.length,0);assert.ok(r.gaps.length>0);
});
