// Business reporting only. No journal is invented, no financial writer is called.
// One exact contribution list feeds totals, category detail and evidence export.
'use strict';
const M = require('./transactionClass');
const GROUPS = ['revenue', 'direct_cost', 'operating_cost', 'other_income', 'interest', 'tax'];
const CURRENCY=/^[A-Z][A-Z0-9]{2,9}$/; // Native codes, including existing USDT; no FX conversion.
const norm = v => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
const own = (xs, biz) => (xs || []).filter(x => x.business_id === biz);
const map = xs => new Map(xs.map(x => [String(x.id), x]));
const dateOK = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
function exact(v) {
  // The loader requests numeric::text. Unsafe JS numbers must not become money.
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw Error('inexact_amount');
  if (!/^-?\d{1,20}(\.\d{1,18})?$/.test(String(v))) throw Error('invalid_amount');
  return M.fromScaled(M.toScaled(v));
}
function options(q = {}) {
  const month = q.month, compare = q.compare || null, currency = q.currency || 'IDR';
  const valid = m => typeof m==='string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(m);
  if (!valid(month) || (compare && (!valid(compare) || compare === month))) throw Error('invalid_period');
  const index = m => Number(m.slice(0,4))*12 + Number(m.slice(5));
  if (compare && Math.abs(index(month)-index(compare)) > 12) throw Error('comparison_too_far');
  if (typeof currency!=='string'||!CURRENCY.test(currency)) throw Error('invalid_currency');
  if (q.basis && q.basis !== 'cash') throw Error('accrual_not_supported');
  const months=q.months?(Array.isArray(q.months)?q.months:String(q.months).split(',')):[];
  if(months.length>12||months.some(m=>!valid(m))||new Set(months).size!==months.length)throw Error('invalid_history');
  const all=[month,compare,...months].filter(Boolean).map(index);
  if(Math.max(...all)-Math.min(...all)>12)throw Error('invalid_history');
  return { month, compare, currency, basis: 'cash',months };
}
function buildReport(input, { businessId, ...query }) {
  const opt = options(query), periods = [...new Set([opt.month,opt.compare,...opt.months].filter(Boolean))];
  if (!businessId) throw Error('business_required');
  const cats = own(input.categories, businessId), byId = map(cats), byName = new Map();
  for (const c of cats) { const k = norm(c.name); byName.set(k, [...(byName.get(k)||[]),c]); }
  const debts = own(input.debts,businessId), debtById = map(debts), debtByTx = new Map();
  for (const d of debts) if (d.linked_transaction_id != null) {
    const k=String(d.linked_transaction_id); debtByTx.set(k,[...(debtByTx.get(k)||[]),d]);
  }
  // Settlement allocations enrich lineage only. Their amounts are not added to
  // payments, and non-cash withholding/credit-note allocations add no cash.
  const allocations=own(input.allocations,businessId);
  for(const a of allocations)if(a.settlement_source_type==='transaction'&&a.transaction_id!=null){
    const d=debtById.get(String(a.debt_id)),k=String(a.transaction_id);
    if(d)debtByTx.set(k,[...(debtByTx.get(k)||[]),d]);
  }
  const wallets = map(own(input.wallets,businessId));
  const documents = map(own(input.documents,businessId).filter(d => !d.archived_at));
  const txLinks=own(input.txLinks,businessId), debtLinks=own(input.debtLinks,businessId);
  const payroll = own(input.payroll,businessId), bank=own(input.bank,businessId);
  const assetTx = new Set(), assetDebt = new Set();
  for(const a of own(input.assets,businessId)) {
    if(a.purchase_transaction_id != null) assetTx.add(String(a.purchase_transaction_id));
    if(a.purchase_debt_id != null) assetDebt.add(String(a.purchase_debt_id));
  }
  const fundingTx=new Set(own(input.funding,businessId).map(f=>String(f.received_transaction_id)));
  // A repayment can mix principal and interest. Do not guess a cash split from a schedule.
  const repayments=new Set(own(input.repayments,businessId).map(f=>String(f.paid_transaction_id)));
  const entries=[], exceptions=[], excluded=[], currencies=new Set(), seen=new Set();
  const related = (xs, field) => { const out=new Map(); for(const x of xs) {const k=String(x[field]);out.set(k,[...(out.get(k)||[]),x]);} return out; };
  const pByTx=related(payroll,'transaction_id'), bByTx=related(bank,'linked_transaction_id');
  const docsByTx=related(txLinks,'transaction_id'), docsByDebt=related(debtLinks,'debt_id');
  for (const t of own(input.transactions,businessId)) {
    if (seen.has(String(t.id))) throw Error('duplicate_transaction_read');
    seen.add(String(t.id));
    if (t.is_training) continue;
    // Invalid dates cannot be silently treated as outside the selected period.
    if (dateOK(t.transaction_date) && !periods.includes(t.transaction_date.slice(0,7))) continue;
    if (CURRENCY.test(t.currency_original||'')) currencies.add(t.currency_original);
    const ds=[...new Map([...(debtByTx.get(String(t.id))||[]),debtById.get(String(t.debt_payment_id))].filter(Boolean).map(d=>[String(d.id),d])).values()];
    const docIds = new Set([...(docsByTx.get(String(t.id))||[]), ...ds.flatMap(d=>docsByDebt.get(String(d.id))||[])].map(l=>String(l.document_id)));
    const docs=[...docIds].map(id=>documents.get(id)).filter(Boolean).map(d=>({id:d.id,number:d.document_number,type:d.document_type,date:d.document_date,review_status:d.review_status}));
    const ref={ key:`transaction:${t.id}`, transaction_id:String(t.id), date:t.transaction_date, currency:t.currency_original,
      native_amount: t.amount_original == null ? null : String(t.amount_original), category:t.category || null,
      account:wallets.get(String(t.wallet_id))?.name || null, counterparty:t.counterparty_name || null,
      description:t.description || '', source_type:t.type === 'payroll' ? 'payroll_payment' : t.bank_import_row_id || bByTx.has(String(t.id)) ? 'bank_transaction' : 'transaction',
      source:t.source || null, journal_reference:null, documents:docs,
      bills:ds.map(d=>({id:String(d.id),number:d.invoice_number,type:d.type,status:d.status,approval_status:d.approval_status})),
      payroll:(pByTx.get(String(t.id))||[]).map(p=>({id:p.id,period:p.period_month,status:p.status})),
      bank_review:(bByTx.get(String(t.id))||[]).map(b=>({batch_id:b.batch_id,review_status:b.review_status,match_status:b.match_status})),
      review_status:'not_accountant_approved', reconciliation_status:bByTx.has(String(t.id))?'statement_linked_not_reconciled':'not_verified' };
    const except = reason => exceptions.push({...ref,reason});
    const exclude = reason => excluded.push({...ref,reason});
    if (!dateOK(t.transaction_date)) {except('missing_transaction_date');continue;}
    if (!CURRENCY.test(t.currency_original || '')) {except('missing_currency');continue;}
    if (t.currency_original !== opt.currency) {exclude('other_currency');continue;}
    const econ=M.getTransactionEconomicClass(t.type);
    if (t.is_opening_balance || /^(wallet_opening_balance|bank_import_opening|opening_reanchor(?:_reversal)?)$/.test(t.source||'') || t.type==='correction') {exclude('opening_or_correction');continue;}
    if(t.transfer_id || econ==='internal_transfer' || /^(transfer:|transfer_)/.test(t.source||'')) {exclude('own_account_transfer');continue;}
    if(econ==='financing'||econ==='investing'||fundingTx.has(String(t.id))) {exclude('financing');continue;}
    if(repayments.has(String(t.id))) {except('repayment_split_not_verified');continue;}
    if(ds.some(d=>assetDebt.has(String(d.id)))&&ds.some(d=>!assetDebt.has(String(d.id)))) {except('mixed_asset_allocation');continue;}
    if(assetTx.has(String(t.id))||ds.some(d=>assetDebt.has(String(d.id)))) {exclude('capital_purchase');continue;}
    if(ds.some(d=>d.status==='cancelled'||d.approval_status==='rejected'||d.approval_status==='pending_approval'||d.is_training)) {except('linked_bill_not_approved');continue;}
    let amount;
    try{amount=exact(t.amount_original);}catch{except('invalid_or_inexact_amount');continue;}
    // Stored magnitudes are nonnegative; refund direction comes from type and its
    // confirmed category, e.g. expense in revenue is a sales refund.
    if(M.cmpDec(amount,'0')<0) {except('negative_magnitude_needs_review');continue;}
    if(!['income','expense','payroll','bank_fee','fx_fee','network_fee'].includes(t.type)) {except('unsupported_transaction_type');continue;}
    let c;
    if(t.cashflow_category_id != null) c=byId.get(String(t.cashflow_category_id));
    else {const hits=byName.get(norm(t.category))||[]; if(hits.length===1)c=hits[0];}
    if(!c?.pnl_group) {except('unclassified_or_ambiguous_category');continue;}
    if(['asset_purchase','funding','transfer'].includes(c.pnl_group)) {exclude(c.pnl_group);continue;}
    if(!GROUPS.includes(c.pnl_group)) {except('unsupported_category_group');continue;}
    const signed = t.type==='income'?amount:M.negDec(amount);
    // Expense rows show a positive cost; opposite-direction refunds show negative cost.
    const contribution=['revenue','other_income'].includes(c.pnl_group)?signed:M.negDec(signed);
    entries.push({...ref,amount,contribution,group:c.pnl_group,category:c.name,category_id:c.id});
  }
  const summarize = month => {
    const xs=entries.filter(e=>e.date.slice(0,7)===month), groups={};
    for(const g of GROUPS) {
      const gs=xs.filter(e=>e.group===g), cs=new Map();
      for(const e of gs) {const k=String(e.category_id);if(!cs.has(k))cs.set(k,{id:k,name:e.category,total:'0',entry_keys:[]});const c=cs.get(k);c.total=M.addDec(c.total,e.contribution);c.entry_keys.push(e.key);}
      groups[g]={total:gs.reduce((n,e)=>M.addDec(n,e.contribution),'0'),categories:[...cs.values()].sort((a,b)=>a.name.localeCompare(b.name)),entry_keys:gs.map(e=>e.key)};
    }
    const gross=M.subDec(groups.revenue.total,groups.direct_cost.total),ebitda=M.subDec(gross,groups.operating_cost.total);
    const result=M.subDec(M.subDec(M.addDec(ebitda,groups.other_income.total),groups.interest.total),groups.tax.total);
    return {month,groups,totals:{revenue:groups.revenue.total,direct_cost:groups.direct_cost.total,gross,operating_cost:groups.operating_cost.total,ebitda,other_income:groups.other_income.total,interest:groups.interest.total,tax:groups.tax.total,cash_result:result,net_profit:null,depreciation:null},entry_keys:xs.map(e=>e.key)};
  };
  return {version:1,business_id:businessId,...opt,status:'provisional_cash_view',accounting_ready:false,
    capabilities:{cash:true,accrual:false,general_ledger:false,trial_balance:false},
    periods:Object.fromEntries(periods.map(m=>[m,summarize(m)])),entries,exceptions,excluded,currencies:[...currencies].sort(),
    coverage:{included:entries.length,exceptions:exceptions.length,excluded:excluded.length,missing_documents:entries.filter(e=>!e.documents.length).length,unreconciled:entries.filter(e=>e.reconciliation_status!=='reconciled').length},
    limitations:['cash_movements_not_accrual_profit','gross_cash_includes_unsplit_vat_and_withholding','payroll_net_cash_not_gross_expense','no_verified_depreciation_or_inventory_recognition','no_accountant_approval_or_journal','only_explicit_business_id_rows','multi_query_read_not_atomic_snapshot']};
}
module.exports={buildReport,options,exact,GROUPS};
