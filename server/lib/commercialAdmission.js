'use strict';
// Business. Commercial admission for every /api request of a commercial_v2 company: the route policy
// (billingRoutes) decides which plan features a request needs and which resources it consumes.
// Legacy companies and the flag OFF keep their existing behaviour (no admission at all).
const billing=require('./commercialBilling');
function install(app,{auth,supabase,resolveBusiness,enabled=false,allowFixtures=false}){
 if(!enabled){
  // Flag OFF: commercial_v2 companies are "billing paused" (server/lib/billingPaused.js) — the same route table
  // decides; no quota is counted, plan features still apply, costly external features are refused.
  const paused=require('./billingPaused');
  app.use('/api',(req,res,next)=>{
   const policy=billing.workflow(req);if(!policy)return next();
   auth(req,res,async()=>{
    // Legacy behaviour is untouched: anything that is not positively a commercial_v2 company goes on to the route.
    let biz=null;try{biz=await resolveBusiness(req)}catch{return next()}
    if(biz?.business?.billing_policy!=='commercial_v2')return next();
    try{
     const p=await paused.pausedAccess(supabase,biz.business);
     for(const f of policy.features||[]){
      if(paused.COSTLY.includes(f))return res.status(503).json({error:'billing_paused',feature:f,automatic_retry:false,
       message:'Commercial billing is paused; AI, API and integrations are unavailable until it is back.'});
      if(p.features[f]!==true)return res.status(402).json({error:'billing_feature_denied',feature:f,automatic_retry:false});
     }
     next();
    }catch(e){
     const code=String(e?.message||'').match(/billing_[a-z_]+/)?.[0];
     res.status(e.status||(code?402:503)).json({error:code||'billing_unavailable',automatic_retry:false});
    }
   });
  });
  return;
 }
 app.use('/api',(req,res,next)=>{
  const policy=billing.workflow(req);if(!policy)return next();
  auth(req,res,async()=>{
   try{
    const biz=await resolveBusiness(req);
    if(biz.business.billing_policy!=='commercial_v2')return next();
    const path=(req.originalUrl||'').split('?')[0].replace(/^\/api/,'');
    const {requestDescription}=await import('./financialIntent.mjs');
    const d=req.method==='POST'?requestDescription(path):null;
    if(d){const f=require('./financialRecovery');
     // The key is read where the route reads it: a debt payment takes Idempotency-Key first (the v2 client sends it there).
     const key=d.field==='idempotency_key'?(req.get('Idempotency-Key')||req.body?.idempotency_key):req.body?.[d.field];
     // A replay of a completed financial operation returns its stored result and consumes nothing again.
     if(f.permitted(biz.role,d.operation)&&key&&await f.replay(supabase,req,res,biz,d.operation,key,await f.intent(d.operation,req.body,d.target)))return;
    }
    // A confirmed bank-statement import has its own durable receipt: the same request key is a replay the route answers
    // from that receipt (intent-checked, nothing booked again), so it must not need a second quota reservation.
    const imp=req.method==='POST'&&/^\/bank-imports\/([0-9a-f-]{36})\/confirm$/i.exec(path);
    if(imp&&typeof req.body?.request_key==='string'){
     const receipt=await require('./bankImportReview').readReceipt(supabase,biz.business.id,imp[1],req.user.userId,req.body.request_key.toLowerCase()).catch(()=>null);
     if(receipt?.state==='confirmed')return next();
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
