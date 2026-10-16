// Shared pieces of the Billing Management Center. Reads and writes go through lib/actions only.
import {useCallback,useEffect,useRef,useState} from 'react'
import {billingRead,billingCommand} from '../../lib/actions'
import {Card,Pill} from '../../ui'

export function useLoad(path,token){
 const [state,setState]=useState({loading:true,data:null,error:null}),alive=useRef(true);
 const reload=useCallback(async()=>{try{const data=await billingRead(path,token);if(alive.current)setState({loading:false,data,error:null});return data}
  catch(error){if(alive.current)setState({loading:false,data:null,error});return null}},[path,token]);
 useEffect(()=>{alive.current=true;reload();return()=>{alive.current=false}},[reload]);
 return {...state,reload};
}

// One command at a time. An ambiguous outcome keeps the exact command (same request_key) for a safe retry:
// the server stores a receipt per key, so the retry returns the first result instead of applying twice.
export function useCommand(token,c){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[unknown,setUnknown]=useState(null),lock=useRef(false);
 const run=async(path,body,after)=>{
  if(lock.current)return null;lock.current=true;setBusy(true);setError('');
  try{const r=await billingCommand(path,token,body);setUnknown(null);await after?.(r);return r}
  catch(e){const code=e?.data?.error||e?.message||'';if(e?.data?.outcome==='unknown'){setUnknown({path,body});setError(c.unknown)}else{setUnknown(null);setError(code==='super_admin_required'&&c.superOnly?c.superOnly:code==='billing_terms_incomplete'&&c.incomplete?c.incomplete:c.error+(code?' · '+code:''))}return null}
  finally{lock.current=false;setBusy(false)}
 };
 const retry=after=>unknown&&run(unknown.path,unknown.body,after);
 return {busy,error,unknown,run,retry};
}

export function CommandStatus({cmd,c,after}){
 if(!cmd.error)return null;
 return <div role="alert" className="v2-inline-err v2-bc-alert">{cmd.error}{cmd.unknown&&<button className="v2-btn v2-btn-secondary" disabled={cmd.busy} onClick={()=>cmd.retry(after)}>{c.retry}</button>}</div>;
}

export const fmt=(x,lang)=>x?new Date(x).toLocaleString(lang,{dateStyle:'medium',timeStyle:'short'}):'—';
export const label=(o,lang)=>o?(o[lang]||o.en||''):'';
export const planTitle=(v,lang)=>v?`${label(v.name_i18n,lang)||v.plan} · v${v.version}`:'—';
export const newKey=()=>crypto.randomUUID();
export function enforcementPill(item,c){
 if(item.enforcement==='always')return <Pill tone="good">{c.available}</Pill>;
 if(item.module_status==='not_released')return <Pill tone="neutral">{c.notReleased}</Pill>;
 if(item.kind==='limit'&&!item.counter&&!item.required)return <Pill tone="warn">{c.noCounter}</Pill>;
 return item.enforcement==='server'?<Pill tone="good">{c.server}</Pill>:<Pill tone="warn">{c.notEnforced}</Pill>;
}
export const Loading=()=><Card><p className="v2-muted">…</p></Card>;
export const localInput=iso=>iso?new Date(new Date(iso)-new Date(iso).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
