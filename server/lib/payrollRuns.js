'use strict';
// Business-only accrual/reconciliation. This module never writes bank transactions.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY=['salary','bonus','earnings','pph21','bpjs','other','employer_bpjs'];
function payload(body={}) {
 const {request_key,...p}=body;
 if(!['create','edit','approve','cancel','link'].includes(p.action))throw Error('payroll_invalid_request');
 const fields=['action',...(['create','edit'].includes(p.action)?['period_month','payment_date','wallet_id','tax_confirmed','lines']:[]),
  ...(p.action==='create'?[]:['run_id','version']),...(p.action==='link'?['payment_id','transaction_id']:[])];
 if(Object.keys(p).some(k=>!fields.includes(k)))throw Error('payroll_invalid_request');
 if(p.action!=='create'&&(!UUID.test(p.run_id)||!Number.isSafeInteger(p.version)||p.version<1))throw Error('payroll_invalid_request');
 if(['create','edit'].includes(p.action)) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.period_month||''))throw Error('payroll_invalid_period');
  const day=String(p.payment_date||''); const d=new Date(day+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day)throw Error('payroll_invalid_period');
  if(!UUID.test(p.wallet_id))throw Error('payroll_wallet_required');
  if(p.tax_confirmed!==true)throw Error('payroll_tax_confirmation_required');
  if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>500)throw Error('payroll_lines_required');
  const seen=new Set();
  p.lines=p.lines.map(line=>{
   if(!line||!UUID.test(line.employee_id)||seen.has(line.employee_id.toLowerCase()))throw Error('payroll_duplicate_employee');
   seen.add(line.employee_id.toLowerCase());
   if(Object.keys(line).some(k=>!['employee_id',...MONEY].includes(k)))throw Error('payroll_invalid_line');
   const out={employee_id:line.employee_id.toLowerCase()};
   for(const k of MONEY){const s=String(line[k]??'');if(!/^(0|[1-9]\d*)$/.test(s)||Number(s)>1e12)throw Error('payroll_invalid_amount');out[k]=s;}
   if(Number(out.salary)+Number(out.bonus)+Number(out.earnings)<=Number(out.pph21)+Number(out.bpjs)+Number(out.other))throw Error('payroll_invalid_net');
   return out;
  });
 }
 if(p.action==='link'&&(!UUID.test(p.payment_id)||!/^[1-9]\d{0,15}$/.test(String(p.transaction_id))||!Number.isSafeInteger(Number(p.transaction_id))))throw Error('payroll_invalid_request');
 return p;
}
function install(app,{auth,requireBusiness,supabase,canManage}) {
 const fail=(res,error)=>{
  const code=String(error?.message||'').match(/(?:payroll_[a-z_]+|idempotency_key_mismatch)/)?.[0];
  const unavailable=error?.code==='PGRST202'||error?.code==='42P01';
  const status=unavailable?503:code==='payroll_forbidden'?403:code==='payroll_not_found'?404:
   /stale|exists|linked|allocated|locked|mismatch|approval|draft/.test(code||'')?409:code?400:503;
  return res.status(status).json({error:unavailable?'payroll_migration_required':code||'payroll_unavailable',automatic_retry:false});
 };
 const employee=action=>async(req,res)=>{
   try{const biz=await requireBusiness(req,res);if(!biz)return;if(!canManage(biz.role))return res.status(403).json({error:'payroll_forbidden'});
    if(req.params.id&&!UUID.test(req.params.id))return res.status(400).json({error:'payroll_invalid_request'});
    const patch=req.body||{};
    const {data,error}=await supabase.rpc('rpc_payroll_employee_action',{p_business:biz.business.id,p_actor:req.user.userId,p_action:action,p_id:req.params.id||null,p_patch:patch});
    if(error)throw error;if(!data?.employee?.id||!data.audit_id)throw Error('payroll_unconfirmed_result');res.json(data);
   }catch(e){fail(res,e)}
  };
 app.post('/api/payroll/employees',auth,employee('create'));
 app.patch('/api/payroll/employees/:id',auth,employee('update'));
 app.delete('/api/payroll/employees/:id',auth,employee('archive'));
 app.get('/api/payroll/runs',auth,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{const biz=await requireBusiness(req,res);if(!biz)return;if(!canManage(biz.role))return res.status(403).json({error:'payroll_forbidden'});
   const {data,error}=await supabase.from('payroll_runs').select('*, payroll_payments(*, payroll_payment_items(*))')
    .eq('business_id',biz.business.id).order('created_at',{ascending:false}).limit(100);
   if(error)throw error;res.json({runs:data||[],limit:100,cash_changed:false});
  }catch(e){fail(res,e)}
 });
 app.post('/api/payroll/runs/action',auth,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{const biz=await requireBusiness(req,res);if(!biz)return;if(!canManage(biz.role))return res.status(403).json({error:'payroll_forbidden'});
   const recovery=require('./financialRecovery');
   if(!recovery.keyValid(req.body?.request_key))return res.status(400).json({error:'idempotency_key_required'});
   const p=payload(req.body);
   const {data,error}=await supabase.rpc('rpc_payroll_run_action',{p_business:biz.business.id,p_actor:req.user.userId,p_request_key:req.body.request_key,p_payload:p});
   if(error)throw error;if(!data?.ok||!data.run?.id||!data.audit_id||data.cash_changed!==false)throw Error('payroll_unconfirmed_result');
   res.json(data);
  }catch(e){fail(res,e)}
 });
}
module.exports={install,payload};
