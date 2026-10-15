'use strict';
// Business + Platform/admin. No checkout or paid-period write endpoint is exposed.
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
 Object.assign(known,{billing_invalid_terms:400,billing_invalid_date:400,billing_reason_required:400,billing_schedule_required:409,billing_grant_overlap:409,billing_grant_not_found:404,billing_legacy_trial_disabled:409});
 if(['23514','22007','22008','22P02','22003'].includes(error?.code))return res.status(400).json({error:'billing_invalid_terms',outcome:'rolled_back',automatic_retry:false});
 const code=Object.keys(known).find(k=>String(error?.message||'').includes(k));
 if(code)return res.status(known[code]).json({error:code,outcome:'rolled_back',automatic_retry:false});
 return res.status(503).json({error:'billing_outcome_unknown',outcome:'unknown',automatic_retry:false,recover_command:true});
}
function install(app,{auth,requireBusiness,requireAdmin,supabase,enabled=false,allowFixtures=false}) {
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
  res.json({policy:data.legacy_fallback?'legacy':data.policy,account:legacy?null:data,access,can_manage:biz.role==='owner'&&biz.business.billing_policy==='commercial_v2',payments_available:false});
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
 app.get('/api/billing/quotas/:key',auth,gate,respond(async(req,res,biz)=>{
  if(!UUID.test(req.params.key||''))throw Error('billing_invalid_key');
  const{data,error}=await supabase.from('billing_quota_reservations').select('request_key,resource,units,state,reason,created_at,updated_at').eq('business_id',biz.business.id).eq('actor_user_id',req.user.userId).eq('request_key',req.params.key).maybeSingle();
  if(error)throw error;res.json(data?{state:data.state,reservation:data}:{state:'not_found'});
 }));
 app.post('/api/billing/quotas/:key/release',auth,gate,respond(async(req,res,biz)=>{
  if(!UUID.test(req.params.key||''))throw Error('billing_invalid_key');
  const{data:r,error:e}=await supabase.from('billing_quota_reservations').select('resource,units').eq('business_id',biz.business.id).eq('actor_user_id',req.user.userId).eq('request_key',req.params.key).maybeSingle();
  if(e)throw e;if(!r)return res.json({state:'not_found'});
  const{data,error}=await supabase.rpc('rpc_billing_quota',{p_actor:req.user.userId,p_business:biz.business.id,p_key:req.params.key,p_resource:r.resource,p_units:r.units,p_action:'abandon',p_reason:'Client upload failed before completion'});if(error)throw error;res.json(data);
 }));
 if(requireAdmin){
 const admin=fn=>async(req,res)=>{res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});try{await fn(req,res)}catch(e){errorResponse(res,e)}};
 app.get('/api/admin/billing/catalog',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const [p,v]=await Promise.all([supabase.from('plan_limits').select('*').order('plan'),supabase.from('plan_versions').select('*').order('created_at',{ascending:false})]);
  if(p.error||v.error)throw p.error||v.error;res.json({plans:p.data,versions:v.data,allow_fixtures:allowFixtures});
 }));
 app.post('/api/admin/billing/catalog/:code',auth,gate,requireAdmin,admin(async(req,res)=>{
  const b=req.body||{};if(!UUID.test(b.request_key||'')||!Number.isSafeInteger(b.expected_version)||b.expected_version<0)throw Error('billing_invalid_command');
  const{data,error}=await supabase.rpc('rpc_billing_catalog_command',{p_actor:req.user.userId,p_key:b.request_key,p_code:req.params.code,p_expected:b.expected_version,p_payload:b.terms});
  if(error)throw error;res.json(data);
 }));
 app.get('/api/admin/billing/companies',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const {data,error}=await supabase.from('businesses').select('id,name,billing_policy').eq('type','business').order('created_at',{ascending:false}).limit(1000);
  if(error)throw error;res.json({businesses:data,truncated:data.length===1000});
 }));
 app.get('/api/admin/billing/companies/:id',auth,gate,requireAdmin,admin(async(req,res)=>{
  if(!UUID.test(req.params.id))throw Error('billing_invalid_command');
  const{data:b,error}=await supabase.from('businesses').select('*').eq('id',req.params.id).single();if(error)throw error;
  // Admin has metadata access; never request wallets, transactions or document contents.
  const{data:a,error:e}=await supabase.from('billing_accounts').select('*').eq('business_id',b.id).maybeSingle();if(e)throw e;
  if(!a)return res.json({policy:'legacy',business:{id:b.id,name:b.name},access:computeBusinessAccess(b),account:{business_id:b.id,version:1,grants:[]},legacy_enrollment:true,usage:[],history:[]});
  const [v,g,p,u,h]=await Promise.all([supabase.from('plan_versions').select('*'),supabase.from('billing_grants').select('*').eq('business_id',b.id),supabase.from('billing_service_periods').select('*').eq('business_id',b.id),supabase.from('billing_quota_reservations').select('resource,units,state,period_start').eq('business_id',b.id),supabase.from('billing_admin_commands').select('id,action,intent,result,created_at').eq('business_id',b.id).order('created_at',{ascending:false}).limit(30)]);
  for(const x of [v,g,p,u,h])if(x.error)throw x.error;
  const s={...a,plan_versions:v.data,grants:g.data,service_periods:p.data};
  res.json({policy:'commercial_v2',business:{id:b.id,name:b.name},account:s,access:computeBusinessAccess(b,new Date(),s),usage:u.data,history:h.data});
 }));
 app.post('/api/admin/billing/companies/:id/:action',auth,gate,requireAdmin,admin(async(req,res)=>{
  const b=req.body||{};if(!UUID.test(req.params.id)||!UUID.test(b.request_key||'')||!Number.isSafeInteger(b.expected_version))throw Error('billing_invalid_command');
  const{data,error}=await supabase.rpc('rpc_billing_admin_command',{p_actor:req.user.userId,p_key:b.request_key,p_business:req.params.id,p_expected:b.expected_version,p_action:req.params.action,p_payload:b.payload,p_allow_fixture:allowFixtures});
  if(error)throw error;res.json(data);
 }));
 }
}
const READ_METHODS=new Set(['GET','HEAD','OPTIONS']);
function workflow(req){
 const path=(req.originalUrl||req.url||'').split('?')[0];
 // Auth, profile, billing, invite acceptance, support and all read/export/recovery
 // routes remain reachable. Financial receipts are read before admission.
 if(READ_METHODS.has(req.method)||/^\/api\/(billing|admin|auth|me|account|personal|mcp-oauth|telegram|bot|business-creation|businesses|support|onboarding|invite|invites|financial-operations)(\/|$)/.test(path)||/^\/api\/documents\/[^/]+\/signed-url$/.test(path))return null;
 // Every other API mutation is a new workflow unless explicitly exempted above.
 // Unknown future endpoints therefore cannot silently bypass commercial expiry.
 if(path==='/api/documents/upload-init')return {feature:'documents',resource:'documents',phase:'init'};
 if(path==='/api/documents/upload-complete')return {feature:'documents',resource:'documents',phase:'complete'};
 if(path==='/api/team/invite')return {feature:'team',resource:'users'};
 if(/\/bank-imports?\//.test(path))return {feature:'import',resource:/parse|upload|extract|\/read$/.test(path)?'imports':null};
 if(/\/ai(?:-cfo)?\//.test(path)||path==='/api/chat'||path==='/api/accountant/ask'||/^\/api\/documents\/[^/]+\/identify$/.test(path))return {feature:'ai',resource:'ai'};
 if(/\/documents\//.test(path)||path==='/api/documents')return {feature:'documents'};
 if(/\/payroll/.test(path))return {feature:'payroll'};
 return {feature:null};
}
async function snapshot(supabase,actor,biz,allowFixtures){
 const{data,error}=await supabase.rpc('rpc_billing_snapshot',{p_actor:actor,p_business:biz.business.id,p_allow_fixture:allowFixtures});
 if(error)throw error;if(data?.policy==='legacy')return null;if(!data||data.policy!=='commercial_v2')throw Error('billing_snapshot_unavailable');return data;
}
async function admit(supabase,actor,biz,policy,{key=null,allowFixtures=false,intent={},units=1}={}){
 const s=await snapshot(supabase,actor,biz,allowFixtures);if(!s)return null;
 if(policy.phase==='complete'){
  if(!UUID.test(key||''))throw Object.assign(Error('billing_request_key_required'),{status:400});
  const{data:r,error}=await supabase.from('billing_quota_reservations').select('*').eq('business_id',biz.business.id).eq('actor_user_id',actor).eq('request_key',key).maybeSingle();
  if(error)throw error;if(!r||r.resource!=='documents'||r.state==='released'||!intent.sha256||r.intent?.sha256!==intent.sha256)throw Object.assign(Error('billing_reservation_terminal'),{status:409});
  const started=await supabase.rpc('rpc_billing_quota',{p_actor:actor,p_business:biz.business.id,p_key:key,p_resource:'documents',p_action:'start',p_units:1,p_intent:intent});if(started.error)throw started.error;
  return {key,resource:'documents',phase:'complete'};
 }
 const a=computeBusinessAccess(biz.business,new Date(s.server_now),s);
 if(a.restricted){const e=Error('billing_restricted');e.status=402;throw e;}
 if(policy.feature&&a.features[policy.feature]!==true){const e=Error('billing_feature_denied');e.status=402;throw e;}
 if(policy.resource){
  if(!UUID.test(key||'')){const e=Error('billing_request_key_required');e.status=400;throw e;}
  if(!Number.isSafeInteger(units)||units<1||units>1000)throw Object.assign(Error('billing_invalid_command'),{status:400});
  const{data,error}=await supabase.rpc('rpc_billing_quota',{p_actor:actor,p_business:biz.business.id,p_key:key,p_resource:policy.resource,p_action:'reserve',p_units:units,p_intent:intent});if(error)throw error;
  if(data?.state==='released'||data?.state==='committed'){const e=Error('billing_reservation_terminal');e.status=409;throw e;}
  if(data?.is_replay){const e=Error('billing_job_in_progress');e.status=409;throw e;}
  return {key,resource:policy.resource,phase:policy.phase,units};
 }
 return null;
}
module.exports={input,errorResponse,install,workflow,snapshot,admit};
