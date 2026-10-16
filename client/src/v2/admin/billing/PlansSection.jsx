// Plan constructor: plans are data (any code). Editing always produces a NEW version — a draft first, then a
// confirmed publish; published versions are immutable in the database and subscribers keep theirs.
import {useEffect,useMemo,useState} from 'react'
import {Card,Pill,ErrorBox} from '../../ui'
import {minorToInput,inputToMinor,priceLabel} from '../../lib/billingMoney'
import {useLoad,useCommand,CommandStatus,fmt,label,newKey,Loading,localInput,enforcementPill} from './shared'

const LANGS=['en','ru','id'];
export const planStatus=(head,versions)=>{if(head.archived_at)return 'archived';const cur=versions.find(v=>v.id===head.current_version_id);return cur&&cur.approval_status!=='draft'?'published':'draft'};
const editableLimit=i=>i.required||!!i.counter;
function formFrom(v,head,items){
 const features={},limits={},policies={};
 // 'always' items belong to every plan; not-released modules cannot be sold.
 for(const i of items.filter(i=>i.kind==='feature'))features[i.key]=i.enforcement==='always'?true:i.module_status==='not_released'?false:v?.features?.[i.key]===true;
 for(const i of items.filter(i=>i.kind==='limit'&&editableLimit(i))){const x=v?.limits?.[i.key];
  limits[i.key]=x===undefined?{mode:'unavailable',n:''}:x===null?{mode:'unlimited',n:''}:x===0?{mode:'unavailable',n:''}:{mode:'number',n:String(x)};
  policies[i.key]=v?.limit_policies?.[i.key]==='soft'?'soft':'hard';}
 const cur=v?.currency||'USD';
 return {name_i18n:{en:'',ru:'',id:'',...(v?.name_i18n||{})},description_i18n:{en:'',ru:'',id:'',...(v?.description_i18n||{})},currency:cur,
  price_input:v?minorToInput(v.price_minor,cur):'',annual_input:v?.price_annual_minor!=null?minorToInput(v.price_annual_minor,cur):'',trial_hours:String(v?.trial_hours??168),
  features,limits,policies,terms_version:v?.terms_version||'',effective_at:new Date().toISOString(),approval_status:v?.approval_status==='staging_fixture'?'staging_fixture':'approved',
  fixture_label:v?.fixture_label||'',visible:head?.commercial_available===true};
}
function termsFrom(f,items,status){
 const price=inputToMinor(f.price_input,f.currency),annual=f.annual_input===''?null:inputToMinor(f.annual_input,f.currency);
 if(price===null||(f.annual_input!==''&&annual===null))return null;
 const limits={},limit_policies={};
 for(const [k,l] of Object.entries(f.limits)){limits[k]=l.mode==='unlimited'?null:l.mode==='unavailable'?0:Number(l.n);if(l.mode==='number'&&!/^\d+$/.test(l.n))return null;
  const item=items.find(i=>i.kind==='limit'&&i.key===k);if(item?.counter&&f.policies[k]==='soft')limit_policies[k]='soft';}
 return {name_i18n:f.name_i18n,description_i18n:f.description_i18n,price_minor:price,price_annual_minor:annual,currency:f.currency,trial_hours:Number(f.trial_hours),
  features:f.features,limits,limit_policies,terms_version:f.terms_version,effective_at:f.effective_at,approval_status:status,...(status==='staging_fixture'?{fixture_label:f.fixture_label}:{})};
}

function Editor({data,code,c,lang,cmd,reload,isNew}){
 const items=data.catalog_items,head=data.plans.find(p=>p.plan===code),versions=data.versions.filter(v=>v.plan===code).sort((a,b)=>b.version-a.version);
 const source=versions.find(v=>v.id===head?.draft_version_id)||versions.find(v=>v.id===head?.current_version_id);
 const [f,setF]=useState(()=>formFrom(source,head,items)),[preview,setPreview]=useState(null),[confirm,setConfirm]=useState(false),[local,setLocal]=useState('');
 const [pres,setPres]=useState({display_order:String(head?.display_order??100),recommended:head?.recommended===true,visible:head?.commercial_available===true});
 useEffect(()=>{setF(formFrom(source,head,items));setPreview(null);setConfirm(false);setPres({display_order:String(head?.display_order??100),recommended:head?.recommended===true,visible:head?.commercial_available===true})},[code,source?.id,head?.catalog_version]);
 const set=(k,v)=>{setF(x=>({...x,[k]:v}));setPreview(null);setConfirm(false)};
 const expected=Number(head?.catalog_version??0),status=planStatus(head||{},versions);
 const send=(terms,after)=>cmd.run('/admin/billing/catalog/'+code,{request_key:newKey(),expected_version:expected,terms},async r=>{setLocal(c.saved);await reload();after?.(r)});
 // Local shape check (prices, numbers); the server re-validates everything against the catalog.
 const build=st=>{const t=termsFrom(f,items,st);if(!t){setLocal('');setPreview({valid:false,error:'billing_invalid_terms',changes:[]})}return t};
 const doPreview=async()=>{const t=build(f.approval_status);if(!t)return;const r=await cmd.run('/admin/billing/catalog/'+code+'/preview',{expected_version:expected,terms:{action:'publish',...t}});if(r)setPreview(r)};
 const val=x=>x===null||x===undefined?'—':typeof x==='object'?JSON.stringify(x):String(x);
 return <Card title={`${code}`} aside={head&&<Pill tone={status==='published'?'good':status==='archived'?'neutral':'warn'}>{c.status[status]}</Pill>}>
  <p className="v2-muted v2-small">{source?.id===head?.draft_version_id&&head?.draft_version_id?c.editingDraft:source?c.editingCurrent:c.newPlan}</p>
  <div className="v2-billing-form">
   <fieldset><legend>{c.name} / {c.description}</legend>{LANGS.map(l=><div key={l}><label>{c.name} · {l.toUpperCase()}<input value={f.name_i18n[l]} maxLength={80} onChange={e=>set('name_i18n',{...f.name_i18n,[l]:e.target.value})}/></label>
    <label>{c.description} · {l.toUpperCase()}<input value={f.description_i18n[l]} onChange={e=>set('description_i18n',{...f.description_i18n,[l]:e.target.value})}/></label></div>)}</fieldset>
   <fieldset><legend>{c.monthly}</legend>
    <label>{c.currency}<input value={f.currency} maxLength={3} onChange={e=>set('currency',e.target.value.toUpperCase())}/></label>
    <label>{c.monthly}<input inputMode="decimal" value={f.price_input} onChange={e=>set('price_input',e.target.value)}/></label>
    <label>{c.annual}<input inputMode="decimal" value={f.annual_input} onChange={e=>set('annual_input',e.target.value)}/></label>
    <label>{c.trialHours}<input type="number" min="1" max="2160" value={f.trial_hours} onChange={e=>set('trial_hours',e.target.value)}/></label>
    <label>{c.termsVersion}<input value={f.terms_version} onChange={e=>set('terms_version',e.target.value)}/></label>
    <label>{c.effective}<input type="datetime-local" value={localInput(f.effective_at)} onChange={e=>e.target.value&&set('effective_at',new Date(e.target.value).toISOString())}/></label>
   </fieldset>
   <fieldset className="v2-bc-list"><legend>{c.features}</legend>{items.filter(i=>i.kind==='feature').map(i=><label key={i.key} className="v2-bc-item">
    <input type="checkbox" checked={f.features[i.key]===true} disabled={i.module_status==='not_released'||i.enforcement==='always'} onChange={e=>set('features',{...f.features,[i.key]:e.target.checked})}/>
    <span>{label(i.label_i18n,lang)}</span>{enforcementPill(i,c)}</label>)}</fieldset>
   <fieldset className="v2-bc-list"><legend>{c.limits}</legend>{items.filter(i=>i.kind==='limit').map(i=>{const l=f.limits[i.key];
    if(!editableLimit(i))return <div key={i.key} className="v2-bc-item v2-billing-off"><span>{label(i.label_i18n,lang)}</span>{enforcementPill(i,c)}</div>;
    return <div key={i.key} className="v2-bc-limit"><span className="v2-bc-limit-name">{label(i.label_i18n,lang)} {enforcementPill(i,c)}</span>
     <select aria-label={label(i.label_i18n,lang)} value={l.mode} onChange={e=>set('limits',{...f.limits,[i.key]:{...l,mode:e.target.value}})}><option value="number">{c.number}</option><option value="unlimited">{c.unlimited}</option><option value="unavailable">{c.unavailable}</option></select>
     {l.mode==='number'&&<input type="number" min="0" step="1" aria-label={c.number} value={l.n} onChange={e=>set('limits',{...f.limits,[i.key]:{...l,n:e.target.value}})}/>}
     {i.counter&&i.key!=='users'&&<select aria-label={c.policy} value={f.policies[i.key]} onChange={e=>set('policies',{...f.policies,[i.key]:e.target.value})}><option value="hard">{c.hard}</option><option value="soft">{c.soft}</option></select>}
    </div>})}</fieldset>
   {data.allow_fixtures&&<label>{c.version}<select value={f.approval_status} onChange={e=>set('approval_status',e.target.value)}><option value="approved">{c.approved}</option><option value="staging_fixture">{c.staging_fixture}</option></select></label>}
   {f.approval_status==='staging_fixture'&&<label>{c.fixture}<input value={f.fixture_label} onChange={e=>set('fixture_label',e.target.value)}/></label>}
  </div>
  <div className="v2-row-gap v2-bc-actions">
   <button className="v2-btn v2-btn-secondary" disabled={cmd.busy} onClick={()=>{const t=build('draft');if(t)send({action:'draft',...t})}}>{c.saveDraft}</button>
   <button className="v2-btn v2-btn-secondary" disabled={cmd.busy} onClick={doPreview}>{c.preview}</button>
  </div>
  {preview&&<div className="v2-bc-preview" aria-live="polite"><Pill tone={preview.valid?'good':'crit'}>{preview.valid?c.valid:c.invalid}</Pill>{preview.error&&<span className="v2-muted v2-small"> {preview.error}</span>}
   {preview.valid&&<><p className="v2-small">{c.subscribers(preview.subscribers??0)}</p><h4>{c.changes}</h4>{!preview.changes?.length?<p className="v2-muted">{c.noChanges}</p>:
    <div className="v2-tablewrap"><table className="v2-table"><tbody>{preview.changes.map(x=><tr key={x.field}><td>{x.field}</td><td>{val(x.before)}</td><td>→ {val(x.after)}</td></tr>)}</tbody></table></div>}
    <label className="v2-bc-item"><input type="checkbox" checked={f.visible} onChange={e=>setF(x=>({...x,visible:e.target.checked}))}/>{c.visible}</label>
    <label className="v2-bc-item"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>{c.confirmPublish}</label>
    <button className="v2-btn v2-btn-primary" disabled={cmd.busy||!confirm} onClick={()=>{const t=build(f.approval_status);if(t)send({action:'publish',confirm_publish:true,publish:f.visible,...t})}}>{c.publish}</button></>}
  </div>}
  {local&&!cmd.error&&<p className="v2-small" role="status">{local}</p>}
  {head&&!isNew&&<><h3 className="v2-h2">{c.savePresentation}</h3><div className="v2-row-gap v2-bc-actions">
   <label>{c.order}<input type="number" min="0" value={pres.display_order} onChange={e=>setPres({...pres,display_order:e.target.value})}/></label>
   <label className="v2-bc-item"><input type="checkbox" checked={pres.recommended} onChange={e=>setPres({...pres,recommended:e.target.checked})}/>{c.recommended}</label>
   <label className="v2-bc-item"><input type="checkbox" checked={pres.visible} disabled={status!=='published'} onChange={e=>setPres({...pres,visible:e.target.checked})}/>{c.visible}</label>
   <button className="v2-btn v2-btn-secondary" disabled={cmd.busy||!/^\d+$/.test(pres.display_order)} onClick={()=>send({action:'presentation',display_order:Number(pres.display_order),recommended:pres.recommended,visible:pres.visible})}>{c.savePresentation}</button>
   <button className="v2-btn v2-btn-secondary" disabled={cmd.busy} onClick={()=>send({action:status==='archived'?'unarchive':'archive'})}>{status==='archived'?c.unarchive:c.archive}</button></div>
   <h3 className="v2-h2">{c.versions}</h3><ul className="v2-bc-versions">{versions.map(v=><li key={v.id}><strong>v{v.version}</strong> · {priceLabel(v.price_minor,v.currency,lang)}{v.price_annual_minor!=null&&' · '+priceLabel(v.price_annual_minor,v.currency,lang)+'/yr'} · {c.hours(v.trial_hours)} · {fmt(v.created_at,lang)}
    {' '}{v.id===head.current_version_id&&<Pill tone="good">{c.current}</Pill>}{v.id===head.draft_version_id&&<Pill tone="warn">{c.draft}</Pill>}{v.approval_status==='draft'&&v.id!==head.draft_version_id&&<span className="v2-muted v2-small"> {c.draft}</span>}</li>)}</ul></>}
 </Card>;
}

export default function PlansSection({token,c,lang}){
 const r=useLoad('/admin/billing/catalog',token),cmd=useCommand(token,c);
 const [code,setCode]=useState(''),[draftCode,setDraftCode]=useState(''),[creating,setCreating]=useState(false);
 const plans=useMemo(()=>r.data?[...r.data.plans].sort((a,b)=>a.display_order-b.display_order||a.plan.localeCompare(b.plan)):[],[r.data]);
 if(r.loading)return <Loading/>;if(r.error)return <ErrorBox error={r.error} onRetry={r.reload}/>;
 const versions=r.data.versions,cur=p=>versions.find(v=>v.id===p.current_version_id);
 const validCode=/^[a-z][a-z0-9_]{1,39}$/.test(draftCode)&&!plans.some(p=>p.plan===draftCode);
 return <><CommandStatus cmd={cmd} c={c} after={r.reload}/>
  <Card title={c.nav.plans} aside={<button className="v2-btn v2-btn-secondary" onClick={()=>{setCreating(true);setCode('')}}>{c.newPlan}</button>}>
   <div className="v2-tablewrap"><table className="v2-table"><thead><tr><th>{c.plan}</th><th>{c.statusCol}</th><th>{c.monthly}</th><th>{c.version}</th><th>{c.order}</th><th/></tr></thead>
    <tbody>{plans.map(p=>{const v=cur(p),st=planStatus(p,versions);return <tr key={p.plan} className={p.plan===code?'is-on':''}>
     <td>{label(v?.name_i18n,lang)||p.plan}<div className="v2-muted v2-small">{p.plan}{p.recommended&&' · ★ '+c.recommended}</div></td>
     <td><Pill tone={st==='published'?'good':st==='archived'?'neutral':'warn'}>{c.status[st]}</Pill>{st==='published'&&<div className="v2-muted v2-small">{p.commercial_available?c.visible:c.hidden}</div>}</td>
     <td className="v2-num">{v?priceLabel(v.price_minor,v.currency,lang):'—'}</td><td className="v2-num">v{v?.version??'—'}{p.draft_version_id&&' · '+c.draft}</td><td className="v2-num">{p.display_order}</td>
     <td><button className="v2-btn v2-btn-secondary" onClick={()=>{setCreating(false);setCode(p.plan)}}>{c.manage}</button></td></tr>})}</tbody></table></div>
   {creating&&<div className="v2-row-gap v2-bc-actions"><label>{c.code}<input value={draftCode} onChange={e=>setDraftCode(e.target.value.trim())} aria-describedby="bc-code-hint"/></label>
    <span id="bc-code-hint" className="v2-muted v2-small">{c.codeHint}</span><button className="v2-btn v2-btn-primary" disabled={!validCode} onClick={()=>{setCode(draftCode);setCreating(false)}}>{c.create}</button></div>}
  </Card>
  {code&&<Editor key={code} data={r.data} code={code} c={c} lang={lang} cmd={cmd} reload={r.reload} isNew={!plans.some(p=>p.plan===code)}/>}
 </>;
}
