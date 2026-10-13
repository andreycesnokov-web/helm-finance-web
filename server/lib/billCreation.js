'use strict';
// The single bill writer. Transport metadata is supplied by trusted adapters,
// never spread from a web body. The native RPC owns role, audit and receipt.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = new Set(['request_key','type','counterparty','amount','currency','due_date','description','scope','invoice_number','invoice_date']);
const invalid = code => { throw Object.assign(new Error(code), { code }); };
function amountIdentity(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) invalid('bill_invalid_amount');
  if (!['string','number'].includes(typeof value)) invalid('bill_invalid_amount');
  const text = String(value).trim();
  if (!/^\+?\d+(?:\.\d+)?$/.test(text)) invalid('bill_invalid_amount');
  let [integer, fraction=''] = text.replace(/^\+/, '').split('.');
  integer=integer.replace(/^0+(?=\d)/, '');fraction=fraction.replace(/0+$/, '');
  if (integer.length > 16 || fraction.length > 2 || integer==='0'&&!fraction) invalid('bill_invalid_amount');
  return integer + (fraction ? '.'+fraction : '');
}
function creationRequest(body={}) {
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!fields.has(k)) || !UUID.test(body.request_key||'')) invalid('bill_invalid_request');
  if (body.scope && body.scope !== 'business') invalid('bill_business_required');
  if (!['payable','receivable'].includes(body.type) || typeof body.counterparty!=='string' || !body.counterparty.trim()) invalid('bill_invalid_value');
  if (body.description != null && typeof body.description!=='string') invalid('bill_invalid_value');
  const currency=body.currency==null?'IDR':typeof body.currency==='string'?body.currency.trim().toUpperCase():'';
  if (!/^[A-Z]{3}$/.test(currency)) invalid('bill_invalid_value');
  const due=body.due_date||null;
  // Current web callers supply a calendar date. Other transport contracts must
  // be inspected separately rather than silently dropping their time/zone.
  if (due!==null && (typeof due!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) || due.startsWith('0000') || !Number.isFinite(Date.parse(due+'T00:00:00Z')) || new Date(due+'T00:00:00Z').toISOString().slice(0,10)!==due)) invalid('bill_invalid_value');
  if(body.invoice_number!=null&&(typeof body.invoice_number!=='string'||body.invoice_number.trim().length>200))invalid('bill_invalid_value');
  const invoice_date=calendarDate(body.invoice_date);
  return { request_key:body.request_key.toLowerCase(), payload:{type:body.type,counterparty:body.counterparty.trim(),amount:amountIdentity(body.amount),currency,due_date:due,description:body.description?.trim()||null,scope:'business',invoice_number:body.invoice_number?.trim()||null,invoice_date} };
}
function calendarDate(value){
 const date=value||null;
 if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.startsWith('0000')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))invalid('bill_invalid_value');
 return date;
}
function metadataRequest(body={},checklist=false){
 const keys=checklist?['expected_version','accountant_checked']:['expected_version','counterparty','description','currency','due_date','invoice_date','invoice_number','type','amount','scope'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||!Number.isSafeInteger(body.expected_version)||body.expected_version<1)invalid('bill_invalid_version');
 const patch={};
 for(const [k,v] of Object.entries(body)){
  if(k==='expected_version')continue;
  if(k==='scope'){if(v!=='business')invalid('bill_business_required');patch[k]=v;}
  else if(k==='type'){if(!['payable','receivable'].includes(v))invalid('bill_invalid_value');patch[k]=v;}
  else if(k==='amount')patch[k]=amountIdentity(v);
  else if(k==='currency'){if(typeof v!=='string'||! /^[A-Z]{3}$/.test(v.trim().toUpperCase()))invalid('bill_invalid_value');patch[k]=v.trim().toUpperCase();}
  else if(['due_date','invoice_date'].includes(k))patch[k]=calendarDate(v);
  else if(k==='accountant_checked'){if(typeof v!=='boolean')invalid('bill_invalid_value');patch[k]=v;}
  else {if(v!=null&&typeof v!=='string')invalid('bill_invalid_value');patch[k]=v?.trim()||null;if(k==='counterparty'&&!patch[k]||k==='invoice_number'&&patch[k]?.length>200)invalid('bill_invalid_value');}
 }
 if(!Object.keys(patch).length||checklist&&typeof patch.accountant_checked!=='boolean')invalid('bill_invalid_request');
 return {version:body.expected_version,patch};
}
module.exports={creationRequest,amountIdentity};
function fromTrustedRow(key, row) {
  const request=creationRequest({request_key:key,type:row.type,counterparty:row.counterparty,amount:row.amount,currency:row.currency,due_date:row.due_date||null,description:row.description||null,scope:row.scope||'business',invoice_number:row.invoice_number,invoice_date:row.invoice_date});
  const allowed=['source_channel','raw_input_text','raw_input_language','confidence_score','attachment_url','attachments','created_by_telegram_id','created_by_name','training_type','is_training','notes','last_action_channel'];
  const context=Object.fromEntries(allowed.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
  context.source_channel ||= 'web';
  if(context.source_channel==='mcp'||row.is_training||context.source_channel==='telegram'&&row.approval_status==='pending_approval')context.pending=true;
  return {...request,context};
}
async function create(supabase, actor, business, request, quota={}) {
  const {data,error}=await supabase.rpc('rpc_create_business_bill',{
    p_actor:actor,p_business:business,p_request_key:request.request_key,p_payload:request.payload,
    p_context:request.context||{},p_limit:quota.limit??null,p_limit_since:quota.since||null,p_limit_scope:quota.scope||'actor'
  });
  if(error)throw error;
  if(!data?.debt?.id||!data.audit_id)throw Object.assign(Error('bill_result_unconfirmed'),{code:'bill_result_unconfirmed'});
  return {...data.debt,...data};
}
function sendFailure(res,error){
  const text=error?.message||error?.code||'', match=text.match(/bill_[a-z_]+/),code=match?.[0]||'bill_create_unavailable';
  const status=code==='bill_forbidden'?403:code==='bill_not_found'?404:code==='bill_quota_reached'?402:['bill_request_conflict','bill_stale','bill_metadata_locked'].includes(code)?409:code.startsWith('bill_invalid')||code==='bill_business_required'?400:503;
  const confirmedRollback=match&&code!=='bill_result_unconfirmed';
  res.status(status).json({error:code,message:code==='bill_request_conflict'?'This request key was used for a different bill.':code==='bill_quota_reached'?'Monthly invoice limit reached.':code==='bill_forbidden'?'Your current membership does not allow this action.':code,outcome:confirmedRollback?'rolled_back':'unknown',automatic_retry:false});
}
module.exports={creationRequest,amountIdentity,fromTrustedRow,create,sendFailure,UUID,metadataRequest};
