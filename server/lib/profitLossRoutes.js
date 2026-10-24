'use strict';
const {buildReport,options}=require('./profitLoss');
const {loadSystemMapping}=require('./categoryGroups');
const PAGE=500,MAX=25000;
// Explicit select list: never return document extraction text, bucket paths or credentials.
const TABLES={
  transactions:'id::text,business_id,type,amount_original::text,currency_original,category,cashflow_category_id,counterparty_name,description,transaction_date,wallet_id,source,transfer_id,debt_payment_id::text,is_opening_balance,is_training,bank_import_row_id,balance_version::text',
  categories:'id,business_id,name,pnl_group',
  debts:'id::text,business_id,type,linked_transaction_id::text,invoice_number,approval_status,is_training,status',
  wallets:'id,business_id,name',
  documents:'id,business_id,document_type,document_number,document_date,review_status,archived_at',
  txLinks:'id,business_id,document_id,transaction_id::text',debtLinks:'id,business_id,document_id,debt_id::text',
  allocations:'id,business_id,debt_id::text,transaction_id::text,settlement_source_type,allocated_amount::text',
  payroll:'id,business_id,transaction_id::text,period_month,status',
  bank:'id,business_id,linked_transaction_id::text,batch_id,review_status,match_status',
  assets:'id,business_id,purchase_transaction_id::text,purchase_debt_id::text',
  funding:'id,business_id,received_transaction_id::text',
  repayments:'id,business_id,paid_transaction_id::text'
};
const NAMES={categories:'cashflow_categories',documents:'financial_documents',txLinks:'document_transaction_links',debtLinks:'document_debt_links',allocations:'debt_settlement_allocations',payroll:'payroll_payments',bank:'bank_import_rows',funding:'business_funding_records',repayments:'business_funding_repayments'};
async function readAll(db,key,businessId,opt,signal){
  const out=[],seen=new Set();let total=null;
  for(let offset=0;offset<=MAX;offset+=PAGE){
    let q=db.from(NAMES[key]||key).select(TABLES[key],{count:'exact'}).eq('business_id',businessId).order('id',{ascending:true});
    if(key==='transactions') {
      const months=[opt.month,opt.compare,...(opt.months||[])].filter(Boolean).sort(),from=months[0]+'-01';
      const [y,m]=months.at(-1).split('-').map(Number), to=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
      q=q.or(`and(transaction_date.gte.${from},transaction_date.lt.${to}),transaction_date.is.null`);
    }
    const {data,error,count}=await q.range(offset,offset+PAGE-1).abortSignal(signal);
    if(error||!Array.isArray(data)||!Number.isSafeInteger(count)) throw Error('source_read_failed');
    if(count>MAX)throw Error('report_row_limit');
    if(total!=null&&total!==count)throw Error('report_changed_during_read');
    total=count;
    for(const r of data){if(r.business_id!==businessId||seen.has(String(r.id)))throw Error('source_scope_or_pagination_error');seen.add(String(r.id));out.push(r);}
    if(out.length===total)return out;
    // Server cap below our page size must never silently produce a partial report.
    if(data.length<PAGE||out.length>total)throw Error('source_read_incomplete');
  }
  throw Error('report_row_limit');
}
function install(app,{auth,requireBusiness,canViewBusinessFinance,supabase}) {
  app.get('/api/pulse/profit-loss',auth,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const biz=await requireBusiness(req,res);if(!biz)return;
    if(biz.business.type==='personal'||!canViewBusinessFinance(biz.role))return res.status(403).json({error:'business_finance_forbidden'});
    let opt;try{opt=options(req.query);}catch(e){return res.status(400).json({error:e.message});}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const started=new Date().toISOString(),input={};
      // Four bounded reads at a time; no writes/RPCs, no credentials in response/logs.
      const keys=Object.keys(TABLES);
      for(let i=0;i<keys.length;i+=4)await Promise.all(keys.slice(i,i+4).map(async k=>{input[k]=await readAll(supabase,k,biz.business.id,opt,controller.signal);}));
      // Shared system categories count only with THIS company's confirmed group (none before the migration).
      const sys=await loadSystemMapping(supabase,biz.business.id,controller.signal);
      input.systemCategories=sys.systemCategories;input.categoryGroups=sys.categoryGroups;
      res.json({...buildReport(input,{businessId:biz.business.id,...opt}),system_category_mapping:sys.available,read_started_at:started,read_finished_at:new Date().toISOString()});
    }catch(e){
      controller.abort();
      const code=['report_row_limit','report_changed_during_read','source_read_incomplete'].includes(e.message)?e.message:'profit_loss_unavailable';
      res.status(503).json({error:code,message:'Report could not be read completely. Retry; no partial totals are shown.'});
    }finally{clearTimeout(timer);}
  });
}
module.exports={install,readAll,TABLES,NAMES};
