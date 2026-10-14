import {useEffect,useRef,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {useWorkspace} from '../../shell/WorkspaceProvider'
import {useApi,useInvalidate} from '../data'
import {useT,useLang} from '../i18n'
import {Card,Pill,Btn,Skeleton,ErrorBox,Empty} from '../ui'
import {money,shortCalendarDate} from '../lib/format'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {documentFileUrl,operationDocumentAction,readOperationDocumentPackage,uploadOperationDocument} from '../lib/actions'
import {canRecordCompanyMoney} from '../lib/financePermissions'
import Modal from './Modal'

export const operationDocumentsPath=(month,filter='incomplete')=>`/business/accountant?tab=packages&month=${encodeURIComponent(month)}&filter=${filter}`
const roles=['basis','payment','contract','withholding','tax_payment','funding']
const uploadTypes={basis:'vendor_invoice',payment:'payment_proof',contract:'other',withholding:'bukti_potong',tax_payment:'payment_proof',funding:'other'}

export default function OperationDocuments({month}){
 const t=useT(),lang=useLang(),{active,scopeKey}=useWorkspace(),[params,setParams]=useSearchParams();
 const data=useApi(`/accountant/operation-documents/package?month=${encodeURIComponent(month)}`);
 const [page,setPage]=useState(0),[selected,setSelected]=useState(null),[saved,setSaved]=useState(null);
 const filter=['all','incomplete','missing','clarification','complete'].includes(params.get('filter'))?params.get('filter'):'all';
 const scope=`${active?.id}|${scopeKey}|${month}`;
 useEffect(()=>{setPage(0);setSelected(null);setSaved(null)},[scope]);
 const result=data.data?.business_id===active?.id?data.data:null,operations=result?.operations||[],summary=result?.summary;
 const rows=operations.filter(o=>filter==='all'||(filter==='incomplete'?o.status!=='complete':filter==='missing'?o.missing_count>0:o.status===filter));
 const cur=operations.find(o=>o.key===selected);
 const pick=k=>{setParams(p=>{const n=new URLSearchParams(p);n.set('filter',k);return n},{replace:true});setPage(0)};
 const close=()=>{setSelected(null);setSaved(null)};
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
     <div><span className="v2-muted">{shortCalendarDate(o.date,lang)}</span><strong>{o.description||t('od.unnamed')}</strong><span>{money(o.amount,{currency:o.currency,full:true})}</span><span className="v2-small">{o.category||t('od.noCategory')}</span></div>
     <div className="v2-small">{o.invoice?<Link to={`/business/${o.invoice.type==='receivable'?'receivables':'payables'}/${o.invoice.id}`}>{t('od.invoice')}{o.invoice.number?` · ${o.invoice.number}`:''}</Link>:t('od.noInvoice')}</div>
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
 const t=useT(),lang=useLang(),{active}=useWorkspace(),request=useBusinessRequest(),invalidate=useInvalidate();
 const manage=canRecordCompanyMoney(active?.role),busyRef=useRef(false),fileInput=useRef(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(null),[outcome,setOutcome]=useState(null);
 const [kind,setKind]=useState(o.kind),[contract,setContract]=useState(!!o.review?.contract_required),[waiver,setWaiver]=useState(''),[reason,setReason]=useState('');
 const [documentId,setDocumentId]=useState(''),[evidenceRole,setEvidenceRole]=useState('basis'),[coverage,setCoverage]=useState(false),[coverageReason,setCoverageReason]=useState('');
 const [uploaded,setUploaded]=useState(null);
 const choices=uploaded&&!documents.some(d=>d.id===uploaded.id)?[uploaded,...documents]:documents;
 const selectedDoc=choices.find(d=>d.id===documentId);
 const save=async(action,doc=null,body={},link=null)=>{
  if(busyRef.current||!manage||!request.isCurrent())return;busyRef.current=true;setBusy(true);setError(null);
  try{const result=await operationDocumentAction(request,{target_type:link?.target_type||o.target_type,target_id:link?.target_id??o.target_id,version:link?.version||o.version,action,document_id:doc?.id,body});if(!request.isCurrent())return;setOutcome({ok:true,result});onChanged(result);invalidate();}
  catch(e){if(!request.isCurrent())return;setError(e.status===403?t('od.forbidden'):e.status===409?t('od.stale'):e.status===400?t('od.invalid'):t('od.unknown'));if(!e.status||e.status>=500)setOutcome({unknown:true});}
  finally{busyRef.current=false;if(request.isCurrent())setBusy(false)}
 };
 const check=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{const r=await readOperationDocumentPackage(request,o.date.slice(0,7));if(!request.isCurrent())return;const current=r.operations.find(x=>x.key===o.key);setOutcome({checked:true});setError(null);onChanged({checked:true});if(current?.status!==o.status)invalidate();}catch(e){if(request.isCurrent())setError(t('od.readFailed'))}finally{busyRef.current=false;if(request.isCurrent())setBusy(false)}};
 const upload=async file=>{if(!file||busyRef.current||!manage)return;busyRef.current=true;setBusy(true);setError(null);try{
  // Existing init/Storage/complete and SHA dedup. No link, payment or AI-provider call.
  const r=await uploadOperationDocument(request,file,uploadTypes[evidenceRole]);
  if(!request.isCurrent())return;const id=r?.document?.id;if(!id)throw Error('No document');
  const meta=await readOperationDocumentPackage(request,o.date.slice(0,7));if(!request.isCurrent())return;
  const d=meta.available_documents.find(x=>x.id===id);if(!d)throw Error('Document readback unavailable');setUploaded(d);setDocumentId(id);setOutcome({uploaded:true});
 }catch(e){if(!request.isCurrent())return;const existing=e.data?.existing_document_id;if(existing){setDocumentId(existing);setOutcome({reused:true});onChanged({reused:true})}else{setError(t('od.uploadUnknown'));setOutcome({unknown:true})}}
 finally{busyRef.current=false;if(request.isCurrent())setBusy(false)}};
 const open=async id=>{try{const r=await documentFileUrl(request,id);if(request.isCurrent()&&r?.url)window.open(r.url,'_blank','noopener')}catch(e){if(request.isCurrent())setError(t('od.readFailed'))}};
 return <Modal wide title={t('od.folder')} onClose={()=>{if(!busy)onClose()}}>
  <div data-od-folder>
   <p><strong>{o.description}</strong> · {shortCalendarDate(o.date,lang)} · {money(o.amount,{currency:o.currency,full:true})}</p>
   <p>{t('od.category')}: {o.category||t('od.noCategory')}</p>
   {o.invoice&&<p><Link to={`/business/${o.invoice.type==='receivable'?'receivables':'payables'}/${o.invoice.id}`}>{t('od.invoice')} {o.invoice.number||''}</Link></p>}
   <h3>{t('od.payments')}</h3>{o.payments.map(p=><p key={p.id}>{shortCalendarDate(p.date,lang)} · {money(p.amount,{currency:p.currency,full:true})} · {p.description}</p>)}
   <h3>{t('od.bankSource')}</h3>{!o.bank_rows.length?<p className="v2-muted">{t('od.noBankRow')}</p>:o.bank_rows.map(r=><p key={r.id}>{shortCalendarDate(r.date,lang)} · {r.description} · <Link to={`/business/bank-import?batch=${r.batch_id}`}>{t('od.statement')}</Link>{r.document_id&&<button className="v2-btn-link" type="button" onClick={()=>open(r.document_id)}>{t('docs.open')}</button>}</p>)}
   <h3>{t('od.requirements')}</h3><ul className="v2-check">{o.requirements.map(r=><li key={r.type} className={r.state==='linked'?'is-done':''}><span className="v2-check-text"><strong>{t(`od.requirement.${r.type}`)}</strong><span>{t(r.mandatory?'od.required':'od.optional')} · {t(`od.state.${r.state}`)}</span><span className="v2-muted v2-small">{t(`od.source.${r.source}`)}{r.na_reason&&!['scenario_does_not_require_contract'].includes(r.na_reason)?` · ${r.na_reason}`:''}</span></span></li>)}</ul>
   <h3>{t('od.questions')}</h3>{o.questions.map(q=><p key={q} className="v2-note">{t(`od.question.${q}`)}</p>)}<p className="v2-muted">{t('od.aiUnavailable')} · {t(`od.classification.${o.classification_source}`)}</p>
   {manage&&<fieldset disabled={busy||outcome?.unknown} className="v2-od-form"><legend>{t('od.clarify')}</legend>
    <label>{t('od.kind')}<select data-od-kind className="v2-select" value={kind} onChange={e=>setKind(e.target.value)}>{['unknown','supplier','income','internal_transfer','funding','loan','fee'].map(k=><option key={k} value={k}>{t(`od.kindLabel.${k}`)}</option>)}</select></label>
    <label><input type="checkbox" checked={contract} onChange={e=>setContract(e.target.checked)}/>{t('od.contractRequired')}</label>
    {contract&&<label>{t('od.contractWaiver')}<input className="v2-input" value={waiver} maxLength={1000} onChange={e=>setWaiver(e.target.value)}/></label>}
    <label>{t('od.reason')}<textarea data-od-review-reason className="v2-input" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
    <Btn data-od-review disabled={reason.trim().length<5} onClick={()=>save('review',null,{kind,reason,contract_required:contract,contract_waiver:waiver})}>{t('od.confirmReview')}</Btn>
   </fieldset>}
   <h3>{t('od.have')}</h3>{o.documents.map(d=><div key={d.id} className="v2-note"><strong>{d.file?.file_name||t('od.document')}</strong><p>{d.coverage.map(c=>`${t(`od.requirement.${c.role}`)}: ${t(`od.state.${c.state}`)} · ${c.reason}`).join('; ')||t('od.coverageNeeded')}</p>
    {d.classification&&<p className="v2-small">{t('od.aiSuggestion')}: {d.classification.business_meaning||d.classification.document_type} · {d.classification.source} · {d.classification.confidence||t('od.uncertain')}</p>}
    <button type="button" className="v2-btn-link" onClick={()=>open(d.id)}>{t('docs.open')}</button>
    {manage&&d.links.map(l=><Btn key={l.link_id} variant="ghost" disabled={busy||outcome?.unknown||!l.version} data-od-unlink={d.id} data-od-link-target={l.target_type} onClick={()=>save('unlink',d,{},l)}>{t('od.unlink')} · {t(l.target_type==='debt'?'od.invoice':'od.paymentLink')}</Btn>)}
   </div>)}
   {manage&&<fieldset disabled={busy||outcome?.unknown} className="v2-od-form"><legend>{t('od.attach')}</legend>
    <label>{t('od.documentRole')}<select data-od-role className="v2-select" value={evidenceRole} onChange={e=>setEvidenceRole(e.target.value)}>{roles.map(k=><option key={k} value={k}>{t(`od.requirement.${k}`)}</option>)}</select></label>
    <Btn variant="secondary" onClick={()=>fileInput.current?.click()}>{t('od.upload')}</Btn><input data-od-upload ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx" hidden onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/>
    <label>{t('od.existing')}<select data-od-document className="v2-select" value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">{t('od.chooseDocument')}</option>{choices.map(d=><option key={d.id} value={d.id}>{d.file?.file_name||t('od.document')}</option>)}</select></label>
    <label><input data-od-coverage type="checkbox" checked={coverage} onChange={e=>setCoverage(e.target.checked)}/>{t('od.coverage')}</label>
    <label>{t('od.coverageReason')}<textarea data-od-coverage-reason className="v2-input" value={coverageReason} maxLength={1000} onChange={e=>setCoverageReason(e.target.value)}/></label>
    <Btn data-od-link disabled={!selectedDoc||!coverage||coverageReason.trim().length<5} onClick={()=>save('link',selectedDoc,{role:evidenceRole,coverage:'full_case',reason:coverageReason,document_version:selectedDoc.document_version})}>{t('od.confirmLink')}</Btn>
   </fieldset>}
   {outcome&&<p role="status">{t(outcome.unknown?'od.unknown':outcome.uploaded?'od.uploaded':outcome.checked?'od.checked':'od.saved')}</p>}
   {error&&<p role="alert">{error}</p>}{outcome?.unknown&&<Btn data-od-recover disabled={busy} onClick={check}>{t('od.checkResult')}</Btn>}
   <h3>{t('od.history')}</h3>{o.history.map(h=><p className="v2-small" key={h.id}>{shortCalendarDate(h.date,lang)} · {t(`od.historyAction.${h.action}`)}{h.reason?` · ${h.reason}`:''}</p>)}
   <p className="v2-muted">{t('od.reviewSeparate')} · {t('od.noCashChange')}</p>
  </div>
 </Modal>
}
