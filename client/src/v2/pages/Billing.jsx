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
const FEATURES=['documents','ai','import','payroll','team','approvals','export','integrations'],LIMITS=['users','companies','documents','ai','imports'];
const TONE={trialing:'good',active:'good',expired:'warn',pending_payment:'warn',not_started:'neutral'};
// Display only: the server snapshot decides access. The countdown re-reads the server when it reaches zero.
const planName=(v,lang)=>v?(v.name_i18n?.[lang]||v.name_i18n?.en||v.plan):'—';
const versionOf=(s,id)=>(s?.plan_versions||[]).find(v=>v.id===id)||(s?.catalog||[]).find(v=>v.id===id);
function useCountdown(seconds,onZero){
 const [left,setLeft]=useState(seconds||0);
 useEffect(()=>{setLeft(seconds||0);if(!seconds)return;const start=Date.now();
  const t=setInterval(()=>{const l=Math.max(0,seconds-Math.floor((Date.now()-start)/1000));setLeft(l);if(!l){clearInterval(t);onZero?.()}},30000);
  return()=>clearInterval(t)},[seconds]);
 return left;
}
const remaining=(sec,c)=>{const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60);return d?c.dh(d,h):c.hm(h,m)};
export function BillingBanner(){const r=useApi('/billing'),lang=useLang(),c=billingCopy(lang);if(!r.data||r.data.policy==='legacy')return null;
 const a=r.data.access,name=planName(versionOf(r.data.account,a.effective_plan_version_id),lang);
 return <div className="v2-banner v2-tone-info"><span>{a.restricted?(a.subscription_status==='not_started'?c.choosePrompt:c.restricted):c.current+': '+name}{a.trial_seconds_remaining>0?' · '+c.left+': '+remaining(a.trial_seconds_remaining,c):''}</span><Link className="v2-btn v2-btn-secondary" to="/business/billing">{c.title}</Link></div>}
export default function Billing(){
 const r=useApi('/billing'),req=useBusinessRequest(),invalidate=useInvalidate(),lang=useLang(),c=billingCopy(lang);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(null),lock=useRef(false);
 const left=useCountdown(r.data?.access?.trial_seconds_remaining,()=>r.reload());
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
 const status=a?.subscription_status||'not_started',current=versionOf(s,a?.effective_plan_version_id),selected=versionOf(s,s?.selected_plan_version_id);
 return <div className="v2-page"><PageHead title={c.title} sub={c.noCard}/><Card><p>{c.offline}</p>{d.policy==='legacy'?<p>{c.legacy}</p>:<>
  <div className="v2-billing-status"><Pill tone={TONE[status]||'neutral'} dot>{c['st_'+status]||status}</Pill>{a.effective_access_source==='admin_override'&&<Pill tone="info">{c.src_admin_override}</Pill>}</div>
  <dl className="v2-dl"><dt>{c.current}</dt><dd>{a.restricted?(selected?planName(selected,lang)+' · '+c.src_restricted:c.src_restricted):planName(current,lang)}</dd>
   <dt>{c.source}</dt><dd>{c['src_'+a.effective_access_source]||a.effective_access_source}</dd>
   {a.trial_status_effective==='active'&&<><dt>{c.left}</dt><dd><strong>{remaining(left,c)}</strong> · {c.ends}: {fmt(a.trial_ends_at)}</dd></>}
   {a.trial_status_effective==='expired'&&<><dt>{c.endedAt}</dt><dd>{fmt(a.trial_ends_at)}</dd></>}
   {a.override_active&&<><dt>{c.grantUntil}</dt><dd>{fmt(a.override_ends_at)}</dd></>}
   {a.subscription_active&&<><dt>{c.paid}</dt><dd>{fmt(a.paid_period_ends_at)}</dd></>}</dl>
  {a.restricted&&s.trial_started_at&&<p>{c.restricted}</p>}
  {!a.restricted&&<><h2 className="v2-h2">{c.usage}</h2><ul>{LIMITS.map(k=><li key={k}>{c[k]}: {s.usage?.[k]||0} / {a.limits?.[k]===null?c.unlimited:a.limits?.[k]??'—'}</li>)}</ul></>}
 </>}{!d.can_manage&&<p>{c.member}</p>}</Card>
 {error&&<p role="alert" className="v2-inline-err">{error}</p>}
 {pending&&<Card><p>{c.pending}</p><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={check}>{c.check}</button><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>command(pending.path,pending.body,true)}>{c.retry}</button></Card>}
 {s&&<><h2 className="v2-h2">{c.choose}</h2>{!plans.length&&<Card>{c.empty}</Card>}{!s.trial_started_at&&d.can_manage&&plans.length>0&&<p>{c.choosePrompt}</p>}<div className="v2-billing-plans">{plans.map(p=>{const mine=s.selected_plan_version_id===p.id;return <Card key={p.id} className={mine?'v2-billing-plan-current':''}>
  <div className="v2-billing-plan-head"><h3 className="v2-h2">{planName(p,lang)}</h3>{mine&&<Pill tone="good">{c.currentBadge}</Pill>}</div><p>{p.description_i18n[lang]||p.description_i18n.en}</p>
  <p className="v2-h2">{priceLabel(p.price_minor,p.currency,lang)} / {lang==='ru'?'месяц':lang==='id'?'bulan':'month'}</p>
  {p.approval_status==='staging_fixture'&&<p className="v2-banner v2-tone-warn">{c.fixture}</p>}
  <ul className="v2-billing-features">{FEATURES.map(k=><li key={k} className={p.features?.[k]?'':'v2-billing-off'} aria-label={(c[k]||k)+': '+(p.features?.[k]?c.included:c.notIncluded)}><span aria-hidden="true">{p.features?.[k]?'✓':'—'}</span> {c[k]||k}</li>)}</ul>
  <ul>{LIMITS.filter(k=>k in (p.limits||{})).map(k=><li key={k}>{c[k]||k}: {p.limits[k]===null?c.unlimited:p.limits[k]}</li>)}</ul>
  {d.can_manage&&<button className="v2-btn v2-btn-secondary" disabled={busy||!!pending||mine} onClick={()=>command('/billing/plan',{request_key:crypto.randomUUID(),plan_version_id:p.id,expected_version:s.version})}>{mine?c.selected:s.trial_started_at?c.change:c.select}</button>}
 </Card>})}</div>{plans.length>0&&<p className="v2-billing-note">{c.payLater}</p>}{d.can_manage&&!s.trial_started_at&&s.selected_plan_version_id&&<button className="v2-btn v2-btn-primary" disabled={busy||!!pending} onClick={()=>command('/billing/trial')}>{c.start}</button>}</>}
 <Btn to="/business/pulse">{c.back}</Btn></div>
}
