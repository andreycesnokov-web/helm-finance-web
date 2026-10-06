'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const vocabulary=require('./indonesiaTaxKnowledgeQueries.cjs');
const ROOT=path.resolve(__dirname,'../../knowledge/indonesia_tax_kb');
const read=(root,name)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const wording={
 ru:{notice:'Объяснения относятся к прочитанному архивному тексту; действующая применимость к компании не подтверждена.',blocked:'Недостаточно подтверждённых оснований для налогового вывода.',outside:'Вопрос вне текущего охвата базы.',history:'Материал относится к другой редакции/периоду и не является основанием применимого ответа.'},
 en:{notice:'Explanations describe the read archived text; current company applicability is not established.',blocked:'There is insufficient confirmed evidence for a tax determination.',outside:'The question is outside the knowledge scope.',history:'This material belongs to another edition/period and is not a basis for an applicable answer.'},
 id:{notice:'Penjelasan menggambarkan teks arsip yang dibaca; penerapan terkini pada perusahaan belum ditetapkan.',blocked:'Bukti terkonfirmasi belum cukup untuk menentukan pajak.',outside:'Pertanyaan di luar cakupan pengetahuan.',history:'Materi ini terkait edisi/periode lain dan bukan dasar jawaban yang berlaku.'}
};
function validDate(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function validate(x){
 if(!x||typeof x.question!=='string'||!x.question.trim()||x.question.length>4000)throw new TypeError('invalid_question');
 if(!wording[x.language])throw new TypeError('unsupported_language');
 if(x.period!=null&&!validDate(x.period))throw new TypeError('period_must_be_iso_date');
 if(x.company!=null&&(typeof x.company!=='object'||Array.isArray(x.company)))throw new TypeError('invalid_company');
 if(x.topics&&(!Array.isArray(x.topics)||x.topics.some(t=>!vocabulary.topics[t])))throw new TypeError('unsupported_topic');
}
function loadCheckedIndex(root=ROOT){
 const index=read(root,'index.json');const checked=new Map();
 for(const f of index.fragments){
  if(!/^[a-f0-9]{64}$/.test(f.sha256))throw new Error('invalid_source_hash');
  if(!checked.has(f.sha256)){
   if(hash(fs.readFileSync(path.join(root,'store/blobs',f.sha256+'.pdf')))!==f.sha256)throw new Error('source_integrity_failure');
   const bytes=fs.readFileSync(path.join(root,'store/extracted',f.sha256+'.json'));
   checked.set(f.sha256,{hash:hash(bytes),data:JSON.parse(bytes)});
  }
  const ex=checked.get(f.sha256),p=ex.data.pages.find(p=>p.page===f.locator.page);
  if(ex.hash!==f.extraction_sha256||!p||p.quality==='unreliable'||p.text.slice(f.locator.start,f.locator.end).trim()!==f.text)throw new Error('extraction_integrity_failure');
 }
 return index;
}
const normalized=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
function temporal(period,from,to){
 if(!period)return 'period_missing';
 if((from&&period<from)||(to&&period>to))return 'outside_period';
 return from?'within_recorded_window_currency_unconfirmed':'undated_reference';
}
// Follow only known amendment links. Missing texts are blockers, never guessed amendment contents.
function dependencyBlockers(ids,registry,manifest){
 const seen=new Set(),queue=ids.map(id=>({id,path:[id]})),out=[];
 while(queue.length){
  const item=queue.shift();if(seen.has(item.id))continue;seen.add(item.id);
  const source=registry.get(item.id);
  if(!source){out.push({code:'dependency_source_missing',source_id:item.id,path:item.path});continue;}
  if(source.verification_status==='download_failed'||!manifest.sources[item.id]?.current_sha256)
   out.push({code:'amendment_text_unavailable',source_id:item.id,path:item.path,content_unknown:true});
  for(const rel of source.relationships||[])if(rel.type==='amended_by')queue.push({id:rel.target,path:[...item.path,rel.target]});
 }
 return out;
}
const administrativeTopics=new Set(['deadlines','pph21','pph23','pph26','pph_final_rent','pph25_29','ppn_pkp']);
function retrieve(input,root=ROOT){
 validate(input);const lang=input.language,m=wording[lang],company=input.company||{};
 const topics=input.topics||Object.keys(vocabulary.topics).filter(t=>vocabulary.topics[t].test(input.question));
 const out={schema_version:2,language:lang,period:input.period||null,research_as_of:read(root,'sources.json').research_as_of,
  status:'research_only',answer_status:'blocked',notice:m.blocked,topics,document_registry:[],fragments:[],reference_fragments:[],historical_materials:[],
  claim_evidence:[],claims:[],blocked_claims:[],additional_reading:[],associated_explanations:[],blockers:[],clarifying_questions:[],missing_information:[],
  evidence_sufficiency:{status:'insufficient',scope:'archived_document_explanation_only'},
  applicability:{status:'not_established',eligible_basis_claim_ids:[],professional_review:null},
  numerical_use:{status:'blocked',calculations:[],TER:'blocked_unverified_table'},production_rule_activation:false,
  trust:{document_content:'untrusted_data',professional_review:null},contradictions:[]};
 if((company.country&&!['id','indonesia'].includes(String(company.country).toLowerCase()))||!topics.length){out.status='out_of_scope';out.notice=m.outside;out.blockers.push({code:'out_of_scope'});return out;}
 const registryData=read(root,'sources.json').sources,registry=new Map(registryData.map(s=>[s.id,s]));
 const manifest=read(root,'store/manifest.json'),index=loadCheckedIndex(root),byId=new Map(index.fragments.map(f=>[f.id,f]));
 const cards=read(root,'cards.json'),all=read(root,'claims.json').claims,prompts=read(root,'clarifications.json');
 const concepts=Object.keys(vocabulary.concepts).filter(c=>vocabulary.concepts[c].test(input.question));
 // Retrieve complete semantic provision bundles for the small topic corpus. Ranking affects presentation,
 // not a three-page quota. Legal article/text anchors, not test IDs or target page numbers, bind the corpus.
 const selected=all.filter(c=>topics.includes(c.topic)).sort((a,b)=>
  b.concepts.filter(c=>concepts.includes(c)).length-a.concepts.filter(c=>concepts.includes(c)).length||a.id.localeCompare(b.id));
 const wanted=new Set(selected.flatMap(c=>c.supports.flatMap(s=>s.fragment_ids)));
 const retrieved=index.fragments.filter(f=>wanted.has(f.id));
 const seenEvidence=new Set(),history=new Map(),refs=new Map(),applicableFragments=new Map();
 const sourceIsCurrent=(sid,sha)=>registry.get(sid)?.sha256===sha&&manifest.sources[sid]?.current_sha256===sha;
 for(const c of selected){
  const problems=[];const evidence=[];
  if(c.binding_status!=='bound')problems.push({code:'claim_binding_incomplete'});
  const tc=temporal(input.period,c.period.from,c.period.to);
  for(const s of c.supports){
   const fs_=s.fragment_ids.map(id=>byId.get(id));
   if(s.use==='reading_reference'){
    for(const f of fs_.filter(Boolean))refs.set(f.id,{...f,use:'additional_reading_not_claim_basis'});
    continue;
   }
   if(fs_.some(f=>!f))problems.push({code:'supporting_fragment_missing',provision_id:s.provision_id,fragment_ids:s.fragment_ids.filter(id=>!byId.has(id))});
   if(!sourceIsCurrent(s.source_id,s.sha256))problems.push({code:'source_version_changed',source_id:s.source_id,expected_sha256:s.sha256,current_sha256:manifest.sources[s.source_id]?.current_sha256||null});
   if(fs_.filter(Boolean).some(f=>f.sha256!==s.sha256||f.provision_id!==s.provision_id||f.locator.article!==s.article||f.role!==s.role))problems.push({code:'support_identity_mismatch',provision_id:s.provision_id});
   const text=fs_.filter(Boolean).map(f=>f.text).join('\n');
   if(!normalized(text).includes(normalized(s.text_anchor)))problems.push({code:'text_anchor_missing',provision_id:s.provision_id});
   const st=temporal(input.period,s.source_period.from,s.source_period.to);
   if(st==='outside_period')problems.push({code:'support_outside_requested_period',provision_id:s.provision_id,recorded_window:s.source_period});
   for(const original of fs_.filter(Boolean)){
    const f={...original,instructions_allowed:false,content_role:original.role==='explanation'?'official_explanation':'official_text'};
    if(!sourceIsCurrent(s.source_id,s.sha256))history.set(f.id,{...f,temporal_status:'superseded_version',use:'superseded_reference_only',notice:m.history});
    else if(tc==='outside_period'||st==='outside_period')history.set(f.id,{...f,temporal_status:'outside_period',use:'historical_reference_only',notice:m.history});
    else if(tc==='undated_reference'||st==='undated_reference'||!input.period)refs.set(f.id,{...f,temporal_status:tc,use:'undated_or_period_missing_reference_only'});
    else applicableFragments.set(f.id,{...f,temporal_status:tc,use:'archival_text_within_recorded_window_not_current_law'});
   }
   evidence.push({...s,evidence_status:'text_grounded_archival_not_legal_currency_reviewed',temporal_status:st});
  }
  if(tc==='outside_period')problems.push({code:'outside_requested_period',recorded_window:c.period});
  const dependencies=dependencyBlockers([...new Set([...c.supports.map(s=>s.source_id),...c.dependencies])],registry,manifest);
  if(c.kind!=='document_explanation'){
   if(!input.period)problems.push({code:'tax_period_missing'});
   if(tc==='undated_reference')problems.push({code:'provision_dates_unconfirmed'});
   // An open ended date or a download status is never currency evidence. No source in this pass is
   // certified current for the requested provision/period. No licensed determination is synthesized.
   problems.push({code:'current_provision_currency_unconfirmed'});
   problems.push(...dependencies);
   if(c.kind==='table_conclusion')problems.push({code:'TER_table_not_verified'});
  }
  if(problems.length){out.blocked_claims.push({id:c.id,topic:c.topic,kind:c.kind,blockers:problems});
   out.blockers.push(...problems.map(p=>({...p,claim_id:c.id})));continue;}
  // General explanation is explicitly documentary, not a period/company tax determination.
  const scope=tc==='undated_reference'||tc==='period_missing'?'archived_document_reference':'archived_document_explanation';
  out.claims.push({id:c.id,topic:c.topic,kind:c.kind,scope,text:c.translations[lang],evidence_ids:evidence.map(s=>s.provision_id),
   applicability:'not_established',period:c.period,evidence_quality:'text_grounded_not_professionally_reviewed',translations_share_evidence:true});
  for(const e of evidence)if(!seenEvidence.has(e.provision_id)){seenEvidence.add(e.provision_id);out.claim_evidence.push(e);}
 }
 out.fragments=[...applicableFragments.values()];out.reference_fragments=[...refs.values()];out.historical_materials=[...history.values()];
 const associated=new Map();
 for(const e of out.claim_evidence)for(const pid of e.related_explanation_provision_ids||[]){
  const g=index.provisions.find(g=>g.id===pid&&g.role==='explanation');
  if(g&&sourceIsCurrent(g.source_id,g.sha256)&&g.fragment_ids.every(id=>byId.has(id)))associated.set(pid,{
   provision_id:pid,parent_provision_id:e.provision_id,source_id:g.source_id,sha256:g.sha256,article:g.article,
   role:'official_explanation',use:'context_only_not_claim_or_company_basis',
   fragments:g.fragment_ids.map(id=>({...byId.get(id),instructions_allowed:false}))
  });
 }
 out.associated_explanations=[...associated.values()];
 out.retrieval={matched_fragment_ids:retrieved.map(f=>f.id),matched_provision_ids:[...new Set(retrieved.map(f=>f.provision_id).filter(Boolean))],method:'multilingual_topics_and_concepts_to_provision_bundles',scope:'research_retrieval_not_applicable_tax_basis'};
 // Apply administrative chain gaps to every affected topic, including pure PPh25/29 questions, without
 // claiming that an unknown amendment changes a specific underlying rate or TER row.
 if(topics.some(t=>administrativeTopics.has(t))){
  out.blockers.push(...dependencyBlockers(['PMK81_2024'],registry,manifest).map(p=>({...p,scope:'administrative_conclusions_only',affected_topics:topics.filter(t=>administrativeTopics.has(t))})));
 }
 const missing=new Set();if(!input.period)missing.add('tax_period');if(!company.country)missing.add('country');
 for(const card of cards.filter(c=>topics.includes(c.topic)))for(const field of card.required_fields){
  const value=field==='tax_period'?input.period:company[field];if(value==null||value===''||value==='unknown')missing.add(field);
 }
 out.missing_information=[...missing];
 out.clarifying_questions=[...missing].map(field=>({field,text:prompts[field][lang],purpose:'company_specific_determination_only'}));
 if(missing.size)out.blockers.push({code:'company_information_missing',fields:[...missing]});
 if(!retrieved.length)out.blockers.push({code:'no_supporting_fragments'});
 out.applicability.status=out.blockers.some(b=>b.code!=='company_information_missing')?'blocked':missing.size?'needs_clarification':'not_established_professional_review_required';
 out.answer_status=out.claims.length?(out.blocked_claims.length||out.blockers.length?'partial':'document_explanation'):'blocked';
 out.evidence_sufficiency.status=out.claims.length?'sufficient_for_returned_document_claims':'insufficient';
 out.evidence_sufficiency.returned_claims=out.claims.length;out.evidence_sufficiency.blocked_claims=out.blocked_claims.length;
 out.evidence_sufficiency.for_company_tax_conclusion='insufficient_unreviewed_currency_and_applicability';
 out.notice=out.claims.length?m.notice:m.blocked;
 const registryIds=new Set([...selected.flatMap(c=>[...c.supports.map(s=>s.source_id),...c.dependencies]),...out.blockers.flatMap(b=>[b.source_id,...b.path||[]]).filter(Boolean)]);
 out.document_registry=registryData.filter(s=>registryIds.has(s.id));
 out.additional_reading=out.document_registry.map(s=>({source_id:s.id,title:s.title,url:s.original_url,verification_status:s.verification_status,use:'registry_link_not_claim_evidence'}));
 out.contradictions=read(root,'issues.json').filter(i=>i.topics.some(t=>topics.includes(t)));
 out.blockers=[...new Map(out.blockers.map(b=>[JSON.stringify(b),b])).values()];
 return out;
}
module.exports={retrieve,validate,validDate,loadCheckedIndex,dependencyBlockers};
