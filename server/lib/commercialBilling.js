'use strict';
// Business + Platform/admin. No checkout or paid-period write endpoint is exposed.
const crypto=require('node:crypto');
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
 Object.assign(known,{billing_plan_code_reserved:409,billing_publish_not_confirmed:409,billing_terms_incomplete:400,billing_unknown_feature:400,billing_unknown_limit:400,billing_limit_without_counter:400,billing_feature_not_released:409,billing_plan_archived:409,billing_override_not_enforceable:400,billing_override_overlap:409,billing_override_not_found:404});
 Object.assign(known,{billing_invalid_terms:400,billing_invalid_date:400,billing_reason_required:400,billing_schedule_required:409,billing_grant_overlap:409,billing_grant_not_found:404,billing_legacy_trial_disabled:409});
 if(['23514','22007','22008','22P02','22003'].includes(error?.code))return res.status(400).json({error:'billing_invalid_terms',outcome:'rolled_back',automatic_retry:false});
 const code=Object.keys(known).find(k=>String(error?.message||'').includes(k));
 if(code)return res.status(known[code]).json({error:code,outcome:'rolled_back',automatic_retry:false});
 return res.status(503).json({error:'billing_outcome_unknown',outcome:'unknown',automatic_retry:false,recover_command:true});
}
function install(app,{auth,requireBusiness,requireAdmin,requireSuperAdmin,supabase,enabled=false,allowFixtures=false}) {
 const gate=(_req,res,next)=>enabled?next():res.status(404).json({error:'not_found'});
 // Public pricing: the published commercial catalog only (no identity, no drafts, no fixtures, no internal notes).
 // Same source as the in-app plan picker; cached for 30 s. Readable by any origin (no credentials).
 let publicCache={at:0,body:null};
 app.get('/api/public/plans',async(_req,res)=>{
  res.set({'Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*'});
  try{
   if(!publicCache.body||Date.now()-publicCache.at>30000){const{data,error}=await supabase.rpc('billing_public_catalog');if(error)throw error;publicCache={at:Date.now(),body:data}}
   res.json(publicCache.body);
  }catch{res.status(503).json({error:'catalog_unavailable'})}
 });
 // Changing or publishing plans is reserved to a Platform SUPER admin (checked here, on the server).
 const catalogWriter=requireSuperAdmin||((_req,res)=>res.status(403).json({error:'super_admin_required'}));
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
  const{data,error}=await supabase.rpc('rpc_billing_quota',{p_actor:req.user.userId,p_business:biz.business.id,p_key:req.params.key,p_resource:r.resource,p_units:r.units,p_action:'abandon',p_reason:'Client upload failed before completion'});if(error)throw error;
  // The storage reservation made next to the upload is returned with it.
  const sk=deriveKey(req.params.key,'storage_mb');const{data:st}=await supabase.from('billing_quota_reservations').select('units,state').eq('business_id',biz.business.id).eq('request_key',sk).maybeSingle();
  if(st?.state==='reserved')await supabase.rpc('rpc_billing_quota',{p_actor:req.user.userId,p_business:biz.business.id,p_key:sk,p_resource:'storage_mb',p_units:st.units,p_action:'abandon',p_reason:'Client upload failed before completion'});
  res.json(data);
 }));
 if(requireAdmin){
 const admin=fn=>async(req,res)=>{res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});try{await fn(req,res)}catch(e){errorResponse(res,e)}};
 app.get('/api/admin/billing/catalog',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const [p,v,c]=await Promise.all([supabase.from('plan_limits').select('*').order('display_order').order('plan'),supabase.from('plan_versions').select('*').order('created_at',{ascending:false}),supabase.from('billing_catalog_items').select('*').order('kind').order('sort_order')]);
  if(p.error||v.error||c.error)throw p.error||v.error||c.error;
  // Rows without versions are legacy plan codes (free/business/founder/enterprise): not part of the commercial catalog.
  const versioned=new Set(v.data.map(x=>x.plan));res.json({plans:p.data.filter(x=>versioned.has(x.plan)),versions:v.data,catalog_items:c.data,allow_fixtures:allowFixtures});
 }));
 app.post('/api/admin/billing/catalog/:code',auth,gate,catalogWriter,admin(async(req,res)=>{
  const b=req.body||{};if(!UUID.test(b.request_key||'')||!Number.isSafeInteger(b.expected_version)||b.expected_version<0)throw Error('billing_invalid_command');
  const{data,error}=await supabase.rpc('rpc_billing_catalog_command',{p_actor:req.user.userId,p_key:b.request_key,p_code:req.params.code,p_expected:b.expected_version,p_payload:b.terms});
  if(error)throw error;publicCache={at:0,body:null};res.json(data); // the pricing page shows a new publication at once
 }));
 // Billing Management Center (Platform admin): read models + preview. Every write still goes through the
 // CAS/idempotent/audited RPCs above. Customer balances, transactions and documents are never read here.
 const TERM_FIELDS=['name_i18n','description_i18n','price_minor','price_annual_minor','currency','trial_hours','features','limits','limit_policies','terms_version','effective_at','approval_status'];
 const NESTED=['features','limits','limit_policies','name_i18n','description_i18n'],NUMERIC=['price_minor','price_annual_minor','trial_hours'];
 const num=x=>x===null||x===undefined?null:Number(x);
 // Features compare by their EFFECTIVE value, as billing_effective_terms applies them (billing_feature_defaults):
 // 'always' features are on whatever is stored; a missing key is on only for absent_allows features, otherwise off.
 const diffTerms=(before,after,defaults={absent:{},always:{}})=>{const out=[];for(const f of TERM_FIELDS){
  if(NESTED.includes(f)){const a=before?.[f]||{},b=after?.[f]||{};
   const feature=(o,k)=>defaults.always[k]===true?true:Object.prototype.hasOwnProperty.call(o,k)?o[k]===true:defaults.absent[k]===true;
   const norm=(o,k)=>f==='features'?feature(o,k):(o[k]??null);
   for(const k of new Set([...Object.keys(a),...Object.keys(b)]))if(JSON.stringify(norm(a,k))!==JSON.stringify(norm(b,k)))out.push({field:f+'.'+k,before:norm(a,k),after:norm(b,k)});}
  else if(NUMERIC.includes(f)){const a=num(before?.[f]??(f==='trial_hours'?168:null)),b=num(after?.[f]??(f==='trial_hours'?168:null));if(a!==b)out.push({field:f,before:a,after:b})}
  // Two moments that have both already passed mean the same thing: effective immediately.
  else if(f==='effective_at'){const a=before?.[f]??null,b=after?.[f]??null,now=Date.now();if(b!==null&&(a===null||Date.parse(a)!==Date.parse(b))&&!(Date.parse(a)<=now&&Date.parse(b)<=now))out.push({field:f,before:a,after:b})}
  else{const a=before?.[f]??null,b=after?.[f]??null;if(JSON.stringify(a)!==JSON.stringify(b))out.push({field:f,before:a,after:b})}
 }return out};
 app.post('/api/admin/billing/catalog/:code/preview',auth,gate,requireAdmin,admin(async(req,res)=>{
  const b=req.body||{};if(!Number.isSafeInteger(b.expected_version)||b.expected_version<0||!b.terms||typeof b.terms!=='object'||Array.isArray(b.terms))throw Error('billing_invalid_command');
  const{data,error}=await supabase.rpc('rpc_billing_catalog_command',{p_actor:req.user.userId,p_key:crypto.randomUUID(),p_code:req.params.code,p_expected:b.expected_version,p_payload:{...b.terms,dry_run:true}});
  if(error)throw error;
  // Companies whose subscription is (or is scheduled to be) on a version of this plan. They keep their pinned version;
  // the list shows who would be affected by an explicit move to the new version.
  let affected=null;
  try{
   const{data:vs,error:ve}=await supabase.from('plan_versions').select('id').eq('plan',req.params.code);if(ve)throw ve;
   const ids=(vs||[]).map(v=>v.id),seen=new Map();
   if(ids.length)for(const col of ['selected_plan_version_id','scheduled_plan_version_id']){
    const{data:acc,error:ae}=await supabase.from('billing_accounts').select('business_id,trial_ends_at').in(col,ids).limit(200);if(ae)throw ae;
    for(const x of acc||[])seen.set(x.business_id,x);
   }
   const list=[...seen.values()].slice(0,200);
   const{data:bs}=list.length?await supabase.from('businesses').select('id,name,business_code').in('id',list.map(x=>x.business_id)):{data:[]};
   const byId=new Map((bs||[]).map(x=>[x.id,x]));
   affected=list.map(x=>({business_id:x.business_id,name:byId.get(x.business_id)?.name||null,business_code:byId.get(x.business_id)?.business_code||null,trial_ends_at:x.trial_ends_at}));
  }catch{affected=null}   // the list is informational; it never blocks a preview
  const defaults={absent:{},always:{}};
  try{const{data:fi,error:fe}=await supabase.from('billing_catalog_items').select('key,absent_allows,enforcement').eq('kind','feature');if(fe)throw fe;
   for(const x of fi||[]){if(x.absent_allows)defaults.absent[x.key]=true;if(x.enforcement==='always')defaults.always[x.key]=true}}catch{/* stored values only */}
  res.json({...data,affected,changes:['draft','publish'].includes(data.action)?diffTerms(data.current,b.terms,defaults):[]});
 }));
 async function adminRows(){
  const{data,error}=await supabase.rpc('rpc_billing_admin_rows');if(error)throw error;
  const now=new Date(data.server_now),by=(list,id)=>(list||[]).filter(x=>String(x.business_id)===String(id));
  return {now,versions:data.versions,rows:data.companies.map(c=>{
   if(!c.account)return {id:c.id,name:c.name,policy:'legacy',access:computeBusinessAccess(c.business,now)};
   const s={...c.account,plan_versions:data.versions,grants:by(data.grants,c.id),service_periods:by(data.service_periods,c.id),overrides:by(data.overrides,c.id),feature_defaults:data.feature_defaults};
   return {id:c.id,name:c.name,policy:c.billing_policy==='commercial_v2'?'commercial_v2':'legacy_overlay',account:c.account,
    access:computeBusinessAccess(c.business,now,s),overrides:s.overrides};
  })};
 }
 const versionLabel=(versions,id)=>{const v=versions.find(x=>String(x.id)===String(id));return v?{id:v.id,plan:v.plan,version:Number(v.version),name_i18n:v.name_i18n}:null};
 app.get('/api/admin/billing/subscriptions',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const{rows,versions}=await adminRows();
  res.json({subscriptions:rows.map(r=>({id:r.id,name:r.name,policy:r.policy,status:r.policy==='legacy'?'legacy':r.access.subscription_status,
   source:r.access.effective_access_source,restricted:!!r.access.restricted,effective:versionLabel(versions,r.access.effective_plan_version_id),
   selected:versionLabel(versions,r.account?.selected_plan_version_id),trial_started_at:r.access.trial_started_at||null,trial_ends_at:r.access.trial_ends_at||null,
   paid_period_ends_at:r.access.paid_period_ends_at||null,overrides_active:(r.access.overrides_active||[]).length,override_active:!!r.access.override_active,
   discount_percent:r.access.discount_percent??null,account_version:r.account?Number(r.account.version):null}))});
 }));
 app.get('/api/admin/billing/overview',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const{rows}=await adminRows(),commercial=rows.filter(r=>r.policy==='commercial_v2'),n=f=>commercial.filter(f).length;
  // MRR needs verified payments; until a provider is connected it is reported as unavailable, never estimated.
  res.json({payments_connected:false,mrr:null,companies:rows.length,legacy:rows.length-commercial.length,commercial:commercial.length,
   trialing:n(r=>r.access.subscription_status==='trialing'),active_paid:n(r=>r.access.subscription_active),
   expired:n(r=>r.access.subscription_status==='expired'),not_started:n(r=>r.access.subscription_status==='not_started'),
   admin_grants:rows.filter(r=>r.access.override_active).length,overrides:rows.reduce((k,r)=>k+(r.access.overrides_active||[]).length,0)});
 }));
 app.get('/api/admin/billing/overrides',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const{rows,versions}=await adminRows(),out=[];
  for(const r of rows)for(const o of r.overrides||[]){
   const base=versions.find(v=>String(v.id)===String(r.access.effective_plan_version_id)),active=(r.access.overrides_active||[]).some(x=>x.id===o.id);
   out.push({...o,company:{id:r.id,name:r.name},base_plan:versionLabel(versions,r.access.effective_plan_version_id),active,
    base_value:o.kind==='limit'?(base?.limits?.[o.key]??null):o.kind==='feature'?(base?.features?.[o.key]??null):null,
    effective_value:o.kind==='discount'?(r.access.discount_percent??null):o.kind==='limit'?(r.access.limits?.[o.key]??null):(r.access.features?.[o.key]??null)});
  }
  out.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));res.json({overrides:out});
 }));
 app.get('/api/admin/billing/audit',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const{data,error}=await supabase.from('billing_admin_commands').select('id,actor_user_id,business_id,action,intent,result,created_at').order('created_at',{ascending:false}).limit(200);
  if(error)throw error;const ids=[...new Set(data.map(x=>x.business_id).filter(Boolean))];
  const{data:b,error:e}=ids.length?await supabase.from('businesses').select('id,name').in('id',ids):{data:[],error:null};if(e)throw e;
  res.json({entries:data.map(x=>({id:x.id,actor_user_id:x.actor_user_id,business_id:x.business_id,company:(b||[]).find(y=>y.id===x.business_id)?.name||null,
   action:x.action,code:x.intent?.code||null,payload_action:x.intent?.payload?.action||null,reason:x.result?.reason||null,created_at:x.created_at}))});
 }));
 app.get('/api/admin/billing/payments',auth,gate,requireAdmin,admin(async(_req,res)=>{
  const{data,error}=await supabase.from('billing_service_periods').select('id,business_id,plan_version_id,payment_id,payment_verified,environment,starts_at,ends_at,revoked_at').order('starts_at',{ascending:false}).limit(200);
  if(error)throw error;res.json({provider:null,connected:false,periods:data});
 }));
 app.get('/api/admin/billing/settings',auth,gate,requireAdmin,admin(async(_req,res)=>{
  res.json({payments_connected:false,provider:null,fixtures_allowed:allowFixtures,default_trial_hours:168,quota_period:'calendar_month_utc',
   failed_requests:'released_on_http_error',lost_responses:'kept_for_reconciliation',default_limit_policy:'hard',seats_policy:'always_hard',
   expired_access:'read_export_recovery_allowed',legacy_companies:'unchanged'});
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
  const [v,g,p,u,h,o,fd,us,ci]=await Promise.all([supabase.from('plan_versions').select('*'),supabase.from('billing_grants').select('*').eq('business_id',b.id),supabase.from('billing_service_periods').select('*').eq('business_id',b.id),supabase.from('billing_quota_reservations').select('resource,units,state,period_start').eq('business_id',b.id),supabase.from('billing_admin_commands').select('id,action,intent,result,created_at').eq('business_id',b.id).order('created_at',{ascending:false}).limit(30),supabase.from('billing_overrides').select('*').eq('business_id',b.id).order('created_at'),supabase.rpc('billing_feature_defaults'),supabase.rpc('billing_usage',{p_business:b.id}),supabase.from('billing_catalog_items').select('*').eq('kind','limit').order('sort_order')]);
  for(const x of [v,g,p,u,h,o,fd,us,ci])if(x.error)throw x.error;
  const s={...a,plan_versions:v.data,grants:g.data,service_periods:p.data,overrides:o.data,feature_defaults:fd.data};
  const access=computeBusinessAccess(b,new Date(),s),base=v.data.find(x=>String(x.id)===String(access.effective_plan_version_id));
  // Base (plan), individual (override), effective and real usage per limit, as the server enforces them.
  const limits=ci.data.map(i=>{const ov=(access.overrides_active||[]).find(x=>x.kind==='limit'&&x.key===i.key);
   return {key:i.key,label_i18n:i.label_i18n,enforcement:i.enforcement,required:i.required,counter:i.counter,reset_period:i.reset_period,base:base?(base.limits?.[i.key]??null):null,
    individual:ov?ov.value:undefined,effective:access.restricted?null:(access.limits?.[i.key]??null),used:i.counter?(us.data?.[i.counter]??0):null,policy:base?.limit_policies?.[i.key]||'hard'}});
  res.json({policy:'commercial_v2',business:{id:b.id,name:b.name},account:s,access,usage:u.data,usage_now:us.data,limits,history:h.data});
 }));
 app.post('/api/admin/billing/companies/:id/:action',auth,gate,requireAdmin,admin(async(req,res)=>{
  const b=req.body||{};if(!UUID.test(req.params.id)||!UUID.test(b.request_key||'')||!Number.isSafeInteger(b.expected_version))throw Error('billing_invalid_command');
  const{data,error}=await supabase.rpc('rpc_billing_admin_command',{p_actor:req.user.userId,p_key:b.request_key,p_business:req.params.id,p_expected:b.expected_version,p_action:req.params.action,p_payload:b.payload,p_allow_fixture:allowFixtures});
  if(error)throw error;res.json(data);
 }));
 }
}
const billingRoutes=require('./billingRoutes');
// Route → plan policy (server/lib/billingRoutes.js). null = never gated (own data, account, recovery, channel gates).
function workflow(req){
 const path=(req.originalUrl||req.url||'').split('?')[0];
 const p=billingRoutes.classify(req.method,path);
 return p.open||p.channel?null:p;
}
// Deterministic UUID for a second reservation of the same request (e.g. storage next to documents) or for a
// non-UUID natural key (transfer_id): retries map to the same reservation.
function deriveKey(raw,suffix){
 const h=crypto.createHash('sha256').update(String(raw).toLowerCase()+':'+suffix).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
const denial=(code,status,extra={})=>Object.assign(Error(code),{status},extra);
// Rows a statement confirmation can still create (unlinked rows minus those the request links or excludes).
async function importRows(supabase,biz,req){
 const batch=((req.originalUrl||'').split('?')[0].match(/\/(?:bank-imports|bank-import\/batches)\/([^/]+)\/confirm$/)||[])[1];
 if(!UUID.test(batch||''))throw denial('billing_invalid_command',400);
 const{data,error}=await supabase.from('bank_import_rows').select('id').eq('business_id',biz.business.id).eq('batch_id',batch).is('linked_transaction_id',null);
 if(error)throw error;
 const skipped=(Array.isArray(req.body?.rows)?req.body.rows:[]).filter(r=>['link','exclude'].includes(r?.match_action)).length;
 return Math.max(1,(data||[]).length-skipped);
}
async function snapshot(supabase,actor,biz,allowFixtures){
 const{data,error}=await supabase.rpc('rpc_billing_snapshot',{p_actor:actor,p_business:biz.business.id,p_allow_fixture:allowFixtures});
 if(error)throw error;if(data?.policy==='legacy')return null;if(!data||data.policy!=='commercial_v2')throw Error('billing_snapshot_unavailable');return data;
}
const quota=(supabase,actor,biz,r,action,extra={})=>supabase.rpc('rpc_billing_quota',{p_actor:actor,p_business:biz.business.id,p_key:r.key,p_resource:r.resource,p_action:action,p_units:r.units,...extra});
// Returns the reservations this request holds ([] when nothing is metered). Throws a billing_* error to refuse.
async function admit(supabase,actor,biz,policy,{key=null,allowFixtures=false,intent={},req={}}={}){
 const s=await snapshot(supabase,actor,biz,allowFixtures);if(!s)return [];
 if(policy.phase==='complete'){
  if(!UUID.test(key||''))throw denial('billing_request_key_required',400);
  key=key.toLowerCase();
  const{data:r,error}=await supabase.from('billing_quota_reservations').select('*').eq('business_id',biz.business.id).eq('actor_user_id',actor).eq('request_key',key).maybeSingle();
  if(error)throw error;if(!r||r.resource!=='documents'||r.state==='released'||!intent.sha256||r.intent?.sha256!==intent.sha256)throw denial('billing_reservation_terminal',409);
  const started=await quota(supabase,actor,biz,{key,resource:'documents',units:1},'start',{p_intent:intent});if(started.error)throw started.error;
  const held=[{key,resource:'documents',units:1,phase:'complete'}];
  const sk=deriveKey(key,'storage_mb');
  const{data:st}=await supabase.from('billing_quota_reservations').select('units,state').eq('business_id',biz.business.id).eq('request_key',sk).maybeSingle();
  if(st&&['reserved','processing'].includes(st.state))held.push({key:sk,resource:'storage_mb',units:st.units,phase:'complete'});
  return held;
 }
 const a=computeBusinessAccess(biz.business,new Date(s.server_now),s);
 if(a.restricted)throw denial('billing_restricted',402);
 for(const f of policy.features||[])if(a.features[f]!==true)throw denial('billing_feature_denied',402,{feature:f});
 if(!policy.resource)return [];
 const units=typeof policy.units==='function'?policy.units(req):policy.units==='import_rows'?await importRows(supabase,biz,req):1;
 if(!Number.isSafeInteger(units)||units<1||units>5000)throw denial('billing_invalid_command',400);
 // Natural idempotency key of the operation: a retry reserves nothing twice. Without one, each request counts.
 if(!key&&policy.requireKey)throw denial('billing_request_key_required',400);
 const primary=!key?crypto.randomUUID():UUID.test(key)?key.toLowerCase():deriveKey(key,'natural');
 const plan=[{key:primary,resource:policy.resource,units,phase:policy.phase}];
 if(policy.storage)plan.push({key:deriveKey(primary,'storage_mb'),resource:'storage_mb',units:policy.storage(req),phase:policy.phase});
 const held=[];
 for(const r of plan){
  const{data,error}=await quota(supabase,actor,biz,r,'reserve',{p_intent:r.resource==='documents'?intent:{}});
  if(error||data?.state==='released'||data?.state==='committed'||data?.is_replay){
   for(const h of held)await quota(supabase,actor,biz,h,'release',{p_reason:'Sibling reservation refused'});
   if(error)throw error;
   if(data?.is_replay&&!['released','committed'].includes(data.state))throw denial('billing_job_in_progress',409);
   throw denial('billing_reservation_terminal',409);
  }
  held.push({...r,over_limit:data?.over_limit===true});
 }
 return held;
}
// MCP / external API (reads and writes): 'api' + the tool's own feature; AI tools are metered per call.
async function mcpGate(supabase,actor,biz,name,allowFixtures=false){
 if(biz?.business?.billing_policy!=='commercial_v2')return null;
 const s=await snapshot(supabase,actor,biz,allowFixtures);if(!s)return null;
 const a=computeBusinessAccess(biz.business,new Date(s.server_now),s);
 const deny=(error,message)=>({error,message,billing_url:'/business/billing'});
 if(a.restricted)return deny('billing_restricted','The company plan is not active. Open CFO OS to review billing; your data stays available in the app.');
 const needs=billingRoutes.MCP_TOOLS[name];
 if(!needs)return deny('billing_feature_denied','This tool is not part of the company plan.');
 for(const f of ['api',...needs])if(a.features[f]!==true)return deny('billing_feature_denied',`The company plan does not include ${f==='api'?'API / MCP access':f}.`);
 // Every call counts one `mcp` request; AI tools also count their AI quota. All or nothing.
 const held=[];
 for(const resource of ['mcp',billingRoutes.MCP_METERED[name]].filter(Boolean)){
  const r={key:crypto.randomUUID(),resource,units:1};
  const{data,error}=await quota(supabase,actor,biz,r,'reserve');
  if(error||!data){
   for(const h of held)try{await quota(supabase,actor,biz,h,'release',{p_reason:'MCP sibling quota refused'})}catch{/* reconciled later */}
   const code=String(error?.message||'').match(/billing_[a-z_]+/)?.[0];if(code)return deny(code,resource==='mcp'?'The company MCP / API quota does not allow this request.':'The company AI quota does not allow this request.');
   throw error||Error('billing_unavailable');
  }
  held.push(r);
 }
 return {settle:async ok=>{for(const r of held)try{await quota(supabase,actor,biz,r,ok?'commit':'release',ok?{}:{p_reason:'MCP tool failed'})}catch{console.error('[billing] mcp quota completion requires reconciliation')}}};
}
module.exports={input,errorResponse,install,workflow,snapshot,admit,mcpGate,deriveKey};
