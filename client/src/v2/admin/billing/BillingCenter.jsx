// Billing Management Center — Platform admin only (requireAdmin on every route). Separate from the customer
// Billing page in the Business workspace. No customer balances, transactions or documents are requested.
import {Fragment,useState} from 'react'
import {NavLink} from 'react-router-dom'
import '../../billing.css'
import {useAuth} from '../../../hooks/useAuth'
import {useLang} from '../../i18n'
import {PageHead,Card,Pill,ErrorBox} from '../../ui'
import {centerCopy} from './copy'
import {useLoad,fmt,label,Loading,enforcementPill} from './shared'
import PlansSection from './PlansSection'
import {SubscriptionsSection,OverridesSection} from './SubscriptionsSection'

export const SECTIONS=['overview','plans','catalog','subscriptions','overrides','promotions','payments','settings','audit'];

function Overview({token,c}){
 const r=useLoad('/admin/billing/overview',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 const d=r.data,tile=(k,v,sub)=><div className="v2-tile" key={k}><span className="v2-tile-label">{k}</span><span className={'v2-tile-val v2-num'+(v===null?' v2-muted':'')}>{v===null?'—':v}</span>{sub&&<span className="v2-tile-sub">{sub}</span>}</div>;
 return <><div className="v2-tiles">{tile(c.mrr,d.mrr,c.mrrOff)}{tile(c.activePaid,d.active_paid)}{tile(c.trialing,d.trialing)}{tile(c.expiredN,d.expired)}</div>
  <Card><dl className="v2-dl v2-dl-tight"><dt>{c.commercial}</dt><dd className="v2-num">{d.commercial}</dd><dt>{c.notStartedN}</dt><dd className="v2-num">{d.not_started}</dd>
   <dt>{c.legacyN}</dt><dd className="v2-num">{d.legacy}</dd><dt>{c.grantsN}</dt><dd className="v2-num">{d.admin_grants}</dd><dt>{c.overridesN}</dt><dd className="v2-num">{d.overrides}</dd></dl>
   <p className="v2-muted v2-small">{c.paymentsOff}</p></Card></>;
}

// Base (plan) → individual (override) → effective limit, and the usage the server counts.
function CompanyUsage({token,c,lang}){
 const subs=useLoad('/admin/billing/subscriptions',token),[id,setId]=useState('');
 const d=useLoad(id?'/admin/billing/companies/'+id:'/admin/billing/settings',token);
 if(subs.loading)return <Loading/>;if(subs.error)return <ErrorBox error={subs.error} onRetry={subs.reload}/>;
 const list=subs.data.subscriptions.filter(s=>s.policy!=='legacy'),val=x=>x===undefined?'—':x===null?c.unlimited:x===0?c.unavailable:String(x);
 return <Card title={c.usageTitle}><label>{c.chooseCompany}<select value={id} onChange={e=>setId(e.target.value)}><option value="">—</option>{list.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
  {id&&!d.loading&&d.data?.limits&&<div className="v2-tablewrap"><table className="v2-table"><thead><tr><th>{c.limit}</th><th>{c.enforcement}</th><th>{c.base}</th><th>{c.individual}</th><th>{c.effectiveCol}</th><th>{c.used}</th><th>{c.policy}</th></tr></thead>
   <tbody>{d.data.limits.map(l=><tr key={l.key}><td>{label(l.label_i18n,lang)}</td><td>{enforcementPill({...l,kind:'limit',module_status:'released'},c)}</td><td>{val(l.base)}</td><td>{l.individual===undefined?'—':val(l.individual)}</td>
    <td>{d.data.access.restricted?'—':val(l.effective)}</td><td className="v2-num">{l.used??'—'}</td><td>{l.counter?(l.policy==='soft'?c.soft:c.hard):'—'}</td></tr>)}</tbody></table></div>}</Card>;
}
function Catalog({token,c,lang}){
 const r=useLoad('/admin/billing/catalog',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 const rows=kind=>r.data.catalog_items.filter(i=>i.kind===kind);
 const table=kind=><Card title={kind==='feature'?c.features:c.limits} key={kind}><div className="v2-tablewrap"><table className="v2-table"><thead><tr><th>{c.key}</th><th>{c.moduleStatus}</th><th>{c.enforcement}</th>{kind==='limit'&&<th>{c.reset}</th>}</tr></thead>
  <tbody>{rows(kind).map(i=><tr key={i.key}><td>{label(i.label_i18n,lang)}<div className="v2-muted v2-small">{i.key}</div></td><td>{c[i.module_status==='not_released'?'notReleased':i.module_status]}</td><td>{enforcementPill(i,c)}</td>
   {kind==='limit'&&<td>{i.reset_period==='month_utc'?c.monthUtc:'—'}</td>}</tr>)}</tbody></table></div></Card>;
 return <><p className="v2-muted">{c.catalogNote}</p><p className="v2-muted v2-small">{c.statusLegend}</p>{table('feature')}{table('limit')}<CompanyUsage token={token} c={c} lang={lang}/></>;
}
function Promotions({token,c,lang}){
 const r=useLoad('/admin/billing/overrides',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 const list=r.data.overrides.filter(o=>o.kind==='discount');
 return <Card><p>{c.promoIntro}</p>{!list.length?<p className="v2-muted">{c.noPromos}</p>:<div className="v2-tablewrap"><table className="v2-table"><thead><tr><th>{c.company}</th><th>{c.percent}</th><th>{c.reason}</th><th>{c.until}</th><th>{c.statusCol}</th></tr></thead>
  <tbody>{list.map(o=><tr key={o.id}><td>{o.company.name}</td><td className="v2-num">{o.value.percent}%</td><td>{o.reason}</td><td>{o.ends_at?fmt(o.ends_at,lang):c.noEnd}</td><td>{o.active?<Pill tone="good">{c.active}</Pill>:<Pill tone="neutral">{c.inactive}</Pill>}</td></tr>)}</tbody></table></div>}</Card>;
}
function Payments({token,c,lang}){
 const r=useLoad('/admin/billing/payments',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 return <Card><dl className="v2-dl"><dt>{c.provider}</dt><dd><Pill tone="warn">{c.notConnected}</Pill></dd></dl><p className="v2-muted v2-small">{c.paymentsOff}</p><h3 className="v2-h2">{c.periods}</h3>
  {!r.data.periods.length?<p className="v2-muted">{c.noPeriods}</p>:<div className="v2-tablewrap"><table className="v2-table"><tbody>{r.data.periods.map(p=><tr key={p.id}><td>{p.payment_id}</td><td>{fmt(p.starts_at,lang)}</td><td>{fmt(p.ends_at,lang)}</td><td>{p.environment}</td></tr>)}</tbody></table></div>}</Card>;
}
function Settings({token,c}){
 const r=useLoad('/admin/billing/settings',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 const value=(k,v)=>k==='default_trial_hours'?c.hours(v):k==='payments_connected'?(v?c.settingValue.true:c.notConnected):(c.settingValue[String(v)]||String(v));
 return <Card><p className="v2-muted v2-small">{c.settingsNote}</p><dl className="v2-dl">{Object.keys(c.settings).filter(k=>k in r.data).map(k=><Fragment key={k}><dt>{c.settings[k]}</dt><dd>{value(k,r.data[k])}</dd></Fragment>)}</dl></Card>;
}
function Audit({token,c,lang}){
 const r=useLoad('/admin/billing/audit',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 if(!r.data.entries.length)return <Card><p className="v2-muted">{c.empty}</p></Card>;
 return <Card><div className="v2-tablewrap"><table className="v2-table"><thead><tr><th>{c.when}</th><th>{c.action}</th><th>{c.details}</th><th>{c.reason}</th><th>{c.actor}</th></tr></thead>
  <tbody>{r.data.entries.map(e=><tr key={e.id}><td>{fmt(e.created_at,lang)}</td><td>{e.action==='catalog'?c.nav.plans:(c[e.action]||c.oKind?.[e.action]||e.action)}</td>
   <td>{e.action==='catalog'?`${e.code} · ${e.payload_action||''}`:e.company||'—'}</td><td>{e.reason||'—'}</td><td className="v2-num">{e.actor_user_id}</td></tr>)}</tbody></table></div></Card>;
}

export default function BillingCenter({section='overview'}){
 const {token}=useAuth(),lang=useLang(),c=centerCopy(lang),s=SECTIONS.includes(section)?section:'overview',props={token,c,lang};
 return <div className="v2-page v2-bc"><PageHead title={c.title} sub={c.sub}/>
  <nav className="v2-tabs v2-bc-tabs" aria-label={c.title}>{SECTIONS.map(k=><NavLink key={k} to={'/admin/billing/'+k} className={({isActive})=>`v2-tab-link${isActive||(k==='overview'&&s==='overview')?' is-on':''}`}>{c.nav[k]}</NavLink>)}</nav>
  {s==='overview'&&<Overview {...props}/>}{s==='plans'&&<PlansSection {...props}/>}{s==='catalog'&&<Catalog {...props}/>}
  {s==='subscriptions'&&<SubscriptionsSection {...props}/>}{s==='overrides'&&<OverridesSection {...props}/>}{s==='promotions'&&<Promotions {...props}/>}
  {s==='payments'&&<Payments {...props}/>}{s==='settings'&&<Settings {...props}/>}{s==='audit'&&<Audit {...props}/>}
 </div>;
}
