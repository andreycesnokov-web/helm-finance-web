'use strict';
// Business profile contract only. This helper is NOT yet wired to a live writer;
// the eventual atomic RPC must repeat source/membership checks inside its locks.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE=['country','jurisdiction','legal_entity_type','tax_residency','tax_regime','tax_identifier','npwp','nib','financial_year_start','financial_year_end','vat_status','pkp_status','employee_status','payroll_tax_status','withholding_tax_status','industry','business_activity_codes','accounting_method','reporting_currency','filing_frequency'];
const EXTENDED=['foreign_owned','company_legal_name','brand_name','kpp','pkp_effective_date','nib_issue_date','primary_kbli','additional_kbli','actual_business_activities','employee_count','local_employee_count','foreign_employee_count','payroll_frequency','bpjs_registered','transaction_types','field_verification'];
const FIELDS=new Set([...BASE,...EXTENDED.filter(x=>x!=='field_verification')]);
function failure(code,status=400){return Object.assign(Error(code),{code,status});}
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function profileValue(field,value){
 if(!FIELDS.has(field))throw failure('profile_invalid_field');
 if(value==null||value==='')return null;
 if(['employee_count','local_employee_count','foreign_employee_count'].includes(field)){
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))throw failure('profile_invalid_value');
  const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw failure('profile_invalid_value');return n;
 }
 if(field==='bpjs_registered'){if(value===true||value==='true')return true;if(value===false||value==='false')return false;throw failure('profile_invalid_value');}
 if(['additional_kbli','transaction_types'].includes(field)){
  const a=Array.isArray(value)?value:typeof value==='string'?value.split(/[,;\s]+/):null;
  if(!a||a.length>40||a.some(x=>typeof x!=='string'||x.length>100))throw failure('profile_invalid_value');return a.map(x=>x.trim()).filter(Boolean);
 }
 if(typeof value!=='string'||value.length>500)throw failure('profile_invalid_value');
 if(['pkp_effective_date','nib_issue_date'].includes(field)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)throw failure('profile_invalid_value');
  const date=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw failure('profile_invalid_value');
 }
 return value;
}
function same(field,a,b){
 if(['npwp','nib'].includes(field))return typeof a==='string'&&typeof b==='string'&&a.replace(/\D/g,'')!==''&&a.replace(/\D/g,'')===b.replace(/\D/g,'');
 const norm=v=>Array.isArray(v)?[...v].sort():typeof v==='string'?v.trim().toLowerCase():v;
 return JSON.stringify(norm(a))===JSON.stringify(norm(b));
}
async function buildProfileProvenance({businessId,actorUserId,before={},updates={},metadata={},loadDocument}){
 if(typeof businessId!=='string'||!UUID.test(businessId)||typeof actorUserId==='number'&&!Number.isSafeInteger(actorUserId)||!/^[-+]?\d+$/.test(String(actorUserId)))throw failure('profile_context_required',403);
 const actor=BigInt(actorUserId);if(actor<-9223372036854775808n||actor>9223372036854775807n)throw failure('profile_context_required',403);
 if(!object(updates)||!object(metadata))throw failure('profile_invalid_provenance');
 const out=object(before.field_verification)?{...before.field_verification}:{},values={};
 for(const [field,value]of Object.entries(updates)){
  values[field]=profileValue(field,value);
  // Editing a field cannot inherit an old extraction/verification badge.
  if(!same(field,before[field]??null,values[field]))out[field]=values[field]==null?'missing':'user_declared';
 }
 const documents=new Map();
 for(const [field,source]of Object.entries(metadata)){
  if(!FIELDS.has(field))throw failure('profile_invalid_field');
  const state=typeof source==='string'?source:object(source)?source.state:null;
  if(!['missing','user_declared','document_uploaded','extracted','conflict','accountant_verified'].includes(state))throw failure('profile_invalid_provenance');
  // Confirmation is a separate, version-bound atomic operation. A client badge
  // is never evidence of a confirmed profile, even from a privileged actor.
  if(state==='accountant_verified')throw failure('profile_confirmation_required',409);
  if(object(source)&&Object.keys(source).some(k=>!['state','document_id'].includes(k)))throw failure('profile_invalid_provenance');
  const id=object(source)?source.document_id:null;
  if(['extracted','document_uploaded'].includes(state)&&!id)throw failure('profile_document_required');
  if(id){
   if(!UUID.test(id)||typeof loadDocument!=='function')throw failure('profile_source_unavailable',404);
   const normalized=id.toLowerCase();
   if(!documents.has(normalized))documents.set(normalized,await loadDocument({documentId:normalized,businessId,actorUserId}));
   const doc=documents.get(normalized);
   if(!doc||doc.id?.toLowerCase()!==normalized||doc.business_id?.toLowerCase()!==businessId.toLowerCase()||doc.archived_at!=null||!doc.file||doc.file.id!==doc.file_id||doc.file.business_id?.toLowerCase()!==businessId.toLowerCase())throw failure('profile_source_unavailable',404);
   if(state==='extracted'){
    const cache=doc.extracted_json?.ai_profile,suggestion=cache?.fields?.[field];
    if(cache?.v!==1||!object(suggestion)||!Object.hasOwn(suggestion,'value'))throw failure('profile_extraction_not_confirmed',409);
    const value=Object.hasOwn(values,field)?values[field]:before[field];
    if(!same(field,suggestion.value,value))throw failure('profile_extraction_value_mismatch',409);
   }
   out[field]={state,document_id:normalized};
  }else out[field]=state;
 }
 return {values,field_verification:out};
}
module.exports={BASE,EXTENDED,profileValue,buildProfileProvenance};
