'use strict';
const crypto = require('node:crypto');
const shared = import('./financialIntent.mjs');
const operations = new Set(['wallet_create','transaction_batch','wallet_adjust','debt_payment','wallet_transfer']);
const managers = new Set(['owner','ceo','admin','cfo']);
const writers = new Set([...managers,'accountant']);
const keyValid = key => typeof key === 'string' && key.length >= 1 && key.length <= 128 && key === key.trim() && !/[\u0000-\u001f]/.test(key);
const permitted = (role, operation) => (['wallet_create','wallet_adjust'].includes(operation) ? managers : writers).has(role);
async function intent(operation, body, target) { return (await shared).canonicalFinancialIntent(operation, body, target); }
async function storedIntent(operation, value, target) {
  return value?.version === 1 && value?.operation === operation && value?.scope === 'business' ? value : intent(operation, value, target);
}
function transferLedgerId(actor, key, operation = 'wallet_transfer') {
  const h=crypto.createHash('sha256').update(JSON.stringify(['business-transfer-v1',String(actor),operation,key])).digest('hex').slice(0,32);
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
async function findReceipt(supabase, business, actor, operation, key) {
  const table = operation === 'debt_payment' ? 'debt_payment_idempotency' : 'financial_write_requests';
  const fields = operation === 'debt_payment' ? 'key,intent,response_body,created_at,debt_id,transaction_id' : 'request_key,intent,result,created_at';
  let query=supabase.from(table).select(fields).eq('business_id',business)
    .eq(operation === 'debt_payment' ? 'user_id' : 'actor_user_id',actor)
    .eq(operation === 'debt_payment' ? 'key' : 'request_key',key);
  if(operation!=='debt_payment')query=query.eq('operation',operation);
  const {data,error}=await query.maybeSingle();
  if(error) throw error;
  return data ? {operation,request_key:key,intent:data.intent,result:data.result ?? data.response_body,created_at:data.created_at} : null;
}
async function publicReceipt(supabase,business,actor,row,detail=true) {
  const result=row.result;
  const ref=crypto.createHash('sha256').update(JSON.stringify([business,String(actor),row.operation,row.request_key])).digest('hex').slice(0,12).toUpperCase();
  const objectIds = [];
  if(row.operation==='wallet_create' && result?.wallet?.id) objectIds.push(result.wallet.id);
  if(row.operation==='wallet_adjust' && row.intent?.version===1) objectIds.push(row.intent.payload.wallet_id);
  if(row.operation==='debt_payment' && row.intent?.version===1) objectIds.push(row.intent.payload.wallet_id);
  if(row.operation==='wallet_transfer' && row.intent?.version===1) objectIds.push(row.intent.payload.from_wallet_id,row.intent.payload.to_wallet_id);
  const currentObjects=[];
  for(const id of detail ? [...new Set(objectIds.filter(Boolean))] : []) {
    const {data,error}=await supabase.from('wallets').select('id,is_active').eq('business_id',business).eq('scope','business').eq('id',id).maybeSingle();
    if(error) throw error;
    currentObjects.push({kind:'wallet',state:!data?'removed':data.is_active===false?'archived':'active'});
  }
  const payload=row.intent?.version===1 ? row.intent.payload : row.intent;
  const summary={name:payload?.name || null,description:payload?.reason || payload?.description || (Array.isArray(payload)?payload[0]?.description:null) || null,
    currency:payload?.currency || result?.wallet?.currency || result?.debt?.currency || result?.source_currency || null,amount:payload?.opening_balance ?? payload?.amount ?? payload?.target_balance ?? null,
    saved:result?.saved ?? null};
  return {scope:'business',operation:row.operation,request_key:row.request_key,receipt_ref:ref,state:'confirmed',
    confirmed_at:row.created_at,result_is_historical:true,not_current_balance:true,summary,current_objects:currentObjects,
    ...(detail?{result,intent:row.intent}:{}),automatic_retry:false};
}
async function replay(supabase,req,res,biz,operation,key,canonical) {
  if(!keyValid(key)) return false;
  const row=await findReceipt(supabase,biz.business.id,req.user.userId,operation,key);
  if(!row) return false;
  let prior;
  if(operation==='debt_payment' && row.intent==null) {
    // Legacy receipts remain readable evidence, not guessed request identities.
    res.status(409).json({error:'legacy_receipt_requires_review',outcome:'confirmed',automatic_retry:false});return true;
  }
  if(operation==='wallet_adjust' && row.intent?.version!==1) {
    const tx=row.result?.transaction_id;
    if(!tx){res.status(409).json({error:'legacy_receipt_requires_review',outcome:'confirmed',automatic_retry:false});return true;}
    const {data,error}=await supabase.from('transactions').select('wallet_id').eq('business_id',biz.business.id).eq('id',tx).maybeSingle();
    if(error)throw error;
    if(!data){res.status(409).json({error:'legacy_receipt_requires_review',outcome:'confirmed',automatic_retry:false});return true;}
    prior=await storedIntent(operation,row.intent,data.wallet_id);
  } else prior=await storedIntent(operation,row.intent);
  if(!require('node:util').isDeepStrictEqual(prior,canonical)) {
    res.status(409).json({error:'idempotency_key_mismatch',automatic_retry:false});return true;
  }
  const receipt=await publicReceipt(supabase,biz.business.id,req.user.userId,row);
  res.json({...row.result,is_replay:true,result_is_historical:true,recovery:receipt});return true;
}
function install(app,{auth,requireBusiness,supabase}) {
  const privateRead=(req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    res.set('Pragma','no-cache');
    res.vary('Authorization');res.vary('x-business-id');next();
  };
  const error=(res,e)=>String(e?.message||'').startsWith('business_write_forbidden:')
    ?res.status(403).json({error:'financial_recovery_forbidden',automatic_retry:false})
    :res.status(503).json({error:'financial_recovery_unavailable',outcome:'unknown',automatic_retry:false});
  app.get('/api/financial-operations/recent',privateRead,auth,async(req,res)=>{
    try {
      const biz=await requireBusiness(req,res);if(!biz)return;
      const requested=req.query.operation;
      if(requested && !operations.has(requested))return res.status(400).json({error:'unsupported_financial_operation'});
      const allowed=[...operations].filter(o=>permitted(biz.role,o));
      if(!allowed.length || requested && !allowed.includes(requested))return res.status(403).json({error:'financial_recovery_forbidden'});
      const actor=req.user.userId;
      let cursor=[null,null,null];
      if(req.query.cursor) {
        try {
          if(typeof req.query.cursor!=='string'||req.query.cursor.length>1024)throw Error();
          cursor=JSON.parse(Buffer.from(req.query.cursor,'base64url').toString());
          if(!Array.isArray(cursor)||cursor.length!==3
            ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(cursor[0])
            ||!Number.isFinite(Date.parse(cursor[0]))||!operations.has(cursor[1])||!keyValid(cursor[2]))throw Error();
        }catch{return res.status(400).json({error:'invalid_recovery_cursor'});}
      }
      const {data,error:e}=await supabase.rpc('rpc_list_own_financial_receipts',{
        p_business_id:biz.business.id,p_user_id:actor,p_operation:requested||null,
        p_before:cursor[0],p_after_operation:cursor[1],p_after_key:cursor[2]});
      if(e)throw e;
      if(!Array.isArray(data?.rows))throw Error('missing recovery rows');
      const selected=data.rows,last=selected.at(-1);
      const next=data.has_more&&last?Buffer.from(JSON.stringify([last.created_at,last.operation,last.request_key])).toString('base64url'):null;
      res.json({scope:'business',operations:await Promise.all(selected.map(x=>publicReceipt(supabase,biz.business.id,actor,x,false))),
        has_more:data.has_more,next_cursor:next,window_days:7,actor_only:true,automatic_retry:false});
    }catch(e){error(res,e);}
  });
  app.get('/api/financial-operations/:operation/:key',privateRead,auth,async(req,res)=>{
    try {
      const biz=await requireBusiness(req,res);if(!biz)return;
      const {operation,key}=req.params;
      if(!operations.has(operation)||!keyValid(key))return res.status(400).json({error:'invalid_financial_operation_reference'});
      if(!permitted(biz.role,operation))return res.status(403).json({error:'financial_recovery_forbidden'});
      const row=await findReceipt(supabase,biz.business.id,req.user.userId,operation,key);
      if(!row)return res.status(404).json({error:'financial_operation_not_found',outcome:'unknown',not_found_is_not_rollback:true,automatic_retry:false});
      res.json(await publicReceipt(supabase,biz.business.id,req.user.userId,row));
    }catch(e){error(res,e);}
  });
}
module.exports={intent,storedIntent,findReceipt,publicReceipt,replay,install,transferLedgerId,keyValid,permitted};
