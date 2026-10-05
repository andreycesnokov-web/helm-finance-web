'use strict';
// Read-only research retrieval. No company persistence, rules, money or model calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULT_ROOT = path.resolve(__dirname, '../../knowledge/indonesia_tax_kb');
const aliases = {
  business_regimes: /umkm|0[.,]5\s*%|business regime|tax regime|режим|оборот|turnover|peredaran bruto|pp\s*(55|20|23)\b/iu,
  ppn_pkp: /\bppn\b|\bpkp\b|\bvat\b|ндс|добавленн|faktur|11\s*%|12\s*%/iu,
  pph21: /pph\s*(pasal\s*)?21|payroll|зарплат|сотрудник|employee|pegawai|ter\b|individual lawyer|юрист физлицо|pengacara orang pribadi/iu,
  pph26: /pph\s*(pasal\s*)?26|foreign|нерезидент|иностранн|treaty|p3b|luar negeri/iu,
  pph23: /pph\s*(pasal\s*)?23|consult|konsultan|консульт|service|услуг|jasa|biaya layanan|equipment|оборудован|peralatan/iu,
  pph_final_rent: /pph\s*(final|4)|rent|аренд|sewa|land|building|tanah|bangunan|hotel|отел|penginapan|pp\s*(34|29)\b/iu,
  pph25_29: /pph\s*(pasal\s*)?(25|29)|instalment|installment|аванс|годов|annual|tahunan|kurang bayar|angsuran/iu,
  deadlines: /deadline|due date|due by|срок|когда|платить до|подавать|сдать|deposit|filing|filed|batas waktu|jatuh tempo|lapor|setor|dibayar|disampaikan|kapan/iu,
};
const messages = {
 ru: {gap:'Исследовательская подборка: юридическая актуальность и применимость не подтверждены специалистом.',outside:'Вопрос вне текущего охвата базы. Налоговое заключение невозможно.',missing:'Нужны дополнительные сведения',period:'Укажите налоговый период; текущие нормы нельзя переносить на прошлые периоды.'},
 en: {gap:'Research collection: legal currency and applicability have not been certified by a professional.',outside:'The question is outside the current knowledge scope. No tax determination is available.',missing:'Additional information is required',period:'Specify the tax period; current provisions must not be applied to historical periods.'},
 id: {gap:'Kumpulan riset: keberlakuan hukum dan penerapannya belum disahkan oleh tenaga profesional.',outside:'Pertanyaan di luar cakupan basis pengetahuan saat ini. Penentuan pajak belum tersedia.',missing:'Diperlukan informasi tambahan',period:'Tentukan periode pajak; ketentuan saat ini tidak boleh diterapkan pada periode lampau.'},
};
function read(root, file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function validate(input) {
  if (!input || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 4000) throw new TypeError('invalid_question');
  if (!['ru','en','id'].includes(input.language)) throw new TypeError('unsupported_language');
  if (input.period != null && !validDate(input.period)) throw new TypeError('period_must_be_iso_date');
  if (input.company != null && (typeof input.company !== 'object' || Array.isArray(input.company))) throw new TypeError('invalid_company');
  if (input.topics && (!Array.isArray(input.topics) || input.topics.some(t=>!aliases[t]))) throw new TypeError('unsupported_topic');
}
function retrieve(input, root = DEFAULT_ROOT) {
  validate(input);
  const m = messages[input.language];
  const company = input.company || {};
  const topics = input.topics || Object.keys(aliases).filter(t=>aliases[t].test(input.question));
  const out = {schema_version:1, language:input.language, period:input.period || null,
    research_as_of:read(root,'sources.json').research_as_of, status:'research_only', topics,
    fragments:[], explanations:[], sources:[], applicability:{status:'undetermined',conditions:[]},
    missing_information:[], contradictions:[], gaps:[], trust:{document_content:'untrusted_data',professional_review:null},
    production_rule_activation:false, notice:m.gap};
  if (company.country && !['ID','Indonesia','id'].includes(company.country)) {
    out.status='out_of_scope'; out.gaps.push('jurisdiction_not_indonesia'); out.notice=m.outside; return out;
  }
  if (!topics.length) {out.status='out_of_scope';out.notice=m.outside;out.gaps.push('topic_not_covered');return out;}
  if (!input.period) {out.missing_information.push('tax_period');out.gaps.push(m.period);}
  if (!company.country) out.missing_information.push('country');
  const index = loadCheckedIndex(root);
  const cards = read(root,'cards.json');
  const registry = read(root,'sources.json').sources;
  // A question mentioning an instrument may retrieve its historical text, never certify its currency.
  const candidates = index.fragments.filter(f=>f.topics.some(t=>topics.includes(t)));
  const temporal = f => !input.period ? 'unknown' : !f.effective_from ? 'unknown' :
    input.period < f.effective_from || (f.effective_to && input.period > f.effective_to) ? 'outside_window' :
    f.unresolved_issues.length ? 'requires_review' : 'within_recorded_window';
  const words = input.question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  const scored = candidates.map(f=>({f, score:words.reduce((n,w)=>n+(f.text.toLowerCase().includes(w)?1:0),0)+
    (temporal(f)==='outside_window'?-100:0)+(company.transaction_type && f.conditions?.transaction_type?.includes(company.transaction_type)?8:0)}))
    .sort((a,b)=>b.score-a.score || a.f.id.localeCompare(b.f.id));
  const picked = [];
  // Ensure each topic has evidence instead of letting a long regulation dominate the ranking.
  for (const topic of topics) {
    const subset = scored.filter(x=>x.f.topics.includes(topic));
    for (const x of subset.slice(0,3)) if (!picked.includes(x.f)) picked.push(x.f);
  }
  out.fragments = picked.slice(0,18).map(f=>({...f, temporal_status:temporal(f), content_role:'official_text', instructions_allowed:false}));
  const sourceIds = new Set(out.fragments.map(f=>f.source_id));
  // Source context is topic-complete and language-independent; include unfetched amendments as gaps.
  for (const source of registry) if (source.topics.some(t=>topics.includes(t))) sourceIds.add(source.id);
  for (const card of cards.filter(c=>topics.includes(c.topic))) {
    out.explanations.push({id:card.id, content_role:'explanation', applicability:'undetermined', historical_use_requires_review:true, text:card.translations[input.language],
      educational_example:card.examples[input.language], assumptions:card.assumptions,
      source_refs:card.source_refs, verification_status:card.verification_status});
    for (const ref of card.source_refs) sourceIds.add(ref.source_id);
    out.applicability.conditions.push(...card.conditions);
    for (const field of card.required_fields) {
      const value = field==='tax_period' ? input.period : company[field];
      if (value == null || value === '' || value === 'unknown') out.missing_information.push(field);
    }
    out.gaps.push(...card.gaps);
  }
  out.sources = registry.filter(s=>sourceIds.has(s.id)).map(s=>({...s}));
  out.gaps.push(...out.sources.flatMap(s=>s.unresolved_issues));
  if (out.fragments.some(f=>f.temporal_status==='outside_window')) out.gaps.push('historical_period_requires_earlier_instrument_or_transition_check');
  if (!out.fragments.length) out.gaps.push('no_readable_primary_fragments_for_topic');
  // Research contradictions are curated evidence, not inferred by a language model.
  out.contradictions = read(root,'issues.json').filter(i=>i.topics.some(t=>topics.includes(t)));
  out.missing_information=[...new Set(out.missing_information)];
  out.gaps=[...new Set(out.gaps)];
  return out;
}
function loadCheckedIndex(root = DEFAULT_ROOT) {
  const data = read(root,'index.json');
  const checked = new Map();
  for (const f of data.fragments) {
    if (!/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('invalid_source_hash');
    if (!checked.has(f.sha256)) {
      const blob = fs.readFileSync(path.join(root,'store/blobs',f.sha256+'.pdf'));
      if (crypto.createHash('sha256').update(blob).digest('hex')!==f.sha256) throw new Error('source_integrity_failure');
      const bytes = fs.readFileSync(path.join(root,'store/extracted',f.sha256+'.json'));
      checked.set(f.sha256,{hash:crypto.createHash('sha256').update(bytes).digest('hex'),data:JSON.parse(bytes)});
    }
    const ext = checked.get(f.sha256);
    const p = ext.data.pages.find(p=>p.page===f.locator.page);
    if (ext.hash!==f.extraction_sha256 || !p || p.quality==='unreliable' || p.text.slice(f.locator.start,f.locator.end).trim()!==f.text)
      throw new Error('extraction_integrity_failure');
  }
  return data;
}
module.exports={retrieve,validate,validDate,loadCheckedIndex};
