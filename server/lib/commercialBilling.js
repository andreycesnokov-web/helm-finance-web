'use strict';
// Business only. Reuses existing auth/business resolution and the central access
// projection. This stage is not installed in index.js until the full admission gate
// and migration rollout are accepted; installing a partial paywall would be unsafe.
const {computeBusinessAccess}=require('./businessAccess');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function input(body,header) {
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['request_key','plan_version_id','expected_version'].includes(k)))throw Error('billing_invalid_fields');
 const key=header||body.request_key;
 if(!UUID.test(key||'')||header&&body.request_key&&header.toLowerCase()!==body.request_key.toLowerCase())throw Error('billing_invalid_key');
 if(!UUID.test(body.plan_version_id||'')||!Number.isSafeInteger(body.expected_version)||body.expected_version<1)throw Error('billing_invalid_command');
 return {key:key.toLowerCase(),plan:body.plan_version_id.toLowerCase(),version:body.expected_version};
}
function errorResponse(res,error) {
 const known={billing_forbidden:403,billing_email_verification_required:403,billing_account_not_enrolled:409,
  billing_command_conflict:409,billing_stale:409,billing_plan_not_found:404,billing_plan_not_approved:409,
  billing_select_plan_first:409,billing_invalid_fields:400,billing_invalid_key:400,billing_invalid_command:400};
 const code=Object.keys(known).find(k=>String(error?.message||'').includes(k));
 if(code)return res.status(known[code]).json({error:code});
 return res.status(503).json({error:'billing_outcome_unknown',outcome:'unknown',automatic_retry:false,recover_command:true});
}
function install(app,{auth,requireBusiness,supabase,enabled=false,allowFixtures=false}) {
 const gate=(_req,res,next)=>enabled?next():res.status(404).json({error:'not_found'});
 const respond=fn=>async(req,res)=>{
  res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});
  try{const biz=await requireBusiness(req,res);if(biz)await fn(req,res,biz);}catch(e){errorResponse(res,e)}
 };
 app.get('/api/billing',auth,gate,respond(async(req,res,biz)=>{
  const {data,error}=await supabase.rpc('rpc_billing_snapshot',{p_actor:req.user.userId,p_business:biz.business.id,p_allow_fixture:allowFixtures});
  if(error)throw error;if(!data||String(data.business_id)!==String(biz.business.id))throw Error('billing_company_mismatch');
  const legacy=data.policy==='legacy';
  const access=computeBusinessAccess(biz.business,new Date(data.server_now||Date.now()),legacy?null:data);
  res.json({policy:data.policy,account:legacy?null:data,access,can_manage:biz.role==='owner',payments_available:false});
 }));
 for(const [path,command]of [['plan','select_plan'],['trial','activate_trial']])app.post('/api/billing/'+path,auth,gate,respond(async(req,res,biz)=>{
  const i=input(req.body,req.get('Idempotency-Key'));
  const {data,error}=await supabase.rpc('rpc_billing_trial_command',{p_actor:req.user.userId,p_business:biz.business.id,p_key:i.key,
   p_command:command,p_plan_version:i.plan,p_expected_version:i.version,p_allow_fixture:allowFixtures});
  if(error)throw error;if(!data||String(data.business_id)!==String(biz.business.id))throw Error('billing_result_unconfirmed');
  res.json(data);
 }));
 app.get('/api/billing/commands/:key',auth,gate,respond(async(req,res,biz)=>{
  if(!UUID.test(req.params.key||''))throw Error('billing_invalid_key');
  const {data,error}=await supabase.rpc('rpc_billing_command_receipt',{p_actor:req.user.userId,p_business:biz.business.id,p_key:req.params.key.toLowerCase()});
  if(error)throw error;if(!data)throw Error('billing_receipt_unavailable');res.json(data);
 }));
}
module.exports={input,errorResponse,install};
