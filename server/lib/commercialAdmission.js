'use strict';
// Business. Commercial admission for every /api request of a commercial_v2 company: the route policy
// (billingRoutes) decides which plan features a request needs and which resources it consumes.
// Legacy companies and the flag OFF keep their existing behaviour (no admission at all).
const billing=require('./commercialBilling');
function install(app,{auth,supabase,resolveBusiness,enabled=false,allowFixtures=false}){
 if(!enabled)return;
 app.use('/api',(req,res,next)=>{
  const policy=billing.workflow(req);if(!policy)return next();
  auth(req,res,async()=>{
   try{
    const biz=await resolveBusiness(req);
    if(biz.business.billing_policy!=='commercial_v2')return next();
    const path=(req.originalUrl||'').split('?')[0].replace(/^\/api/,'');
    const {requestDescription}=await import('./financialIntent.mjs');
    const d=req.method==='POST'?requestDescription(path):null;
    if(d){const f=require('./financialRecovery'),key=req.body?.[d.field];
     // A replay of a completed financial operation returns its stored result and consumes nothing again.
     if(f.permitted(biz.role,d.operation)&&key&&await f.replay(supabase,req,res,biz,d.operation,key,await f.intent(d.operation,req.body,d.target)))return;
    }
    const key=req.get('Idempotency-Key')||(d&&req.body?.[d.field])||req.body?.request_key||req.body?.request_id||null;
    const held=await billing.admit(supabase,req.user.userId,biz,policy,{key,allowFixtures,req,
     intent:policy.resource==='documents'?{sha256:req.body?.sha256}:{}});
    const warn=held.filter(r=>r.over_limit).map(r=>r.resource);
    if(warn.length)res.set('X-Billing-Quota-Warning',warn.join(','));
    if(held.length)res.once('finish',()=>{
     const action=res.statusCode<400?'commit':'release';
     for(const r of held){
      if(r.phase==='init'&&action==='commit')continue; // upload-init keeps the reservation until upload-complete
      // Lost responses retain the reservation; never free possibly completed work.
      Promise.resolve(supabase.rpc('rpc_billing_quota',{p_actor:req.user.userId,p_business:biz.business.id,p_key:r.key,p_resource:r.resource,
       p_action:action,p_units:r.units,p_reason:action==='release'?'HTTP '+res.statusCode:null})).then(x=>{if(x.error)console.error('[billing] quota completion requires reconciliation')}).catch(()=>console.error('[billing] quota completion requires reconciliation'));
     }
    });
    next();
   }catch(e){
    const code=String(e?.message||'').match(/billing_[a-z_]+/)?.[0];
    res.status(e.status||(code?402:503)).json({error:code||'billing_unavailable',billing_url:'/business/billing',automatic_retry:false,
     ...(e.feature?{feature:e.feature}:{}),...(policy.resource?{resource:policy.resource}:{})});
   }
  });
 });
}
module.exports={install};
