// Company subscriptions and customer overrides. Every action is a CAS + idempotent + audited server command;
// overrides adjust terms on top of the effective plan and never create access by themselves.
import {useState} from 'react'
import {Card,Pill,ErrorBox} from '../../ui'
import {useLoad,useCommand,CommandStatus,fmt,label,planTitle,newKey,Loading} from './shared'

const TONE={trialing:'good',active:'good',expired:'warn',not_started:'neutral',legacy:'neutral',pending_payment:'warn'};
const statusText=(s,c)=>s==='legacy'?c.legacy:(c['st_'+s]||s);
const valueText=(o,c)=>o.kind==='discount'?`${o.value?.percent}%`:o.kind==='feature'?(o.value?c.on:c.off):o.value===null?c.unlimited:o.value===0?c.unavailable:String(o.value);
const baseText=(v,kind,c)=>v===null||v===undefined?'—':kind==='feature'?(v?c.on:c.off):v===0?c.unavailable:String(v);

function Detail({id,token,c,lang,onChanged}){
 const d=useLoad('/admin/billing/companies/'+id,token),cat=useLoad('/admin/billing/catalog',token),cmd=useCommand(token,c);
 const [plan,setPlan]=useState(''),[reason,setReason]=useState(''),[starts,setStarts]=useState(''),[until,setUntil]=useState('');
 const [o,setO]=useState({kind:'limit',key:'',mode:'number',n:'',bool:true,percent:''});
 if(d.loading||cat.loading)return <Loading/>;if(d.error||cat.error)return <ErrorBox error={d.error||cat.error} onRetry={()=>{d.reload();cat.reload()}}/>;
 const x=d.data,a=x.access,acct=x.account,items=cat.data.catalog_items.filter(i=>i.enforcement==='server'&&i.kind===o.kind);
 const archived=new Set(cat.data.plans.filter(p=>p.archived_at).map(p=>p.plan));
 const choices=cat.data.versions.filter(v=>v.approval_status!=='draft').sort((p,q)=>p.plan.localeCompare(q.plan)||q.version-p.version);
 const iso=v=>v?new Date(v).toISOString():null,ok=reason.trim().length>=5;
 const send=(action,payload)=>cmd.run(`/admin/billing/companies/${id}/${action}`,{request_key:newKey(),expected_version:Number(acct.version),payload:{...payload,reason}},async()=>{setReason('');await d.reload();onChanged?.()});
 const overrideValue=()=>o.kind==='discount'?{percent:Number(o.percent)}:o.kind==='feature'?o.bool:o.mode==='unlimited'?null:o.mode==='unavailable'?0:Number(o.n);
 const overrideOk=ok&&(o.kind==='discount'?/^\d+$/.test(o.percent)&&+o.percent>=1&&+o.percent<=100:o.key&&(o.kind==='feature'||o.mode!=='number'||/^\d+$/.test(o.n)));
 const vById=vid=>(acct.plan_versions||[]).find(v=>v.id===vid)||cat.data.versions.find(v=>v.id===vid);
 return <Card title={x.business.name} aside={<Pill tone={TONE[x.policy==='legacy'?'legacy':a.subscription_status]||'neutral'}>{x.policy==='legacy'?c.legacy:statusText(a.subscription_status,c)}</Pill>}>
  <CommandStatus cmd={cmd} c={c} after={d.reload}/>
  <dl className="v2-dl"><dt>{c.plan}</dt><dd>{planTitle(vById(a.effective_plan_version_id),lang)}</dd><dt>{c.selected}</dt><dd>{planTitle(vById(acct.selected_plan_version_id),lang)}</dd>
   <dt>{c.source}</dt><dd>{c['src_'+a.effective_access_source]||a.effective_access_source||'—'}</dd>
   <dt>{c.trialEnd}</dt><dd>{fmt(a.trial_ends_at,lang)}{a.trial_hours?' · '+c.hours(a.trial_hours):''}</dd><dt>{c.paidEnd}</dt><dd>{fmt(a.paid_period_ends_at,lang)}</dd>
   {acct.scheduled_at&&<><dt>{c.schedule}</dt><dd>{planTitle(vById(acct.scheduled_plan_version_id),lang)} · {fmt(acct.scheduled_at,lang)}</dd></>}
   <dt>{c.version}</dt><dd className="v2-num">{acct.version}</dd></dl>
  <p className="v2-muted v2-small">{c.noRevenue}</p>
  <div className="v2-billing-form">
   <label>{c.reason}<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <fieldset><legend>{c.assign}</legend>
    <label>{c.choosePlan}<select value={plan} onChange={e=>setPlan(e.target.value)}><option value="">—</option>{choices.map(v=><option key={v.id} value={v.id} disabled={archived.has(v.plan)}>{planTitle(v,lang)}{archived.has(v.plan)?' · '+c.status.archived:''}</option>)}</select></label>
    <label>{c.starts}<input type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
    <label>{c.until}<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label>
   </fieldset>
   <div className="v2-row-gap v2-bc-actions">
    <button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!ok||!plan} onClick={()=>send('assign',{plan_version_id:plan})}>{c.assign}</button>
    <button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!ok||!plan||!until} onClick={()=>send('schedule',{plan_version_id:plan,effective_at:iso(until)})}>{c.schedule}</button>
    <button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!ok||!until||!acct.trial_started_at} onClick={()=>send('extend',{ends_at:iso(until)})}>{c.extend}</button>
    <button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!ok||!plan||!until} onClick={()=>send('grant',{plan_version_id:plan,ends_at:iso(until),...(starts?{starts_at:iso(starts)}:{})})}>{c.grant}</button>
   </div>
   <fieldset><legend>{c.addOverride}</legend>
    <label>{c.kind}<select value={o.kind} onChange={e=>setO({...o,kind:e.target.value,key:''})}>{['limit','feature','discount'].map(k=><option key={k} value={k}>{c.oKind[k]}</option>)}</select></label>
    {o.kind!=='discount'&&<label>{c.key}<select value={o.key} onChange={e=>setO({...o,key:e.target.value})}><option value="">—</option>{items.filter(i=>o.kind==='feature'||i.counter).map(i=><option key={i.key} value={i.key}>{label(i.label_i18n,lang)}</option>)}</select></label>}
    {o.kind==='limit'&&<label>{c.value}<select value={o.mode} onChange={e=>setO({...o,mode:e.target.value})}><option value="number">{c.number}</option><option value="unlimited">{c.unlimited}</option><option value="unavailable">{c.unavailable}</option></select></label>}
    {o.kind==='limit'&&o.mode==='number'&&<label>{c.number}<input type="number" min="0" value={o.n} onChange={e=>setO({...o,n:e.target.value})}/></label>}
    {o.kind==='feature'&&<label>{c.value}<select value={String(o.bool)} onChange={e=>setO({...o,bool:e.target.value==='true'})}><option value="true">{c.on}</option><option value="false">{c.off}</option></select></label>}
    {o.kind==='discount'&&<label>{c.percent}<input type="number" min="1" max="100" value={o.percent} onChange={e=>setO({...o,percent:e.target.value})}/></label>}
    <label>{c.until}<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label>
   </fieldset>
   <div className="v2-row-gap v2-bc-actions"><button className="v2-btn v2-btn-primary" disabled={cmd.busy||!overrideOk} onClick={()=>send('override',{kind:o.kind,...(o.kind!=='discount'?{key:o.key}:{}),value:overrideValue(),...(until?{ends_at:iso(until)}:{})})}>{c.addOverride}</button></div>
  </div>
  <h3 className="v2-h2">{c.overrides}</h3>
  {!(acct.overrides||[]).length?<p className="v2-muted">{c.empty}</p>:<ul className="v2-bc-versions">{acct.overrides.map(ov=>{const live=(a.overrides_active||[]).some(z=>z.id===ov.id);
   return <li key={ov.id}><strong>{c.oKind[ov.kind]}</strong>{ov.key&&' · '+ov.key} · {valueText(ov,c)} · {ov.reason} · {ov.ends_at?fmt(ov.ends_at,lang):c.noEnd} {live?<Pill tone="good">{c.active}</Pill>:<Pill tone="neutral">{c.inactive}</Pill>}
    {!ov.revoked_at&&<button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!ok} onClick={()=>send('revoke_override',{override_id:ov.id})}>{c.revoke}</button>}</li>})}</ul>}
  <h3 className="v2-h2">{c.grants}</h3>
  {!(acct.grants||[]).length?<p className="v2-muted">{c.empty}</p>:<ul className="v2-bc-versions">{acct.grants.map(g=><li key={g.id}>{c.grantLabel} · {planTitle(vById(g.plan_version_id),lang)} · {fmt(g.starts_at,lang)} — {fmt(g.ends_at,lang)} · {g.reason}
   {!g.revoked_at?<button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!ok} onClick={()=>send('revoke',{grant_id:g.id})}>{c.revoke}</button>:<Pill tone="neutral">{c.inactive}</Pill>}</li>)}</ul>}
  <h3 className="v2-h2">{c.history}</h3>
  {!(x.history||[]).length?<p className="v2-muted">{c.empty}</p>:<ul className="v2-bc-versions">{x.history.map(h=><li key={h.id}>{fmt(h.created_at,lang)} · {c[h.action]||c.oKind[h.intent?.payload?.kind]||h.action} · {h.result?.reason||''}</li>)}</ul>}
 </Card>;
}

export function SubscriptionsSection({token,c,lang}){
 const r=useLoad('/admin/billing/subscriptions',token),[open,setOpen]=useState('');
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 return <><Card title={c.nav.subscriptions}>{!r.data.subscriptions.length?<p className="v2-muted">{c.empty}</p>:<div className="v2-tablewrap"><table className="v2-table">
  <thead><tr><th>{c.company}</th><th>{c.plan}</th><th>{c.statusCol}</th><th>{c.source}</th><th>{c.trialEnd}</th><th>{c.paidEnd}</th><th>{c.overridesCol}</th><th/></tr></thead>
  <tbody>{r.data.subscriptions.map(s=><tr key={s.id} className={open===s.id?'is-on':''}><td>{s.name}</td><td>{planTitle(s.effective||s.selected,lang)}</td>
   <td><Pill tone={TONE[s.status]||'neutral'}>{statusText(s.status,c)}</Pill>{s.override_active&&<div className="v2-muted v2-small">{c.src_admin_override}</div>}</td>
   <td>{s.policy==='legacy'?'—':(c['src_'+s.source]||s.source)}</td><td>{fmt(s.trial_ends_at,lang)}</td><td>{fmt(s.paid_period_ends_at,lang)}</td>
   <td className="v2-num">{s.overrides_active||0}{s.discount_percent?` · ${s.discount_percent}%`:''}</td>
   <td><button className="v2-btn v2-btn-secondary" onClick={()=>setOpen(open===s.id?'':s.id)}>{open===s.id?c.close:c.manage}</button></td></tr>)}</tbody></table></div>}</Card>
  {open&&<Detail key={open} id={open} token={token} c={c} lang={lang} onChanged={r.reload}/>}</>;
}

export function OverridesSection({token,c,lang}){
 const r=useLoad('/admin/billing/overrides',token);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 const list=r.data.overrides.filter(o=>o.kind!=='discount');
 return <Card title={c.nav.overrides}>{!list.length?<p className="v2-muted">{c.empty}</p>:<div className="v2-tablewrap"><table className="v2-table">
  <thead><tr><th>{c.company}</th><th>{c.key}</th><th>{c.base}</th><th>{c.individual}</th><th>{c.effectiveCol}</th><th>{c.reason}</th><th>{c.approvedBy}</th><th>{c.until}</th><th>{c.statusCol}</th></tr></thead>
  <tbody>{list.map(o=><tr key={o.id}><td>{o.company.name}<div className="v2-muted v2-small">{planTitle(o.base_plan,lang)}</div></td><td>{c.oKind[o.kind]} · {o.key}</td>
   <td>{baseText(o.base_value,o.kind,c)}</td><td>{valueText(o,c)}</td><td>{o.active?baseText(o.effective_value,o.kind,c):'—'}</td><td>{o.reason}</td><td className="v2-num">{o.approved_by}</td>
   <td>{o.ends_at?fmt(o.ends_at,lang):c.noEnd}</td><td>{o.active?<Pill tone="good">{c.active}</Pill>:<Pill tone="neutral">{c.inactive}</Pill>}</td></tr>)}</tbody></table></div>}</Card>;
}
