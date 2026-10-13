import { financialActor } from './financialRecovery.js'
import { stableJson } from '../../../server/lib/financialIntent.mjs'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PROFILE_FIELDS='country jurisdiction legal_entity_type tax_residency tax_regime tax_identifier npwp nib financial_year_start financial_year_end vat_status pkp_status employee_status payroll_tax_status withholding_tax_status industry business_activity_codes accounting_method reporting_currency filing_frequency foreign_owned company_legal_name brand_name kpp pkp_effective_date nib_issue_date primary_kbli additional_kbli actual_business_activities employee_count local_employee_count foreign_employee_count payroll_frequency bpjs_registered transaction_types field_verification'.split(' ')
const fail=(code,status=409)=>Object.assign(Error(code),{code,status,data:{error:code,automatic_retry:false}})
export function profileCurrent(request){try{return !!request?.isCurrent?.()&&!!financialActor(request.token)&&financialActor(localStorage.getItem('hf_token'))===financialActor(request.token)}catch{return false}}
function current(request){if(!profileCurrent(request))throw fail('profile_actor_changed')}
function key(request,operation){current(request);if(!UUID.test(request.businessId||'')||!['save','verify','draft'].includes(operation))throw fail('profile_context_required');return `profileRequest:v1:${financialActor(request.token)}:${request.businessId}:${operation}`}
export function normalizeProfilePatch(body={}){
 const out={};for(const k of PROFILE_FIELDS){if(!Object.hasOwn(body,k))continue;let v=body[k]
  if(v===''||v==null){out[k]=k==='field_verification'?{}:null;continue}
  if(['employee_count','local_employee_count','foreign_employee_count'].includes(k)){if(typeof v!=='number'&&!/^\d+$/.test(String(v)))throw fail('profile_invalid_value',400);v=Number(v);if(!Number.isInteger(v)||v<0||v>2147483647)throw fail('profile_invalid_value',400)}
  else if(k==='bpjs_registered'){if(v===true||v==='true')v=true;else if(v===false||v==='false')v=false;else throw fail('profile_invalid_value',400)}
  else if(['additional_kbli','transaction_types'].includes(k)){v=Array.isArray(v)?v:typeof v==='string'?v.split(/[,;\s]+/):null;if(!v||v.length>40||v.some(x=>typeof x!=='string'||x.length>100))throw fail('profile_invalid_value',400);v=v.map(x=>x.trim()).filter(Boolean)}
  else if(k==='field_verification'){if(typeof v!=='object'||Array.isArray(v))throw fail('profile_invalid_provenance',400)}
  else if(typeof v!=='string'||v.length>500)throw fail('profile_invalid_value',400)
  out[k]=v
 }return out
}
// The server canonicalizes provenance (and adds checked source metadata). Compare
// requested state/source identity rather than JSON presentation or client labels.
export function unconfirmedProfileFields(body,row,response={}){
 const payload=normalizeProfilePatch(body),pending=new Set([...(response.not_saved||[]),...(response.unsupported_fields||[])])
 for(const [k,value] of Object.entries(payload)){
  if(k==='field_verification'){for(const [field,source] of Object.entries(value)){const saved=row?.field_verification?.[field],wanted=typeof source==='string'?{state:source}:source;const actual=typeof saved==='string'?{state:saved}:saved;if(!actual||actual.state!==wanted?.state||wanted?.document_id&&actual.document_id!==wanted.document_id)pending.add(k)}}
  else if(!row||!Object.hasOwn(row,k)||stableJson(normalizeProfilePatch({[k]:row[k]})[k])!==stableJson(value))pending.add(k)
 }return [...pending]
}
export function profileDelta(form,before={}){
 const payload=normalizeProfilePatch(form),previous=normalizeProfilePatch(before||{}),out={}
 for(const [k,value] of Object.entries(payload)){
  if(k==='field_verification'){const changed={};for(const [field,source] of Object.entries(value)){if(stableJson(source)!==stableJson(previous[k]?.[field]))changed[field]=typeof source==='string'?source:{state:source?.state,...(source?.document_id?{document_id:source.document_id}:{})}}if(Object.keys(changed).length)out[k]=changed}
  else if(stableJson(value)!==stableJson(previous[k]??null))out[k]=value
 }return out
}
function readEntry(request,operation){const raw=localStorage.getItem(key(request,operation));try{return raw?JSON.parse(raw):null}catch{throw fail('profile_recovery_storage_invalid')}}
function writeEntry(request,operation,entry){const k=key(request,operation),raw=JSON.stringify(entry);localStorage.setItem(k,raw);if(localStorage.getItem(k)!==raw)throw fail('profile_draft_unavailable')}
export function readProfileDraft(request){return readEntry(request,'draft')}
export function saveProfileDraft(request,draft){writeEntry(request,'draft',{form:normalizeProfilePatch(draft.form),before:draft.before?{...normalizeProfilePatch(draft.before),profile_version:draft.before.profile_version}:null,verification:draft.verification||{}})}
export function clearProfileDraft(request){localStorage.removeItem(key(request,'draft'))}
function confirms(entry,result,request){
 current(request)
 const expected=String(BigInt(entry.expected_version)+(entry.operation==='save'?1n:0n))
 if(result?.ok!==true||result.request_id!==entry.request_key||!UUID.test(result.audit_id||'')||result.profile?.business_id!==request.businessId||typeof result.profile.profile_version==='number'&&!Number.isSafeInteger(result.profile.profile_version)||String(result.profile.profile_version)!==expected||result.operation!==entry.operation||String(result.expected_version)!==entry.expected_version||stableJson(result.payload)!==stableJson(entry.payload)||entry.operation==='verify'&&String(result.profile.verified_profile_version)!==entry.expected_version)throw fail('profile_save_unconfirmed')
 return result
}
export async function recoverProfileOperation(request,operation,{read}){
 const entry=readEntry(request,operation);if(!entry)return null
 const r=await read(request,entry.request_key);current(request)
 if(r?.state==='not_found')return {state:'unknown',entry}
 const confirmed=confirms(entry,r,request);writeEntry(request,operation,{...entry,state:'confirmed'});return confirmed
}
export async function performProfileOperation(request,operation,body,expectedVersion,{send,read}){
 current(request);const rawVersion=String(expectedVersion??'');if(!/^\d+$/.test(rawVersion)||typeof expectedVersion==='number'&&!Number.isSafeInteger(expectedVersion)||BigInt(rawVersion)>9223372036854775807n)throw fail('profile_version_required',400)
 const expected=BigInt(rawVersion).toString()
 const payload=operation==='save'?normalizeProfilePatch(body):{},existing=readEntry(request,operation)
 if(operation==='save'&&Object.keys(payload).length===0)throw fail('profile_no_changes',400)
 if(existing&&['prepared','in_flight'].includes(existing.state)){
  const recovered=await recoverProfileOperation(request,operation,{read});current(request)
  if(recovered?.ok===true&&stableJson(existing.payload)===stableJson(payload))return recovered
  throw fail('profile_pending_review')
 }
 if(existing?.state==='confirmed'&&stableJson(existing.payload)===stableJson(payload)&&(expected===existing.expected_version||operation==='save'&&expected===String(BigInt(existing.expected_version)+1n)))return confirms(existing,await read(request,existing.request_key),request)
 const entry={operation,payload,expected_version:BigInt(expected).toString(),request_key:crypto.randomUUID(),state:'prepared'}
 writeEntry(request,operation,entry);writeEntry(request,operation,{...entry,state:'in_flight'})
 let response
 try{response=await send(request,{...payload,expected_version:entry.expected_version,request_key:entry.request_key});current(request)}
 catch(e){current(request);if(e?.data?.outcome==='rolled_back')writeEntry(request,operation,{...entry,state:'rejected'});throw e}
 // A successful write followed by a read failure remains an unknown result.
 confirms(entry,response,request)
 const fresh=confirms(entry,await read(request,entry.request_key),request);writeEntry(request,operation,{...entry,state:'confirmed'});return fresh
}
