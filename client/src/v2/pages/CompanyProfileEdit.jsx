// Version-bound Business profile editor. Save and confirmation use one atomic
// profile/audit RPC with scoped durable request recovery; document suggestions
// remain unconfirmed until explicitly saved and checked. No automatic AI read.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBusinessRequest } from '../lib/useBusinessRequest'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { saveTaxProfile, verifyTaxProfile, readProfileFromDocuments,readProfileRequest } from '../lib/actions'
import {performProfileOperation,recoverProfileOperation,resumeProfileOperation,profilePending,profileCurrent,readProfileDraft,saveProfileDraft,clearProfileDraft,unconfirmedProfileFields} from '../lib/profileOperation'
import {financialActor} from '../../lib/financialRecovery'
import AccountantTabs from '../components/AccountantTabs'

// A stored value (English code) shown in the app language when a label exists.
export const optLabel = (t, field, v) => { const k = `pe.o.${field}.${v}`; const x = t(k); return x !== k ? x : v }
const LEGAL = ['PT Local', 'PT PMA', 'CV', 'Yayasan', 'Individual / Freelancer', 'Representative Office / Branch', 'Other']
const REGIMES = ['normal', 'pp23_final', 'pph_final_umkm']
// Field → section and input kind. `ext` requires the additive profile schema.
export const SECTIONS = [
  { key: 'company', fields: [
    { k: 'company_legal_name', ext: true },{k:'brand_name',ext:true}, { k: 'legal_entity_type', opts: LEGAL }, { k: 'foreign_owned', ext: true, opts: ['no', 'yes'] },
    { k: 'country', opts: ['Indonesia', 'Singapore', 'Malaysia','Thailand','Other'] }, { k: 'jurisdiction' } ] },
  { key: 'tax', fields: [
    { k: 'npwp',idOnly:true }, { k: 'kpp', ext: true,idOnly:true }, { k: 'pkp_status',idOnly:true, opts: ['non_pkp', 'pkp_registered', 'unknown'] },
    {k:'tax_identifier',nonIDOnly:true},{k:'vat_status',nonIDOnly:true},
    { k: 'pkp_effective_date', ext: true, type: 'date', when: (f) => f.pkp_status === 'pkp_registered' },
    { k: 'tax_regime', opts: REGIMES }, { k: 'financial_year_start', type: 'date' }, { k: 'financial_year_end', type: 'date' } ] },
  { key: 'licence', fields: [
    { k: 'nib',idOnly:true }, { k: 'nib_issue_date',idOnly:true, ext: true, type: 'date' }, { k: 'primary_kbli',idOnly:true, ext: true }, { k: 'additional_kbli',idOnly:true, ext: true, list: true },
    { k: 'actual_business_activities', ext: true, wide: true } ] },
  { key: 'people', fields: [
    { k: 'employee_status', opts: ['has_employees', 'no_employees'] }, { k: 'employee_count', ext: true, type: 'number' },
    {k:'local_employee_count',ext:true,type:'number'},{k:'foreign_employee_count',ext:true,type:'number'},
    { k: 'bpjs_registered',idOnly:true, ext: true, opts: ['true', 'false'] }, { k: 'payroll_frequency', ext: true, opts: ['Monthly', 'Bi-weekly', 'Weekly'] },{k:'transaction_types',ext:true,list:true} ] },
]
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields)
const asInput = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'true' : v === false ? 'false' : v == null ? '' : String(v))
const dateIn = (v) => { const s = String(v || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '' }

/** The body PUT /api/accountant/profile receives. vat_status follows pkp_status (it is the older
 *  copy of the same fact; a Non-PKP company must not keep a stale "pkp"). */
export function profileBody(form, verification, before) {
  const body = {}
  for (const f of ALL_FIELDS) {
    if (form[f.k] === undefined) continue
    const previous = f.type === 'date' ? dateIn(before?.[f.k]) : asInput(before?.[f.k])
    if (before && asInput(form[f.k]) === previous) continue
    body[f.k] = f.list ? String(form[f.k] || '').split(/[,;\s]+/).filter(Boolean) : form[f.k]
  }
  if ('pkp_status' in body && form.pkp_status === 'pkp_registered') body.vat_status = 'pkp'
  else if ('pkp_status' in body && form.pkp_status === 'non_pkp') body.vat_status = null
  if (verification && Object.keys(verification).length) body.field_verification = verification
  return body
}

export default function CompanyProfileEdit() {
  const t = useT()
  const nav = useNavigate()
  const request = useBusinessRequest()
  const invalidate = useInvalidate()
  const prof = useApi('/accountant/profile')
  const company=useApi('/business/current')
  const [form, setForm] = useState(null)
  const [savedProfile, setSavedProfile] = useState(null)
  const [verification, setVerification] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)       // { tone, text }
  const [ai, setAi] = useState({ state: 'idle' })
  const [picked, setPicked] = useState({})
  const saving=useRef(false),draftUnreadable=useRef(false),[draftError,setDraftError]=useState(false),[recovering,setRecovering]=useState(false)
  const actor=financialActor(request.token)
  const formContext=useRef(''),namespace=`${actor}/${request.businessId}`
  useEffect(()=>{formContext.current='';draftUnreadable.current=false;setDraftError(false);setForm(null);setSavedProfile(null);setVerification({});setAi({state:'idle'});setPicked({});setMsg(null);setBusy(false);saving.current=false},[request.businessId,actor])

  useEffect(() => {
    if (!prof.data || form||prof.loading||company.loading||company.error||!profileCurrent(request)) return
    const p = prof.data.profile || {}
    const business=company.data?.business||company.data
    if(business?.id!==request.businessId||p.business_id&&p.business_id!==request.businessId)return
    let draft
    try{draft=readProfileDraft(request)}catch{draftUnreadable.current=true;setDraftError(true)}
    const f = {}
    for (const x of ALL_FIELDS) f[x.k] = x.type === 'date' ? dateIn(draft?.form?.[x.k]??p[x.k]) : asInput(draft?.form?.[x.k]??p[x.k])
    if (!prof.data.profile) {const country=company.data?.business?.country||company.data?.country||'';f.country=country;f.jurisdiction={Indonesia:'ID',Singapore:'SG',Malaysia:'MY',Thailand:'TH'}[country]||''}
    setSavedProfile(draft?draft.before:prof.data.profile);setVerification(draft?.verification||{})
    formContext.current=namespace
    setForm(f)
  }, [prof.data,company.data,company.loading,company.error,form,request])
  useEffect(()=>{if(!form||draftUnreadable.current||formContext.current!==namespace||!profileCurrent(request))return;try{if(Object.keys(profileBody(form,verification,savedProfile)).length)saveProfileDraft(request,{form,before:savedProfile,verification});else clearProfileDraft(request);setDraftError(false)}catch{setDraftError(true)}},[form,savedProfile,verification,request,namespace])

  const readDocs = async (force = false) => {
    setAi({ state: 'loading' })
    try {
      const r = await readProfileFromDocuments(request, { force })
      if(!profileCurrent(request))return
      setAi({ state: 'ready', data: r })
      const pre = {}
      for (const s of r.suggestions || []) pre[s.field] = !s.same_as_current && !s.conflict && (s.current == null || s.current === '' || (Array.isArray(s.current) && !s.current.length))
      setPicked(pre)
    } catch (e) { if(profileCurrent(request))setAi({ state: 'error', error: e?.status === 403 ? t('dec.forbidden') : (e?.data?.error || e?.message) }) }
  }

  const ext = prof.data?.extended_fields === true
  const supported = prof.data?.supported_extended_fields
  const canEdit = prof.data?.can_edit !== false
  const isID=(company.data?.business?.country||form?.country)==='Indonesia'
  const actualCountry=company.data?.business?.country,actualJurisdiction={Indonesia:'ID',Singapore:'SG',Malaysia:'MY',Thailand:'TH'}[actualCountry]
  const countryConflict=!!actualCountry&&(form?.country!==actualCountry||!!actualJurisdiction&&form?.jurisdiction!==actualJurisdiction)
  const set = (k, v) => {if(formContext.current!==namespace||!profileCurrent(request))return; setForm((f) => ({ ...f, [k]: v })); setVerification((m) => ({ ...m, [k]: v===''?'missing':'user_declared' })) }
  const applyPicked = () => {
    if(formContext.current!==namespace||!profileCurrent(request))return
    const sug = ai.data?.suggestions || []
    const next = { ...form }; const ver = { ...verification }
    for (const s of sug) {
      if (!picked[s.field]) continue
      const def = ALL_FIELDS.find((x) => x.k === s.field)
      next[s.field] = def?.type === 'date' ? dateIn(s.value) : asInput(s.value)
      ver[s.field] = { state: 'extracted', document_id: s.sources?.[0]?.document_id }
    }
    setForm(next); setVerification(ver)
    setMsg({ tone: 'info', text: t('pe.applied') })
  }
  const save = async () => {
    if (saving.current||draftError||!ext||formContext.current!==namespace||!form || prof.loading || prof.error || !canEdit || !profileCurrent(request)) return
    saving.current=true
    setBusy(true); setMsg(null)
    try {
      const body = profileBody(form, verification, savedProfile)
      if(Object.keys(body).length===0){setMsg({tone:'info',text:t('pe.noChanges')});return}
      const r = await performProfileOperation(request,'save',body,savedProfile?.profile_version??0,{send:saveTaxProfile,read:readProfileRequest})
      if(!profileCurrent(request))return
      if (!r?.profile) throw new Error(t('pe.notConfirmed'))
      const notSaved = unconfirmedProfileFields(body, r?.profile, r)
      if(r.historical){setMsg({tone:'warn',text:t('pe.historical')});return}
      if(notSaved.length){setSavedProfile(r.current_profile||r.profile);setMsg({tone:'warn',text:t('pe.savedPartly',{f:notSaved.map(k=>t(`pe.f.${k}`)).join(', ')})});return}
      if (r?.profile){const p=r.current_profile||r.profile;setSavedProfile(p);setVerification({});setForm(Object.fromEntries(ALL_FIELDS.map(f=>[f.k,f.type==='date'?dateIn(p[f.k]):asInput(p[f.k])])))}
      invalidate()
      setMsg(notSaved.length
        ? { tone: 'warn', text: t('pe.savedPartly', { f: notSaved.map((k) => t(`pe.f.${k}`)).join(', ') }) }
        : { tone: 'good', text: t('pe.saved', { n: r?.completeness?.percent ?? '—' }) })
    } catch (e) {
      if(!profileCurrent(request))return
      setMsg({ tone: 'warn', text: e?.data?.error==='profile_version_conflict'?t('pe.historical'):e?.status === 422 ? t('pe.incomplete', { f: (e?.data?.missing || e?.data?.fields || []).map((k) => t(`pe.f.${k}`)).join(', ') || e?.data?.message || e?.data?.error }) : e?.status === 403 ? t('pe.forbidden') : t('pe.failed', { msg: e?.data?.message || e?.data?.error || e?.message }) })
    } finally { if(profileCurrent(request)){setBusy(false);saving.current=false} }
  }
  const verify = async () => {
    if (saving.current||draftError||!ext||formContext.current!==namespace||!form || prof.loading || prof.error || !canEdit || !profileCurrent(request)) return
    if(Object.keys(profileBody(form,verification,savedProfile)).length){setMsg({tone:'warn',text:t('pe.saveBeforeVerify')});return}
    saving.current=true
    setBusy(true); setMsg(null)
    try {const r=await performProfileOperation(request,'verify',{},savedProfile?.profile_version,{send:verifyTaxProfile,read:readProfileRequest});if(!profileCurrent(request))return;if(r.historical){setMsg({tone:'warn',text:t('pe.historical')});return}setSavedProfile(r.profile);invalidate();setMsg({tone:'good',text:t('pe.verified')})}
    catch (e) { if(profileCurrent(request))setMsg({ tone: 'warn', text: e?.status === 422 ? t('pe.incomplete', { f: (e?.data?.missing || []).map((k) => t(`pe.f.${k}`)).join(', ') }) : e?.status === 403 ? t('pe.forbidden') : t('pe.failed', { msg: e?.data?.error || e?.message }) }) }
    finally { if(profileCurrent(request)){setBusy(false);saving.current=false} }
  }
  const recover=async()=>{if(recovering||!profileCurrent(request))return;setRecovering(true);try{let latest=null,unknown=false;for(const op of ['save','verify']){const r=await recoverProfileOperation(request,op,{read:readProfileRequest});if(!profileCurrent(request))return;if(r?.state==='unknown')unknown=true;if(r?.ok&&!r.historical)latest=r}if(latest){const p=latest.current_profile||latest.profile;setSavedProfile(p);setVerification({});setForm(Object.fromEntries(ALL_FIELDS.map(f=>[f.k,f.type==='date'?dateIn(p[f.k]):asInput(p[f.k])])));invalidate()}setMsg({tone:unknown||!latest?'warn':'good',text:t(unknown?'pe.pending':latest?'pe.recovered':'pe.historical')})}catch{if(profileCurrent(request))setMsg({tone:'warn',text:t('pe.pending')})}finally{if(profileCurrent(request))setRecovering(false)}}
  const reloadCurrent=()=>{if(busy||!profileCurrent(request))return;try{clearProfileDraft(request);draftUnreadable.current=false;setDraftError(false);setForm(null);setVerification({});setSavedProfile(null);prof.reload();setMsg({tone:'info',text:t('pe.reloaded')})}catch{setDraftError(true)}}
  const resume=async operation=>{if(saving.current||!canEdit||!profileCurrent(request))return;saving.current=true;setBusy(true);try{const r=await resumeProfileOperation(request,operation,{send:operation==='save'?saveTaxProfile:verifyTaxProfile,read:readProfileRequest});if(!profileCurrent(request))return;setMsg({tone:r.historical?'warn':'good',text:t(r.historical?'pe.historical':'pe.recovered')});invalidate()}catch(e){if(profileCurrent(request))setMsg({tone:'warn',text:e?.data?.error==='profile_version_conflict'?t('pe.historical'):t('pe.failed',{msg:e?.data?.error||e.message})})}finally{if(profileCurrent(request)){setBusy(false);saving.current=false}}}

  const sug = useMemo(() => (ai.data?.suggestions || []).filter((s) => !s.same_as_current), [ai.data])
  const head = <PageHead title={t('pe.title')} sub={t('pe.sub')} back={{ to: '/business/accountant/tax-profile', label: t('screen.companyProfile') }} />
  if (prof.error||company.error) return <div className="v2-page">{head}<ErrorBox error={prof.error?.status === 403 ? t('dec.forbidden') : prof.error||company.error} onRetry={()=>{prof.reload();company.reload()}} /></div>
  if (prof.loading||company.loading || !form||formContext.current!==namespace) return <div className="v2-page">{head}<AccountantTabs active="profile" /><Card><Skeleton rows={8} /></Card></div>

  return (
    <div className="v2-page">
      {head}
      <AccountantTabs active="profile" />
      <div className="v2-grid-detail">
        <div className="v2-col">
          {!ext && <div className="v2-banner v2-tone-warn"><I.info size={18} /><span className="v2-banner-text">{t('pe.no040')}</span></div>}
          {draftError&&<div className="v2-banner v2-tone-warn" role="alert">{t('pe.draftUnavailable')}</div>}
          {countryConflict&&<div className="v2-banner v2-tone-warn" role="alert">{t('pe.countryMismatch')} <button type="button" className="v2-btn-link" disabled={busy||!canEdit||!actualJurisdiction} onClick={()=>{set('country',actualCountry);set('jurisdiction',actualJurisdiction)}}>{t('pe.useCompanyCountry')}</button></div>}
          {msg && <div className={`v2-banner v2-tone-${msg.tone}`} role="status"><span className="v2-banner-text">{msg.text}</span></div>}
          {SECTIONS.map((s) => (
            <Card key={s.key} title={t(`pe.s.${s.key}`)}>
              <div className="v2-field-row">
                {s.fields.filter((f) => (!f.when || f.when(form))&&(!f.idOnly||isID)&&(!f.nonIDOnly||!isID)).map((f) => {
                  const off = f.ext && (supported ? !supported.includes(f.k) : !ext)
                  const v = verification[f.k]
                  return (
                    <label key={f.k} className={`v2-field${f.wide ? ' v2-field-wide' : ''}`}>
                      <span className="v2-field-label">{t(`pe.f.${f.k}`)}{off && <span className="v2-muted"> · {t('pe.notSavedYet')}</span>}
                        {(v?.state || v) === 'extracted' && <Pill tone="info">{t('pe.fromDoc')}</Pill>}</span>
                      {f.opts&&(isID||!['legal_entity_type','tax_regime'].includes(f.k)) ? (
                        <select className="v2-select" value={form[f.k] || ''} disabled={busy || !canEdit||f.k==='country'} onChange={(e) => set(f.k, e.target.value)}>
                          <option value="">{t('pe.choose')}</option>
                          {f.opts.map((o) => <option key={o} value={o}>{optLabel(t, f.k, o)}</option>)}
                        </select>
                      ) : (
                        <input className="v2-input" type={f.type || 'text'} min={f.type==='number'?0:undefined} step={f.type==='number'?1:undefined} value={form[f.k] || ''} disabled={busy || !canEdit}
                          placeholder={f.k === 'additional_kbli' ? '47999, 62090' : f.k === 'npwp' ? '00.000.000.0-000.000' : ''}
                          onChange={(e) => set(f.k, e.target.value)} />
                      )}
                    </label>
                  )
                })}
              </div>
            </Card>
          ))}
          <div className="v2-row-gap v2-pe-actions">
            <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !canEdit||!ext||draftError||countryConflict} onClick={save}>{busy ? t('pe.saving') : t('pe.save')}</button>
            <button type="button" className="v2-btn v2-btn-secondary" disabled={busy || !canEdit||!ext||draftError||countryConflict} onClick={verify}>{t('pe.verify')}</button>
            <button type="button" className="v2-btn v2-btn-secondary" disabled={busy||recovering} onClick={recover}>{t('pe.checkResult')}</button>
            {profilePending(request,'save')&&<button type="button" className="v2-btn v2-btn-ghost" disabled={busy||!canEdit} onClick={()=>resume('save')}>{t('pe.retryOriginalSave')}</button>}
            {profilePending(request,'verify')&&<button type="button" className="v2-btn v2-btn-ghost" disabled={busy||!canEdit} onClick={()=>resume('verify')}>{t('pe.retryOriginalVerify')}</button>}
            <button type="button" className="v2-btn v2-btn-ghost" disabled={busy} onClick={reloadCurrent}>{t('pe.loadLatest')}</button>
            <button type="button" className="v2-btn v2-btn-ghost" onClick={() => nav('/business/accountant/tax-profile')}>{t('pe.back')}</button>
          </div>
          <p className="v2-muted v2-small">{t('pe.note')}</p>
        </div>

        <aside className="v2-col">
          <Card title={t('pe.ai.title')} aside={<button type="button" className="v2-btn-link v2-small" disabled={ai.state==='loading'} onClick={() => readDocs(false)}>{t('pe.ai.again')}</button>}>
            {ai.state === 'loading' && <><Skeleton rows={4} /><span className="v2-muted v2-small">{t('pe.ai.reading')}</span></>}
            {ai.state === 'error' && <p className="v2-inline-err" role="alert">{t('pe.ai.failed', { msg: ai.error })}</p>}
            {ai.state === 'ready' && (
              <>
                <p className="v2-muted v2-small">{t('pe.ai.read', { n: (ai.data.documents || []).length })}</p>
                {sug.length === 0 ? <p className="v2-sec">{t('pe.ai.nothing')}</p> : (
                  <ul className="v2-pe-sug" data-profile-suggestions>
                    {sug.map((s) => (
                      <li key={s.field}>
                        <label className="v2-pe-sug-row">
                          <input type="checkbox" checked={!!picked[s.field]} onChange={(e) => setPicked((p) => ({ ...p, [s.field]: e.target.checked }))} />
                          <span>
                            <strong>{t(`pe.f.${s.field}`)}</strong>: {optLabel(t, s.field, asInput(s.value))}
                            {s.current != null && s.current !== '' && <span className="v2-muted v2-small"> · {t('pe.ai.now', { v: optLabel(t, s.field, asInput(s.current)) })}</span>}
                            <span className="v2-muted v2-small v2-block">{s.sources.map((x) => `${x.file_name} (${t(x.printed ? 'pe.ai.printed' : 'pe.ai.image')})`).join(' · ')}</span>
                            {s.conflict && <span className="v2-inline-err v2-small v2-block">{t('pe.ai.conflict', { v: s.values.map((x) => optLabel(t, s.field, asInput(x))).join(' / ') })}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {(ai.data.kbli_titles || []).length > 0 && (
                  <p className="v2-small">{t('pe.ai.kbli')} {ai.data.kbli_titles.map((k) => `${k.code} — ${k.title}`).join('; ')}</p>
                )}
                {sug.length > 0 && <button type="button" className="v2-btn v2-btn-primary" onClick={applyPicked}>{t('pe.ai.apply')}</button>}
                {(ai.data.missing_document_types || []).filter((x) => ['npwp', 'nib', 'akta'].includes(x)).length > 0 && (
                  <p className="v2-small">{t('pe.ai.upload', { d: ai.data.missing_document_types.filter((x) => ['npwp', 'nib', 'akta', 'pkp_certificate'].includes(x)).map((x) => t(`docs.vault.${x}`)).join(', ') })} <Link to="/business/documents?tab=company">{t('pe.ai.uploadLink')}</Link></p>
                )}
                {(ai.data.skipped || []).length > 0 && <p className="v2-muted v2-small">{t('pe.ai.skipped', { n: ai.data.skipped.length })}</p>}
                <p className="v2-muted v2-small">{t('pe.ai.note')}</p>
              </>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
