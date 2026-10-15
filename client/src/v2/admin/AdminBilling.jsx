import {useEffect,useRef,useState} from 'react'
import '../billing.css'
import {useAuth} from '../../hooks/useAuth'
import {billingRead,billingCommand} from '../lib/actions'
import {financialActor} from '../../lib/financialRecovery'
import {useLang} from '../i18n'
import {billingCopy} from '../lib/billingCopy'
import {minorToInput,inputToMinor,priceLabel} from '../lib/billingMoney'
import {PageHead,Card,Skeleton} from '../ui'
const limits=['users','companies','documents','ai','imports'],features=['documents','ai','import','payroll','team','approvals','export','integrations'];
const nowLocal=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
export default function AdminBilling(){
 const {token}=useAuth(),lang=useLang(),c=billingCopy(lang),lock=useRef(false),mounted=useRef(true);
 const [data,setData]=useState(null),[companies,setCompanies]=useState([]),[code,setCode]=useState('starter'),[form,setForm]=useState(null),[co,setCo]=useState(''),[detail,setDetail]=useState(null),[plan,setPlan]=useState(''),[reason,setReason]=useState(''),[until,setUntil]=useState(''),[starts,setStarts]=useState(nowLocal),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(null);
 const journal='cfo-billing-admin:'+financialActor(token),selection=useRef(co);selection.current=co;
 const load=async()=>{const [d,b]=await Promise.all([billingRead('/admin/billing/catalog',token),billingRead('/admin/billing/companies',token)]);if(mounted.current){setData(d);setCompanies(b.businesses||[])}return d};
 useEffect(()=>{mounted.current=true;try{setSaved(JSON.parse(localStorage.getItem(journal)||'null'))}catch{}load().catch(e=>setErr(e.message));return()=>{mounted.current=false}},[token]);
 useEffect(()=>{if(!data)return;const p=data.plans.find(x=>x.plan===code),v=data.versions.find(x=>x.id===p?.current_version_id);setForm(v?{...structuredClone(v),price_input:minorToInput(v.price_minor,v.currency),features:{...Object.fromEntries(features.map(k=>[k,false])),...v.features},publish:p.commercial_available}:null)},[data,code]);
 const refreshCompany=async(id)=>{const x=await billingRead('/admin/billing/companies/'+id,token);if(mounted.current&&selection.current===id)setDetail(x)};
 useEffect(()=>{setDetail(null);if(co)refreshCompany(co).catch(e=>setErr(e.message))},[co,token]);
 const send=async(path,body,retry=false)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setErr('');
  try{if(saved&&!retry)throw Error(c.pending);localStorage.setItem(journal,JSON.stringify({path,body}));setSaved({path,body});
   await billingCommand(path,token,body);localStorage.removeItem(journal);if(mounted.current){setSaved(null);await load();if(selection.current)await refreshCompany(selection.current)}
  }catch(e){if(mounted.current){if(e?.data?.outcome==='rolled_back'){localStorage.removeItem(journal);setSaved(null)}setErr(c.error)}}finally{lock.current=false;if(mounted.current)setBusy(false)}
 };
 const mutate=(k,v)=>setForm(f=>({...f,[k]:v}));
 const catalog=(archive=false)=>{
  const p=data.plans.find(x=>x.plan===code),price=inputToMinor(form.price_input,form.currency);if(!archive&&price===null){setErr(c.error);return}
  const terms=archive?{action:'archive'}:{action:'version',name_i18n:form.name_i18n,description_i18n:form.description_i18n,price_minor:price,currency:form.currency,features:form.features,limits:form.limits,terms_version:form.terms_version,effective_at:form.effective_at,approval_status:form.approval_status,fixture_label:form.fixture_label,publish:form.publish===true};
  send('/admin/billing/catalog/'+code,{request_key:crypto.randomUUID(),expected_version:p?.catalog_version||0,terms});
 };
 const action=(kind,gid)=>{if(!detail)return;const payload={reason};if(['assign','schedule','grant'].includes(kind))payload.plan_version_id=plan;
  if(['grant','extend'].includes(kind))payload.ends_at=until?new Date(until).toISOString():null;
  if(kind==='grant')payload.starts_at=new Date(starts).toISOString();if(kind==='schedule')payload.effective_at=until?new Date(until).toISOString():null;if(kind==='revoke')payload.grant_id=gid;
  send('/admin/billing/companies/'+co+'/'+kind,{request_key:crypto.randomUUID(),expected_version:detail.account.version,payload})};
 const fmt=x=>x?new Date(x).toLocaleString(lang):'—';
 return <div className="v2-page"><PageHead title={c.admin}/>{err&&<p role="alert" className="v2-inline-err">{err}</p>}{saved&&<Card><p>{c.pending}</p><button className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>send(saved.path,saved.body,true)}>{c.retry}</button></Card>}
 {!data?<Skeleton rows={4}/>:<><Card title={c.catalog}><label>{c.catalog}<select value={code} onChange={e=>setCode(e.target.value)}>{data.plans.filter(x=>['starter','control','pro'].includes(x.plan)).map(p=><option key={p.plan}>{p.plan}</option>)}</select></label>
 {form&&<div className="v2-billing-form">{['en','ru','id'].map(l=><div key={l}><label>{c.name} · {l}<input value={form.name_i18n[l]||''} onChange={e=>mutate('name_i18n',{...form.name_i18n,[l]:e.target.value})}/></label><label>{c.description} · {l}<input value={form.description_i18n[l]||''} onChange={e=>mutate('description_i18n',{...form.description_i18n,[l]:e.target.value})}/></label></div>)}
 <label>{c.price}<input inputMode="decimal" value={form.price_input} onChange={e=>mutate('price_input',e.target.value)}/></label><label>{c.currency}<input maxLength="3" value={form.currency} onChange={e=>mutate('currency',e.target.value.toUpperCase())}/></label>
 <label>{c.terms}<input value={form.terms_version} onChange={e=>mutate('terms_version',e.target.value)}/></label><label>{c.effective}<input type="datetime-local" value={form.effective_at?new Date(new Date(form.effective_at)-new Date(form.effective_at).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>{if(e.target.value)mutate('effective_at',new Date(e.target.value).toISOString())}}/></label>
 <fieldset><legend>{c.features}</legend>{features.map(k=><label key={k}><input type="checkbox" checked={form.features[k]===true} onChange={e=>mutate('features',{...form.features,[k]:e.target.checked})}/>{c[k]}</label>)}</fieldset>
 <fieldset><legend>{c.limits}</legend>{limits.map(k=><div key={k}><label>{c[k]}<input type="number" min="0" step="1" disabled={Object.hasOwn(form.limits,k)&&form.limits[k]===null} value={form.limits[k]??''} onChange={e=>{const m={...form.limits};if(e.target.value==='')delete m[k];else m[k]=Number(e.target.value);mutate('limits',m)}}/></label><label><input type="checkbox" checked={Object.hasOwn(form.limits,k)&&form.limits[k]===null} onChange={e=>{const m={...form.limits};if(e.target.checked)m[k]=null;else delete m[k];mutate('limits',m)}}/>{c.unlimited}</label></div>)}</fieldset>
 <label>{c.version}<select value={form.approval_status} onChange={e=>mutate('approval_status',e.target.value)}>{['draft','approved',...(data.allow_fixtures?['staging_fixture']:[])].map(x=><option key={x} value={x}>{c[x]}</option>)}</select></label>
 {form.approval_status==='staging_fixture'&&<label>{c.fixture}<input value={form.fixture_label||''} onChange={e=>mutate('fixture_label',e.target.value)}/></label>}
 <label><input type="checkbox" checked={form.publish===true} onChange={e=>mutate('publish',e.target.checked)}/>{c.publish}</label>
 <div className="v2-row-gap"><button className="v2-btn v2-btn-primary" disabled={busy||!!saved} onClick={()=>catalog()}>{c.save}</button><button className="v2-btn v2-btn-secondary" disabled={busy||!!saved} onClick={()=>catalog(true)}>{c.archive}</button></div>
 <h3>{c.history}</h3><ul>{data.versions.filter(v=>v.plan===code).map(v=><li key={v.id}>v{v.version} · {priceLabel(v.price_minor,v.currency,lang)} · {fmt(v.effective_at)} · {c[v.approval_status]}</li>)}</ul>
 </div>}</Card>
 <Card title={c.company}><label>{c.company}<select value={co} onChange={e=>setCo(e.target.value)}><option value="">—</option>{companies.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
 {detail&&<><p>{detail.policy==='legacy'?c.legacy:c.current+': '+detail.access.effective_plan}</p><dl className="v2-dl"><dt>{c.source}</dt><dd>{detail.access.effective_access_source}</dd><dt>{c.ends}</dt><dd>{fmt(detail.access.trial_ends_at)}</dd><dt>{c.paid}</dt><dd>{fmt(detail.access.paid_period_ends_at)}</dd><dt>{c.version}</dt><dd>{detail.account.version}</dd></dl>
 <p>{c.noRevenue}</p><p>{c.scheduleNote}</p>{detail.account.scheduled_at&&<p>{c.schedule}: {fmt(detail.account.scheduled_at)}</p>}
 <h3>{c.usage}</h3><ul>{(detail.usage||[]).map((u,i)=><li key={i}>{c[u.resource]}: {u.units} · {u.state} · {u.period_start}</li>)}</ul>
 <label>{c.choose}<select value={plan} onChange={e=>setPlan(e.target.value)}><option value="">—</option>{data.versions.filter(v=>v.approval_status!=='draft').map(v=><option key={v.id} value={v.id}>{v.name_i18n[lang]||v.plan} · v{v.version}{v.approval_status==='staging_fixture'?' · TEST':''}</option>)}</select></label>
 <label>{c.reason}<textarea value={reason} minLength={5} onChange={e=>setReason(e.target.value)}/></label><label>{c.starts}<input type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label><label>{c.until}<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label>
 <div className="v2-row-gap">{['assign','schedule','grant','extend'].map(k=><button key={k} className="v2-btn v2-btn-secondary" disabled={busy||!!saved||reason.trim().length<5||(k!=='extend'&&!plan)||(k!=='assign'&&!until)} onClick={()=>action(k)}>{c[k]}</button>)}</div>
 {(detail.account.grants||[]).map(g=><div key={g.id}><p>{c.grantLabel} · {fmt(g.starts_at)} — {fmt(g.ends_at)} · {g.reason}</p>{!g.revoked_at&&<button className="v2-btn v2-btn-secondary" disabled={busy||!!saved||reason.trim().length<5} onClick={()=>action('revoke',g.id)}>{c.revoke}</button>}</div>)}
 <h3>{c.history}</h3><ul>{(detail.history||[]).map(h=><li key={h.id}>{fmt(h.created_at)} · {c[h.action]||h.action} · {h.result?.reason||''}</li>)}</ul>
 <button className="v2-btn v2-btn-secondary" disabled={busy} onClick={()=>refreshCompany(co)}>{c.reload}</button></>}
 </Card></>}
 </div>
}
