import {useEffect,useRef,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {useWorkspace} from '../../shell/WorkspaceProvider'
import {useApi,useInvalidate} from '../data'
import {useT,useLang} from '../i18n'
import {Card,Pill,Btn,Skeleton,ErrorBox,Empty} from '../ui'
import {money,shortCalendarDate} from '../lib/format'
import {catLabel} from '../lib/categoryLabel'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {documentFileUrl,operationDocumentAction,readOperationDocumentPackage,uploadOperationDocument} from '../lib/actions'
import {canRecordCompanyMoney} from '../lib/financePermissions'
import Modal from './Modal'

export const operationDocumentsPath=(month,filter='incomplete')=>'/business/accountant?tab=packages&month='+encodeURIComponent(month)+'&filter='+filter
const roles=['basis','payment','contract','withholding','tax_payment','funding']
const uploadTypes={basis:'vendor_invoice',payment:'payment_proof',contract:'other',withholding:'bukti_potong',tax_payment:'payment_proof',funding:'other'}

// This is a display hint from the bank narrative, never a verified counterparty.
function bankRecipient(operation){
 if(operation.target_type!=='transaction'||operation.direction!=='out'||operation.payments?.length!==1)return null
 const raw=operation.bank_rows?.find(row=>row.verified)?.description||''
 const match=raw.match(/\bTRF(?:\s+BIFAST)?\s+KE\s+(.+?)(?=\s+\d{7,}|\s+BANK\b|\s+New PeB\b|$)/i)
 return match?.[1]?.trim()||null
}

export default function OperationDocuments({month}){
 const t=useT(),lang=useLang(),{active,scopeKey}=useWorkspace(),[params,setParams]=useSearchParams()
 const data=useApi('/accountant/operation-documents/package?month='+encodeURIComponent(month))
 const [page,setPage]=useState(0),[selected,setSelected]=useState(null),[saved,setSaved]=useState(null)
 const filter=['all','incomplete','missing','clarification','complete'].includes(params.get('filter'))?params.get('filter'):'all'
 const scope=String(active?.id)+'|'+scopeKey+'|'+month
 useEffect(()=>{setPage(0);setSelected(null);setSaved(null)},[scope])
 const result=data.data?.business_id===active?.id?data.data:null,operations=result?.operations||[],summary=result?.summary
 const rows=operations.filter(o=>filter==='all'||(filter==='incomplete'?o.status!=='complete':filter==='missing'?o.missing_count>0:o.status===filter))
 const cur=operations.find(o=>o.key===selected)
 const pick=k=>{setParams(p=>{const n=new URLSearchParams(p);n.set('filter',k);return n},{replace:true});setPage(0)}
 const close=()=>{setSelected(null);setSaved(null)}
 return <div data-operation-documents>
  {saved&&<p role="status" className="v2-note">{t('od.saved')}</p>}
  {data.loading?<Card><Skeleton rows={4}/></Card>:data.error?<ErrorBox error={data.error?.status===403?t('od.forbidden'):t('od.readFailed')} onRetry={data.reload}/>:<>
   <Card><p className="v2-dec-title" data-od-count>{summary?.empty?t('od.empty'):t('od.collected',{ok:summary?.complete,n:summary?.total})}</p>
    <p>{t('od.gaps',{missing:summary?.missing,clarification:summary?.clarification})}</p>
    <p className="v2-muted">{t('od.aiUnavailable')} · {t('od.reviewSeparate')}</p>
    {summary?.scope==='own_records'&&<p className="v2-muted">{t('od.ownRecords')}</p>}
   </Card>
   <Card>
    <div className="v2-chips" aria-label={t('od.filters')}>{['all','incomplete','missing','clarification','complete'].map(k=><button type="button" key={k} data-od-filter={k} className="v2-chip v2-chip-sel" aria-pressed={filter===k} onClick={()=>pick(k)}>{t(`od.filter.${k}`)}</button>)}</div>
    {!rows.length?<Empty title={t('od.emptyFilter')}/>:<ul className="v2-od-list" data-od-list>{rows.slice(page*50,(page+1)*50).map(o=><li key={o.key} data-operation={o.key}>
     <div><span className="v2-muted">{shortCalendarDate(o.date,lang)}</span><strong>{bankRecipient(o)?t('od.paymentTo',{name:bankRecipient(o)}):o.description||t('od.unnamed')}</strong><span>{money(o.amount,{currency:o.currency,full:true})}</span><span className="v2-small">{o.category?catLabel(t,o.category):t('od.noCategory')}</span></div>
     <div className="v2-small">{o.invoice?<Link to={'/business/'+(o.invoice.type==='receivable'?'receivables':'payables')+'/'+o.invoice.id}>{t('od.invoice')}{o.invoice.number?' · '+o.invoice.number:''}</Link>:o.loan_repayment?t('od.ownerFinancing.repaymentNoInvoice'):['funding','loan'].includes(o.kind)?t('od.ownerFinancing.noInvoice'):t('od.noInvoice')}</div>
     <div className="v2-small">{t('od.have')}: {o.documents.map(d=>d.file?.file_name||t('od.document')).join(', ')||'—'}</div>
     <div className="v2-small">{t('od.missing')}: {o.requirements.filter(r=>r.mandatory&&r.state==='missing').map(r=>t(`od.requirement.${r.type}`)).join(', ')||'—'}</div>
     <div><Pill tone={o.status==='complete'?'good':'warn'}>{t(`od.status.${o.status}`)}</Pill><Btn variant="secondary" data-od-open={o.key} onClick={()=>setSelected(o.key)}>{t('od.openFolder')}</Btn></div>
    </li>)}</ul>}
    {rows.length>50&&<p data-od-pagination>{page*50+1}–{Math.min((page+1)*50,rows.length)} / {rows.length} <Btn variant="ghost" disabled={!page} onClick={()=>setPage(p=>p-1)}>{t('od.previous')}</Btn><Btn variant="ghost" data-od-next disabled={(page+1)*50>=rows.length} onClick={()=>setPage(p=>p+1)}>{t('od.next')}</Btn></p>}
   </Card>
  </>}
  {cur&&<OperationFolder key={scope+'|'+cur.key} operation={cur} documents={result.available_documents||[]} onClose={close} onChanged={r=>{setSaved(r);data.reload()}}/>}
 </div>
}

function OperationFolder({operation:o,documents,onClose,onChanged}){
 const t=useT(),lang=useLang(),{active}=useWorkspace(),request=useBusinessRequest(),invalidate=useInvalidate()
 const manage=canRecordCompanyMoney(active?.role),busyRef=useRef(false),fileInput=useRef(null),uploadRole=useRef('basis')
 const [busy,setBusy]=useState(false),[error,setError]=useState(null),[outcome,setOutcome]=useState(null)
 const [kind,setKind]=useState(o.kind),[contractDecision,setContractDecision]=useState(o.review?(o.review.contract_required?'yes':'no'):''),[waiver,setWaiver]=useState(''),[reason,setReason]=useState('')
 const [reviewOpen,setReviewOpen]=useState(false)
 const [documentId,setDocumentId]=useState(''),[coverage,setCoverage]=useState(false),[coverageReason,setCoverageReason]=useState('')
 const [activeRole,setActiveRole]=useState(null),[uploaded,setUploaded]=useState(null)
 const choices=uploaded&&!documents.some(d=>d.id===uploaded.id)?[uploaded,...documents]:documents
 const selectedDoc=choices.find(d=>d.id===documentId)
 const recipient=bankRecipient(o),canReview=contractDecision!==''&&reason.trim().length>=5
 const save=async(action,doc=null,body={},link=null)=>{
  if(busyRef.current||!manage||!request.isCurrent())return;busyRef.current=true;setBusy(true);setError(null)
  try{const result=await operationDocumentAction(request,{target_type:link?.target_type||o.target_type,target_id:link?.target_id??o.target_id,version:link?.version||o.version,action,document_id:doc?.id,body});if(!request.isCurrent())return;setOutcome({ok:true,result});onChanged(result);invalidate()}
  catch(e){if(!request.isCurrent())return;setError(e.status===403?t('od.forbidden'):e.status===409?t('od.stale'):e.status===400?t('od.invalid'):t('od.unknown'));if(!e.status||e.status>=500)setOutcome({unknown:true})}
  finally{busyRef.current=false;if(request.isCurrent())setBusy(false)}
 }
 const check=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{const r=await readOperationDocumentPackage(request,o.date.slice(0,7));if(!request.isCurrent())return;const current=r.operations.find(x=>x.key===o.key);setOutcome({checked:true});setError(null);onChanged({checked:true});if(current?.status!==o.status)invalidate()}catch(e){if(request.isCurrent())setError(t('od.readFailed'))}finally{busyRef.current=false;if(request.isCurrent())setBusy(false)}}
 const chooseRole=role=>{setActiveRole(role);setDocumentId('');setCoverage(false);setCoverageReason('');setUploaded(null)}
 const upload=async(file,role)=>{if(!file||busyRef.current||!manage)return;busyRef.current=true;setBusy(true);setError(null);try{
  // File creation and evidence confirmation remain separate, explicit actions.
  const r=await uploadOperationDocument(request,file,uploadTypes[role])
  if(!request.isCurrent())return;const id=r?.document?.id;if(!id)throw Error('No document')
  const meta=await readOperationDocumentPackage(request,o.date.slice(0,7));if(!request.isCurrent())return
  const d=meta.available_documents.find(x=>x.id===id);if(!d)throw Error('Document readback unavailable');setUploaded(d);setDocumentId(id);setOutcome({uploaded:true})
 }catch(e){if(!request.isCurrent())return;const existing=e.data?.existing_document_id;if(existing){
   try{const meta=await readOperationDocumentPackage(request,o.date.slice(0,7));const d=meta.available_documents.find(x=>x.id===existing);if(!d)throw Error('Existing document unavailable');if(!request.isCurrent())return;setUploaded(d);setDocumentId(existing);setOutcome({reused:true})}
   catch{if(request.isCurrent()){setError(t('od.uploadUnknown'));setOutcome({unknown:true})}}
  }else{setError(t('od.uploadUnknown'));setOutcome({unknown:true})}}
 finally{busyRef.current=false;if(request.isCurrent())setBusy(false)}}
 const open=async id=>{try{const r=await documentFileUrl(request,id);if(request.isCurrent()&&r?.url)window.open(r.url,'_blank','noopener')}catch(e){if(request.isCurrent())setError(t('od.readFailed'))}}
 return <Modal wide title={t('od.folder')} onClose={()=>{if(!busy)onClose()}}>
  <div data-od-folder>
   <section className="v2-od-summary" data-od-summary>
    <p className="v2-muted">{shortCalendarDate(o.date,lang)} · {o.category?catLabel(t,o.category):t('od.noCategory')}</p>
    <h3>{recipient?t('od.paymentTo',{name:recipient}):t(`od.operationKind.${o.direction==='in'||o.direction==='out'?o.direction:'other'}`)}</h3>
    <p className="v2-od-amount">{money(o.amount,{currency:o.currency,full:true})}</p>
    {recipient&&<p className="v2-muted v2-small">{t('od.recipientFromBank')}</p>}
    {o.loan_repayment&&<p className="v2-muted v2-small">{t('od.ownerFinancing.repaymentNote')}</p>}
   </section>
   {o.target_type==='transaction'&&o.owner_financing_type&&<section className="v2-od-owner-financing" data-od-owner-financing>
    <div className="v2-od-owner-financing-copy">
     <strong>{t('od.ownerFinancing.title')}</strong>
     <p>{t(`od.ownerFinancing.current.${o.owner_financing_type}`)}</p>
     <p className="v2-muted v2-small">{t('od.ownerFinancing.explain')}</p>
    </div>
    {manage&&<div className="v2-od-owner-financing-actions">
     <Link className="v2-btn v2-btn-secondary" to={'/business/transactions?tx='+encodeURIComponent(o.target_id)+'&category='+encodeURIComponent('Capital contribution')}>{t('od.ownerFinancing.equity')}</Link>
     <Link className="v2-btn v2-btn-secondary" to={'/business/transactions?tx='+encodeURIComponent(o.target_id)+'&category='+encodeURIComponent('Owner funding (loan)')}>{t('od.ownerFinancing.loan')}</Link>
    </div>}
   </section>}
   <h3>{t('od.nextDocuments')}</h3>
   <ul className="v2-od-evidence" data-od-evidence>
    {o.requirements.map(r=>{
     const linkedDocs=r.documents.map(id=>o.documents.find(d=>d.id===id)).filter(Boolean)
     const bankProof=r.type==='payment'&&r.state==='linked'&&r.explanation==='bank_row_or_transfer_pair'
     const declaredFunding=r.type==='funding'&&r.explanation==='owner_category_and_bank'
     const contractPending=r.type==='contract'&&r.explanation==='contract_decision_pending'
     return <li key={r.type} data-od-evidence-role={r.type} className={r.state==='linked'?'is-done':''}>
      <div className="v2-od-evidence-head"><strong>{t(`od.requirement.${r.type}`)}</strong><span>{contractPending?t('od.contractUndecided'):bankProof?t('od.bankVerified'):declaredFunding?t('od.ownerFinancing.declared'):t(`od.state.${r.state}`)}</span></div>
      {declaredFunding&&<p className="v2-muted v2-small">{t('od.ownerFinancing.declaredHelp')}</p>}
      {bankProof&&<div className="v2-od-evidence-files">{o.bank_rows.filter(row=>row.verified).map(row=><span key={row.id}><Link to={'/business/bank-import?batch='+row.batch_id}>{t('od.statement')}</Link>{row.document_id&&<button className="v2-btn-link" type="button" onClick={()=>open(row.document_id)}>{t('docs.open')}</button>}</span>)}</div>}
      {linkedDocs.length>0&&<div className="v2-od-evidence-files">{linkedDocs.map(d=><button type="button" className="v2-btn-link" key={d.id} onClick={()=>open(d.id)}>{d.file?.file_name||t('od.document')}</button>)}</div>}
      {contractPending&&<p className="v2-muted v2-small">{t('od.contractRowHelp')}</p>}
      {r.state==='not_applicable'&&<p className="v2-muted v2-small">{r.na_reason==='recorded_fee_or_transfer'?t('od.ruleNoContract'):o.review?t('od.confirmedByPerson')+(r.na_reason?' · '+r.na_reason:''):t('od.contractUndecided')}</p>}
      {manage&&r.type==='contract'&&<Btn variant="ghost" data-od-decide-contract onClick={()=>setReviewOpen(v=>!v)}>{reviewOpen?t('od.hideDecision'):contractPending?t('od.decideContract'):t('od.changeDecision')}</Btn>}
      {manage&&roles.includes(r.type)&&r.state!=='not_applicable'&&!contractPending&&!((o.owner_financing_type||o.loan_repayment)&&r.state==='linked')&&<div className="v2-od-actions">
       <Btn variant="secondary" data-od-upload-for={r.type} disabled={busy||outcome?.unknown} onClick={()=>{chooseRole(r.type);uploadRole.current=r.type;fileInput.current?.click()}}>{t('od.upload')}</Btn>
       <Btn variant="ghost" data-od-existing-for={r.type} disabled={busy||outcome?.unknown} onClick={()=>chooseRole(r.type)}>{t('od.existing')}</Btn>
      </div>}
      {activeRole===r.type&&manage&&<fieldset disabled={busy||outcome?.unknown} className="v2-od-form v2-od-inline" data-od-attach-form>
       <legend>{t('od.attachFor',{name:t(`od.requirement.${r.type}`)})}</legend>
       <label>{t('od.existing')}<select data-od-document className="v2-select" value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">{t('od.chooseDocument')}</option>{choices.map(d=><option key={d.id} value={d.id}>{d.file?.file_name||t('od.document')}</option>)}</select></label>
       <label><input data-od-coverage type="checkbox" checked={coverage} onChange={e=>setCoverage(e.target.checked)}/>{t('od.coverage')}</label>
       <label>{t('od.coverageReason')}<input data-od-coverage-reason className="v2-input" value={coverageReason} maxLength={1000} onChange={e=>setCoverageReason(e.target.value)}/></label>
       <Btn data-od-link disabled={!selectedDoc||!coverage||coverageReason.trim().length<5} onClick={()=>save('link',selectedDoc,{role:activeRole,coverage:'full_case',reason:coverageReason,document_version:selectedDoc.document_version})}>{t('od.confirmLink')}</Btn>
      </fieldset>}
     </li>
    })}
   </ul>
   <input data-od-upload ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx" hidden onChange={e=>{upload(e.target.files?.[0],uploadRole.current);e.target.value=''}}/>
   {manage&&o.requirements.some(r=>r.type==='contract')&&<div className="v2-od-contract" data-od-contract>
    {reviewOpen&&<fieldset disabled={busy||outcome?.unknown} className="v2-od-form">
     <legend>{t('od.contractDecisionTitle')}</legend>
     <p className="v2-muted">{t('od.contractDecisionHelp')}</p>
     <label>{t('od.kind')}<select data-od-kind className="v2-select" value={kind} onChange={e=>setKind(e.target.value)}>{['unknown','supplier','income','internal_transfer','funding','loan','fee'].map(k=><option key={k} value={k}>{t(`od.kindLabel.${k}`)}</option>)}</select></label>
     <label>{t('od.contractDecision')}<select data-od-contract-choice className="v2-select" value={contractDecision} onChange={e=>{setContractDecision(e.target.value);setWaiver('')}}><option value="">{t('od.chooseDecision')}</option><option value="yes">{t('od.contractYes')}</option><option value="no">{t('od.contractNo')}</option></select></label>
     {contractDecision==='yes'&&<details><summary>{t('od.contractWaiver')}</summary><input className="v2-input" value={waiver} maxLength={1000} onChange={e=>setWaiver(e.target.value)}/></details>}
     <label>{t('od.reason')}<input data-od-review-reason className="v2-input" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
     <Btn data-od-review disabled={!canReview} onClick={()=>save('review',null,{kind,reason,contract_required:contractDecision==='yes',contract_waiver:waiver})}>{t('od.confirmReview')}</Btn>
    </fieldset>}
   </div>}
   {o.questions.filter(q=>q!=='contract_decision').length>0&&<p className="v2-note">{o.questions.filter(q=>q!=='contract_decision').map(q=>t(`od.question.${q}`)).join(' · ')}</p>}
   {outcome&&<p role="status">{t(outcome.unknown?'od.unknown':outcome.uploaded?'od.uploaded':outcome.checked?'od.checked':'od.saved')}</p>}
   {error&&<p role="alert">{error}</p>}{outcome?.unknown&&<Btn data-od-recover disabled={busy} onClick={check}>{t('od.checkResult')}</Btn>}
   <details className="v2-od-details" data-od-details>
    <summary>{t('od.details')}</summary>
    <p>{t('od.originalBankText')}: {o.description}</p>
    {o.invoice&&<p><Link to={'/business/'+(o.invoice.type==='receivable'?'receivables':'payables')+'/'+o.invoice.id}>{t('od.invoice')} {o.invoice.number||''}</Link></p>}
    {o.payments.length>1&&<p>{t('od.payments')}: {o.payments.map(p=>shortCalendarDate(p.date,lang)+' · '+money(p.amount,{currency:p.currency,full:true})).join('; ')}</p>}
    {o.documents.map(d=><div key={d.id} className="v2-note"><strong>{d.file?.file_name||t('od.document')}</strong><p>{d.coverage.map(c=>t(`od.requirement.${c.role}`)+': '+t(`od.state.${c.state}`)).join('; ')||t('od.coverageNeeded')}</p>
     <button type="button" className="v2-btn-link" onClick={()=>open(d.id)}>{t('docs.open')}</button>
     {manage&&d.links.map(l=><Btn key={l.link_id} variant="ghost" disabled={busy||outcome?.unknown||!l.version} data-od-unlink={d.id} data-od-link-target={l.target_type} onClick={()=>save('unlink',d,{},l)}>{t('od.unlink')} · {t(l.target_type==='debt'?'od.invoice':'od.paymentLink')}</Btn>)}
    </div>)}
    <h4>{t('od.history')}</h4>{o.history.map(h=><p className="v2-small" key={h.id}>{shortCalendarDate(h.date,lang)} · {t(`od.historyAction.${h.action}`)}{h.reason?' · '+h.reason:''}</p>)}
   </details>
   <p className="v2-muted v2-small">{t('od.reviewSeparate')} · {t('od.noCashChange')}</p>
  </div>
 </Modal>
}
