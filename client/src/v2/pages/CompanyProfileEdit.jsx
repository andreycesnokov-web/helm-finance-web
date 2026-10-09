// Company tax profile — editing in v2 (replaces the classic form behind "Edit profile").
// Reads GET /api/accountant/profile; saves with PUT /api/accountant/profile (role-checked on the
// server: owner / CEO / admin / CFO; critical fields audited; a critical change re-opens review).
// Fields from migration 040 (KBLI, KPP, company name, NIB date, employees, BPJS) are saved only
// once 040 is applied — until then the server answers which fields were not saved and this page
// says so instead of keeping them in the browser.
//
// "From your documents": POST /api/accountant/profile/from-documents reads the company documents
// (NPWP, NIB with KBLI, deed, SK, SPPKP, KPP, BPJS) and suggests values with their source. Nothing
// is applied until the user ticks a suggestion and saves.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { saveTaxProfile, verifyTaxProfile, readProfileFromDocuments } from '../lib/actions'
import AccountantTabs from '../components/AccountantTabs'

const LEGAL = ['PT Local', 'PT PMA', 'CV', 'Yayasan', 'Individual / Freelancer', 'Representative Office / Branch', 'Other']
const REGIMES = ['normal', 'pp23_final', 'pph_final_umkm']
// Field → section and input kind. `ext` = a migration-040 column.
export const SECTIONS = [
  { key: 'company', fields: [
    { k: 'company_legal_name', ext: true }, { k: 'legal_entity_type', opts: LEGAL }, { k: 'foreign_owned', ext: true, opts: ['no', 'yes'] },
    { k: 'country', opts: ['Indonesia', 'Singapore', 'Other'] } ] },
  { key: 'tax', fields: [
    { k: 'npwp' }, { k: 'kpp', ext: true }, { k: 'pkp_status', opts: ['non_pkp', 'pkp_registered', 'unknown'] },
    { k: 'pkp_effective_date', ext: true, type: 'date', when: (f) => f.pkp_status === 'pkp_registered' },
    { k: 'tax_regime', opts: REGIMES }, { k: 'financial_year_start', type: 'date' }, { k: 'financial_year_end', type: 'date' } ] },
  { key: 'licence', fields: [
    { k: 'nib' }, { k: 'nib_issue_date', ext: true, type: 'date' }, { k: 'primary_kbli', ext: true }, { k: 'additional_kbli', ext: true, list: true },
    { k: 'actual_business_activities', ext: true, wide: true } ] },
  { key: 'people', fields: [
    { k: 'employee_status', opts: ['has_employees', 'no_employees'] }, { k: 'employee_count', ext: true, type: 'number' },
    { k: 'bpjs_registered', ext: true, opts: ['true', 'false'] }, { k: 'payroll_frequency', ext: true, opts: ['Monthly', 'Bi-weekly', 'Weekly'] } ] },
]
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields)
const asInput = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'true' : v === false ? 'false' : v == null ? '' : String(v))
const dateIn = (v) => { const s = String(v || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '' }

/** The body PUT /api/accountant/profile receives. vat_status follows pkp_status (it is the older
 *  copy of the same fact; a Non-PKP company must not keep a stale "pkp"). */
export function profileBody(form, verification) {
  const body = {}
  for (const f of ALL_FIELDS) {
    if (form[f.k] === undefined) continue
    body[f.k] = f.list ? String(form[f.k] || '').split(/[,;\s]+/).filter(Boolean) : form[f.k]
  }
  if (form.pkp_status === 'pkp_registered') body.vat_status = 'pkp'
  else if (form.pkp_status === 'non_pkp') body.vat_status = null
  if (!form.jurisdiction) body.jurisdiction = 'ID'
  if (verification && Object.keys(verification).length) body.field_verification = verification
  return body
}

export default function CompanyProfileEdit() {
  const t = useT()
  const nav = useNavigate()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const prof = useApi('/accountant/profile')
  const [form, setForm] = useState(null)
  const [verification, setVerification] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)       // { tone, text }
  const [ai, setAi] = useState({ state: 'idle' })
  const [picked, setPicked] = useState({})

  useEffect(() => {
    if (!prof.data || form) return
    const p = prof.data.profile || {}
    const f = {}
    for (const x of ALL_FIELDS) f[x.k] = x.type === 'date' ? dateIn(p[x.k]) : asInput(p[x.k])
    f.jurisdiction = p.jurisdiction || 'ID'
    if (!f.country) f.country = 'Indonesia'
    setForm(f)
  }, [prof.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const readDocs = async (force = false) => {
    setAi({ state: 'loading' })
    try {
      const r = await readProfileFromDocuments(token, { force })
      setAi({ state: 'ready', data: r })
      const pre = {}
      for (const s of r.suggestions || []) pre[s.field] = !s.same_as_current && !s.conflict && (s.current == null || s.current === '' || (Array.isArray(s.current) && !s.current.length))
      setPicked(pre)
    } catch (e) { setAi({ state: 'error', error: e?.status === 403 ? t('dec.forbidden') : (e?.data?.error || e?.message) }) }
  }
  useEffect(() => { if (form && ai.state === 'idle') readDocs(false) }, [form]) // eslint-disable-line react-hooks/exhaustive-deps

  const ext = prof.data?.extended_fields === true
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setVerification((m) => ({ ...m, [k]: 'user_declared' })) }
  const applyPicked = () => {
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
    setBusy(true); setMsg(null)
    try {
      const r = await saveTaxProfile(token, profileBody(form, verification))
      invalidate()
      const notSaved = r?.not_saved || []
      setMsg(notSaved.length
        ? { tone: 'warn', text: t('pe.savedPartly', { f: notSaved.map((k) => t(`pe.f.${k}`)).join(', ') }) }
        : { tone: 'good', text: t('pe.saved', { n: r?.completeness?.percent ?? '—' }) })
    } catch (e) {
      setMsg({ tone: 'warn', text: e?.status === 403 ? t('pe.forbidden') : t('pe.failed', { msg: e?.data?.error || e?.message }) })
    } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true); setMsg(null)
    try { await verifyTaxProfile(token); invalidate(); setMsg({ tone: 'good', text: t('pe.verified') }) }
    catch (e) { setMsg({ tone: 'warn', text: e?.status === 422 ? t('pe.incomplete', { f: (e?.data?.missing || []).map((k) => t(`pe.f.${k}`)).join(', ') }) : e?.status === 403 ? t('pe.forbidden') : t('pe.failed', { msg: e?.data?.error || e?.message }) }) }
    finally { setBusy(false) }
  }

  const sug = useMemo(() => (ai.data?.suggestions || []).filter((s) => !s.same_as_current), [ai.data])
  const head = <PageHead title={t('pe.title')} sub={t('pe.sub')} back={{ to: '/business/accountant/tax-profile', label: t('screen.companyProfile') }} />
  if (prof.loading || !form) return <div className="v2-page">{head}<AccountantTabs active="profile" /><Card><Skeleton rows={8} /></Card></div>
  if (prof.error) return <div className="v2-page">{head}<ErrorBox error={prof.error?.status === 403 ? t('dec.forbidden') : prof.error} onRetry={prof.reload} /></div>

  return (
    <div className="v2-page">
      {head}
      <AccountantTabs active="profile" />
      <div className="v2-grid-detail">
        <div className="v2-col">
          {!ext && <div className="v2-banner v2-tone-warn"><I.info size={18} /><span className="v2-banner-text">{t('pe.no040')}</span></div>}
          {msg && <div className={`v2-banner v2-tone-${msg.tone}`} role="status"><span className="v2-banner-text">{msg.text}</span></div>}
          {SECTIONS.map((s) => (
            <Card key={s.key} title={t(`pe.s.${s.key}`)}>
              <div className="v2-field-row">
                {s.fields.filter((f) => !f.when || f.when(form)).map((f) => {
                  const off = f.ext && !ext
                  const v = verification[f.k]
                  return (
                    <label key={f.k} className={`v2-field${f.wide ? ' v2-field-wide' : ''}`}>
                      <span className="v2-field-label">{t(`pe.f.${f.k}`)}{off && <span className="v2-muted"> · {t('pe.notSavedYet')}</span>}
                        {(v?.state || v) === 'extracted' && <Pill tone="info">{t('pe.fromDoc')}</Pill>}</span>
                      {f.opts ? (
                        <select className="v2-select" value={form[f.k] || ''} disabled={busy} onChange={(e) => set(f.k, e.target.value)}>
                          <option value="">{t('pe.choose')}</option>
                          {f.opts.map((o) => <option key={o} value={o}>{t(`pe.o.${f.k}.${o}`) !== `pe.o.${f.k}.${o}` ? t(`pe.o.${f.k}.${o}`) : o}</option>)}
                        </select>
                      ) : (
                        <input className="v2-input" type={f.type || 'text'} value={form[f.k] || ''} disabled={busy}
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
            <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={save}>{busy ? t('pe.saving') : t('pe.save')}</button>
            <button type="button" className="v2-btn v2-btn-secondary" disabled={busy} onClick={verify}>{t('pe.verify')}</button>
            <button type="button" className="v2-btn v2-btn-ghost" onClick={() => nav('/business/accountant/tax-profile')}>{t('pe.back')}</button>
          </div>
          <p className="v2-muted v2-small">{t('pe.note')}</p>
        </div>

        <aside className="v2-col">
          <Card title={t('pe.ai.title')} aside={ai.state === 'ready' ? <button type="button" className="v2-btn-link v2-small" onClick={() => readDocs(true)}>{t('pe.ai.again')}</button> : null}>
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
                            <strong>{t(`pe.f.${s.field}`)}</strong>: {asInput(s.value)}
                            {s.current != null && s.current !== '' && <span className="v2-muted v2-small"> · {t('pe.ai.now', { v: asInput(s.current) })}</span>}
                            <span className="v2-muted v2-small v2-block">{s.sources.map((x) => `${x.file_name} (${t(x.printed ? 'pe.ai.printed' : 'pe.ai.image')})`).join(' · ')}</span>
                            {s.conflict && <span className="v2-inline-err v2-small v2-block">{t('pe.ai.conflict', { v: s.values.map(asInput).join(' / ') })}</span>}
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
