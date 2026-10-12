import { financialActor } from './financialRecovery.js'
import { stableJson } from '../../../server/lib/financialIntent.mjs'
const PREFIX='companyCreation:v1:', DRAFT='companyDraft:v1:'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fields=['name','form','base_currency','country','timezone','activity']
function error(code,status=409){const e=new Error(code);e.code=code;e.status=status;return e}
function actorOf(token){const actor=financialActor(token);if(!actor)throw error('company_identity_required',401);return actor}
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
function write(key,value){try{const json=JSON.stringify(value);localStorage.setItem(key,json);if(localStorage.getItem(key)!==json)throw 0}catch{throw error('company_recovery_storage_required') }}
export function companyDraft(token){const actor=actorOf(token),draft=read(DRAFT+actor);return draft&&typeof draft==='object'?Object.fromEntries(fields.filter(k=>typeof draft[k]==='string').map(k=>[k,draft[k]])):null}
export function saveCompanyDraft(token,draft){write(DRAFT+actorOf(token),Object.fromEntries(fields.filter(k=>typeof draft[k]==='string').map(k=>[k,draft[k]])))}
export function pendingCompanyCreation(token){const actor=actorOf(token),x=read(PREFIX+actor);return x?.actor===actor&&UUID.test(x.key||'')&&x.body&&typeof x.body==='object'?x:null}
function guard(token,isCurrent){const actor=actorOf(token);let stored=false;try{stored=!!localStorage.getItem('hf_token')}catch{}
 return()=>{if(isCurrent&&!isCurrent())throw error('company_context_changed');let current=actor;try{if(stored||localStorage.getItem('hf_token'))current=financialActor(localStorage.getItem('hf_token'))}catch{}
 if(current!==actor)throw error('company_context_changed');return actor}
}
async function request(token,path,{body,key,isCurrent}={}){
 const check=guard(token,isCurrent);check();let res,data;
 try{
  res=await fetch('/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const text=await res.text();check();data=JSON.parse(text);if(res.ok&&(!data||typeof data!=='object'))throw 0;
 }catch(e){check();throw error('company_creation_outcome_unknown',503)}
 if(!res.ok){const e=error(data.error||'company_creation_failed',res.status);e.data=data;throw e}
 return data;
}
function confirmed(result,key){return result?.creation_request_id===key&&UUID.test(result.business?.id||'')&&result.business?.type==='business'}
export async function submitCompanyCreation(token,body,{isCurrent}={}){
 const actor=actorOf(token),check=guard(token,isCurrent);
 if(typeof body?.name!=='string'||!body.name.trim()||body.name.trim().length>120)throw error('invalid_company_name',400);
 if(body.timezone){try{new Intl.DateTimeFormat('en',{timeZone:body.timezone}).format(new Date(0))}catch{throw error('invalid_company_timezone',400)}}
 const work=async()=>{
  check();let pending=pendingCompanyCreation(token);
  if(pending&&stableJson(pending.body)!==stableJson(body))throw error('company_creation_pending');
  if(!pending){pending={actor,key:crypto.randomUUID(),body,state:'pending',started_at:Date.now()};write(PREFIX+actor,pending)}
  if(pending.state==='completed')return pending.result;
  const result=await request(token,'/businesses',{body:pending.body,key:pending.key,isCurrent});check();
  if(!confirmed(result,pending.key))throw error('company_creation_outcome_unknown',503);
  write(PREFIX+actor,{...pending,state:'completed',result});return result;
 };
 if(!globalThis.navigator?.locks?.request)throw error('company_serialization_required');
 return navigator.locks.request('company-creation:'+actor,work);
}
export async function checkCompanyCreation(token,{isCurrent}={}){
 const actor=actorOf(token),check=guard(token,isCurrent),pending=pendingCompanyCreation(token);if(!pending)return null;
 const state=await request(token,'/business-creation/'+pending.key,{isCurrent});check();
 if(state.state==='completed'){
  if(!confirmed(state.result,pending.key))throw error('company_creation_outcome_unknown',503);
  write(PREFIX+actor,{...pending,state:'completed',result:state.result});return state;
 }
 if(state.state!=='not_found')throw error('company_creation_outcome_unknown',503);
 return state;
}
export function finishCompanyCreation(token){const actor=actorOf(token),x=pendingCompanyCreation(token);if(x?.state!=='completed')throw error('company_creation_pending');localStorage.removeItem(PREFIX+actor);localStorage.removeItem(DRAFT+actor)}
