'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {retrieve,validate,loadCheckedIndex}=require('../server/lib/indonesiaTaxKnowledge.cjs');
const root=path.resolve(__dirname,'../knowledge/indonesia_tax_kb'),read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const questions=read('quality/questions.json'),gold=read('quality/provision_expectations.json');
const norm=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
const found=r=>[...r.fragments,...r.reference_fragments,...r.historical_materials];
function assertProofs(r){
 const fs_=new Map(found(r).map(f=>[f.id,f]));
 for(const claim of r.claims){
  assert.equal(claim.kind,'document_explanation');assert.ok(claim.evidence_ids.length);assert.equal(claim.applicability,'not_established');
  for(const eid of claim.evidence_ids){
   const e=r.claim_evidence.find(e=>e.provision_id===eid);assert.ok(e,eid);
   const list=e.fragment_ids.map(id=>fs_.get(id));assert.ok(list.every(Boolean));
   assert.ok(list.every(f=>f.provision_id===eid&&f.sha256===e.sha256&&f.locator.article===e.article&&f.role===e.role));
   assert.ok(norm(list.map(f=>f.text).join('\n')).includes(norm(e.text_anchor)));
   assert.ok(!r.historical_materials.some(f=>e.fragment_ids.includes(f.id)),'outside period used as claim basis');
  }
 }
 assert.equal(r.production_rule_activation,false);assert.equal(r.trust.professional_review,null);
 assert.deepEqual(r.numerical_use.calculations,[]);assert.deepEqual(r.applicability.eligible_basis_claim_ids,[]);
}
function assertGold(r,list){
 for(const want of list){
  const group=found(r).filter(f=>f.source_id===want.source_id&&f.locator.article===want.article&&f.role===want.role);
  assert.ok(group.length,JSON.stringify(want));
  assert.ok(norm(group.map(f=>f.text).join('\n')).includes(norm(want.text_anchor)),JSON.stringify(want));
 }
}
for(const q of questions)test(q.id+' real retrieval, provision content and claim binding in three languages',()=>{
 const results=['ru','en','id'].map(language=>retrieve({question:q.questions[language],language,period:q.period,company:q.company}));
 for(const r of results){
  assertGold(r,gold[q.id]);assertProofs(r);
  if(q.kind==='out_of_scope'){assert.equal(r.status,'out_of_scope');assert.equal(r.claims.length,0);continue;}
  for(const field of q.required_missing)assert.ok(r.clarifying_questions.some(x=>x.field===field&&x.text.length>15),field);
  if(q.id==='Q07'){assert.equal(r.claims.length,0);assert.ok(r.historical_materials.length);}
  else assert.ok(r.claims.length>0,'refusal of all explanations cannot fix search');
  if(q.id==='Q19'||q.id==='Q20')assert.ok(r.blocked_claims.some(c=>c.blockers.some(b=>b.code==='TER_table_not_verified')));
  if(q.id==='Q23'||q.id==='Q26')assert.ok(r.blockers.some(b=>b.source_id==='PMK1_2026'&&['amendment_text_unavailable','amendment_review_incomplete'].includes(b.code)));
 }
 assert.deepEqual(results[0].retrieval?.matched_provision_ids.slice().sort(),results[1].retrieval?.matched_provision_ids.slice().sort());
 assert.deepEqual(results[1].retrieval?.matched_provision_ids.slice().sort(),results[2].retrieval?.matched_provision_ids.slice().sort());
 assert.deepEqual(results[0].claims.map(c=>c.id).sort(),results[2].claims.map(c=>c.id).sort());
});
const fixture=(change,run)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tax-knowledge-v2-'));
 try{for(const name of ['sources.json','cards.json','claims.json','index.json','issues.json','clarifications.json'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
  fs.cpSync(path.join(root,'store'),path.join(dir,'store'),{recursive:true});change(dir);run(dir);
 }finally{
  const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('tax-knowledge-v2-'))throw new Error('unsafe_test_cleanup');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
};
const file=(dir,name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const write=(dir,name,d)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(d));
const rent={question:'Explain rent withholding',language:'en',period:'2026-10-01',company:{country:'ID'}};
test('empty index never returns unsupported card/rates/examples',()=>fixture(d=>write(d,'index.json',{schema_version:2,fragments:[],provisions:[]}),d=>{
 const r=retrieve(rent,d);assert.equal(r.claims.length,0);assert.equal(r.claim_evidence.length,0);assert.equal(r.answer_status,'blocked');assert.ok(r.blockers.some(b=>b.code==='no_supporting_fragments'));assert.equal(r.explanations,undefined);
}));
test('delete the actual supporting text, no registry or another article fallback',()=>fixture(d=>{
 const i=file(d,'index.json');const target=i.fragments.find(f=>f.source_id==='PP34_2017'&&f.locator.article==='3'&&/bukan sebagai pemotong/i.test(f.text));
 i.fragments=i.fragments.filter(f=>f.id!==target.id);write(d,'index.json',i);
},d=>{const r=retrieve(rent,d);assert.ok(!r.claims.some(c=>c.id==='RENT_PAYER'));assert.ok(r.blocked_claims.find(c=>c.id==='RENT_PAYER').blockers.some(b=>b.code==='supporting_fragment_missing'));assertProofs(r);}));
test('a current registry version update loses old claim confirmation',()=>fixture(d=>{
 const m=file(d,'store/manifest.json'),s=file(d,'sources.json');const old=m.sources.PP34_2017.current_sha256;
 const newBytes=Buffer.concat([fs.readFileSync(path.join(d,'store/blobs',old+'.pdf')),Buffer.from('\n%synthetic-new-version-for-test\n')]);
 const changed=crypto.createHash('sha256').update(newBytes).digest('hex');fs.writeFileSync(path.join(d,'store/blobs',changed+'.pdf'),newBytes);
 m.sources.PP34_2017.versions.push({sha256:changed,verification_status:'downloaded_unverified'});m.sources.PP34_2017.current_sha256=changed;s.sources.find(s=>s.id==='PP34_2017').sha256=changed;
 write(d,'store/manifest.json',m);write(d,'sources.json',s);
},d=>{const r=retrieve(rent,d);assert.equal(r.claims.filter(c=>c.topic==='pph_final_rent').length,0);assert.ok(r.blockers.some(b=>b.code==='source_version_changed'));assert.equal(r.fragments.length,0);assert.ok(r.historical_materials.every(f=>f.temporal_status==='superseded_version'));}));
test('a claim text anchor with no support is blocked by the real module',()=>fixture(d=>{
 const cs=file(d,'claims.json');cs.claims.find(c=>c.id==='RENT_SCOPE').supports[0].text_anchor='unsupported tax assertion';write(d,'claims.json',cs);
},d=>{const r=retrieve(rent,d);assert.ok(!r.claims.some(c=>c.id==='RENT_SCOPE'));assert.ok(r.blockers.some(b=>b.claim_id==='RENT_SCOPE'&&b.code==='text_anchor_missing'));}));
test('period outside clause window is segregated, not applicable evidence',()=>{
 const r=retrieve({...rent,period:'2017-06-01'});assert.equal(r.claims.length,0);assert.equal(r.fragments.length,0);assert.ok(r.historical_materials.some(f=>f.locator.article==='7'));assert.ok(r.blockers.some(b=>b.code==='outside_requested_period'));
});
test('unknown dates and open-ended dates cannot certify current applicability',()=>{
 const r=retrieve({question:'PPh23',language:'en',period:'2099-01-01',company:{country:'ID'}});assert.ok(r.claims.length);assertProofs(r);assert.ok(r.blockers.some(b=>b.code==='current_provision_currency_unconfirmed'));assert.ok(r.reference_fragments.length);assert.equal(r.applicability.status,'blocked');
});
test('amendment gaps propagate to PPh25/29 even without deadline keywords',()=>{
 const r=retrieve({question:'PPh25 and PPh29',language:'id',period:'2026-10-01'});assert.ok(r.blockers.some(b=>['amendment_text_unavailable','amendment_review_incomplete'].includes(b.code)&&b.source_id==='PMK1_2026'&&b.path.includes('PMK81_2024')));assert.ok(r.claims.length);assertProofs(r);
});
test('all company data still cannot produce unverified numerical TER or tax applicability',()=>{
 const c=read('cards.json').find(c=>c.topic==='pph21');const company=Object.fromEntries(c.required_fields.map(f=>[f,'declared']));company.country='ID';
 const r=retrieve({question:'Exact PPh21 TER calculation',language:'en',period:'2026-10-01',company});
 assert.ok(r.blockers.some(b=>b.code==='TER_table_not_verified'));assert.ok(!r.claims.some(c=>c.kind==='table_conclusion'));assertProofs(r);
 assert.ok(r.claims.every(c=>!/%/.test(c.text)));assert.equal(r.missing_information.length,0);assert.equal(r.applicability.status,'blocked');
});
test('insufficient profile gives concrete questions in selected language without mutating input',()=>{
 for(const language of ['ru','en','id']){const company={country:'ID'};const before=JSON.stringify(company),r=retrieve({...rent,company,language});
  assert.ok(r.clarifying_questions.some(x=>x.field==='rental_object'));assert.ok(r.clarifying_questions.every(x=>x.text.includes(language==='ru'?'Уточните':language==='en'?'Please specify':'Mohon jelaskan')));assert.equal(JSON.stringify(company),before);assert.equal(r.applicability.status,'blocked');}
});
test('article continuations/notes and amendment instructions do not absorb neighboring provisions',()=>{
 const i=loadCheckedIndex();const g=i.provisions.find(g=>g.source_id==='PMK168_2023'&&g.article==='15'&&g.role==='operative_text');const fs_=g.fragment_ids.map(id=>i.fragments.find(f=>f.id===id));
 assert.ok(fs_.some(f=>f.locator.page===15));assert.ok(fs_.some(f=>f.locator.page===16));assert.ok(fs_.every(f=>f.locator.article==='15'));assert.ok(!fs_.map(f=>f.text).join('\n').includes('Pasal 16'));
 assert.ok(i.fragments.some(f=>f.source_id==='DJP_SDSN_2023'&&f.locator.page===231&&f.locator.article===null&&f.text.includes('Ayat (2)')));
 const deletion=i.fragments.find(f=>f.source_id==='PP20_2026'&&f.text.includes('Pasal 59 dihapus'));assert.equal(deletion.role,'amendment_instruction');assert.equal(deletion.locator.article,'59');
 assert.ok(i.provisions.some(g=>g.source_id==='DJP_SDSN_2023'&&g.article==='29'&&g.related_explanation_ids.length));
 const r=retrieve({question:'PPh29',language:'en',period:'2026-10-01'});
 assert.ok(r.associated_explanations.some(g=>g.article==='29'));assert.ok(!r.associated_explanations.some(g=>g.article==='28A'));
 assert.ok(i.fragments.some(f=>f.locator.footnote_markers.length));
});
test('invalid input is rejected, period never silently defaults',()=>{
 for(const period of ['2026-02-30','2026','yesterday',{},'2026-13-01'])assert.throws(()=>validate({question:'PPh23',language:'en',period}));
 assert.throws(()=>validate({question:'',language:'en'}));assert.throws(()=>validate({question:'PPh23',language:'fr'}));assert.throws(()=>validate({question:'PPh23',language:'en',topics:['unknown']}));
 const r=retrieve({question:'PPh23',language:'en'});assert.equal(r.period,null);assert.ok(r.clarifying_questions.some(q=>q.field==='tax_period'));assert.equal(r.fragments.length,0);assertProofs(r);
});
test('altered archived bytes are rejected',()=>fixture(d=>{
 const f=file(d,'index.json').fragments[0];fs.appendFileSync(path.join(d,'store/blobs',f.sha256+'.pdf'),'tampered');
},d=>assert.throws(()=>retrieve(rent,d),/source_integrity_failure/)));
const paraphrases=[
 {topic:'ppn_pkp',claim:'VAT_JAN_TRANSITION',period:'2025-01-15',questions:{ru:'PPN: переход в январе для роскошных товаров конечному потребителю?',en:'VAT: what is the January transition for luxury goods sold to final consumers?',id:'PPN: bagaimana transisi Januari untuk barang mewah ke konsumen akhir?'}},
 {topic:'deadlines',claim:'DEADLINE_SEPARATION',period:'2026-10-01',questions:{ru:'PPh23: чем отличаются сроки уплаты и подачи?',en:'PPh23: explain payment deadlines versus filing deadlines.',id:'PPh23: jelaskan batas waktu pembayaran dibanding pelaporan.'}},
 {topic:'pph21',claim:'PAYROLL_METHOD',period:'2026-10-01',questions:{ru:'PPh21: как работает сверка в последний период сотрудника?',en:'PPh21: how does the last employee tax period reconcile earlier withholding?',id:'PPh21: bagaimana Masa Pajak Terakhir pegawai merekonsiliasi pemotongan sebelumnya?'}}
];
for(const p of paraphrases)test('new multilingual paraphrases '+p.claim,()=>{
 const rr=['ru','en','id'].map(language=>retrieve({question:p.questions[language],language,period:p.period,company:{country:'ID'}}));
 for(const r of rr){assert.ok(r.claims.some(c=>c.id===p.claim));assertProofs(r);}
 assert.deepEqual(rr[0].claims.map(c=>c.id).sort(),rr[1].claims.map(c=>c.id).sort());assert.deepEqual(rr[1].claims.map(c=>c.id).sort(),rr[2].claims.map(c=>c.id).sort());
});
