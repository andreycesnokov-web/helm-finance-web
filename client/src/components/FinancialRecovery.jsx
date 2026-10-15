import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useWorkspace } from '../shell/WorkspaceProvider'
import { apiFetch } from '../lib/api'
import { financialActor, pendingOperations, markRecovered, allowSeparateOperation, acknowledgeRecentOperations } from '../lib/financialRecovery'
const COPY = {
  en: { button:'Operation recovery',title:'Check operation results',recent:'Your recent confirmed operations',check:'Check result',unknown:'Result unknown',confirmed:'Confirmed',missing:'No confirmed result was found. This does not prove rollback. Keep the original request and check again; nothing has been resubmitted.',note:'These are historical operation results, not current balances. Reviewing a result never creates another record.',reviewed:'I have reviewed; this is a new operation',another:'Record another operation separately',confirmNew:'The original operation is confirmed. Clear its local identity only if you intend to record another separate operation.',closed:'Close',receipt:'Operation',archived:'The original account is archived or removed. Its confirmed operation remains recorded.',empty:'No recent confirmed operations found. An unresolved request may still be processing.',more:'Only the latest 25 results from 7 days are shown. A retained original key can still be checked directly.' },
  ru: { button:'Восстановление операций',title:'Проверить результаты операций',recent:'Ваши недавние подтверждённые операции',check:'Проверить результат',unknown:'Исход неизвестен',confirmed:'Подтверждена',missing:'Подтверждённый результат не найден. Это не доказывает откат. Сохраните исходный запрос и проверьте позже; повторной отправки не было.',note:'Это исторические результаты операций, а не текущие балансы. Проверка результата не создаёт новую запись.',reviewed:'Я проверил; это новая операция',another:'Записать ещё одну отдельную операцию',confirmNew:'Исходная операция подтверждена. Сбросьте её локальный ключ только если хотите записать ещё одну отдельную операцию.',closed:'Закрыть',receipt:'Операция',archived:'Исходный счёт архивирован или удалён. Подтверждённая операция сохранена.',empty:'Недавние подтверждённые операции не найдены. Запрос с неизвестным исходом ещё может выполняться.',more:'Показаны последние 25 результатов за 7 дней. Сохранённый исходный ключ можно проверить отдельно.' },
  id: { button:'Pemulihan transaksi',title:'Periksa hasil transaksi',recent:'Transaksi Anda yang baru dikonfirmasi',check:'Periksa hasil',unknown:'Hasil belum diketahui',confirmed:'Dikonfirmasi',missing:'Hasil yang dikonfirmasi belum ditemukan. Ini tidak membuktikan rollback. Simpan permintaan awal dan periksa lagi; tidak ada pengiriman ulang.',note:'Ini hasil transaksi historis, bukan saldo saat ini. Memeriksa hasil tidak membuat catatan baru.',reviewed:'Saya sudah periksa; ini transaksi baru',another:'Catat transaksi terpisah lainnya',confirmNew:'Transaksi awal sudah dikonfirmasi. Hapus identitas lokal hanya jika Anda ingin mencatat transaksi terpisah lainnya.',closed:'Tutup',receipt:'Transaksi',archived:'Rekening awal diarsipkan atau dihapus. Transaksi yang dikonfirmasi tetap tersimpan.',empty:'Tidak ada transaksi baru yang dikonfirmasi. Permintaan yang belum pasti mungkin masih diproses.',more:'Hanya 25 hasil terakhir dalam 7 hari yang ditampilkan. Kunci awal yang tersimpan masih dapat diperiksa.' }
}
const LABELS = {wallet_create:'Account + opening',transaction_batch:'Transactions',wallet_adjust:'Balance correction',debt_payment:'Debt payment',wallet_transfer:'Transfer'}
export default function FinancialRecovery() {
  const { token } = useAuth(), workspace = useWorkspace()
  const active = workspace?.active, actor = financialActor(token), business = active?.type === 'business' ? String(active.id) : null
  const scope = actor && business ? actor + '|' + business : null
  const [open,setOpen] = useState(false), [state,setState] = useState({scope:null,rows:[],pending:[],detail:null,error:'',busy:false,hasMore:false})
  let lang='en';try {lang=localStorage.getItem('hf_lang')||'en'}catch{}
  const t=COPY[lang]||COPY.en, visible=scope && state.scope===scope, selection=workspace?.selectionRef?.current
  const current=()=>financialActor(localStorage.getItem('hf_token'))===actor && workspace.selectionRef.current===selection
  const request={token,businessId:business,isCurrent:current}
  const refresh=async()=>{
    if(!scope)return
    setState({scope,rows:[],pending:pendingOperations(actor,business).filter(x=>['sent','unknown','rejected'].includes(x.state)),detail:null,error:'',busy:true,hasMore:false})
    try {const r=await apiFetch('/financial-operations/recent',request);if(current())setState(s=>({...s,rows:r.operations,pending:pendingOperations(actor,business).filter(x=>['sent','unknown','rejected'].includes(x.state)),busy:false,hasMore:r.has_more,nextCursor:r.next_cursor}))}
    catch(e){if(current())setState(s=>({...s,error:e.message,busy:false}))}
  }
  useEffect(()=>{
    setOpen(false);setState({scope,rows:[],pending:[],detail:null,error:'',busy:false,hasMore:false})
    if(scope)refresh()
    const changed=()=>{if(scope && current())setState(s=>({...s,scope,pending:pendingOperations(actor,business).filter(x=>['sent','unknown','rejected'].includes(x.state))}))}
    const show=()=>{if(scope && current()){setOpen(true);refresh()}}
    const confirmed=e=>{if(current()&&e.detail?.actor===actor&&e.detail?.business===business){setOpen(true);check({operation:e.detail.operation,key:e.detail.key})}}
    window.addEventListener('financial-intent-changed',changed);window.addEventListener('financial-recovery-open',show);window.addEventListener('storage',changed)
    window.addEventListener('financial-recovery-confirmed',confirmed)
    return()=>{window.removeEventListener('financial-intent-changed',changed);window.removeEventListener('financial-recovery-open',show);window.removeEventListener('storage',changed);window.removeEventListener('financial-recovery-confirmed',confirmed)}
  },[scope,token,workspace?.scopeKey])
  const check=async(row)=>{
    if(!current()||state.busy)return
    setState(s=>({...s,busy:true,error:'',detail:null}))
    try{
      const receipt=await apiFetch('/financial-operations/'+row.operation+'/'+encodeURIComponent(row.request_key||row.key),request)
      if(!current())return
      markRecovered(actor,business,receipt.operation,receipt.request_key)
      setState(s=>({...s,busy:false,detail:receipt,pending:pendingOperations(actor,business).filter(x=>['sent','unknown','rejected'].includes(x.state))}))
    }catch(e){if(current())setState(s=>({...s,busy:false,error:e.status===404?t.missing:e.message}))}
  }
  const loadMore=async()=>{
    if(!current()||state.busy||!state.nextCursor)return
    setState(s=>({...s,busy:true,error:''}))
    try{
      const r=await apiFetch('/financial-operations/recent?cursor='+encodeURIComponent(state.nextCursor),request)
      if(current())setState(s=>({...s,busy:false,rows:[...new Map([...s.rows,...r.operations].map(x=>[x.operation+':'+x.request_key,x])).values()],hasMore:r.has_more,nextCursor:r.next_cursor}))
    }catch(e){if(current())setState(s=>({...s,busy:false,error:e.message}))}
  }
  if(!scope)return null
  return <aside data-financial-recovery style={{position:'fixed',right:12,bottom:12,zIndex:100010,maxWidth:480,fontFamily:'inherit'}}>
    <button type="button" onClick={()=>{setOpen(true);refresh()}} style={{padding:'9px 14px',border:'1px solid #ccd3df',borderRadius:10,background:'white',color:'#14223b'}}>{t.button}{visible&&state.pending.length?' · '+state.pending.length:''}</button>
    {open&&<section role="dialog" aria-modal="false" aria-label={t.title} data-recovery-dialog style={{background:'white',color:'#14223b',border:'1px solid #ccd3df',borderRadius:12,padding:16,maxHeight:'75vh',overflowY:'auto',boxShadow:'0 8px 36px #0002'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><strong>{t.title}</strong><button type="button" onClick={()=>setOpen(false)}>{t.closed}</button></div>
      <p>{t.note}</p>
      {visible&&state.error&&<p role="alert">{state.error}</p>}
      {visible&&state.busy&&<p role="status">{lang==='ru'?'Проверяем результат…':'Checking result…'}</p>}
      {visible&&state.pending.map(x=><div key={x.storageKey} data-recovery-pending style={{padding:8,borderTop:'1px solid #eee'}}><span>{LABELS[x.operation]} · {x.state==='rejected'?'Rejected':t.unknown}</span> <button type="button" disabled={state.busy} onClick={()=>check(x)}>{t.check}</button></div>)}
      <p><strong>{t.recent}</strong></p>
      {visible&&state.rows.map(x=><div key={x.operation+':'+x.request_key} data-recovery-recent style={{padding:8,borderTop:'1px solid #eee'}}>
        <div>{LABELS[x.operation]} · {x.summary?.name||x.summary?.description||''}</div><small>{new Date(x.confirmed_at).toLocaleString()} · {t.receipt} {x.receipt_ref}</small>
        <button type="button" disabled={state.busy} onClick={()=>check(x)}>{t.check}</button>
      </div>)}
      {visible&&!state.busy&&!state.rows.length&&<p>{t.empty}</p>}
      {visible&&state.hasMore&&<p>{t.more}<br/><button type="button" disabled={state.busy} onClick={loadMore}>{lang==='ru'?'Показать более ранние результаты':'Show older results'}</button></p>}
      {visible&&state.detail&&<div data-recovery-confirmed role="status" style={{background:'#edf8ee',padding:12,marginTop:12}}>
        <strong>{t.confirmed} · {t.receipt} {state.detail.receipt_ref}</strong>
        <p>{state.detail.summary?.name||state.detail.summary?.description||LABELS[state.detail.operation]}</p>
        <p>{state.detail.summary?.amount!=null?state.detail.summary.amount+' '+(state.detail.summary.currency||(lang==='ru'?'валюта не записана в receipt':'currency not recorded in this receipt')):''}{state.detail.result?.saved!=null?' · '+state.detail.result.saved+' recorded':''}</p>
        {state.detail.result?.target_amount!=null&&<p>{state.detail.result.source_amount+' '+state.detail.result.source_currency+' → '+state.detail.result.target_amount+' '+state.detail.result.target_currency}</p>}
        {state.detail.current_objects.some(x=>x.state!=='active')&&<p>{t.archived}</p>}
        <p>{t.note}</p>
        <button type="button" disabled={state.busy} onClick={()=>{if(current()&&window.confirm(t.confirmNew)){allowSeparateOperation(actor,business,state.detail.operation,state.detail.request_key);acknowledgeRecentOperations(actor,business);setOpen(false)}}}>{t.another}</button>
      </div>}
      <button type="button" data-recovery-new disabled={!visible||state.busy||state.pending.some(x=>x.state!=='rejected')} onClick={async()=>{if(current()){await acknowledgeRecentOperations(actor,business);setOpen(false)}}}>{t.reviewed}</button>
    </section>}
  </aside>
}
