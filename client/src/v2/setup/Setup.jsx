// Company setup — designs reg/R4 (about), R5 (documents), R6 (check what AI read), R7 (your taxes),
// errors from R10. /business/new creates the company (the creator becomes its owner); the next
// steps run inside it at /business/setup/{docs,review,taxes}. Leaving at any step is safe: the
// company and its documents are kept, and the steps can be reopened from "First day".
//
// Engines, not guesses:
//   · documents are typed by the server's text classifier on upload; scans and photos are
//     explained by the AI (POST /api/documents/:id/identify) and the proposed company type is
//     confirmed by the user's upload in this step (PATCH …/classification);
//   · the profile is read from the documents (POST /api/accountant/profile/from-documents) — numbers
//     kept only when printed in the document text; nothing is saved until "All correct";
//   · the taxes are the tax calendar (GET /api/accountant/tax-calendar, general PMK 81/2024 deadlines).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { Pill, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { V2DataProvider, useApi, useInvalidate } from '../data'
import { LangSwitch } from '../auth/AuthApp'
import { TaxList, ruleTitle } from '../pages/Accountant'
import { optLabel } from '../pages/CompanyProfileEdit'
import { shortDate } from '../lib/format'
import {
  createCompany, saveTaxProfile, uploadCompanyDocument, identifyDocument, confirmDocumentKind, readProfileFromDocuments,
} from '../lib/actions'

const SYMBOL = '/brand/symbol_navy_transparent.svg'
const STEPS = ['about', 'docs', 'review', 'taxes']
const COMPANY_TYPES = ['nib', 'npwp', 'akta', 'sk_kemenkumham', 'oss_license', 'pkp_certificate', 'kpp_registration', 'bpjs_document']
// Slots shown on R5 — a slot is ticked when a document of one of its types is in the company.
const SLOTS = [
  { key: 'nib', types: ['nib', 'oss_license'], must: true },
  { key: 'npwp', types: ['npwp', 'kpp_registration'], must: true },
  { key: 'akta', types: ['akta', 'sk_kemenkumham'] },
  { key: 'pkp', types: ['pkp_certificate'] },
  { key: 'bpjs', types: ['bpjs_document'] },
]
const FORMS = [
  { v: 'pt_pma', legal: 'PT PMA' }, { v: 'pt', legal: 'PT Local' }, { v: 'cv', legal: 'CV' },
  { v: 'yayasan', legal: 'Yayasan' }, { v: 'other', legal: null },
]
const ACTIVITY_KEY = (id) => `hf_setup_activity_${id}`
const detectTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta' } catch { return 'Asia/Jakarta' } }
const typeOf = (doc) => doc?.extracted_json?.ai_intake?.doc_type || null

/* ── frame: brand, company, save & exit, steps ───────────────────────────── */
export function SetupFrame() {
  return <V2DataProvider><SetupChrome /></V2DataProvider>
}
function SetupChrome() {
  const t = useT()
  const { step } = useParams()
  const { active } = useWorkspace()
  const cur = step ? STEPS.indexOf(step) : 0
  const company = active?.type === 'business' && step ? active.name : null
  return (
    <div className="v2-root v2-auth v2-setup-root">
      <header className="v2-auth-top">
        <span className="v2-auth-brand"><img src={SYMBOL} alt="" aria-hidden="true" width="32" height="32" />
          <span className="v2-brand-name">{t('shell.brand')}{company ? ` · ${company}` : ''}</span></span>
        <div className="v2-auth-top-right"><Link to={step ? '/business/onboarding' : '/account'} className="v2-btn v2-btn-ghost">{t('setup.saveExit')}</Link><LangSwitch /></div>
      </header>
      <main className="v2-auth-main is-wide" id="v2-main">
        <ol className="v2-setup-steps" aria-label={t('setup.stepsLabel')}>
          {STEPS.map((s, i) => (
            <li key={s} className={i < cur ? 'is-done' : i === cur ? 'is-now' : ''} aria-current={i === cur ? 'step' : undefined}>
              <span className="v2-setup-n" aria-hidden="true">{i < cur ? <I.check size={14} /> : i + 1}</span>{t(`setup.step.${s}`)}
            </li>
          ))}
        </ol>
        <Outlet />
      </main>
    </div>
  )
}

/* ── R4: about the company → creates it ──────────────────────────────────── */
export function SetupAbout() {
  const t = useT()
  const nav = useNavigate()
  const { token } = useAuth()
  const { applyActive, refresh } = useWorkspace()
  const [f, setF] = useState({ name: '', form: '', base_currency: 'IDR', country: 'Indonesia', timezone: detectTimezone(), activity: '' })
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: null, form_: null })) }
  const submit = async (e) => {
    e.preventDefault()
    if (!f.name.trim()) { setErr({ name: t('setup.about.nameErr') }); return }
    setBusy(true)
    try {
      const { business } = await createCompany(token, { name: f.name.trim(), base_currency: f.base_currency, country: f.country, timezone: f.timezone, business_type: f.form || 'other' })
      applyActive({ id: business.id, name: business.name, type: 'business', role: 'owner', business_code: business.business_code })
      try { sessionStorage.setItem(ACTIVITY_KEY(business.id), f.activity || 'unknown') } catch { /* private mode */ }
      const legal = FORMS.find((x) => x.v === f.form)?.legal
      // The first profile rows: country and, when the owner knows it, the legal form. The rest is read from the documents.
      try { await saveTaxProfile(token, { jurisdiction: 'ID', country: f.country, ...(legal ? { legal_entity_type: legal } : {}) }) } catch { /* the profile step asks again */ }
      refresh()
      nav('/business/setup/docs')
    } catch (x) {
      setErr({ form_: x?.status === 403 || x?.status === 402 ? t('setup.about.limit') : t('setup.err', { msg: x?.data?.error || x?.message }) })
    } finally { setBusy(false) }
  }
  return (
    <form className="v2-setup-card" onSubmit={submit} noValidate>
      <h1 className="v2-auth-h1">{t('setup.about.title')}</h1>
      <p className="v2-auth-p">{t('setup.about.p')}</p>
      <label className="v2-field"><span className="v2-field-label">{t('setup.about.name')} *</span>
        <input className="v2-input" value={f.name} autoFocus maxLength={120} aria-invalid={!!err.name} onChange={(e) => set('name', e.target.value)} />
        {err.name ? <span className="v2-inline-err" role="alert">{err.name}</span> : <span className="v2-muted v2-small">{t('setup.about.nameHint')}</span>}
      </label>
      <fieldset className="v2-fieldset"><legend className="v2-field-label">{t('setup.about.form')}</legend>
        <div className="v2-setup-chips">
          {FORMS.map((x) => <button key={x.v} type="button" className="v2-chip" aria-pressed={f.form === x.v} onClick={() => set('form', x.v)}>{t(`setup.about.forms.${x.v}`)}</button>)}
        </div>
        <span className="v2-muted v2-small">{t('setup.about.formHint')}</span>
      </fieldset>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('setup.about.country')}</span>
          <select className="v2-select" value={f.country} onChange={(e) => set('country', e.target.value)}>
            {['Indonesia', 'Singapore', 'Malaysia', 'Thailand', 'Other'].map((c) => <option key={c} value={c}>{t(`setup.about.countries.${c}`)}</option>)}
          </select></label>
        <label className="v2-field"><span className="v2-field-label">{t('setup.about.currency')}</span>
          <select className="v2-select" value={f.base_currency} onChange={(e) => set('base_currency', e.target.value)}>
            {['IDR', 'USD', 'SGD', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="v2-field"><span className="v2-field-label">{t('setup.about.tz')}</span>
          <input className="v2-input" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></label>
      </div>
      <fieldset className="v2-fieldset"><legend className="v2-field-label">{t('setup.about.activity')}</legend>
        <div className="v2-setup-chips">
          {['active', 'dormant', 'starting'].map((a) => <button key={a} type="button" className="v2-chip" aria-pressed={f.activity === a} onClick={() => set('activity', a)}>{t(`setup.about.act.${a}`)}</button>)}
        </div>
        <span className="v2-muted v2-small">{t('setup.about.activityHint')}</span>
      </fieldset>
      <div className="v2-banner v2-tone-info"><I.info size={18} /><span className="v2-banner-text">{t('setup.about.separate')}</span></div>
      {err.form_ && <p className="v2-inline-err" role="alert">{err.form_}</p>}
      <div className="v2-setup-actions">
        <Link to="/account" className="v2-btn v2-btn-secondary">{t('setup.back')}</Link>
        <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>{busy ? t('setup.creating') : t('setup.about.create')}</button>
      </div>
      <p className="v2-muted v2-small">{t('setup.about.owner')}</p>
    </form>
  )
}

/* ── R5: company documents ───────────────────────────────────────────────── */
function SetupDocs() {
  const t = useT()
  const lang = useLang()
  const nav = useNavigate()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const docs = useApi('/documents?limit=200')
  const [items, setItems] = useState([])        // { key, name, state, type, label, title, note, docId }
  const [drag, setDrag] = useState(false)
  const input = useRef(null)
  const patch = (key, p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const have = useMemo(() => {
    const s = new Set((docs.data?.documents || []).filter((d) => !d.archived_at).map(typeOf).filter(Boolean))
    for (const x of items) if (x.state === 'read' && x.type) s.add(x.type)
    return s
  }, [docs.data, items])

  const handle = async (file, key) => {
    patch(key, { state: 'uploading' })
    let doc
    try {
      const r = await uploadCompanyDocument(token, file)
      doc = r.document
    } catch (x) {
      if (x?.status === 409 && x?.data?.duplicate) { patch(key, { state: 'duplicate' }); return }
      patch(key, { state: 'failed', note: x?.status === 403 ? t('setup.docs.noAccess') : (x?.data?.error || x?.message) }); return
    }
    patch(key, { state: 'reading', docId: doc.id })
    const det = typeOf(doc)
    let ident = null
    try { ident = (await identifyDocument(token, doc.id, { lang }))?.identify || null } catch { /* AI unavailable → classifier only */ }
    const ai = ident?.suggested_type || null
    const type = COMPANY_TYPES.includes(det) ? det : COMPANY_TYPES.includes(ai) ? ai : null
    if (type && type !== det) { try { await confirmDocumentKind(token, doc.id, type) } catch { /* shown as read; the profile step reads confirmed types only */ } }
    invalidate()
    if (type) patch(key, { state: 'read', type, title: ident?.title || '', note: ident?.summary || '' })
    else if (ai || (det && det !== 'unknown')) patch(key, { state: 'other', type: ai || det, label: ident?.suggested_label || '', title: ident?.title || '' })
    else patch(key, { state: 'unreadable' })
  }
  const add = (files) => {
    const list = [...files].slice(0, 12)
    const fresh = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: 'queued' }))
    setItems((xs) => [...fresh, ...xs])
    // One at a time: each upload is identified before the next, so the list fills in order.
    ;(async () => { for (let i = 0; i < list.length; i++) await handle(list[i], fresh[i].key) })()
  }
  const busy = items.some((x) => ['queued', 'uploading', 'reading'].includes(x.state))

  return (
    <div className="v2-setup-card">
      <h1 className="v2-auth-h1">{t('setup.docs.title')}</h1>
      <p className="v2-auth-p">{t('setup.docs.p')}</p>
      <div className={`v2-setup-drop${drag ? ' is-over' : ''}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) add(e.dataTransfer.files) }}>
        <I.upload size={26} /><strong>{t('setup.docs.drop')}</strong><span className="v2-muted v2-small">{t('setup.docs.dropHint')}</span>
        <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" hidden data-setup-file
          onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = '' }} />
      </div>
      {items.length > 0 && (
        <ul className="v2-setup-files" aria-live="polite">
          {items.map((x) => (
            <li key={x.key} className={`is-${x.state}`} data-setup-item={x.state}>
              <span className="v2-setup-fic" aria-hidden="true">{x.state === 'read' ? <I.check size={16} /> : x.state === 'unreadable' || x.state === 'failed' ? <I.close size={16} /> : x.state === 'other' || x.state === 'duplicate' ? <I.warn size={16} /> : <I.clock size={16} />}</span>
              <span className="v2-setup-ftext">
                <strong>{x.state === 'read' ? t(`docs.vault.${x.type}`) : x.name}</strong>
                <span className="v2-muted v2-small">
                  {x.state === 'read' && <>{x.name}{x.title ? ` · ${x.title}` : ''}</>}
                  {x.state === 'queued' && t('setup.docs.st.queued')}
                  {x.state === 'uploading' && t('setup.docs.st.uploading')}
                  {x.state === 'reading' && t('setup.docs.st.reading')}
                  {x.state === 'other' && t('setup.docs.st.other', { what: x.label || x.title || x.type })}
                  {x.state === 'unreadable' && t('setup.docs.st.unreadable')}
                  {x.state === 'duplicate' && t('setup.docs.st.duplicate')}
                  {x.state === 'failed' && t('setup.docs.st.failed', { msg: x.note || '' })}
                </span>
                {x.state === 'read' && x.note && <span className="v2-small">{x.note}</span>}
              </span>
              <Pill tone={x.state === 'read' ? 'good' : ['unreadable', 'failed'].includes(x.state) ? 'crit' : ['other', 'duplicate'].includes(x.state) ? 'warn' : 'info'}>{t(`setup.docs.pill.${x.state}`)}</Pill>
            </li>
          ))}
        </ul>
      )}
      <ul className="v2-setup-slots">
        {SLOTS.map((s) => {
          const ok = s.types.some((ty) => have.has(ty))
          return (
            <li key={s.key} className={ok ? 'is-done' : ''} data-slot={s.key} data-slot-done={ok ? '1' : '0'}>
              <span className="v2-setup-fic" aria-hidden="true">{ok ? <I.check size={16} /> : <I.plus size={16} />}</span>
              <span className="v2-setup-ftext"><strong>{t(`setup.docs.slot.${s.key}`)}{s.must ? '' : ` · ${t('setup.docs.optional')}`}</strong><span className="v2-muted v2-small">{t(`setup.docs.slot.${s.key}Hint`)}</span></span>
              {ok ? <Pill tone="good">{t('setup.docs.inPlace')}</Pill> : <button type="button" className="v2-btn v2-btn-secondary" onClick={() => input.current?.click()}>{t('setup.docs.upload')}</button>}
            </li>
          )
        })}
      </ul>
      <p className="v2-muted v2-small">{t('setup.docs.who')}</p>
      <div className="v2-setup-actions">
        <Link to="/business/new" className="v2-btn v2-btn-ghost">{t('setup.back')}</Link>
        <Link to="/business/setup/review" className="v2-btn v2-btn-secondary" onClick={(e) => { e.preventDefault(); nav('/business/setup/review?manual=1') }}>{t('setup.docs.skip')}</Link>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => nav('/business/setup/review')}>{busy ? t('setup.docs.wait') : t('setup.docs.next')}</button>
      </div>
    </div>
  )
}

/* ── R6: check what the AI read ──────────────────────────────────────────── */
const REVIEW_FIELDS = ['company_legal_name', 'legal_entity_type', 'npwp', 'kpp', 'nib', 'primary_kbli', 'additional_kbli']
const LEGAL = ['PT Local', 'PT PMA', 'CV', 'Yayasan', 'Individual / Freelancer', 'Other']
const asText = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v))

function SetupReview() {
  const t = useT()
  const nav = useNavigate()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const prof = useApi('/accountant/profile')
  const [ai, setAi] = useState({ state: 'loading' })
  const [vals, setVals] = useState({})
  const [edit, setEdit] = useState({})
  const [ans, setAns] = useState({ pkp_status: '', employee_status: '', fy: 'jan', tax_regime: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const manual = new URLSearchParams(window.location.search).get('manual') === '1'

  useEffect(() => {
    let off = false
    readProfileFromDocuments(token, {}).then((r) => {
      if (off) return
      const v = {}
      for (const s of r.suggestions || []) v[s.field] = { value: s.value, sources: s.sources || [], conflict: s.conflict, values: s.values }
      setVals(v)
      // No reading because the model could not be reached is "AI unavailable" (R10), not "no documents".
      const aiDown = !(r.documents || []).length && (r.skipped || []).some((s) => /^ai_/.test(s.reason || ''))
      setAi({ state: (r.documents || []).length ? 'ready' : aiDown ? 'error' : 'none', data: r })
      if (v.pkp_status?.value) setAns((a) => ({ ...a, pkp_status: v.pkp_status.value }))
    }).catch((x) => { if (!off) setAi({ state: 'error', status: x?.status }) })
    return () => { off = true }
  }, [token])
  useEffect(() => {
    const p = prof.data?.profile
    if (!p) return
    setAns((a) => ({ ...a, pkp_status: a.pkp_status || p.pkp_status || '', employee_status: a.employee_status || p.employee_status || '', tax_regime: a.tax_regime || p.tax_regime || '' }))
    setVals((v) => { const n = { ...v }; for (const k of REVIEW_FIELDS) if (!n[k] && p[k]) n[k] = { value: p[k], sources: [], saved: true }; return n })
  }, [prof.data])

  const setVal = (k, value) => setVals((v) => ({ ...v, [k]: { ...(v[k] || {}), value, user: true } }))
  const save = async () => {
    if (!ans.pkp_status || !ans.employee_status) { setMsg({ tone: 'warn', text: t('setup.review.answer') }); return }
    setBusy(true); setMsg(null)
    const body = { jurisdiction: 'ID', pkp_status: ans.pkp_status, vat_status: ans.pkp_status === 'pkp_registered' ? 'pkp' : null, employee_status: ans.employee_status }
    if (ans.tax_regime && ans.tax_regime !== 'unknown') body.tax_regime = ans.tax_regime
    const yr = new Date().getFullYear()
    if (ans.fy === 'jan') { body.financial_year_start = `${yr}-01-01`; body.financial_year_end = `${yr}-12-31` }
    const verification = {}
    for (const k of REVIEW_FIELDS) {
      const v = vals[k]
      if (!v || v.value == null || v.value === '') continue
      body[k] = k === 'additional_kbli' ? (Array.isArray(v.value) ? v.value : String(v.value).split(/[,;\s]+/).filter(Boolean)) : v.value
      verification[k] = v.user ? 'user_declared' : v.sources?.[0]?.document_id ? { state: 'extracted', document_id: v.sources[0].document_id } : 'user_declared'
    }
    if (Object.keys(verification).length) body.field_verification = verification
    // KBLI also into business_activity_codes — a column that exists before migration 040, so the
    // codes are kept even while primary_kbli / additional_kbli wait for it.
    const kbli = [body.primary_kbli, ...(body.additional_kbli || [])].filter(Boolean)
    if (kbli.length) body.business_activity_codes = kbli.join(', ')
    try {
      const r = await saveTaxProfile(token, body)
      invalidate()
      const notSaved = (r?.not_saved || []).filter((k) => k !== 'field_verification' && !(k.endsWith('_kbli') && kbli.length))
      nav(`/business/setup/taxes${notSaved.length ? `?pending=${encodeURIComponent(notSaved.join(','))}` : ''}`)
    } catch (x) { setMsg({ tone: 'warn', text: x?.status === 403 ? t('pe.forbidden') : t('setup.err', { msg: x?.data?.error || x?.message }) }) }
    finally { setBusy(false) }
  }
  const src = (v) => {
    if (v?.user) return t('setup.review.byYou')
    if (v?.saved) return t('setup.review.saved')
    const s = v?.sources?.[0]
    if (!s) return t('setup.review.notFound')
    return `${s.file_name} · ${t(s.printed ? 'setup.review.printed' : 'setup.review.fromImage')}`
  }
  const titles = ai.data?.kbli_titles || []
  const titleOf = (code) => titles.find((k) => k.code === code)?.title

  return (
    <div className="v2-setup-card">
      <h1 className="v2-auth-h1">{t('setup.review.title')}</h1>
      <p className="v2-auth-p">{t('setup.review.p')}</p>
      {ai.state === 'loading' && <><Skeleton rows={6} /><span className="v2-muted v2-small">{t('pe.ai.reading')}</span></>}
      {ai.state === 'error' && (
        <div className="v2-banner v2-tone-warn" role="status"><I.warn size={18} /><span className="v2-banner-text"><strong>{t('setup.review.aiDown')}</strong> {t('setup.review.aiDownP')}</span></div>
      )}
      {ai.state === 'none' && !manual && (
        <div className="v2-banner v2-tone-info" role="status"><I.info size={18} /><span className="v2-banner-text">{t('setup.review.noDocs')}</span><Link to="/business/setup/docs" className="v2-btn v2-btn-secondary">{t('setup.review.toDocs')}</Link></div>
      )}
      {ai.state !== 'loading' && (
        <ul className="v2-setup-review" data-setup-review>
          {REVIEW_FIELDS.map((k) => {
            const v = vals[k]
            const editing = edit[k]
            return (
              <li key={k} data-field={k}>
                <span className="v2-setup-rlabel">{t(`pe.f.${k}`)}</span>
                <span className="v2-setup-rval">
                  {editing ? (
                    k === 'legal_entity_type'
                      ? <select className="v2-select" value={asText(v?.value)} onChange={(e) => setVal(k, e.target.value)}><option value="">{t('pe.choose')}</option>{LEGAL.map((o) => <option key={o} value={o}>{optLabel(t, 'legal_entity_type', o)}</option>)}</select>
                      : <input className="v2-input" value={asText(v?.value)} autoFocus onChange={(e) => setVal(k, e.target.value)} />
                  ) : (
                    <strong className={v?.value ? 'v2-num' : 'v2-muted'}>{v?.value ? asText(v.value) : t('setup.review.empty')}</strong>
                  )}
                  {(k === 'primary_kbli' || k === 'additional_kbli') && v?.value && !editing && (
                    <span className="v2-small v2-block">{(Array.isArray(v.value) ? v.value : [v.value]).map((c) => titleOf(c) ? `${c} — ${titleOf(c)}` : c).join('; ')}</span>
                  )}
                  <span className="v2-muted v2-small v2-block">{src(v)}</span>
                  {v?.conflict && <span className="v2-inline-err v2-small v2-block">{t('setup.review.conflict', { v: (v.values || []).map(asText).join(' / ') })}</span>}
                </span>
                <button type="button" className="v2-btn v2-btn-ghost" onClick={() => setEdit((e) => ({ ...e, [k]: !e[k] }))}>{editing ? t('setup.review.done') : t('setup.review.edit')}</button>
              </li>
            )
          })}
        </ul>
      )}
      <section className="v2-setup-q">
        <h2 className="v2-h2">{t('setup.review.qTitle')}</h2>
        <fieldset className="v2-fieldset"><legend className="v2-field-label">{t('setup.review.pkp')}</legend>
          <div className="v2-setup-chips">
            {[['non_pkp', 'no'], ['pkp_registered', 'yes'], ['unknown', 'dk']].map(([v, l]) => <button key={v} type="button" className="v2-chip" aria-pressed={ans.pkp_status === v} onClick={() => setAns((a) => ({ ...a, pkp_status: v }))}>{t(`setup.review.${l}`)}</button>)}
          </div>
          <span className="v2-muted v2-small">{vals.pkp_status?.sources?.length ? t('setup.review.pkpFromDoc') : t('setup.review.pkpHint')}</span>
        </fieldset>
        <fieldset className="v2-fieldset"><legend className="v2-field-label">{t('setup.review.emp')}</legend>
          <div className="v2-setup-chips">
            {[['no_employees', 'no'], ['has_employees', 'yes']].map(([v, l]) => <button key={v} type="button" className="v2-chip" aria-pressed={ans.employee_status === v} onClick={() => setAns((a) => ({ ...a, employee_status: v }))}>{t(`setup.review.${l}`)}</button>)}
          </div>
        </fieldset>
        <fieldset className="v2-fieldset"><legend className="v2-field-label">{t('setup.review.regime')}</legend>
          <div className="v2-setup-chips">
            {['normal', 'pph_final_umkm', 'unknown'].map((v) => <button key={v} type="button" className="v2-chip" aria-pressed={ans.tax_regime === v} onClick={() => setAns((a) => ({ ...a, tax_regime: v }))}>{t(`setup.review.reg.${v}`)}</button>)}
          </div>
          <span className="v2-muted v2-small">{t('setup.review.regimeHint')}</span>
        </fieldset>
        <label className="v2-field"><span className="v2-field-label">{t('setup.review.fy')}</span>
          <select className="v2-select" value={ans.fy} onChange={(e) => setAns((a) => ({ ...a, fy: e.target.value }))}>
            <option value="jan">{t('setup.review.fyJan')}</option><option value="other">{t('setup.review.fyOther')}</option>
          </select></label>
      </section>
      {msg && <div className={`v2-banner v2-tone-${msg.tone}`} role="status"><span className="v2-banner-text">{msg.text}</span></div>}
      <div className="v2-setup-actions">
        <Link to="/business/setup/docs" className="v2-btn v2-btn-ghost">{t('setup.review.back')}</Link>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || ai.state === 'loading'} onClick={save}>{busy ? t('pe.saving') : t('setup.review.next')}</button>
      </div>
    </div>
  )
}

/* ── R7: what the company has to file ────────────────────────────────────── */
function SetupTaxes() {
  const t = useT()
  const lang = useLang()
  const { active } = useWorkspace()
  const cal = useApi('/accountant/tax-calendar')
  const prof = useApi('/accountant/profile')
  const pending = (new URLSearchParams(window.location.search).get('pending') || '').split(',').filter(Boolean)
  if (cal.loading || prof.loading) return <div className="v2-setup-card"><Skeleton rows={8} /></div>
  if (cal.error) return <div className="v2-setup-card"><ErrorBox error={cal.error} onRetry={cal.reload} /></div>
  const p = prof.data?.profile || {}
  const events = cal.data?.events || []
  const overdue = events.filter((e) => e.stage === 'overdue')
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = events.filter((e) => e.stage !== 'overdue' && String(e.due_date) >= today).slice(0, 12)
  const has = (code) => events.some((e) => e.rule_code === code)
  const pkp = p.pkp_status === 'pkp_registered' || p.vat_status === 'pkp'
  const emp = p.employee_status === 'has_employees'
  let activity = 'unknown'
  try { activity = sessionStorage.getItem(ACTIVITY_KEY(active?.id)) || 'unknown' } catch { /* private mode */ }
  const duties = [
    { code: 'ID_PPH_BADAN_ANNUAL', need: p.legal_entity_type !== 'Individual / Freelancer', why: 'badan' },
    { code: 'ID_PPH21_MONTHLY', need: emp, why: emp ? 'pph21Yes' : 'pph21No' },
    { code: 'ID_PPN_MONTHLY', need: pkp, why: pkp ? 'ppnYes' : 'ppnNo' },
  ]
  const nextOf = (code) => events.filter((e) => e.rule_code === code && String(e.due_date) >= today)[0]
  const facts = [p.legal_entity_type || t('setup.taxes.formUnknown'), pkp ? 'PKP' : t('setup.taxes.nonPkp'), emp ? t('setup.taxes.withEmp') : t('setup.taxes.noEmp'),
    activity === 'dormant' || activity === 'starting' ? t('setup.taxes.noActivity') : null].filter(Boolean)
  return (
    <div className="v2-setup-card">
      <h1 className="v2-auth-h1">{t('setup.taxes.title', { co: active?.name || '' })}</h1>
      <p className="v2-auth-p">{t('setup.taxes.p', { facts: facts.join(', ') })}</p>
      {pending.length > 0 && <div className="v2-banner v2-tone-warn" role="status"><I.info size={18} /><span className="v2-banner-text">{t('pe.savedPartly', { f: pending.map((k) => t(`pe.f.${k}`)).join(', ') })}</span></div>}
      {overdue.length > 0 && (
        <div className="v2-banner v2-tone-crit" role="status" data-setup-overdue={overdue.length}><I.warn size={18} />
          <span className="v2-banner-text"><strong>{t('setup.taxes.overdue', { n: overdue.length })}</strong> {overdue.slice(0, 3).map((e) => `${ruleTitle(t, e)}${e.period ? ` · ${e.period}` : ''} (${shortDate(e.due_date, lang)})`).join('; ')}</span></div>
      )}
      <ul className="v2-setup-duties" data-setup-duties>
        {duties.map((d) => {
          const n = nextOf(d.code)
          return (
            <li key={d.code} className={d.need ? 'is-need' : 'is-not'} data-duty={d.code} data-need={d.need ? '1' : '0'}>
              <span className="v2-setup-ftext"><strong>{ruleTitle(t, { rule_code: d.code })}</strong><span className="v2-muted v2-small">{t(`setup.taxes.why.${d.why}`)}</span></span>
              <span className="v2-num v2-small">{d.need && n ? `${shortDate(n.due_date, lang)}${n.period ? ` · ${n.period}` : ''}` : '—'}</span>
              <Pill tone={d.need ? (has(d.code) && overdue.some((e) => e.rule_code === d.code) ? 'crit' : 'warn') : 'neutral'}>{d.need ? (n?.nil_return ? t('setup.taxes.needNil') : t('setup.taxes.need')) : t('setup.taxes.notNeeded')}</Pill>
            </li>
          )
        })}
        {p.legal_entity_type === 'PT PMA' && (
          <li className="is-check" data-duty="LKPM"><span className="v2-setup-ftext"><strong>{t('setup.taxes.lkpm')}</strong><span className="v2-muted v2-small">{t('setup.taxes.lkpmWhy')}</span></span>
            <span className="v2-num v2-small">{t('setup.taxes.quarterly')}</span><Pill tone="info">{t('setup.taxes.check')}</Pill></li>
        )}
      </ul>
      {upcoming.length > 0 && <><h2 className="v2-h2">{t('setup.taxes.soon')}</h2><TaxList events={upcoming} lang={lang} t={t} limit={8} /></>}
      {(overdue.some((e) => e.nil_return) || activity !== 'active') && (
        <section className="v2-setup-how">
          <h2 className="v2-h2">{t('setup.taxes.howNil')}</h2>
          <ol>{['s1', 's2', 's3', 's4'].map((k) => <li key={k}>{t(`setup.taxes.nil.${k}`)}</li>)}</ol>
        </section>
      )}
      <p className="v2-muted v2-small">{t('setup.taxes.note')}</p>
      <div className="v2-setup-actions">
        <Link to="/business/setup/review" className="v2-btn v2-btn-ghost">{t('setup.back')}</Link>
        <Link to="/business/settings?tab=team" className="v2-btn v2-btn-secondary">{t('setup.taxes.inviteAcc')}</Link>
        <Link to="/business/onboarding" className="v2-btn v2-btn-primary">{t('setup.taxes.open')}</Link>
      </div>
    </div>
  )
}

export function SetupStep() {
  const { step } = useParams()
  const { active, loading } = useWorkspace()
  if (loading && !active) return <div className="v2-setup-card"><Skeleton rows={6} /></div>
  if (!active || active.type !== 'business') return <div className="v2-setup-card"><p className="v2-auth-p"><Link to="/business/new">←</Link></p></div>
  if (step === 'docs') return <SetupDocs />
  if (step === 'review') return <SetupReview />
  if (step === 'taxes') return <SetupTaxes />
  return <SetupDocs />
}
