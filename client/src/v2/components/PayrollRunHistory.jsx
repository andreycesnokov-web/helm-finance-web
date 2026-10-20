import {useRef,useState} from 'react'
import {useT,useLang} from '../i18n'
import {useApi,useInvalidate,usePagedBusinessTransactions} from '../data'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {savePayrollRun} from '../lib/actions'
import {money,shortCalendarDate} from '../lib/format'
import TransactionPicker,{TransactionSummary} from './TransactionPicker'
import {transactionAmount,transactionCurrency,transactionDirection} from '../lib/transactionPickerModel'
import {payrollErrorMessage} from '../lib/payrollRunModel'
import {Card,ErrorBox,Skeleton} from '../ui'
import Modal from './Modal'

export default function PayrollRunHistory({wallets=[],onEdit,onChanged}) {
 const t=useT(),lang=useLang(),api=useApi('/payroll/runs'),invalidate=useInvalidate()
 const [id,setId]=useState(null),[paymentId,setPaymentId]=useState(null),[txId,setTxId]=useState('')
 const [busy,setBusy]=useState(false),[err,setErr]=useState(''),lock=useRef(false),request=useBusinessRequest()
 const ledger=usePagedBusinessTransactions(!!paymentId)
 const runs=api.data?.runs||[],run=runs.find(r=>r.id===id)
 const payments=run?.payroll_payments||[],payment=payments.find(p=>p.id===paymentId)
 const tx=ledger.data.find(x=>String(x.id)===String(txId))
 const linkedIds=new Set(runs.flatMap(r=>r.payroll_payments||[]).map(p=>String(p.transaction_id)).filter(x=>x!=='null'))
 const linkedHere=new Set(payments.filter(p=>p.transaction_id!=null).map(p=>String(p.transaction_id)))
 const same=tx&&payment&&transactionDirection(tx)==='out'&&transactionCurrency(tx)===payment.currency
  &&String(tx.wallet_id)===String(payment.wallet_id)&&transactionAmount(tx)===Number(payment.net_amount)
 const act=async(action)=>{
  if(lock.current||!run)return
  if(action==='link'&&(!same||!payment))return
  lock.current=true;setBusy(true);setErr('')
  try{await savePayrollRun(request,{action,run_id:run.id,version:run.version,
   ...(action==='link'?{payment_id:payment.id,transaction_id:String(tx.id)}:{})})
   setPaymentId(null);setTxId('');invalidate();api.reload();onChanged?.()
  }catch(e){if(e.code!=='workspace_changed')setErr(payrollErrorMessage(e,t))}
  finally{lock.current=false;setBusy(false)}
 }
 return <Card title={t('payr.history')}>
  {api.loading?<Skeleton rows={3}/>:api.error?<ErrorBox error={api.error} onRetry={api.reload}/>:!runs.length?<p>{t('payr.empty')}</p>:
   <div className="v2-payrun-history">{runs.map(r=><button key={r.id} type="button" className="v2-payrun-history-row v2-btn-secondary" onClick={()=>{setId(r.id);setPaymentId(null);setTxId('');setErr('')}}>
    <strong>{r.period_month}</strong><span>{shortCalendarDate(r.payment_date,lang)}</span><span>{t(`payr.status.${r.status}`)}</span>
    <strong className="v2-num">{money((r.payroll_payments||[]).reduce((a,p)=>a+Number(p.net_amount),0),{full:true})}</strong>
   </button>)}</div>}
  {runs.length===100&&<p className="v2-muted">{t('payr.latest100')}</p>}
  {run&&<Modal wide title={t('payr.history')+' · '+run.period_month} onClose={()=>{if(!busy)setId(null)}}>
   <p className="v2-banner v2-tone-info">{t('payr.noCash')}</p>
   <p>{t(`payr.status.${run.status}`)} · {t('payr.plannedDate')}: {shortCalendarDate(run.payment_date,lang)} · {wallets.find(w=>w.id===run.wallet_id)?.name||'—'}</p>
   {run.status==='scheduled'&&<p>{t('payr.approvedWaiting')}</p>}
   <div className="v2-payrun-lines">{payments.map(p=><div className="v2-payrun-line" key={p.id}>
    <div><strong>{p.employee_name}</strong><p className="v2-muted">{t(`payr.status.${p.status}`)}{p.status==='paid'?' · '+shortCalendarDate(p.payment_date,lang):''}</p></div>
    <strong className="v2-num">{money(p.net_amount,{full:true})}</strong>
    {p.status==='scheduled'&&<button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>{setPaymentId(p.id);setTxId('')}}>{t('payr.findDebit')}</button>}
   </div>)}</div>
   {payment&&<section className="v2-payrun-link">
    <h3>{payment.employee_name} · {money(payment.net_amount,{full:true})}</h3>
    <TransactionPicker doc={{gross_amount:payment.net_amount,currency:payment.currency,document_date:run.payment_date}}
     transactions={ledger.data} wallets={wallets} value={txId} onSelect={setTxId} disabled={busy}
     linkedIds={linkedIds} linkedToCurrent={linkedHere} linkedHereLabel={t('payr.status.paid')} linkedLabel={t('payr.status.paid')} statusComplete={false} loading={ledger.loading} error={ledger.error}
     hasMore={ledger.hasMore} onRetry={ledger.reload} onLoadMore={ledger.loadMore}/>
    {tx&&<><div className="v2-txp-compare"><p>{t('payr.bankCompare')}</p><TransactionSummary tx={tx} wallets={wallets} fullDescription/></div>
     {!same&&<p role="alert" className="v2-inline-err">{t('payr.mismatch')}</p>}
     <p className="v2-muted">{t('payr.bankEvidence')}</p>
     <button type="button" className="v2-btn v2-btn-primary" disabled={busy||!same} onClick={()=>act('link')}>{t('payr.confirmLink')}</button></>}
   </section>}
   <div className="v2-payrun-actions">
    {run.status==='draft'&&<><button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>{setId(null);onEdit(run)}}>{t('payr.edit')}</button>
     <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={()=>act('approve')}>{t('payr.approve')}</button></>}
    {['draft','scheduled'].includes(run.status)&&!payments.some(p=>p.status==='paid')&&<button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>act('cancel')}>{t('payr.cancel')}</button>}
   </div>
   {err&&<><p className="v2-inline-err" role="alert">{err}</p><button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>{setPaymentId(null);setTxId('');api.reload()}}>{t('payr.reload')}</button></>}
  </Modal>}
 </Card>
}
