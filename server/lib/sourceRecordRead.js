'use strict';
// Bounded deep-link reads use the existing list routes and their current role gates.
// Text aliases keep bigint IDs / numeric amounts exact without duplicate JSON keys.
const FIELDS={transactions:['id','amount_original','balance_version'],debts:['id','amount','original_amount','paid_amount','bill_version']};
function lookupId(query){
 if(query.id===undefined)return null;
 if(typeof query.id!=='string'||!(/^[1-9]\d{0,18}$/).test(query.id)||BigInt(query.id)>9223372036854775807n)throw Error('invalid_record_id');
 return query.id;
}
function select(table,id){return id?'*,'+FIELDS[table].map(k=>`exact_${k}:${k}::text`).join(','):'*';}
function scope(query,id,businessId){return id?query.eq('business_id',businessId).eq('id',id).limit(1):query;}
function decode(rows,table,id){return id?(rows||[]).map(row=>{const out={...row};for(const k of FIELDS[table]){out[k]=out['exact_'+k];delete out['exact_'+k];}return out;}):rows;}
module.exports={lookupId,select,scope,decode};
