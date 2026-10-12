import { financialActor } from '../../lib/financialRecovery.js'
function current(request) { if (!request.isCurrent()) throw Error('account_actor_changed') }
function key(request) { const actor=financialActor(request.token);if(!actor)throw Error('account_actor_changed');return `accountDraft:v1:${actor}` }
export function ownProfile(request,response) {
 current(request)
 if(!response||!Object.hasOwn(response,'profile'))throw Error('account_profile_invalid')
 const p=response.profile
 if(p!==null&&(!p||String(p.user_id)!==financialActor(request.token)))throw Error('account_profile_invalid')
 return p
}
export function profileMatches(profile,body) { return !!profile&&Object.entries(body).every(([k,v])=>profile[k]===v) }
export function accountBody(name,timezone) { return {display_name:String(name).trim().slice(0,80),timezone:String(timezone).trim().slice(0,64)} }
export function readAccountDraft(request) {
 current(request)
 try { const d=JSON.parse(localStorage.getItem(key(request))||'null');return d&&typeof d.display_name==='string'&&typeof d.timezone==='string'?{display_name:d.display_name.slice(0,80),timezone:d.timezone.slice(0,64),pending:d.pending===true}:null } catch { return null }
}
export function writeAccountDraft(request,draft) {
 current(request);const k=key(request),value=JSON.stringify({display_name:String(draft.display_name).slice(0,80),timezone:String(draft.timezone).slice(0,64),pending:draft.pending===true})
 localStorage.setItem(k,value);if(localStorage.getItem(k)!==value)throw Error('account_draft_unavailable')
}
export function clearAccountDraft(request) { current(request);localStorage.removeItem(key(request)) }
export async function confirmedAccountProfile(request,body,{write,read}) {
 current(request)
 const acknowledgement=ownProfile(request,await write(request.token,body))
 if(!profileMatches(acknowledgement,body))throw Error('account_save_unconfirmed')
 const profile=ownProfile(request,await read(request.token))
 if(!profileMatches(profile,body))throw Error('account_save_unconfirmed')
 return profile
}
