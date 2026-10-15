'use strict';
// Business only. Pure review math, not a financial writer or an authority to
// invent missing opening history. Match fn_ledger_signed's existing policy.
const {addDec,subDec,negDec,cmpDec}=require('./transactionClass');
const crypto=require('node:crypto');
function decimal(value){
 if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))throw Error('import_numeric_precision');
 const s=String(value??'').trim();if(s.length>100||!/^[-+]?\d+(?:\.\d{1,18})?$/.test(s))throw Error('import_numeric_precision');
 return addDec('0',s);
}
function isoDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')throw Error('import_invalid_date');
 const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw Error('import_invalid_date');return value;
}
function previousDay(value){const d=new Date(isoDate(value)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return isoDate(d.toISOString().slice(0,10));}
function ledgerSigned(t,currency){
 // Unknown legacy/funding types retain the native balance function's neutral
 // treatment; importing must not change the existing financial policy.
 if(!['income','expense','payroll','correction'].includes(t.type))return '0';
 let amount=t.amount_original;if(amount==null){if(currency!=='IDR'||t.amount_idr==null)throw Error('import_native_amount_unavailable');amount=t.amount_idr;}
 if(t.currency_original&&String(t.currency_original).toUpperCase()!==currency)throw Error('import_currency_mismatch');
 const n=decimal(amount);return ['expense','payroll'].includes(t.type)?negDec(n):n;
}
function historicalOpening({business,wallet,ledger,statementStart,complete=true}){
 const start=isoDate(statementStart),currency=String(wallet.currency||'').toUpperCase();
 if(!business?.id||business.type==='personal'||wallet.scope!=='business'||wallet.business_id!==business.id)throw Error('import_business_scope_required');
 if(!currency)throw Error('import_currency_required');
 let recorded='0',anchored=false;const reasons=new Set(complete?[]:['ledger_truncated']);
 for(const t of ledger){
  if(t.business_id!==business.id)throw Error('import_business_scope_required');
  if(t.wallet_id!==wallet.id&&(t.wallet_id!=null||t.source!==wallet.name))continue;
  let signed;try{signed=ledgerSigned(t,currency)}catch(e){reasons.add(e.message);continue;}
  if(signed==='0')continue;
  if(!t.transaction_date){reasons.add('undated_ledger');continue;}
  let date;try{date=isoDate(String(t.transaction_date).slice(0,10))}catch{reasons.add('invalid_ledger_date');continue;}
  if(date>=start)continue;
  recorded=addDec(recorded,signed);
  if(t.is_opening_balance===true)anchored=true;
 }
 if(!anchored)reasons.add('opening_history_unanchored');
 return {currency,state:reasons.size?'unknown':'known',recorded_before:recorded,historical_opening:reasons.size?null:recorded,reasons:[...reasons].sort(),correction_date:previousDay(start)};
}
function statementReconciliation({opening,closing,rows}){
 let all='0',processed='0';for(const r of rows){
  if(!['in','out'].includes(r.direction))throw Error('import_invalid_direction');const amount=decimal(r.amount);if(cmpDec(amount,'0')<=0)throw Error('import_invalid_amount');
  const signed=r.direction==='out'?negDec(amount):amount;all=addDec(all,signed);
  if(r.linked_transaction_id!=null&&['imported','matched_existing'].includes(r.review_status))processed=addDec(processed,signed);
 }
 const a=opening==null?null:decimal(opening),b=closing==null?null:decimal(closing),computed=a==null?null:addDec(a,processed);
 return{bank_rows_signed:all,processed_rows_signed:processed,raw_computed_close:a==null?null:addDec(a,all),cumulative_computed_close:computed,difference:b==null||computed==null?null:subDec(b,computed),complete_statement_matches:a==null||b==null?null:cmpDec(addDec(a,all),b)===0};
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
function reviewIdentity({business,wallet,batch,rows,ledger}){
 if(batch.business_id!==business.id||batch.wallet_id!==wallet.id||wallet.business_id!==business.id||wallet.scope!=='business'||business.type==='personal')throw Error('import_business_scope_required');
 const pick=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]??null]));
 const snapshot={v:1,business_id:business.id,wallet:pick(wallet,['id','name','scope','currency','is_active']),batch:pick(batch,['id','wallet_id','currency','statement_start','statement_end','opening_balance','closing_balance','status']),rows:rows.map(r=>{if(r.business_id!==business.id||r.batch_id!==batch.id)throw Error('import_business_scope_required');return pick(r,['id','row_index','tx_date','description','amount','direction','dedup_hash','review_status','linked_transaction_id','matched_transaction_id','final_category_id','final_counterparty_id','final_transaction_type','final_scope']);}).sort((a,b)=>String(a.id).localeCompare(String(b.id))),ledger:ledger.filter(t=>t.wallet_id===wallet.id||t.wallet_id==null&&t.source===wallet.name).map(t=>{if(t.business_id!==business.id)throw Error('import_business_scope_required');return pick(t,['id','wallet_id','source','type','amount_original','amount_idr','currency_original','transaction_date','balance_version','is_opening_balance','bank_import_row_id']);}).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
 return crypto.createHash('sha256').update(JSON.stringify(stable(snapshot))).digest('hex');
}
module.exports={decimal,isoDate,previousDay,ledgerSigned,historicalOpening,statementReconciliation,reviewIdentity};
