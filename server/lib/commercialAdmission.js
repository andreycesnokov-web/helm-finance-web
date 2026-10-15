'use strict';
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
     if(f.permitted(biz.role,d.operation)&&key&&await f.replay(supabase,req,res,biz,d.operation,key,await f.intent(d.operation,req.body,d.target)))return;
    }
    const key=req.get('Idempotency-Key')||req.body?.request_key||req.body?.request_id;
    const reservation=await billing.admit(supabase,req.user.userId,biz,policy,{key,allowFixtures,intent:policy.resource==='documents'?{sha256:req.body?.sha256}:{},units:policy.resource==='users'?Number(req.body?.max_uses??1):1});
    if(reservation)res.once('finish',()=>{
     const action=res.statusCode<400?'commit':'release';
     if(reservation.phase==='init'&&action==='commit')return;
     // Lost responses retain the reservation; never free possibly completed work.
     Promise.resolve(supabase.rpc('rpc_billing_quota',{p_actor:req.user.userId,p_business:biz.business.id,p_key:key,p_resource:reservation.resource,
      p_action:action,p_units:reservation.units||1,p_reason:action==='release'?'HTTP '+res.statusCode:null})).then(r=>{if(r.error)console.error('[billing] quota completion requires reconciliation')}).catch(()=>console.error('[billing] quota completion requires reconciliation'));
    });
    next();
   }catch(e){
    const code=String(e?.message||'').match(/billing_[a-z_]+/)?.[0];
    res.status(e.status||(code?402:503)).json({error:code||'billing_unavailable',billing_url:'/business/billing',automatic_retry:false});
   }
  });
 });
}
module.exports={install};
