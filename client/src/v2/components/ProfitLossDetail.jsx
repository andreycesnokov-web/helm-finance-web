// Drill-down inside existing Performance; no replacement report page.
import {useEffect,useMemo,useRef,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {useLang} from '../i18n'
import {Pill,Btn,Skeleton,ErrorBox} from '../ui'
import {copy,exactMoney,difference,sourceLinks,metricDetail,downloadReport} from '../lib/profitLossView'
import Modal from './Modal'
import '../pages/profitLoss.css'
function Source({to,children,c}){return <Link to={to} target="_blank" rel="noopener noreferrer" title={c.newTab}>{children}<span className="v2-sr"> · {c.newTab}</span></Link>}
function Entries({entries,c,currency,exception=false}){
  const [limit,setLimit]=useState(50)
  return <><ol className="pnl-entries">
    {entries.slice(0,limit).map(e=><li key={e.key} className="pnl-entry">
      <header><strong>{e.date||c.unknown} · {e.counterparty||c.unknown}</strong><strong className="v2-num">{exactMoney(exception?e.native_amount:e.contribution,e.currency||currency)}</strong></header>
      <p className="pnl-description">{e.description||c.unknown}</p>
      {exception&&<Pill tone="warn">{c[e.reason]||e.reason}</Pill>}
      <dl className="pnl-record-fields">
        <div><dt>{c.categoryName}</dt><dd>{e.category||c.unknown}</dd></div>
        <div><dt>{c.account}</dt><dd>{e.account||c.unknown}</dd></div>
        <div><dt>{c.type}</dt><dd>{c[e.source_type]||e.source_type.replaceAll("_"," ")}</dd></div>
        <div><dt>{c.journal}</dt><dd>{c.unknown}</dd></div>
      </dl>
      <p className="v2-small v2-muted">{e.reconciliation_status==='statement_linked_not_reconciled'?c.linked:c.unverified}</p>
      {e.bank_review?.map((b,i)=><p key={i} className="v2-small">{c.bank}: {b.review_status||c.unknown} · {b.match_status||c.unknown}</p>)}
      <div className="pnl-links">{sourceLinks(e).map((s,i)=><Source key={i} to={s.href} c={c}>{c[s.kind]}{s.label?` · ${s.label}`:''}</Source>)}</div>
      <div className="pnl-documents"><strong>{c.documents}</strong>{e.documents?.length?<ul>{e.documents.map(d=><li key={d.id}><Source to={`/business/documents?doc=${encodeURIComponent(d.id)}`} c={c}>{d.number||d.type}</Source> · {c.review}: {c[d.review_status]||d.review_status||c.unknown}</li>)}</ul>:<p><Pill tone="warn">{c.missing}</Pill></p>}</div>
    </li>)}
  </ol>{!entries.length&&<p className="v2-muted">{c.noEntries}</p>}{limit<entries.length&&<Btn onClick={()=>setLimit(n=>n+50)}>{c.more} ({limit}/{entries.length})</Btn>}</>
}
export default function ProfitLossDetail({data,metric,month,onClose,onChange,onReload,loading,error}){
 const c=copy(useLang()),[sp,setSp]=useSearchParams(),body=useRef(null)
 const compare=sp.get('compare')||'',currency=sp.get('currency')||'IDR'
 const current=useMemo(()=>data?metricDetail(data,month,metric):null,[data,month,metric])
 const prior=useMemo(()=>compare&&data?metricDetail(data,compare,metric):null,[data,compare,metric])
 const expanded=new Set((sp.get('categories')||'').split(',').filter(Boolean))
 const toggle=id=>setSp(old=>{const n=new URLSearchParams(old),s=new Set((n.get('categories')||'').split(',').filter(Boolean));s.has(id)?s.delete(id):s.add(id);n.set('categories',[...s].join(','));return n})
 useEffect(()=>{
  const onKey=e=>{if(e.key!=='Tab')return;const dialog=body.current?.closest('[role="dialog"]'),nodes=[...(dialog?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')||[])].filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}};
  document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)
 },[])
 const exceptions=(data?.exceptions||[]).filter(e=>!e.date||[month,compare].includes(e.date.slice(0,7)))
 const excluded=(data?.excluded||[]).filter(e=>e.date&&[month,compare].includes(e.date.slice(0,7)))
 const groups=current?.groups.map(g=>({...g,categories:[...new Map([...(prior?.groups.find(x=>x.key===g.key)?.categories||[]).map(c=>({...c,total:'0',entries:[]})),...g.categories].map(c=>[c.id,c])).values()]}))||[]
 const cats=groups.flatMap(g=>g.categories.map(x=>x.id))
 return <Modal wide title={<>{c[metric]||metric} · <span className="pnl-month-label">{month}</span></>} onClose={onClose}><div ref={body} className="pnl-detail">
   <div className="pnl-controls">
    <div><label htmlFor="pnl-compare">{c.compare}</label><input id="pnl-compare" className="v2-input" type="month" value={compare} onChange={e=>onChange('compare',e.target.value)}/></div>
    {compare&&<Btn onClick={()=>onChange('compare','')}>{c.none}</Btn>}
    <div><label htmlFor="pnl-currency">{c.currency}</label><select id="pnl-currency" className="v2-select" value={currency} onChange={e=>onChange('currency',e.target.value)}>{[...new Set([currency,'IDR',...(data?.currencies||[])])].map(s=><option key={s}>{s}</option>)}</select></div>
   </div>
   <p className="v2-small v2-muted">{c.cash}. {c.note}</p>
   {loading?<Skeleton rows={6}/>:error?<ErrorBox error={error} onRetry={onReload}/>:current?<>
    <div className="pnl-summary"><strong className="v2-num" data-pnl-total>{exactMoney(current.total,currency)}</strong>{prior&&<span>{compare}: {exactMoney(prior.total,currency)} · {c.change}: {exactMoney(difference(current.total,prior.total),currency)}</span>}</div>
    {metric==='net_profit'?<p role="status">{c.netNote}</p>:<>
      <div className="pnl-toolbar"><Btn onClick={()=>onChange('categories',cats.join(','))}>{c.expand}</Btn><Btn onClick={()=>onChange('categories','')}>{c.collapse}</Btn><Btn onClick={()=>downloadReport(data)}>{c.export}</Btn></div>
      {groups.map(g=><section key={g.key} className="pnl-metric-group"><h3>{c[g.key]} · <span className="v2-num">{exactMoney(g.total,currency)}</span></h3>{!g.categories.length&&<p>{c.noEntries}</p>}{g.categories.map(cat=><section key={cat.id} className="pnl-category"><button type="button" className="pnl-category-toggle" aria-expanded={expanded.has(cat.id)} aria-controls={`pnl-cat-${cat.id}`} onClick={()=>toggle(cat.id)}><span>{expanded.has(cat.id)?'▾':'▸'} {cat.name} ({cat.entries.length})</span><strong className="v2-num">{exactMoney(cat.total,currency)}</strong></button>{expanded.has(cat.id)&&<div id={`pnl-cat-${cat.id}`}><p><strong>{month}</strong></p><Entries key={month+currency+cat.id} entries={cat.entries} c={c} currency={currency}/>{prior&&<details><summary>{compare}</summary><Entries entries={prior.groups.find(x=>x.key===g.key)?.categories.find(x=>x.id===cat.id)?.entries||[]} c={c} currency={currency}/></details>}</div>}</section>)}</section>)}
    </>}
    <p className="v2-small">{c.coverage}: {data.coverage.included} {c.included} · {data.coverage.missing_documents} {c.missingCount} · {data.coverage.exceptions} {c.reviewCount}</p>
    <details><summary>{c.exceptions} ({exceptions.length})</summary><Entries key={month+currency+'exception'} entries={exceptions} c={c} currency={currency} exception/></details>
    <details><summary>{c.excluded} ({excluded.length})</summary><Entries key={month+currency+'excluded'} entries={excluded} c={c} currency={currency} exception/></details>
    <p className="v2-small v2-muted">{c.observed}: {data.read_started_at||'—'} → {data.read_finished_at||'—'}. {c.notSnapshot}</p>
   </>:null}
  </div></Modal>
}
