'use strict';
const {BASE,EXTENDED,profileValue}=require('./profileProvenance');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function profileError(res,error){
 const codes=[['profile_invalid_request',400],['profile_invalid_value',400],['profile_invalid_field',400],['profile_invalid_provenance',400],['profile_document_required',400],['profile_business_required',403],['profile_forbidden',403],['profile_not_found',404],['profile_source_unavailable',404],['profile_version_conflict',409],['profile_request_conflict',409],['profile_country_mismatch',409],['profile_confirmation_required',409],['profile_extraction_not_confirmed',409],['profile_extraction_value_mismatch',409],['profile_source_conflict',422],['profile_incomplete',422]];
 for(const [code,status]of codes)if(error?.code===code||String(error?.message||'').includes(code)){
  let missing;try{if(code==='profile_incomplete')missing=JSON.parse(error.details)}catch{}
  return res.status(status).json({error:code,outcome:'rolled_back',automatic_retry:false,...(Array.isArray(missing)?{missing}:{})});
 }
 if(['22P02','22007','22008','23514','22003'].includes(error?.code))return res.status(400).json({error:'profile_invalid_value',outcome:'rolled_back',automatic_retry:false});
 return res.status(503).json({error:['PGRST202','42883','42703','42P01'].includes(error?.code)?'profile_schema_unavailable':'profile_outcome_unknown',outcome:'unknown',automatic_retry:false});
}
function profileRequest(body={}){
 const expected=String(body.expected_version??'');
 if(!/^\d+$/.test(expected)||typeof body.expected_version==='number'&&!Number.isSafeInteger(body.expected_version)||BigInt(expected)>9223372036854775807n||!UUID.test(body.request_key||''))throw Object.assign(Error('profile_invalid_request'),{code:'profile_invalid_request'});
 const patch={};for(const f of [...BASE,...EXTENDED.filter(f=>f!=='field_verification')])if(Object.hasOwn(body,f))patch[f]=profileValue(f,body[f]);
 if(Object.hasOwn(body,'field_verification')){
  if(!body.field_verification||typeof body.field_verification!=='object'||Array.isArray(body.field_verification))throw Object.assign(Error('profile_invalid_provenance'),{code:'profile_invalid_provenance'});
  patch.field_verification=body.field_verification;
 }
 return{expected_version:BigInt(expected).toString(),request_key:body.request_key.toLowerCase(),patch};
}
function registerBusinessProfileOperations(app,{auth,supabase,requireBusiness,canApprove,completeness,warnings}){
 const write=operation=>async(req,res)=>{
  res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});
  try{
   const biz=await requireBusiness(req,res);if(!biz)return;
   if(!canApprove(biz.role))return profileError(res,{code:'profile_forbidden'});
   if(req.body?.business_id&&String(req.body.business_id).toLowerCase()!==biz.business.id.toLowerCase())return profileError(res,{code:'profile_business_required'});
   const r=profileRequest(req.body);
   if(operation==='verify'&&Object.keys(r.patch).length)return profileError(res,{code:'profile_invalid_request'});
   const{data,error}=await supabase.rpc('rpc_write_business_profile',{p_actor:req.user.userId,p_business:biz.business.id,p_operation:operation,p_expected_version:r.expected_version,p_request_key:r.request_key,p_patch:r.patch});if(error)return profileError(res,error);
   if(data?.ok!==true||data.request_id!==r.request_key||!UUID.test(data.audit_id||'')||data.profile?.business_id!==biz.business.id||!/^\d+$/.test(String(data.profile?.profile_version))||typeof data.profile.profile_version==='number'&&!Number.isSafeInteger(data.profile.profile_version)||BigInt(data.profile.profile_version)!==BigInt(r.expected_version)+(operation==='save'?1n:0n))return profileError(res,{});
   if(operation==='verify'&&String(data.profile.verified_profile_version)!==r.expected_version)return profileError(res,{});
   return res.json({...data,operation,expected_version:r.expected_version,payload:r.patch,completeness:completeness(data.profile),warnings:warnings(data.profile),not_saved:[],unsupported_fields:[]});
  }catch(e){return profileError(res,e)}
 };
 app.put('/api/accountant/profile',auth,write('save'));
 app.post('/api/accountant/profile/verify',auth,write('verify'));
 app.get('/api/accountant/profile/requests/:requestKey',auth,async(req,res)=>{
  res.set({'Cache-Control':'private, no-store',Vary:'Authorization'});
  try{
   const biz=await requireBusiness(req,res);if(!biz)return;if(!canApprove(biz.role))return profileError(res,{code:'profile_forbidden'});
   if(!UUID.test(req.params.requestKey||''))return profileError(res,{code:'profile_invalid_request'});
   const key=req.params.requestKey.toLowerCase();const{data,error}=await supabase.from('audit_events').select('id,after_json').eq('business_id',biz.business.id).eq('actor_user_id',req.user.userId).eq('entity_type','tax_profile').eq('request_id',key).maybeSingle();if(error)return profileError(res,error);
   if(!data)return res.json({state:'not_found',request_id:key});
   const snapshot=data.after_json?.profile;if(snapshot?.business_id!==biz.business.id)return profileError(res,{});
   const{data:current,error:currentError}=await supabase.from('tax_profiles').select('*').eq('business_id',biz.business.id).maybeSingle();if(currentError)return profileError(res,currentError);
   return res.json({state:'confirmed',ok:true,profile:snapshot,current_profile:current,request_id:key,audit_id:data.id,operation:data.after_json.operation,expected_version:data.after_json.expected_version,payload:data.after_json.payload,replayed:true,historical:String(current?.profile_version)!==String(snapshot.profile_version),completeness:completeness(snapshot),warnings:warnings(snapshot),not_saved:[],unsupported_fields:[]});
  }catch(e){return profileError(res,e)}
 });
}
module.exports={profileError,profileRequest,registerBusinessProfileOperations};
