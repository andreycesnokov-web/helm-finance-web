// Company profile (designs/CompanyProfile.dc.html) — /business/accountant/tax-profile.
// The legacy /accountant/tax-profile page is untouched.
//
// Reads: GET /api/accountant/profile (+ completeness), GET /api/accountant/applicability
// (deterministic rule engine: which duties apply and why), GET /api/ai-accountant/required-documents
// (checklist), GET /api/payroll/overview (employee count, when the role may read it).
// Editing stays in the existing profile form, which has the existing save path and its
// audited critical-field rules ("Edit profile" → the AI Accountant classic view).
import { Link } from 'react-router-dom'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { shortDate } from '../lib/format'
import AccountantTabs from '../components/AccountantTabs'

const DOCS = ['akta', 'sk_kemenkumham', 'nib', 'npwp']
// Tax regime values the legacy profile form stores; anything else is shown as stored.
const REGIMES = ['normal', 'pp23_final', 'pph_final_umkm']
const show = (v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : Array.isArray(v) ? v.join(', ') : String(v))
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
  const head = <PageHead title={t('screen.companyProfile')} sub={t('prof.sub')} back={{ to: '/business/settings', label: t('nav.settings') }}
    actions={<Btn variant="primary" to="/business/accountant/classic">{t('prof.edit')}</Btn>} />
  if (prof.loading) return <>{head}<AccountantTabs active="profile" /><Card><Skeleton rows={8} /></Card></>
  if (prof.error) return <>{head}<AccountantTabs active="profile" /><ErrorBox error={prof.error?.status === 403 ? t('dec.forbidden') : prof.error} onRetry={prof.reload} /></>

  const p = prof.data?.profile || {}
  const pct = prof.data?.completeness?.percent ?? appl.data?.completeness?.percent ?? null
  const fv = p.field_verification || {}
  const src = (k) => (fv[k]?.source ? t('prof.from', { s: fv[k].source }) : fv[k]?.verified ? t('prof.confirmed') : null)
  const items = req.data?.items || []
  const docState = (key) => items.find((i) => (i.type || i.doc_type) === key)?.status || null
  const rules = appl.data?.applicable_rules || []
  const excluded = appl.data?.excluded_rules || []
  const employees = payroll.data?.employees?.length ?? p.employee_count ?? null

  return (
    <div className="v2-page">
      {head}
      <AccountantTabs active="profile" />
      <div className="v2-grid-detail">
        <div className="v2-col">
          <Card>
            <div className="v2-prof-head">
              <Pill tone={pct === 100 ? 'good' : 'warn'}>{pct == null ? t('prof.unknownPct') : t('prof.pct', { n: pct })}</Pill>
              <span className="v2-sec">{t('prof.uploadHint')}</span>
            </div>
            <ul className="v2-docchips">
              {DOCS.map((k) => {
                const s = docState(k)
                const ok = s === 'uploaded'
                return <li key={k}><Pill tone={ok ? 'good' : s === 'needs_review' ? 'warn' : 'neutral'}>{ok ? <I.check size={12} /> : null}{t(`prof.doc.${k}`)}{!ok && s ? ` · ${t(`prof.docSt.${s}`)}` : ''}</Pill></li>
              })}
            </ul>
            <Btn to="/business/documents">{t('bill.upload')}</Btn>
          </Card>

          <Card title={t('prof.legal')}>
            <dl className="v2-dl">
              <Row t={t} label={t('prof.legalName')} value={show(p.company_legal_name)} source={src('company_legal_name')} />
              <Row t={t} label={t('prof.form')} value={show(p.legal_entity_type)?.toUpperCase()} source={src('legal_entity_type')} />
              <Row t={t} label={t('prof.capital')} value={p.foreign_owned === 'yes' ? 'PMA' : p.foreign_owned === 'no' ? 'PMDN' : null} source={src('foreign_owned')} />
              <Row t={t} label={t('prof.country')} value={show(p.country)} />
              <Row t={t} label={t('prof.fiscalYear')} value={p.financial_year_start ? `${p.financial_year_start} – ${p.financial_year_end || ''}` : null} />
            </dl>
          </Card>

          <Card title={t('prof.licence')}>
            <dl className="v2-dl">
              <Row t={t} label="NIB" value={mask(p.nib)} source={p.nib_issue_date ? shortDate(p.nib_issue_date, lang) : null} />
              <Row t={t} label={t('prof.mainKbli')} value={show(p.primary_kbli)} />
              <Row t={t} label={t('prof.otherKbli')} value={show(p.additional_kbli || p.business_activity_codes)} />
              <Row t={t} label={t('prof.activities')} value={show(p.actual_business_activities || p.industry)} />
            </dl>
          </Card>

          <Card title={t('prof.tax')}>
            <dl className="v2-dl">
              <Row t={t} label="NPWP" value={mask(p.npwp || p.tax_identifier)} source={src('npwp')} />
              <Row t={t} label={t('prof.kpp')} value={show(p.kpp)} />
              <Row t={t} label={t('prof.vat')} value={p.pkp_status === 'pkp' ? 'PKP' : p.pkp_status === 'non_pkp' ? t('cp.form.notPkp') : null} source={p.pkp_effective_date ? shortDate(p.pkp_effective_date, lang) : null} />
              <Row t={t} label={t('prof.regime')} value={REGIMES.includes(p.tax_regime) ? t(`prof.regimeV.${p.tax_regime}`) : show(p.tax_regime)} />
            </dl>
          </Card>

          <Card title={t('prof.people')}>
            <dl className="v2-dl">
              <Row t={t} label={t('prof.employees')} value={employees != null ? String(employees) : null} source={payroll.data ? t('prof.fromPayroll') : null} />
              <Row t={t} label="BPJS" value={p.bpjs_registered === true ? t('prof.yes') : p.bpjs_registered === false ? t('prof.no') : null} />
              <Row t={t} label={t('prof.directors')} value={null} />
            </dl>
            <p className="v2-muted v2-small">{t('prof.peopleNote')}</p>
          </Card>
        </div>

        <aside className="v2-col">
          <Card title={t('prof.workedOut')}>
            {appl.loading ? <Skeleton rows={4} /> : (
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
