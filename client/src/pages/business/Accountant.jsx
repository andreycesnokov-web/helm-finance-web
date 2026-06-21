// AI Accountant — Company Tax & Compliance Profile (V1 UI). Business workspace only.
// Persisted fields wire to GET/PUT /api/accountant/profile (existing backend, unchanged).
// New fields (not yet in schema — see migration 040 PROPOSAL) are LOCAL DRAFT until 040
// is applied. Obligations come from /api/accountant/applicability (deterministic, no LLM).
// No tax-calculation/logic change; no OCR/extraction/filing. Mobile-safe.
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { PageHeader, Card, Btn, StatusBadge, Stat, ErrorState, LoadingSkeleton, Icon } from '../../shell/ui'

// Which UI fields persist to the backend today vs. live as local draft (await 040).
const PERSISTED = new Set(['country', 'jurisdiction', 'legal_entity_type', 'npwp', 'pkp_status', 'vat_status', 'financial_year_start', 'financial_year_end', 'nib', 'employee_status'])
const LEGAL_ENTITY = ['PT Local', 'PT PMA', 'CV', 'Yayasan', 'Individual / Freelancer', 'Representative Office / Branch', 'Other', 'Unknown']
const draftKey = (bizId) => `accountant_draft_${bizId}`

// verification badge tone/label
const VSTATES = {
  missing: { label: 'Missing', tone: 'danger' },
  user_declared: { label: 'User declared', tone: 'warning' },
  document_uploaded: { label: 'Document uploaded', tone: 'info' },
  extracted: { label: 'Extracted from document', tone: 'info' },
  accountant_verified: { label: 'Accountant verified', tone: 'success' },
  conflict: { label: 'Conflict', tone: 'danger' },
}
const REQUIRED_DOCS = ['NPWP', 'NIB', 'PKP certificate', 'Akta', 'SK Kemenkumham', 'OSS / licenses', 'KBLI support documents', 'BPJS registration (if employees)']

export function BusinessAccountant() {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({})
  const [obligations, setObligations] = useState({ applicable_rules: [], missing_profile_fields: [] })
  const [docs, setDocs] = useState({})          // documents checklist (local placeholder)
  const [saving, setSaving] = useState(false)
  const [readiness, setReadiness] = useState(null)

  useEffect(() => {
    if (!token || !active) return
    let on = true; setLoading(true); setError(null)
    Promise.all([
      apiFetch('/accountant/profile', token).catch(() => ({ profile: null })),
      apiFetch('/accountant/applicability', token).catch(() => ({ applicable_rules: [], missing_profile_fields: [] })),
    ]).then(([p, ap]) => {
      if (!on) return
      let draft = {}; try { draft = JSON.parse(localStorage.getItem(draftKey(active.id)) || '{}') } catch {}
      setForm({ ...(p.profile || {}), ...draft })
      setObligations(ap || { applicable_rules: [], missing_profile_fields: [] })
      setLoading(false)
    }).catch(e => { if (on) { setError(e.message); setLoading(false) } })
    return () => { on = false }
  }, [token, active?.id, scopeKey])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const vstatus = (k) => (form.field_verification?.[k]) || (form[k] !== undefined && form[k] !== '' && form[k] !== null ? 'user_declared' : 'missing')

  const save = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      // persist backend-supported fields
      const body = {}; for (const k of PERSISTED) if (form[k] !== undefined) body[k] = form[k]
      const res = await apiFetch('/accountant/profile', token, { method: 'PUT', body }).catch(e => { throw e })
      // local draft for not-yet-migrated fields
      const draft = {}; for (const k of Object.keys(form)) if (!PERSISTED.has(k)) draft[k] = form[k]
      try { localStorage.setItem(draftKey(active.id), JSON.stringify(draft)) } catch {}
      // refresh obligations + build readiness summary
      const ap = await apiFetch('/accountant/applicability', token).catch(() => obligations)
      setObligations(ap)
      const missingFields = (res?.completeness?.missing || ap.missing_profile_fields || [])
      const missingDocs = REQUIRED_DOCS.filter(d => !docs[d])
      const riskFlags = []
      if (form.foreign_owned === 'yes' && form.pkp_status !== 'pkp_registered') riskFlags.push('Foreign-owned (PT PMA) without confirmed PKP status')
      if (form.employee_status === 'has_employees' && !form.bpjs_registered) riskFlags.push('Has employees but BPJS not registered')
      setReadiness({
        obligations: (ap.applicable_rules || []).length,
        missingDocs: missingDocs.length,
        verificationGaps: missingFields.length,
        riskFlags,
        next: missingDocs.includes('NIB') || missingDocs.includes('PKP certificate')
          ? 'Upload NIB and PKP certificate.' : (missingFields[0] ? `Complete ${missingFields[0].replace(/_/g, ' ')}.` : 'Request accountant verification.'),
      })
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }, [form, docs, token, active, obligations])

  const head = (
    <PageHeader eyebrow="Business Workspace · AI Accountant" title="Company Tax & Compliance Profile"
      actions={<><StatusBadge tone="info">Preliminary assessment</StatusBadge><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Btn></>} />
  )
  if (loading) return <>{head}<Card><LoadingSkeleton rows={6} height={18} /></Card></>
  if (error && !form) return <>{head}<ErrorState description={error} onRetry={() => location.reload()} /></>

  const Field = ({ label, k, type = 'text', options, placeholder }) => (
    <div style={{ minWidth: 0 }}>
      <label style={LBL}>{label} {!PERSISTED.has(k) && <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>· draft</span>}</label>
      {options
        ? <select style={INP} value={form[k] || ''} onChange={e => set(k, e.target.value)}><option value="">—</option>{options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select>
        : <input style={INP} type={type} value={form[k] || ''} placeholder={placeholder} onChange={e => set(k, e.target.value)} />}
      <div style={{ marginTop: 6 }}><StatusBadge tone={VSTATES[vstatus(k)].tone}>{VSTATES[vstatus(k)].label}</StatusBadge></div>
    </div>
  )

  return (
    <>{head}
      {readiness && (
        <Card title="AI Accountant readiness" action={<StatusBadge tone="warning">Needs accountant review</StatusBadge>} className="cfo-accountant-readiness" >
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>Profile saved. Preliminary assessment (not final tax advice):</div>
          <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 14 }}>
            <Stat k="Likely obligations" v={readiness.obligations} />
            <Stat k="Missing documents" v={readiness.missingDocs} tone={readiness.missingDocs ? 'neg' : 'pos'} />
            <Stat k="Verification gaps" v={readiness.verificationGaps} tone={readiness.verificationGaps ? 'neg' : 'pos'} />
            <Stat k="Risk flags" v={readiness.riskFlags.length} tone={readiness.riskFlags.length ? 'neg' : 'pos'} />
          </div>
          {readiness.riskFlags.map((r, i) => <div key={i} style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 4 }}>⚠ {r}</div>)}
          <div style={{ marginTop: 8, padding: 12, background: 'var(--info-soft)', borderRadius: 'var(--radius-md)', fontSize: 14 }}>
            <strong>Suggested next action:</strong> {readiness.next}
          </div>
        </Card>
      )}

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0' }}>{error}</div>}

      <div className="cfo-grid cfo-grid-2" style={{ marginTop: readiness ? 18 : 0 }}>
        <Card title="1 · Basic Tax Profile">
          <div className="cfo-form2">
            <Field label="Country" k="country" options={['Indonesia', 'Singapore', 'Other']} />
            <Field label="Jurisdiction" k="jurisdiction" placeholder="e.g. ID" />
            <Field label="Legal entity type" k="legal_entity_type" options={LEGAL_ENTITY} />
            <Field label="Foreign-owned company" k="foreign_owned" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />
            <Field label="Company legal name" k="company_legal_name" />
            <Field label="Brand / trading name" k="brand_name" />
          </div>
        </Card>

        <Card title="2 · Tax Identity">
          <div className="cfo-form2">
            <Field label="NPWP" k="npwp" placeholder="00.000.000.0-000.000" />
            <Field label="KPP (registered tax office)" k="kpp" />
            <Field label="PKP status" k="pkp_status" options={[{ value: 'pkp_registered', label: 'PKP registered' }, { value: 'non_pkp', label: 'Non-PKP' }, { value: 'unknown', label: 'Unknown' }]} />
            <Field label="PKP effective date" k="pkp_effective_date" type="date" />
            <Field label="Financial year start" k="financial_year_start" type="date" />
            <Field label="Financial year end" k="financial_year_end" type="date" />
          </div>
        </Card>

        <Card title="3 · Business Activity">
          <div className="cfo-form2">
            <Field label="NIB number" k="nib" />
            <Field label="NIB issue date" k="nib_issue_date" type="date" />
            <Field label="Primary KBLI" k="primary_kbli" placeholder="e.g. 62090" />
            <Field label="Additional KBLI" k="additional_kbli" placeholder="comma-separated" />
            <Field label="Actual business activities" k="actual_business_activities" />
          </div>
        </Card>

        <Card title="4 · Employees">
          <div className="cfo-form2">
            <Field label="Has employees" k="employee_status" options={[{ value: 'has_employees', label: 'Yes' }, { value: 'no_employees', label: 'No' }]} />
            <Field label="Employee count" k="employee_count" type="number" />
            <Field label="Local employees" k="local_employee_count" type="number" />
            <Field label="Foreign employees" k="foreign_employee_count" type="number" />
            <Field label="Payroll frequency" k="payroll_frequency" options={['Monthly', 'Bi-weekly', 'Weekly']} />
            <Field label="BPJS registered" k="bpjs_registered" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
          </div>
        </Card>

        <Card title="5 · Transaction Types">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Service revenue', 'Product sales', 'Rent', 'Payroll', 'Contractor payments', 'Import/export', 'Loans/funding', 'Crypto', 'Other'].map(t => {
              const on = (form.transaction_types || []).includes(t)
              return <button key={t} onClick={() => set('transaction_types', on ? (form.transaction_types || []).filter(x => x !== t) : [...(form.transaction_types || []), t])}
                className={`cfo-badge ${on ? 'cfo-badge-info' : 'cfo-badge-neutral'}`} style={{ cursor: 'pointer', border: 0 }}>{on ? '✓ ' : ''}{t}</button>
            })}
          </div>
        </Card>

        <Card title="6 · Required Documents" action={<StatusBadge tone="neutral">Document Center</StatusBadge>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {REQUIRED_DOCS.map(d => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!docs[d]} onChange={e => setDocs(s => ({ ...s, [d]: e.target.checked }))} />
                <Icon.doc width="15" height="15" /> {d}
                <span style={{ marginLeft: 'auto' }}><StatusBadge tone={docs[d] ? 'success' : 'danger'}>{docs[d] ? 'Linked' : 'Missing'}</StatusBadge></span>
              </label>
            ))}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Linking uses the existing Document Center. OCR / extraction / filing are not part of V1.</div>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Btn>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        Verification states: {Object.values(VSTATES).map(v => v.label).join(' · ')}. Persisted fields sync to your account; “draft” fields are saved locally until the additive profile migration is applied. This is a preliminary assessment, not final legal/tax advice.
      </div>
    </>
  )
}
const LBL = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }
const INP = { width: '100%', maxWidth: '100%', padding: '10px 11px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-ui)', fontSize: 14, background: 'var(--surface-card)', color: 'var(--text-primary)', boxSizing: 'border-box' }
