'use strict';
const { validTimezone } = require('./profileValidation');
const { DEFAULT_BUSINESS_CATEGORIES } = require('./defaultCategories');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function creationInput(body, currencies) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!['name','base_currency','country','timezone','business_type','request_key'].includes(k))) throw new Error('invalid_company_fields');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length>120) throw new Error('invalid_company_name');
  const base_currency=body.base_currency||'IDR';if(!currencies.includes(base_currency))throw new Error('invalid_company_currency');
  const result={name:body.name.trim(),base_currency};
  for(const field of ['country','timezone','business_type'])if(body[field]!==undefined){
    if(body[field]!==null && (typeof body[field]!=='string'||body[field].length>120))throw new Error('invalid_company_'+field);
    result[field]=body[field]?.trim()||null;
  }
  if(result.timezone!==undefined && result.timezone!==null && !validTimezone(result.timezone))throw new Error('invalid_company_timezone');
  return result;
}
function creationError(res,error) {
  const msg=error?.message||'';
  const known=[['company_creation_key_mismatch',409],['company_creation_unavailable',410],['invalid_company_creation',400]];
  for(const [code,status]of known)if(msg.includes(code))return res.status(status).json({error:code});
  if(['PGRST202','42883','42703','42P01'].includes(error?.code))return res.status(503).json({error:'company_creation_unavailable_schema',outcome:'rolled_back'});
  // A gateway failure can follow a committed RPC. Never label it as rollback.
  return res.status(503).json({error:'company_creation_outcome_unknown',outcome:'unknown',automatic_retry:false});
}
function registerCompanyCreation(app,{auth,supabase,currencies}) {
  app.post('/api/businesses',auth,async(req,res)=>{
    let intent;
    try{intent=creationInput(req.body,currencies)}catch(e){return res.status(400).json({error:e.message})}
    const header=req.get('Idempotency-Key'),key=header||req.body?.request_key;
    if(!UUID.test(key||'')||header&&req.body?.request_key&&header.toLowerCase()!==req.body.request_key.toLowerCase())return res.status(400).json({error:'company_creation_key_required'});
    try {
      const {data,error}=await supabase.rpc('rpc_create_business_once',{
        p_actor:req.user.userId,p_request_key:key.toLowerCase(),p_intent:intent,
        p_categories:DEFAULT_BUSINESS_CATEGORIES.map(([name,group_type,activity_type],sort_order)=>({name,group_type,activity_type,sort_order})),
      });
      if(error)return creationError(res,error);
      if(!data?.business?.id||data.creation_request_id!==key.toLowerCase())return res.status(503).json({error:'company_creation_outcome_unknown',outcome:'unknown'});
      res.status(data.is_replay?200:201).json(data);
    }catch(e){creationError(res,e)}
  });
  app.get('/api/business-creation/:key',auth,async(req,res)=>{
    if(!UUID.test(req.params.key))return res.status(400).json({error:'company_creation_key_required'});
    try{
      const{data,error}=await supabase.rpc('rpc_read_business_creation',{p_actor:req.user.userId,p_request_key:req.params.key.toLowerCase()});
      if(error)return creationError(res,error);
      // Not found does not prove that another in-flight request rolled back.
      res.json(data?{state:'completed',result:data}:{state:'not_found',safe_replay_same_key:true});
    }catch(e){creationError(res,e)}
  });
}
module.exports={creationInput,registerCompanyCreation};
