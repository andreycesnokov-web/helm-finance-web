import { financialActor } from '../../lib/financialRecovery.js'
export const REVIEW_FIELDS=['company_legal_name','legal_entity_type','npwp','kpp','nib','primary_kbli','additional_kbli']
const ANSWERS={pkp_status:['non_pkp','pkp_registered','unknown'],employee_status:['no_employees','has_employees'],fy:['jan','other'],tax_regime:['normal','pph_final_umkm','unknown']}
function key(request){const actor=financialActor(request?.token);return actor&&/^[0-9a-f-]{36}$/i.test(request?.businessId||'')?`setupReview:v1:${actor}:${request.businessId}`:null}
function sanitize(draft){const fields={},answers={}
 for(const k of REVIEW_FIELDS){const v=draft?.fields?.[k];if(typeof v==='string')fields[k]=v.slice(0,2000);else if(k==='additional_kbli'&&Array.isArray(v))fields[k]=v.filter(x=>typeof x==='string').slice(0,40).map(x=>x.slice(0,100))}
 for(const [k,values] of Object.entries(ANSWERS))if(values.includes(draft?.answers?.[k]))answers[k]=draft.answers[k]
 return{fields,answers}
}
export function readReviewDraft(request){try{const k=key(request);return k?sanitize(JSON.parse(localStorage.getItem(k)||'null')):{fields:{},answers:{}}}catch{return{fields:{},answers:{}}}}
export function saveReviewDraft(request,draft){const k=key(request);if(!k||!request.isCurrent())throw Error('workspace_changed')
 if(localStorage.getItem('hf_token')&&financialActor(localStorage.getItem('hf_token'))!==financialActor(request.token))throw Error('workspace_changed')
 const json=JSON.stringify(sanitize(draft));localStorage.setItem(k,json);if(localStorage.getItem(k)!==json)throw Error('review_draft_storage_unavailable')
}
export function clearReviewDraft(request){const k=key(request);if(k&&request.isCurrent())localStorage.removeItem(k)}
// Country identity is not a tax rule. Never substitute Indonesia for another or
// unspecified country. A saved conflicting jurisdiction requires explicit review.
export function reviewCountry(business,profile){const country=business?.country||profile?.country||null
 const jurisdiction={Indonesia:'ID',Singapore:'SG',Malaysia:'MY',Thailand:'TH'}[country]||null
 return{country,jurisdiction,isID:jurisdiction==='ID',conflict:!!jurisdiction&&!!profile?.jurisdiction&&profile.jurisdiction!==jurisdiction}
}
export function reviewBody({country,vals,answers,touched={},profile={},year=new Date().getFullYear()}){
 if(!country.jurisdiction||country.conflict)throw Error('review_country_required')
 const body={country:country.country,jurisdiction:country.jurisdiction,employee_status:answers.employee_status},verification={}
 if(country.isID){body.pkp_status=answers.pkp_status;body.vat_status=answers.pkp_status==='pkp_registered'?'pkp':null;if(answers.tax_regime&&answers.tax_regime!=='unknown')body.tax_regime=answers.tax_regime}
 if(answers.fy==='jan'&&(touched.fy||!profile.financial_year_start)){body.financial_year_start=`${year}-01-01`;body.financial_year_end=`${year}-12-31`}
 for(const k of REVIEW_FIELDS.filter(k=>country.isID||['company_legal_name','legal_entity_type'].includes(k))){const v=vals[k];if(!v||v.value==null||v.value===''&&!v.user)continue
  body[k]=v.value===''?null:k==='additional_kbli'?(Array.isArray(v.value)?v.value:String(v.value).split(/[,;\s]+/).filter(Boolean)):v.value
  verification[k]=v.user||!v.sources?.[0]?.document_id?'user_declared':{state:'extracted',document_id:v.sources[0].document_id}
 }
 if(Object.keys(verification).length)body.field_verification=verification
 const kbli=[body.primary_kbli,...(body.additional_kbli||[])].filter(Boolean);if(kbli.length)body.business_activity_codes=kbli.join(', ')
 return body
}
