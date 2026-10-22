import {useMemo,useRef,useState} from 'react'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {useT} from '../i18n'
import {money} from '../lib/format'
import {payrollLine,payrollTotals,payrollMoneyFields,payrollErrorMessage} from '../lib/payrollRunModel'
import {savePayrollRun} from '../lib/actions'
import Modal from './Modal'

// The existing F2 monthly table, now saved as one atomic draft; never a transfer.
export default function PayrollRunDialog({employees=[],wallets=[],initialRun=null,onClose,onSaved}) {
 const t=useT(),request=useBusinessRequest(),inFlight=useRef(false)
 const eligible=wallets.filter(w=>w.scope!=='personal'&&w.is_active!==false&&w.currency==='IDR')
 const [period,setPeriod]=useState(initialRun?.period_month||new Date().toISOString().slice(0,7))
 const [date,setDate]=useState(initialRun?.payment_date||new Date().toISOString().slice(0,10))
 const [walletId,setWalletId]=useState(initialRun?.wallet_id||eligible[0]?.id||'')
 const [rows,setRows]=useState(()=>{
  const people=employees.filter(e=>e.status!=='archived'&&e.status!=='inactive')
  for(const p of initialRun?.payroll_payments||[])if(!people.some(e=>e.id===p.employee_id))people.push({id:p.employee_id,name:p.employee_name})
  return people.map(e=>{
  const payment=initialRun?.payroll_payments?.find(p=>p.employee_id===e.id)
  return {...payrollLine(e,payment),on:initialRun?!!payment:true}
 })})
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[err,setErr]=useState('')
 const selected=rows.filter(r=>r.on)
 const totals=useMemo(()=>selected.reduce((a,r)=>{const c=payrollTotals(r);return {gross:a.gross+c.gross,net:a.net+c.net,employer:a.employer+c.employer_bpjs}}, {gross:0,net:0,employer:0}),[rows])
 const set=(index,key,value)=>setRows(rs=>rs.map((r,i)=>i===index?{...r,[key]:value}:r))
 const save=async()=>{
  if(inFlight.current)return
  const bad=selected.find(r=>r.pph21===''||payrollMoneyFields.some(k=>!Number.isFinite(payrollTotals(r)[k]))||payrollTotals(r).net<=0)
  if(bad||!confirmed||!selected.length||!walletId||!period||!date){setErr(t('payr.invalid'));return}
  inFlight.current=true;setBusy(true);setErr('')
  try{
   const result=await savePayrollRun(request,{action:initialRun?'edit':'create',
    ...(initialRun?{run_id:initialRun.id,version:initialRun.version}:{}),period_month:period,payment_date:date,
    wallet_id:walletId,tax_confirmed:true,lines:selected.map(r=>({employee_id:r.id,
     ...Object.fromEntries(payrollMoneyFields.map(k=>[k,String(payrollTotals(r)[k])]))}))})
   onSaved?.(result);onClose()
  }catch(e){if(e.code!=='workspace_changed')setErr(payrollErrorMessage(e,t))}
  finally{inFlight.current=false;setBusy(false)}
 }
 return <Modal wide title={t(initialRun?'payr.edit':'payr.new')} onClose={()=>{if(!busy)onClose()}}
  footer={<><button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={onClose}>{t('set.cancel')}</button>
   <button type="button" className="v2-btn v2-btn-primary" disabled={busy||!confirmed||!selected.length||!walletId} onClick={save} data-payd-run>{t(busy?'payr.saving':'payr.save')}</button></>}>
  <p className="v2-banner v2-tone-info">{t('payr.noCash')}</p>
  <div className="v2-field-row">
   <label className="v2-field"><span className="v2-field-label">{t('payd.period')}</span><input type="month" className="v2-input" value={period} disabled={busy} onChange={e=>setPeriod(e.target.value)}/></label>
   <label className="v2-field"><span className="v2-field-label">{t('payr.plannedDate')}</span><input type="date" className="v2-input" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
   <label className="v2-field"><span className="v2-field-label">{t('payd.wallet')}</span><select className="v2-select" value={walletId} disabled={busy} onChange={e=>setWalletId(e.target.value)}><option value="">—</option>{eligible.map(w=><option key={w.id} value={w.id}>{w.name} · IDR</option>)}</select></label>
  </div>
  <div className="v2-payd-table v2-payrun-table" role="table" aria-label={t('payr.new')}>
   <div className="v2-payd-row is-head" role="row"><span role="columnheader">{t('payd.col.person')}</span>{payrollMoneyFields.map(k=><span key={k} role="columnheader">{t(['earnings','employer_bpjs'].includes(k)?'payr.'+k:'payd.col.'+k)}</span>)}<span role="columnheader">{t('payd.col.net')}</span></div>
   {rows.map((r,i)=>{const c=payrollTotals(r);return <div key={r.id} className={'v2-payd-row'+(r.on?'':' is-off')} role="row">
    <label role="cell" className="v2-pe-sug-row"><input type="checkbox" checked={r.on} disabled={busy} onChange={e=>set(i,'on',e.target.checked)}/><span>{r.name}</span></label>
    {payrollMoneyFields.map(k=><label key={k} role="cell" className="v2-payrun-cell"><span className="v2-payrun-mobile-label">{t(['earnings','employer_bpjs'].includes(k)?'payr.'+k:'payd.col.'+k)}</span><input className="v2-input v2-num" inputMode="numeric" value={r[k]} disabled={busy||!r.on}
     aria-label={t(['earnings','employer_bpjs'].includes(k)?'payr.'+k:'payd.col.'+k)+' · '+r.name} aria-invalid={!Number.isFinite(c[k])}
     placeholder={k==='pph21'?t('payd.pphPh'):'0'} onChange={e=>set(i,k,e.target.value)}/></label>)}
    <span role="cell" className="v2-num v2-r v2-payrun-net"><span className="v2-payrun-mobile-label">{t('payd.col.net')}</span>{Number.isFinite(c.net)?money(c.net,{full:true}):'—'}</span>
   </div>})}
  </div>
  <p className="v2-sec">{t('payd.total')}: {money(totals.net,{full:true})} · {t('payr.employer_bpjs')}: {money(totals.employer,{full:true})}</p>
  <p className="v2-muted v2-small">{t('payr.employerNote')}</p>
  <label className="v2-txp-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('payr.taxConfirm')}</label>
  {err&&<><p className="v2-inline-err" role="alert">{err}</p><button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>{onSaved?.();onClose()}}>{t('payr.reload')}</button></>}
 </Modal>
}
