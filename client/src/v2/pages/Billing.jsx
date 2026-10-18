import {useEffect,useRef,useState} from 'react'
import '../billing.css'
import {Link,useLocation} from 'react-router-dom'
import {useApi,useInvalidate} from '../data'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import {billingRead,billingCommand} from '../lib/actions'
import {financialActor} from '../../lib/financialRecovery'
import {captureSelectedPlan,getSelectedPlan,clearSelectedPlan} from '../../lib/planSelection'
import {useLang} from '../i18n'
import {billingCopy} from '../lib/billingCopy'
import {priceLabel} from '../lib/billingMoney'
import {PageHead,Card,Btn,Pill,Skeleton,ErrorBox} from '../ui'
const FEATURES=['documents','ai','import','payroll','team','approvals','export','integrations'],LIMITS=['users','transactions','documents','ai','companies','accounts','imports','bank_rows','ai_extraction','ai_accountant','mcp','storage_mb'];
// A limit value: null = unlimited, 0 = not included, otherwise the number (absent keys are not shown).
const limitValue=(v,c)=>v===null?c.unlimited:v===0?c.notIncluded:v;
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
// Shown when the server refuses an action because of the plan (402). The refusal itself is server-side.
export function BillingDeniedBanner(){
 const lang=useLang(),c=billingCopy(lang),[d,setD]=useState(null);
 useEffect(()=>{const on=e=>setD(e.detail||{});window.addEventListener('cfo-billing-denied',on);return()=>window.removeEventListener('cfo-billing-denied',on)},[]);
 if(!d)return null;
 return <div className="v2-banner v2-tone-warn" role="alert"><span>{c.denied[d.error]||c.deniedFallback}</span><Link className="v2-btn v2-btn-secondary" to={d.billing_url||'/business/billing'} onClick={()=>setD(null)}>{c.seePlans}</Link><button type="button" className="v2-btn v2-btn-secondary" onClick={()=>setD(null)}>{c.dismiss}</button></div>
}
export function BillingBanner(){const r=useApi('/billing'),lang=useLang(),c=billingCopy(lang);if(!r.data||r.data.policy==='legacy')return null;
 const a=r.data.access,name=planName(versionOf(r.data.account,a.effective_plan_version_id),lang);
 return <div className="v2-banner v2-tone-info"><span>{a.restricted?(a.subscription_status==='not_started'?c.choosePrompt:c.restricted):c.current+': '+name}{a.trial_seconds_remaining>0?' · '+c.left+': '+remaining(a.trial_seconds_remaining,c):''}</span><Link className="v2-btn v2-btn-secondary" to="/business/billing">{c.title}</Link></div>}
export default function Billing(){
 const r=useApi('/billing'),req=useBusinessRequest(),invalidate=useInvalidate(),lang=useLang(),c=billingCopy(lang),loc=useLocation();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(null),lock=useRef(false);
 const left=useCountdown(r.data?.access?.trial_seconds_remaining,()=>r.reload());
 const journal=`cfo-billing:${financialActor(req.token)}:${req.businessId}`;
 const selectedPlanCode=captureSelectedPlan(loc.search)||getSelectedPlan();
 useEffect(()=>{try{setPending(JSON.parse(localStorage.getItem(journal)||'null'))}catch{setPending(null)}},[journal]);
 const command=async(path,body,replay=false)=>{
  if(lock.current||!req.isCurrent())return;lock.current=true;setBusy(true);setError('');
  const saved={path,body:body||{request_key:crypto.randomUUID(),plan_version_id:r.data.account.selected_plan_version_id,expected_version:r.data.account.version}};
  try{if(!replay&&pending)throw Error(c.pending);localStorage.setItem(journal,JSON.stringify(saved));setPending(saved);
   await billingCommand(path,req,saved.body);
   if(req.isCurrent()){localStorage.removeItem(journal);setPending(null);invalidate();r.reload()}
  }catch(e){if(req.isCurrent()){if(e?.data?.outcome==='rolled_back'){localStorage.removeItem(journal);setPending(null);r.reload()}setError(c.error)}}finally{lock.current=false;setBusy(false)}
 };
 const activateSelectedTrial=async(target)=>{
  if(lock.current||!req.isCurrent()||busy)return;lock.current=true;setBusy(true);setError('');
  try{
   let curVersion=r.data.account.version;
   if(r.data.account.selected_plan_version_id!==target.id){
    const selKey=crypto.randomUUID();
    const selBody={request_key:selKey,plan_version_id:target.id,expected_version:curVersion};
    localStorage.setItem(journal,JSON.stringify({path:'/billing/plan',body:selBody}));
    const selRes=await billingCommand('/billing/plan',req,selBody);
    curVersion=selRes?.version||(curVersion+1);
   }
   const trialKey=crypto.randomUUID();
   const trialBody={request_key:trialKey,plan_version_id:target.id,expected_version:curVersion};
   localStorage.setItem(journal,JSON.stringify({path:'/billing/trial',body:trialBody}));
   await billingCommand('/billing/trial',req,trialBody);
   clearSelectedPlan();
   if(req.isCurrent()){localStorage.removeItem(journal);setPending(null);invalidate();r.reload()}
  }catch(e){
   if(req.isCurrent()){
    if(e?.data?.outcome==='rolled_back'){localStorage.removeItem(journal);setPending(null);r.reload()}
    setError(c.error||'Failed to activate trial');
   }
  }finally{lock.current=false;setBusy(false)}
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
 const matchedPlan=plans.find(p=>p.plan===selectedPlanCode)||null;
 return <div className="v2-page"><PageHead title={c.title} sub={c.noCard}/><Card><p>{c.offline}</p>{d.policy==='legacy'?<p>{c.legacy}</p>:<>
  <div className="v2-billing-status"><Pill tone={TONE[status]||'neutral'} dot>{c['st_'+status]||status}</Pill>{a.effective_access_source==='admin_override'&&<Pill tone="info">{c.src_admin_override}</Pill>}</div>
  <dl className="v2-dl"><dt>{c.current}</dt><dd>{a.restricted?(selected?planName(selected,lang)+' · '+c.src_restricted:c.src_restricted):planName(current,lang)}</dd>
   <dt>{c.source}</dt><dd>{c['src_'+a.effective_access_source]||a.effective_access_source}</dd>
   {a.trial_status_effective==='active'&&<><dt>{c.left}</dt><dd><strong>{remaining(left,c)}</strong> · {c.ends}: {fmt(a.trial_ends_at)}</dd></>}
   {a.trial_status_effective==='expired'&&<><dt>{c.endedAt}</dt><dd>{fmt(a.trial_ends_at)}</dd></>}
   {a.override_active&&<><dt>{c.grantUntil}</dt><dd>{fmt(a.override_ends_at)}</dd></>}
   {a.subscription_active&&<><dt>{c.paid}</dt><dd>{fmt(a.paid_period_ends_at)}</dd></>}</dl>
  {a.restricted&&s.trial_started_at&&<p>{c.restricted}</p>}
  {!a.restricted&&<><h2 className="v2-h2">{c.usage}</h2><ul>{LIMITS.filter(k=>a.limits&&k in a.limits).map(k=><li key={k}>{c.lim[k]}: {s.usage?.[k]||0} / {limitValue(a.limits[k],c)}</li>)}</ul></>}
 </>}{!d.can_manage&&<p>{c.member}</p>}</Card>
 {error&&<p role="alert" className="v2-inline-err">{error}</p>}
 {pending&&<Card><p>{c.pending}</p><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={check}>{c.check}</button><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>command(pending.path,pending.body,true)}>{c.retry}</button></Card>}
 {s&&<><h2 className="v2-h2">{c.choose}</h2>
  {matchedPlan&&!s.trial_started_at&&d.can_manage&&<Card className="v2-billing-plan-current" style={{marginBottom:20}}>
   <div className="v2-billing-plan-head"><h3 className="v2-h2">{planName(matchedPlan,lang)}</h3><Pill tone="good">{lang==='ru'?'Выбранный тариф':lang==='id'?'Paket Terpilih':'Selected Plan'}</Pill></div>
   <p>{matchedPlan.description_i18n?.[lang]||matchedPlan.description_i18n?.en}</p>
   <p className="v2-h2">{priceLabel(matchedPlan.price_minor,matchedPlan.currency,lang)} / {lang==='ru'?'месяц':lang==='id'?'bulan':'month'}</p>
   <p className="v2-muted">{lang==='ru'?'7 дней бесплатного пробного периода (168 часов). Без кредитной карты.':lang==='id'?'Uji coba gratis 7 hari (168 jam). Tanpa kartu kredit.':'7-day free trial (168 hours). No credit card required.'}</p>
   <div style={{marginTop:16,display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
    <button type="button" className="v2-btn v2-btn-primary" disabled={busy||!!pending} onClick={()=>activateSelectedTrial(matchedPlan)}>
     {busy?(lang==='ru'?'Активация...':lang==='id'?'Mengaktifkan...':'Activating trial...'):(lang==='ru'?`Начать 7-дневный пробный период ${planName(matchedPlan,lang)}`:lang==='id'?`Mulai Uji Coba 7 Hari ${planName(matchedPlan,lang)}`:`Start 7-Day Free Trial of ${planName(matchedPlan,lang)}`)}
    </button>
    <span className="v2-muted v2-small">{lang==='ru'?'Или выберите другой тариф ниже':lang==='id'?'Atau pilih paket lain di bawah':'Or select another plan below'}</span>
   </div>
  </Card>}
  {!plans.length&&<Card>{c.empty}</Card>}{!s.trial_started_at&&d.can_manage&&plans.length>0&&!matchedPlan&&<p>{c.choosePrompt}</p>}<div className="v2-billing-plans">{plans.map(p=>{const mine=s.selected_plan_version_id===p.id;const isTarget=matchedPlan&&matchedPlan.id===p.id;return <Card key={p.id} className={mine?'v2-billing-plan-current':isTarget?'v2-billing-plan-target':''}>
   <div className="v2-billing-plan-head"><h3 className="v2-h2">{planName(p,lang)}</h3>{mine&&<Pill tone="good">{c.currentBadge}</Pill>}{!mine&&isTarget&&<Pill tone="info">{lang==='ru'?'Выбранный':lang==='id'?'Terpilih':'Selected'}</Pill>}</div><p>{p.description_i18n[lang]||p.description_i18n.en}</p>
   <p className="v2-h2">{priceLabel(p.price_minor,p.currency,lang)} / {lang==='ru'?'месяц':lang==='id'?'bulan':'month'}</p>
   {p.approval_status==='staging_fixture'&&<p className="v2-banner v2-tone-warn">{c.fixture}</p>}
   <ul className="v2-billing-features">{FEATURES.map(k=><li key={k} className={p.features?.[k]?'':'v2-billing-off'} aria-label={(c[k]||k)+': '+(p.features?.[k]?c.included:c.notIncluded)}><span aria-hidden="true">{p.features?.[k]?'✓':'—'}</span> {c[k]||k}</li>)}</ul>
   <ul>{LIMITS.filter(k=>k in (p.limits||{})).map(k=><li key={k}>{c.lim[k]}: {limitValue(p.limits[k],c)}</li>)}</ul>
   {d.can_manage&&<button className="v2-btn v2-btn-secondary" disabled={busy||!!pending||mine} onClick={()=>{if(p.plan){try{localStorage.setItem('cfo_selected_plan',p.plan)}catch{}}command('/billing/plan',{request_key:crypto.randomUUID(),plan_version_id:p.id,expected_version:s.version})}}>{mine?c.selected:s.trial_started_at?c.change:c.select}</button>}
  </Card>})}</div>{plans.length>0&&<p className="v2-billing-note">{c.payLater}</p>}{d.can_manage&&!s.trial_started_at&&s.selected_plan_version_id&&<button className="v2-btn v2-btn-primary" disabled={busy||!!pending} onClick={()=>command('/billing/trial')}>{c.start}</button>}</>}
 <div style={{display:'flex',gap:12,marginTop:16,flexWrap:'wrap'}}>
  {s?.trial_started_at&&<Btn to="/business/setup/docs">{lang==='ru'?'Настройка документов':lang==='id'?'Penyiapan Dokumen':'Continue Company Setup'}</Btn>}
  <Btn to="/business/pulse">{c.back}</Btn>
 </div></div>
}

