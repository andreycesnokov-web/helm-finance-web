'use strict';
// One document-control projection from a native snapshot. Never writes cash or invokes AI.
const access=require('./documentAccess');
const {publicIntakeV2}=require('./documentPublicView');
const publicFileRow=f=>f?Object.fromEntries(['file_name','mime_type','file_size','created_at','upload_channel'].map(k=>[k,f[k]??null])):null;
const classification=d=>publicIntakeV2(d.extracted_json?.ai_intake_v2)||null;
const {isInternalTransfer,isFinancingFlow,isFinancialCost,getTransactionCashDirection,cmpDec}=require('./transactionClass');
const key=(type,id)=>type+':'+id;
const stamp=x=>String(x||'').slice(0,10);
const monthOf=x=>stamp(x).slice(0,7);
const same=(a,b)=>String(a)===String(b);
const active=d=>!d.archived_at;
const requiredRoles=['basis','payment','contract','withholding','tax_payment','funding'];
function documentControl(snapshot,{month,role,actor}) {
 const s=snapshot,tx=s.transactions||[],debts=s.debts||[],documents=s.documents||[],audit=s.audit||[];
 const txById=new Map(tx.map(t=>[String(t.id),t])),debtById=new Map(debts.map(d=>[String(d.id),d]));
 const links=[...(s.debt_links||[]).map(l=>({...l,target_type:'debt',target_id:l.debt_id})),...(s.transaction_links||[]).map(l=>({...l,target_type:'transaction',target_id:l.transaction_id}))];
 const owned=debts.filter(d=>same(d.created_by_user_id,actor)).map(d=>d.id);
 const accessible=documents.filter(d=>access.canAccessDocument({role,userId:actor,doc:{...d,created_by_user_id:same(d.created_by_user_id,actor)?actor:d.created_by_user_id,links:links.filter(l=>same(l.document_id,d.id))},ownedDebtIds:owned}));
 const docById=new Map(accessible.map(d=>[String(d.id),d])),fileById=new Map((s.files||[]).map(f=>[String(f.id),f]));
 const catById=new Map((s.categories||[]).map(c=>[String(c.id),c.name]));
 const txDebt=new Map();
 for(const t of tx){if(debtById.has(String(t.debt_payment_id)))txDebt.set(String(t.id),String(t.debt_payment_id));}
 for(const a of s.allocations||[]){if(a.transaction_id&&debtById.has(String(a.debt_id)))txDebt.set(String(a.transaction_id),String(a.debt_id));}
 for(const d of debts){if(d.linked_transaction_id&&txById.has(String(d.linked_transaction_id)))txDebt.set(String(d.linked_transaction_id),String(d.id));}
 const groups=new Map();
 for(const t of tx){if(t.is_opening_balance||t.source==='wallet_opening_balance'||t.type==='opening')continue;
  const debt=txDebt.get(String(t.id)),g=debt?key('debt',debt):t.transfer_id?'transfer:'+t.transfer_id:key('transaction',t.id);
  if(!groups.has(g))groups.set(g,{key:g,transactions:[],debt:debt?debtById.get(debt):null});groups.get(g).transactions.push(t);
 }
 for(const d of debts){const g=key('debt',d.id);if(!groups.has(g))groups.set(g,{key:g,debt:d,transactions:[]});}
 const operations=[];
 for(const group of groups.values()){
  const d=group.debt,payments=group.transactions,monthTx=payments.filter(t=>monthOf(t.transaction_date||t.created_at)===month);
  if(!monthTx.length&&(!d||monthOf(d.invoice_date||d.created_at)!==month))continue;
  const t=monthTx[0]||payments[0],target_type=d?'debt':'transaction',target_id=d?.id??t.id,version=d?.document_review_version??t.document_review_version;
  const matchesTarget=a=>a.target_type===target_type&&same(a.target_id,target_id);
  const review=[...audit].reverse().find(a=>a.action==='operation_reviewed'&&matchesTarget(a));
  const category=t?.category||catById.get(String(t?.cashflow_category_id))||null;
  const ownerFinancingType=!d&&t&&getTransactionCashDirection(t.type)==='in'&&category==='Capital contribution'?'equity':!d&&t&&getTransactionCashDirection(t.type)==='in'&&category==='Owner funding (loan)'?'loan':null;
  const loanRepayment=!d&&t&&getTransactionCashDirection(t.type)==='out'&&category==='Loan repayments';
  const classifiedFinancing=!!ownerFinancingType||!!loanRepayment;
  const expectedFundingKind=ownerFinancingType==='equity'?'funding':ownerFinancingType==='loan'?'loan':null;
  // A manual review for the opposite instrument cannot validate this category.
  const currentReview=review?.metadata?.version===version&&(!expectedFundingKind||review.metadata.kind===expectedFundingKind)?review.metadata:null;
  let kind='unknown',classification_source='uncertain';
  if(d){kind=d.type==='payable'?'supplier':'income';classification_source='linked_invoice';}
  else if(t?.transfer_id||isInternalTransfer(t?.type)||/^Transfer between own accounts/i.test(category||'')){kind='internal_transfer';classification_source='recorded_transfer';}
  else if(isFinancingFlow(t?.type)||/^(Owner funding|Capital contribution|Loan proceeds|Loan repayments)/i.test(category||'')){kind=ownerFinancingType==='loan'||loanRepayment?'loan':'funding';classification_source='recorded_funding';}
  else if(isFinancialCost(t?.type)||/^(Bank fee and admin|Payment gateway fees)$/i.test(category||'')){kind='fee';classification_source='recorded_fee';}
  else if(category&&t?.type==='expense'&&!/^(Other expenses|Intercompany|Owner withdrawal)/i.test(category)){kind='supplier';classification_source='confirmed_category';}
  else if(category&&t?.type==='income'&&!/^(Other income|Intercompany)/i.test(category)){kind='income';classification_source='confirmed_category';}
  // For these explicit cash-flow choices the saved category is the user's answer.
  // An older document review cannot turn a later capital/loan correction back into
  // an unresolved question. Document and month sign-off remain separate stages.
  if(currentReview&&!classifiedFinancing){kind=currentReview.kind;classification_source='human_confirmation';}
  // Not a filename match: only an explicit per-case, per-role coverage confirmation counts.
  const caseTargets=new Set([key(target_type,target_id),...payments.map(p=>key('transaction',p.id))]);
  const caseLinks=links.filter(l=>caseTargets.has(key(l.target_type,l.target_id)));
  const caseDocIds=new Set(caseLinks.map(l=>String(l.document_id)));
  const caseDocuments=[...caseDocIds].map(id=>docById.get(id)).filter(Boolean).map(doc=>{
   const docLinks=caseLinks.filter(l=>same(l.document_id,doc.id));
   const confirmations=requiredRoles.flatMap(r=>{
    const event=[...audit].reverse().find(a=>a.action==='operation_evidence_confirmed'&&same(a.document_id,doc.id)&&matchesTarget(a)&&a.metadata?.role===r);
    if(!event)return [];
    const valid=active(doc)&&fileById.has(String(doc.file_id))&&!fileById.get(String(doc.file_id)).archived_at&&event.metadata.version===version&&event.metadata.document_version===doc.document_review_version&&docLinks.some(l=>same(l.id,event.metadata.link_id));
    const currencyMismatch=doc.gross_amount!=null&&doc.currency&&(doc.currency!==(d?.currency||t?.currency_original));
    return [{role:r,state:valid&&!currencyMismatch?'linked':'requires_review',reason:event.metadata.reason,source:'human_coverage_confirmation'}];
   });
   return {id:doc.id,document_type:doc.document_type,document_version:doc.document_review_version,archived:!active(doc),file:publicFileRow(fileById.get(String(doc.file_id))),links:docLinks.map(l=>({link_id:l.id,target_type:l.target_type,target_id:l.target_id,version:(l.target_type==='debt'?debtById.get(String(l.target_id)):txById.get(String(l.target_id)))?.document_review_version})),coverage:confirmations,classification:classification(doc)};
  });
  const bankRows=(s.bank_rows||[]).filter(r=>payments.some(p=>(same(r.linked_transaction_id,p.id)||same(r.matched_transaction_id,p.id))&&monthOf(r.tx_date)===month));
  const validBank=bankRows.filter(r=>{
   const p=payments.find(p=>r.linked_transaction_id!=null&&same(r.linked_transaction_id,p.id));
   const b=(s.batches||[]).find(b=>same(b.id,r.batch_id));
   // A suggested/manual match before confirm is not committed bank provenance.
   // JSON numeric values above this precision bound need explicit human coverage;
   // this never limits financial entry amounts or changes a ledger record.
   const precise=v=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
   if(!p||!b||!precise(r.amount)||!precise(p.amount_original))return false;
   let amountMatches=false;try{amountMatches=cmpDec(String(r.amount),String(p.amount_original).replace(/^-/,''))===0}catch{return false}
   return !['cancelled','failed'].includes(b.status)&&stamp(r.tx_date)===stamp(p.transaction_date||p.created_at)&&amountMatches&&r.direction===getTransactionCashDirection(p.type)&&b.currency===p.currency_original&&['imported','confirmed','matched_existing'].includes(r.review_status);
  });
  const paymentSatisfied=payments.length>0&&payments.every(p=>validBank.some(r=>same(r.linked_transaction_id,p.id)));
  // The existing withholding writer records waiting_slip or slip_received after
  // the amount is confirmed. An arbitrary status must never imply a tax gap.
  const recordedWithholding=new Set(['waiting_slip','slip_received','confirmed','reported','paid']);
  const wht=(s.withholding||[]).filter(w=>d&&same(w.debt_id,d.id)&&recordedWithholding.has(w.status)&&Number(w.withholding_amount)>0);
  const requirements=[];
  function requirement(r,mandatory,source,automatic=false,na=false){const evidence=caseDocuments.flatMap(doc=>doc.coverage.filter(c=>c.role===r).map(c=>({...c,document_id:doc.id})));const linked=evidence.some(e=>e.state==='linked');requirements.push({type:r,mandatory,source,reason:r, state:na?'not_applicable':automatic||linked?'linked':evidence.length?'requires_review':'missing',documents:evidence.map(e=>e.document_id),explanation:automatic?'bank_row_or_transfer_pair':source,na_reason:na?(currentReview?.contract_waiver||'scenario_does_not_require_contract'):null});}
  if(kind==='supplier'||kind==='income')requirement('basis',true,'commercial_operation');
  if(kind==='fee')requirement('payment',true,'recorded_fee',paymentSatisfied);
  if(kind==='funding'||kind==='loan'){
   // Explicit owner capital/loan classification plus a verified imported credit
   // closes the preliminary cash folder. A repayment needs only its verified
   // bank debit here. None of these claims that a particular loan liability was
   // settled or that legal/accounting review of the terms is complete.
   if(ownerFinancingType&&paymentSatisfied)requirements.push({type:'funding',mandatory:true,source:'owner_category_and_bank',reason:'funding',state:'linked',documents:[],explanation:'owner_category_and_bank',na_reason:null});
   else if(!loanRepayment)requirement('funding',true,'confirmed_financing_type');
  }
  if(payments.length&&kind!=='fee'&&kind!=='internal_transfer')requirement('payment',true,'cash_operation',paymentSatisfied);
  const paired=kind==='internal_transfer'&&payments.length===2&&new Set(payments.map(p=>String(p.wallet_id))).size===2&&payments.every(p=>p.transfer_id&&same(p.transfer_id,payments[0].transfer_id))&&payments.some(p=>/out|expense/.test(p.type))&&payments.some(p=>/in|income/.test(p.type));
  if(kind==='internal_transfer')requirements.push({type:'counterpart',mandatory:true,source:'internal_transfer',reason:'counterpart',state:paired?'linked':'requires_review',documents:[],explanation:'recorded_same_business_transfer_pair'});
  // An absent or stale human decision is not evidence that a contract is unnecessary.
  // Recorded fees and paired own-account transfers have an explicit rule; other
  // scenarios must be decided before this folder can be called complete.
  const contractByRule=!currentReview&&['fee','internal_transfer'].includes(kind);
  const contractUndecided=!classifiedFinancing&&!currentReview&&!contractByRule;
  // Contract sufficiency is outside this preliminary cash folder for explicit
  // owner financing and loan repayment. It must not block saving their category.
  if(!classifiedFinancing){
   if(contractUndecided)requirements.push({type:'contract',mandatory:false,source:'scenario_confirmation',reason:'contract',state:'requires_review',documents:[],explanation:'contract_decision_pending',na_reason:null});
   else if(contractByRule)requirements.push({type:'contract',mandatory:false,source:'recorded_fee_or_transfer',reason:'contract',state:'not_applicable',documents:[],explanation:'recorded_fee_or_transfer',na_reason:'recorded_fee_or_transfer'});
   else {
    requirement('contract',!!currentReview.contract_required&&!currentReview.contract_waiver,'human_confirmation',false,!currentReview.contract_required||!!currentReview.contract_waiver);
    const r=requirements.at(-1);if(r.state==='not_applicable')r.na_reason=currentReview.contract_waiver||currentReview.reason;
   }
  }
  if(wht.length){requirement('withholding',true,'confirmed_withholding_record');requirement('tax_payment',true,'confirmed_withholding_record');}
  const questions=[];if(kind==='unknown')questions.push('unknown_type');if(review&&!currentReview&&!classifiedFinancing)questions.push('stale_review');
  if(contractUndecided)questions.push('contract_decision');
  if(requirements.some(r=>r.state==='requires_review'&&requiredRoles.includes(r.type)&&r.type!=='contract'))questions.push('coverage_review');
  if(kind==='internal_transfer'&&!paired)questions.push('counterpart_missing');
  const missing=requirements.filter(r=>r.mandatory&&r.state==='missing'),uncertain=questions.length>0;
  const complete=!missing.length&&!uncertain&&requirements.filter(r=>r.mandatory).every(r=>r.state==='linked'||r.state==='not_applicable');
  const history=audit.filter(a=>caseTargets.has(key(a.target_type,a.target_id))||caseDocIds.has(String(a.document_id))).map(a=>({id:a.id,action:a.action,date:a.created_at,reason:a.metadata?.reason||null}));
  operations.push({key:group.key,target_type,target_id,version,date:stamp(t?.transaction_date||d?.invoice_date||d?.created_at),description:d?.counterparty||t?.counterparty_name||t?.description||'',direction:t?getTransactionCashDirection(t.type):d?.type==='payable'?'out':'in',amount:d?.original_amount??d?.amount??t?.amount_original,currency:d?.currency||t?.currency_original,category,owner_financing_type:ownerFinancingType,loan_repayment:!!loanRepayment,invoice:d?{id:d.id,number:d.invoice_number,type:d.type}:null,payments:payments.map(p=>({id:p.id,date:stamp(p.transaction_date||p.created_at),amount:p.amount_original,currency:p.currency_original,description:p.description})),bank_rows:bankRows.map(r=>({id:r.id,date:r.tx_date,description:r.description,amount:r.amount,batch_id:r.batch_id,review_status:r.review_status,verified:validBank.some(v=>same(v.id,r.id)),document_id:(s.batches||[]).find(b=>same(b.id,r.batch_id))?.document_id||null})),documents:caseDocuments,requirements,questions,kind,classification_source,review:currentReview,status:complete?'complete':uncertain?'clarification':'missing',missing_count:missing.length,accountant_checked:!!d?.accountant_checked_at,history});
 }
 operations.sort((a,b)=>b.date.localeCompare(a.date)||a.key.localeCompare(b.key));
 const summary={total:operations.length,complete:operations.filter(o=>o.status==='complete').length,missing:operations.filter(o=>o.missing_count>0).length,clarification:operations.filter(o=>o.status==='clarification').length,accountant_checked:operations.filter(o=>o.accountant_checked).length,empty:!operations.length,document_control_complete:operations.length>0&&operations.every(o=>o.status==='complete'),accountant_review_complete:false,is_closed:false,scope:s.scope||'company'};
 const available=accessible.filter(d=>active(d)&&fileById.has(String(d.file_id))&&!fileById.get(String(d.file_id))?.archived_at).map(d=>({id:d.id,document_type:d.document_type,document_version:d.document_review_version,file:publicFileRow(fileById.get(String(d.file_id))),classification:classification(d)}));
 return {month,summary,operations,available_documents:available,ai:{available:false,source:'rules_and_manual_confirmation'},profile_used:{country:s.profile?.country||null,jurisdiction:s.profile?.jurisdiction||null,profile_status:s.profile?.profile_status||null},limitations:['external_ai_unavailable','accountant_review_separate','manual_coverage_not_legal_validation']};
}
function install(app,{auth,requireBusiness,supabase,hasDocumentsAccess}){
 async function load(req,res){const biz=await requireBusiness(req,res);if(!biz)return null;if(!await hasDocumentsAccess(biz)){res.status(403).json({error:'documents_forbidden'});return null;}const month=String(req.query.month||'');if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){res.status(400).json({error:'invalid_month'});return null;}const {data,error}=await supabase.rpc('rpc_operation_documents_snapshot',{p_business:biz.business.id,p_actor:req.user.userId,p_month:month});if(error)throw error;return {biz,result:documentControl(data,{month,role:biz.role,actor:req.user.userId})};}
 app.get('/api/accountant/operation-documents',auth,async(req,res)=>{try{const x=await load(req,res);if(!x)return;const filter=['all','incomplete','missing','clarification','complete'].includes(req.query.filter)?req.query.filter:'all';const rows=x.result.operations.filter(o=>filter==='all'||(filter==='incomplete'?o.status!=='complete':filter==='missing'?o.missing_count>0:o.status===filter));const page=Math.max(0,Math.floor(Number(req.query.page)||0)),size=50;res.json({...x.result,operations:rows.slice(page*size,(page+1)*size),page,page_size:size,filtered_total:rows.length});}catch(e){res.status(e.code==='42501'?403:503).json({error:'operation_documents_unavailable'});}});
 app.get('/api/accountant/operation-documents/package',auth,async(req,res)=>{try{const x=await load(req,res);if(x)res.json({...x.result,package_kind:'preliminary',business_id:x.biz.business.id});}catch(e){res.status(e.code==='42501'?403:503).json({error:'operation_documents_unavailable'});}});
 app.post('/api/accountant/operation-documents/action',auth,async(req,res)=>{try{const biz=await requireBusiness(req,res);if(!biz)return;if(!access.canManageDocuments(biz.role)||!await hasDocumentsAccess(biz))return res.status(403).json({error:'operation_documents_forbidden'});const b=req.body||{};if(!['debt','transaction'].includes(b.target_type)||!/^\d+$/.test(String(b.target_id))||!['review','link','unlink'].includes(b.action)||!String(b.version||'').match(/^[a-f0-9]{32}$/))return res.status(400).json({error:'invalid_operation_action'});const {data,error}=await supabase.rpc('rpc_operation_document_action',{p_business:biz.business.id,p_actor:req.user.userId,p_type:b.target_type,p_id:b.target_id,p_action:b.action,p_version:b.version,p_document:b.document_id||null,p_body:b.body||{}});if(error){const status=error.code==='42501'?403:error.code==='40001'?409:/not_found/.test(error.message)?404:/invalid_/.test(error.message)?400:503;return res.status(status).json({error:status===503?'operation_document_save_unavailable':error.message});}res.json(data);}catch(e){res.status(503).json({error:'operation_document_save_unavailable'});}});
}
module.exports={documentControl,install};
