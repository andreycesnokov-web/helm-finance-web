import {useEffect,useRef,useState} from 'react'
import '../billing.css'
import {Link} from 'react-router-dom'
import {useApi,useInvalidate} from '../data'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {billingRead,billingCommand} from '../lib/actions'
import {financialActor} from '../../lib/financialRecovery'
import {useLang} from '../i18n'
import {billingCopy} from '../lib/billingCopy'
import {priceLabel} from '../lib/billingMoney'
import {PageHead,Card,Btn,Pill,Skeleton,ErrorBox} from '../ui'
export function BillingBanner(){const r=useApi('/billing'),lang=useLang(),c=billingCopy(lang);if(!r.data||r.data.policy==='legacy')return null;
 return <div className="v2-banner v2-tone-info"><span>{r.data.access.restricted?c.restricted:c.current+': '+r.data.access.effective_plan}{r.data.access.trial_ends_at?' · '+c.ends+': '+new Date(r.data.access.trial_ends_at).toLocaleString(lang):''}</span><Link className="v2-btn v2-btn-secondary" to="/business/billing">{c.title}</Link></div>}
export default function Billing(){
 const r=useApi('/billing'),req=useBusinessRequest(),invalidate=useInvalidate(),lang=useLang(),c=billingCopy(lang);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(null),lock=useRef(false);
 const journal=`cfo-billing:${financialActor(req.token)}:${req.businessId}`;
 useEffect(()=>{try{setPending(JSON.parse(localStorage.getItem(journal)||'null'))}catch{setPending(null)}},[journal]);
 const command=async(path,body,replay=false)=>{
  if(lock.current||!req.isCurrent())return;lock.current=true;setBusy(true);setError('');
  const saved={path,body:body||{request_key:crypto.randomUUID(),plan_version_id:r.data.account.selected_plan_version_id,expected_version:r.data.account.version}};
  try{if(!replay&&pending)throw Error(c.pending);localStorage.setItem(journal,JSON.stringify(saved));setPending(saved);
   await billingCommand(path,req,saved.body);
   if(req.isCurrent()){localStorage.removeItem(journal);setPending(null);invalidate();r.reload()}
  }catch(e){if(req.isCurrent()){if(e?.data?.outcome==='rolled_back'){localStorage.removeItem(journal);setPending(null);r.reload()}setError(c.error)}}finally{lock.current=false;setBusy(false)}
 };
 const check=async()=>{if(!pending||lock.current)return;lock.current=true;setBusy(true);try{
  const x=await billingRead('/billing/commands/'+pending.body.request_key,req);
  if(req.isCurrent()&&x.state==='completed'){localStorage.removeItem(journal);setPending(null);setError('');invalidate();r.reload()}
  else setError(c.pending);
 }catch{setError(c.error)}finally{lock.current=false;setBusy(false)}};
 if(r.loading)return <Card><Skeleton rows={4}/></Card>;
 const isBillingDisabled=Boolean(r.error&&r.error.status===404&&r.error.data&&typeof r.error.data==='object'&&!r.error.data.path&&(r.error.data.error==='not_found'||r.error.data.code==='billing_disabled'||r.error.data.error==='billing_disabled'));
 if(isBillingDisabled)return <div className="v2-page"><PageHead title={c.title} sub={c.pilotTitle}/><Card><p>{c.pilotNotice}</p><div style={{marginTop:16}}><Btn to="/business/pulse">{c.back}</Btn></div></Card></div>;
 if(r.error)return <><PageHead title={c.title}/><ErrorBox error={r.error} onRetry={r.reload}/></>;
 const d=r.data,a=d.access,s=d.account,plans=s?.catalog||[],fmt=x=>x?new Date(x).toLocaleString(lang):'—';
 return <div className="v2-page"><PageHead title={c.title} sub={c.noCard}/><Card><p>{c.offline}</p>{d.policy==='legacy'?<p>{c.legacy}</p>:<>
  <Pill tone={a.restricted?'warn':'good'}>{a.restricted?(s.trial_started_at?c.restricted:c.notStarted):c.active}</Pill>
  <dl className="v2-dl"><dt>{c.current}</dt><dd>{a.effective_plan}</dd><dt>{c.source}</dt><dd>{a.effective_access_source}</dd><dt>{c.ends}</dt><dd>{fmt(a.trial_ends_at)}</dd><dt>{c.paid}</dt><dd>{fmt(a.paid_period_ends_at)}</dd></dl>
  <h2 className="v2-h2">{c.usage}</h2><ul>{['documents','ai','imports','users','companies'].map(k=><li key={k}>{c[k]}: {s.usage?.[k]||0} / {a.limits?.[k]===null?c.unlimited:a.limits?.[k]??'—'}</li>)}</ul>
 </>}{!d.can_manage&&<p>{c.member}</p>}</Card>
 {error&&<p role="alert" className="v2-inline-err">{error}</p>}
 {pending&&<Card><p>{c.pending}</p><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={check}>{c.check}</button><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>command(pending.path,pending.body,true)}>{c.retry}</button></Card>}
 {d.can_manage&&s&&<><h2 className="v2-h2">{c.choose}</h2>{!plans.length&&<Card>{c.empty}</Card>}<div className="v2-billing-plans">{plans.map(p=><Card key={p.id}>
  <h3 className="v2-h2">{p.name_i18n[lang]||p.name_i18n.en}</h3><p>{p.description_i18n[lang]||p.description_i18n.en}</p>
  <p className="v2-h2">{priceLabel(p.price_minor,p.currency,lang)} / {lang==='ru'?'месяц':lang==='id'?'bulan':'month'}</p>
  {p.approval_status==='staging_fixture'&&<p className="v2-banner v2-tone-warn">{c.fixture}</p>}
  <ul>{Object.entries(p.limits).map(([k,v])=><li key={k}>{c[k]||k}: {v===null?c.unlimited:v}</li>)}</ul>
  <button className="v2-btn v2-btn-secondary" disabled={busy||!!pending||s.selected_plan_version_id===p.id} onClick={()=>command('/billing/plan',{request_key:crypto.randomUUID(),plan_version_id:p.id,expected_version:s.version})}>{s.selected_plan_version_id===p.id?c.selected:c.select}</button>
 </Card>)}</div>{!s.trial_started_at&&s.selected_plan_version_id&&<button className="v2-btn v2-btn-primary" disabled={busy||!!pending} onClick={()=>command('/billing/trial')}>{c.start}</button>}</>}
 <Btn to="/business/pulse">{c.back}</Btn></div>
}
