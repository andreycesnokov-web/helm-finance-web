'use strict';
const {fetchAllRows}=require('./walletLedger');
// Page-scoped document-link metadata, independent of the 200-document UI list.
// Failure stays unknown; a capped/failed read must never manufacture "unlinked".
async function enrich(supabase,businessId,transactions){
 if(!transactions.length)return;
 for(const row of transactions)row.document_link_status_known=false;
 try{
  const ids=transactions.map(t=>t.id);
  const links=await fetchAllRows(()=>supabase.from('document_transaction_links').select('id,transaction_id')
   .eq('business_id',businessId).in('transaction_id',ids).order('id',{ascending:true}));
  const counts=new Map();for(const link of links)counts.set(String(link.transaction_id),(counts.get(String(link.transaction_id))||0)+1);
  for(const row of transactions){row.document_link_count=counts.get(String(row.id))||0;row.document_link_status_known=true;}
 }catch{/* Existing rows remain usable; global absence is not claimed. */}
}
module.exports={enrich};
