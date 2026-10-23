import {useMemo,useRef,useState} from 'react'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {useT} from '../i18n'
import {money} from '../lib/format'
import {payrollLine,payrollTotals,payrollMoneyFields,payrollMoreFields,payrollPayloadLine,payrollErrorMessage} from '../lib/payrollRunModel'
import {savePayrollRun} from '../lib/actions'
import Modal from './Modal'

// The monthly table laid out like the accountant's sheet (Gaji perbulan → Gaji bersih), saved as one atomic
// draft; never a transfer. `gross` is computed, every other column is entered.
const columns=more=>['salary','bonus',...(more?['earnings']:[]),'gross','pph21','bpjs_kes','bpjs_jp','bpjs_jht',
 ...(more?['bpjs','other','employer_bpjs']:[])]
// Static keys so the copy guard checks every column name exists.
const LABELS={salary:{labelKey:'payr.col.salary'},bonus:{labelKey:'payr.col.bonus'},earnings:{labelKey:'payr.col.earnings'},
 gross:{labelKey:'payr.col.gross'},pph21:{labelKey:'payr.col.pph21'},bpjs_kes:{labelKey:'payr.col.bpjs_kes'},
 bpjs_jp:{labelKey:'payr.col.bpjs_jp'},bpjs_jht:{labelKey:'payr.col.bpjs_jht'},bpjs:{labelKey:'payr.col.bpjs'},
 other:{labelKey:'payr.col.other'},employer_bpjs:{labelKey:'payr.col.employer_bpjs'},net:{labelKey:'payr.col.net'}}
// Person, entered amounts, computed amounts (Gross, Take-home) — computed ones carry a full "Rp 34,883,721".
const grid=cols=>({'--payrun-grid':['minmax(150px,1.5fr)',...cols.map(k=>k==='gross'?'minmax(128px,1.1fr)':'minmax(96px,1fr)'),'minmax(128px,1.1fr)'].join(' '),
 '--payrun-min':(150+128*2+96*(cols.length-1)+8*(cols.length+1))+'px'})

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
 // A saved draft with amounts in the extra columns opens with them visible.
 const [more,setMore]=useState(()=>rows.some(r=>payrollMoreFields.some(k=>payrollTotals(r)[k]>0)))
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[err,setErr]=useState('')
 const selected=rows.filter(r=>r.on)
 const cols=columns(more)
 const totals=useMemo(()=>{
  const sum=Object.fromEntries([...cols,'net'].map(k=>[k,0]))
  for(const r of selected){const c=payrollTotals(r);for(const k of Object.keys(sum))sum[k]+=c[k]}
  return sum
 },[rows,more])
 const label=k=>t(LABELS[k].labelKey)
 const set=(index,key,value)=>setRows(rs=>rs.map((r,i)=>i===index?{...r,[key]:value}:r))
 const save=async()=>{
  if(inFlight.current)return
  const bad=selected.find(r=>r.pph21===''||payrollMoneyFields.some(k=>!Number.isFinite(payrollTotals(r)[k]))||payrollTotals(r).net<=0)
  if(bad||!confirmed||!selected.length||!walletId||!period||!date){setErr(t('payr.invalid'));return}
  inFlight.current=true;setBusy(true);setErr('')
  try{
   const result=await savePayrollRun(request,{action:initialRun?'edit':'create',
    ...(initialRun?{run_id:initialRun.id,version:initialRun.version}:{}),period_month:period,payment_date:date,
    wallet_id:walletId,tax_confirmed:true,lines:selected.map(payrollPayloadLine)})
   onSaved?.(result);onClose()
  }catch(e){if(e.code!=='workspace_changed')setErr(payrollErrorMessage(e,t))}
  finally{inFlight.current=false;setBusy(false)}
 }
 const amount=v=>Number.isFinite(v)?money(v,{full:true}):'—'
 return <Modal wide title={t(initialRun?'payr.edit':'payr.new')} onClose={()=>{if(!busy)onClose()}}
  footer={<><button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={onClose}>{t('set.cancel')}</button>
   <button type="button" className="v2-btn v2-btn-primary" disabled={busy||!confirmed||!selected.length||!walletId} onClick={save} data-payd-run>{t(busy?'payr.saving':'payr.save')}</button></>}>
  <p className="v2-banner v2-tone-info">{t('payr.noCash')}</p>
  <div className="v2-field-row">
   <label className="v2-field"><span className="v2-field-label">{t('payd.period')}</span><input type="month" className="v2-input" value={period} disabled={busy} onChange={e=>setPeriod(e.target.value)}/></label>
   <label className="v2-field"><span className="v2-field-label">{t('payr.plannedDate')}</span><input type="date" className="v2-input" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
   <label className="v2-field"><span className="v2-field-label">{t('payd.wallet')}</span><select className="v2-select" value={walletId} disabled={busy} onChange={e=>setWalletId(e.target.value)}><option value="">—</option>{eligible.map(w=><option key={w.id} value={w.id}>{w.name} · IDR</option>)}</select></label>
  </div>
  <div className="v2-payrun-tools">
   <button type="button" className="v2-linkbtn" aria-expanded={more} disabled={busy} onClick={()=>setMore(m=>!m)} data-payrun-more>{t(more?'payr.less':'payr.more')}</button>
  </div>
  <div className="v2-payd-table v2-payrun-table" role="table" aria-label={t('payr.new')} style={grid(cols)}>
   <div className="v2-payd-row is-head" role="row"><span role="columnheader">{t('payd.col.person')}</span>{cols.map(k=><span key={k} role="columnheader" className={k==='gross'?'v2-r':undefined}>{label(k)}</span>)}<span role="columnheader" className="v2-r">{label('net')}</span></div>
   {rows.map((r,i)=>{const c=payrollTotals(r);return <div key={r.id} className={'v2-payd-row'+(r.on?'':' is-off')} role="row">
    <label role="cell" className="v2-pe-sug-row"><input type="checkbox" checked={r.on} disabled={busy} onChange={e=>set(i,'on',e.target.checked)}/><span>{r.name}</span></label>
    {cols.map(k=>k==='gross'
     ?<span key={k} role="cell" className="v2-num v2-r v2-payrun-computed"><span className="v2-payrun-mobile-label">{label(k)}</span>{amount(c.gross)}</span>
     :<label key={k} role="cell" className="v2-payrun-cell"><span className="v2-payrun-mobile-label">{label(k)}</span><input className="v2-input v2-num" inputMode="numeric" value={r[k]} disabled={busy||!r.on}
      aria-label={label(k)+' · '+r.name} aria-invalid={!Number.isFinite(c[k])}
      placeholder={k==='pph21'?t('payd.pphPh'):'0'} onChange={e=>set(i,k,e.target.value)}/></label>)}
    <span role="cell" className="v2-num v2-r v2-payrun-net"><span className="v2-payrun-mobile-label">{label('net')}</span>{amount(c.net)}</span>
   </div>})}
   <div className="v2-payd-row is-total" role="row" data-payrun-total>
    <span role="rowheader">{t('payd.total')}</span>
    {cols.map(k=><span key={k} role="cell" className="v2-num v2-r"><span className="v2-payrun-mobile-label">{label(k)}</span>{amount(totals[k])}</span>)}
    <span role="cell" className="v2-num v2-r v2-payrun-net"><span className="v2-payrun-mobile-label">{label('net')}</span>{amount(totals.net)}</span>
   </div>
  </div>
  <p className="v2-muted v2-small">{t('payr.sheetNote')}</p>
  {more&&<p className="v2-muted v2-small">{t('payr.employerNote')}</p>}
  <label className="v2-txp-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('payr.taxConfirm')}</label>
  {err&&<><p className="v2-inline-err" role="alert">{err}</p><button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>{onSaved?.();onClose()}}>{t('payr.reload')}</button></>}
 </Modal>
}
