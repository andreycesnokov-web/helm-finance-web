// Company profile (designs/CompanyProfile.dc.html) — /business/accountant/tax-profile.
// The legacy /accountant/tax-profile page is untouched.
//
// Reads: GET /api/accountant/profile (+ completeness), GET /api/accountant/applicability
// (deterministic rule engine: which duties apply and why), GET /api/ai-accountant/required-documents
// (checklist), GET /api/payroll/overview (employee count, when the role may read it).
// Editing stays in the existing profile form, which has the existing save path and its
// audited critical-field rules ("Edit profile" → the AI Accountant classic view).
import { Link } from 'react-router-dom'
import {useEffect,useState} from 'react'
import {useBusinessRequest} from '../lib/useBusinessRequest'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { shortDate } from '../lib/format'
import AccountantTabs from '../components/AccountantTabs'
import { optLabel } from './CompanyProfileEdit'

const DOCS = ['akta', 'sk_kemenkumham', 'nib', 'npwp']
// Tax regime values the legacy profile form stores; anything else is shown as stored.
const REGIMES = ['normal', 'pp23_final', 'pph_final_umkm']
const show = (v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : Array.isArray(v) ? v.join(', ') : String(v))
const kbliCodes = (v) => String(v || '').split(/[,;\s]+/).filter(Boolean)
const mask = (v) => { const s = String(v || '').replace(/\D/g, ''); return s.length > 4 ? `···· ${s.slice(-4)}` : show(v) }

function Row({ label, value, source, t }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value != null ? <>{value}{source && <span className="v2-muted v2-small"> · {source}</span>}</> : <span className="v2-muted">{t('prof.notFilled')}</span>}</dd>
    </>
  )
}

export default function CompanyProfile() {
  const t = useT()
  const lang = useLang()
  const prof = useApi('/accountant/profile')
  const appl = useApi('/accountant/applicability')
  const req = useApi('/ai-accountant/required-documents')
  const payroll = useApi('/payroll/overview')
  const company=useApi('/business/current')
  const request=useBusinessRequest(),[historyOffset,setHistoryOffset]=useState(0)
  useEffect(()=>setHistoryOffset(0),[request.businessId])
  const history=useApi(`/audit/events?entity_type=tax_profile&limit=20&offset=${historyOffset}`)
  const head = <PageHead title={t('screen.companyProfile')} sub={t('prof.sub')} back={{ to: '/business/settings', label: t('nav.settings') }}
    actions={<Btn variant="primary" to="/business/accountant/tax-profile/edit">{t('prof.edit')}</Btn>} />
  if (prof.loading) return <>{head}<AccountantTabs active="profile" /><Card><Skeleton rows={8} /></Card></>
  if (prof.error) return <>{head}<AccountantTabs active="profile" /><ErrorBox error={prof.error?.status === 403 ? t('dec.forbidden') : prof.error} onRetry={prof.reload} /></>

  const p = prof.data?.profile || {}
  const pct = prof.data?.completeness?.percent ?? appl.data?.completeness?.percent ?? null
  const fv = p.field_verification || {}
  const src = (k) => {const state=typeof fv[k]==='string'?fv[k]:fv[k]?.state;return state?t(`prof.source.${state}`):null}
  const isID=(company.data?.business?.country||p.country)==='Indonesia'
  const currentCountry=company.data?.business?.country,currentJurisdiction={Indonesia:'ID',Singapore:'SG',Malaysia:'MY',Thailand:'TH'}[currentCountry]
  const countryMismatch=!!currentCountry&&(p.country!==currentCountry||!!currentJurisdiction&&p.jurisdiction!==currentJurisdiction)
  const confirmed=!company.loading&&!company.error&&!countryMismatch&&p.profile_version!=null&&String(p.profile_version)===String(p.verified_profile_version)
  const items = req.data?.items || []
  const docState = (key) => items.find((i) => (i.type || i.doc_type) === key)?.status || null
  const rules = appl.data?.applicable_rules || []
  const excluded = appl.data?.excluded_rules || []
  const employees = p.employee_count ?? payroll.data?.employees?.length ?? null

  return (
    <div className="v2-page">
      {head}
      <AccountantTabs active="profile" />
      {countryMismatch&&<div className="v2-banner v2-tone-warn" role="alert">{t('pe.countryMismatch')} <Link to="/business/accountant/tax-profile/edit">{t('prof.edit')}</Link></div>}
      <div className="v2-grid-detail">
        <div className="v2-col">
          <Card>
            <div className="v2-prof-head">
              <Pill tone={pct === 100 ? 'good' : 'warn'}>{pct == null ? t('prof.unknownPct') : t('prof.pct', { n: pct })}</Pill>
              <span className="v2-sec">{t('prof.uploadHint')}</span>
              <Pill tone={confirmed?'good':'warn'}>{t(confirmed?'prof.versionChecked':'prof.versionReview',{n:p.profile_version??'—'})}</Pill>
            </div>
            <ul className="v2-docchips">
              {(isID?DOCS:[]).map((k) => {
                const s = docState(k)
                const ok = s === 'uploaded'
                return <li key={k}><Pill tone={ok ? 'good' : s === 'needs_review' ? 'warn' : 'neutral'}>{ok ? <I.check size={12} /> : null}{t(`prof.doc.${k}`)}{!ok && s ? ` · ${t(`prof.docSt.${s}`)}` : ''}</Pill></li>
              })}
            </ul>
            <Btn to="/business/documents?tab=company">{t('bill.upload')}</Btn>
          </Card>

          <Card title={t('prof.legal')}>
            <dl className="v2-dl">
              <Row t={t} label={t('prof.legalName')} value={show(p.company_legal_name)} source={src('company_legal_name')} />
              <Row t={t} label={t('pe.f.brand_name')} value={show(p.brand_name)} source={src('brand_name')} />
              <Row t={t} label={t('prof.form')} value={p.legal_entity_type ? optLabel(t, 'legal_entity_type', show(p.legal_entity_type)) : show(p.legal_entity_type)} source={src('legal_entity_type')} />
              <Row t={t} label={t('prof.capital')} value={isID?(p.foreign_owned === 'yes' ? 'PMA' : p.foreign_owned === 'no' ? 'PMDN' : null):show(p.foreign_owned)} source={src('foreign_owned')} />
              <Row t={t} label={t('prof.country')} value={show(p.country)} />
              <Row t={t} label={t('prof.fiscalYear')} value={p.financial_year_start ? `${p.financial_year_start} – ${p.financial_year_end || ''}` : null} />
            </dl>
          </Card>

          {isID&&<Card title={t('prof.licence')}>
            <dl className="v2-dl">
              <Row t={t} label="NIB" value={mask(p.nib)} source={p.nib_issue_date ? shortDate(p.nib_issue_date, lang) : null} />
              {/* KBLI: the 040 columns, else business_activity_codes (kept before 040 by the setup step). */}
              <Row t={t} label={t('prof.mainKbli')} value={show(p.primary_kbli || kbliCodes(p.business_activity_codes)[0])} />
              <Row t={t} label={t('prof.otherKbli')} value={show(p.additional_kbli || kbliCodes(p.business_activity_codes).slice(1).join(', '))} />
              <Row t={t} label={t('prof.activities')} value={show(p.actual_business_activities || p.industry)} />
            </dl>
          </Card>}

          <Card title={t('prof.tax')}>
            <dl className="v2-dl">
              <Row t={t} label={isID?'NPWP':t('pe.f.tax_identifier')} value={mask(isID?p.npwp || p.tax_identifier:p.tax_identifier)} source={src(isID?'npwp':'tax_identifier')} />
              {isID&&<Row t={t} label={t('prof.kpp')} value={show(p.kpp)} />}
              <Row t={t} label={t('prof.vat')} value={isID?['pkp','pkp_registered'].includes(p.pkp_status) ? 'PKP' : p.pkp_status === 'non_pkp' ? t('cp.form.notPkp') : null:show(p.vat_status)} source={isID&&p.pkp_effective_date ? shortDate(p.pkp_effective_date, lang) : null} />
              <Row t={t} label={t('prof.regime')} value={REGIMES.includes(p.tax_regime) ? t(`prof.regimeV.${p.tax_regime}`) : show(p.tax_regime)} />
            </dl>
          </Card>

          <Card title={t('prof.people')}>
            <dl className="v2-dl">
              <Row t={t} label={t('prof.employees')} value={employees != null ? String(employees) : null} source={p.employee_count!=null?src('employee_count'):payroll.data ? t('prof.fromPayroll') : null} />
              {['local_employee_count','foreign_employee_count','payroll_frequency','transaction_types'].map(k=><Row key={k} t={t} label={t(`pe.f.${k}`)} value={show(p[k])} source={src(k)}/>)}
              {isID&&<Row t={t} label="BPJS" value={p.bpjs_registered === true ? t('prof.yes') : p.bpjs_registered === false ? t('prof.no') : null} />}
              <Row t={t} label={t('prof.directors')} value={null} />
            </dl>
            <p className="v2-muted v2-small">{t('prof.peopleNote')}</p>
          </Card>
          <Card title={t('prof.history')}>
            {history.loading?<Skeleton rows={3}/>:history.error?<ErrorBox error={history.error?.status===403?t('dec.forbidden'):history.error} onRetry={history.reload}/>:<ol>{(history.data?.events||[]).map(e=><li key={e.id}><strong>{t(e.action==='verified'?'prof.historyVerified':'prof.historySaved',{n:e.profile_version??'—'})}</strong> · {e.actor_name} · {shortDate(e.created_at,lang)}</li>)}</ol>}
            {!history.loading&&!history.error&&!history.data?.events?.length&&<p className="v2-muted">{t('prof.historyEmpty')}</p>}
            <div className="v2-row-gap"><button type="button" className="v2-btn v2-btn-ghost" disabled={history.loading||historyOffset===0} onClick={()=>setHistoryOffset(n=>Math.max(0,n-20))}>{t('history.previous')}</button><button type="button" className="v2-btn v2-btn-ghost" disabled={history.loading||historyOffset+20>=(history.data?.total||0)} onClick={()=>setHistoryOffset(n=>n+20)}>{t('history.next')}</button></div>
          </Card>
        </div>

        <aside className="v2-col">
          <Card title={t('prof.workedOut')}>
            {appl.loading ? <Skeleton rows={4} /> : appl.error?<ErrorBox error={appl.error} onRetry={appl.reload}/>:appl.data?.available===false?<p className="v2-inline-err">{t('setup.review.countryRequired')}</p>: (
              <>
                <p className="v2-sec">{t('prof.dutiesN', { n: rules.length, k: excluded.length })}</p>
                <ol className="v2-duties">
                  {rules.map((r) => <li key={r.rule_code}><strong>{r.title || r.rule_code}</strong>{r.reason && <span className="v2-muted"> — {r.reason}</span>}</li>)}
                </ol>
                {excluded.length > 0 && (
                  <>
                    <p className="v2-field-label">{t('prof.notNeeded')}</p>
                    <ul className="v2-duties v2-duties-off">
                      {excluded.slice(0, 6).map((r) => <li key={r.rule_code}><strong>{r.title || r.rule_code}</strong>{r.reason && <span className="v2-muted"> — {r.reason}</span>}</li>)}
                    </ul>
                  </>
                )}
                {(appl.data?.missing_profile_fields || []).length > 0 && <p className="v2-small v2-neg">{t('acct.profileMissing', { n: appl.data.missing_profile_fields.length })}</p>}
              </>
            )}
            <Link to="/business/accountant?tab=taxes">{t('prof.openCalendar')}</Link>
            <p className="v2-muted v2-small">{t('prof.engineNote')}</p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
