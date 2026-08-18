// AI Accountant — Company Tax & Compliance Profile (V1 UI). Business workspace only.
// Persisted fields wire to GET/PUT /api/accountant/profile (existing backend, unchanged).
// New fields (not yet in schema — see migration 040 PROPOSAL) are LOCAL DRAFT until 040
// is applied. Obligations come from /api/accountant/applicability (deterministic, no LLM).
// No tax-calculation/logic change; no OCR/extraction/filing. Mobile-safe.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { PageHeader, Card, Btn, StatusBadge, Stat, ErrorState, LoadingSkeleton, Icon } from '../../shell/ui'
import DocumentIntakeModal from '../../components/DocumentIntakeModal'
import { createRequestGuard } from '../../lib/requestGuard'
import { buildReadiness } from '../../lib/accountantReadiness'

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

export function BusinessAccountant() {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({})
  const [obligations, setObligations] = useState({ applicable_rules: [], missing_profile_fields: [] })
  const [saving, setSaving] = useState(false)
  const [savedMissingFields, setSavedMissingFields] = useState([])
  const [profileSaved, setProfileSaved] = useState(false)
  // Document intake (Phase 1): real checklist + classified inbox for the ACTIVE business.
  const [checklist, setChecklist] = useState(null)
  const [intake, setIntake] = useState(null)
  const [intakeLoading, setIntakeLoading] = useState(true)
  const [intakeErr, setIntakeErr] = useState('')
  // Ignores responses from a workspace the user has already switched away from.
  const intakeGuard = useRef(createRequestGuard())
  const [showUpload, setShowUpload] = useState(false)
  const [confirming, setConfirming] = useState(null)

  useEffect(() => {
    // Saved-profile state belongs to ONE workspace: clear it before anything else so
    // business A's "Profile saved" banner and missing-field list can never be shown
    // under business B.
    setProfileSaved(false); setSavedMissingFields([])
    setObligations({ applicable_rules: [], missing_profile_fields: [] })
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

  // Re-fetched per active workspace (scopeKey bumps on switch), so documents from another
  // business can never linger on screen.
  const loadIntake = useCallback(() => {
    // Clear FIRST: never leave the previous workspace's documents on screen while the new
    // workspace loads.
    setChecklist(null); setIntake(null); setIntakeErr('')
    if (!token || !active) { setIntakeLoading(false); return }
    setIntakeLoading(true)
    const req = intakeGuard.current.start()
    const opts = { signal: req.signal }
    Promise.allSettled([
      apiFetch('/ai-accountant/required-documents', token, opts),
      apiFetch('/ai-accountant/document-intake', token, opts),
    ]).then(([cl, ik]) => {
      if (req.isStale()) return                       // a newer workspace load already won
      if (cl.status === 'fulfilled') setChecklist(cl.value)
      else setIntakeErr(cl.reason?.message || 'Checklist unavailable')
      if (ik.status === 'fulfilled') setIntake(ik.value)
      setIntakeLoading(false)
    })
  }, [token, active?.id])

  useEffect(() => {
    loadIntake()
    // Abort in-flight work when the workspace changes or the page unmounts.
    return () => intakeGuard.current.abort()
  }, [loadIntake, scopeKey])

  const confirmType = async (docId, docType) => {
    setConfirming(docId)
    try {
      await apiFetch(`/ai-accountant/documents/${docId}/classification`, token, { method: 'PATCH', body: { doc_type: docType } })
      loadIntake()
    } catch (e) { alert(e.message || 'Could not update the document type') } finally { setConfirming(null) }
  }

  // Re-read an existing document's content (documents uploaded before Phase 2, or where
  // extraction failed). Never overwrites a manually confirmed type — the backend refuses.
  const reclassify = async (docId) => {
    setConfirming(docId)
    try {
      await apiFetch(`/ai-accountant/documents/${docId}/reclassify`, token, { method: 'POST' })
      loadIntake()
    } catch (e) { alert(e.message || 'Could not re-read the document') } finally { setConfirming(null) }
  }

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
      setSavedMissingFields(res?.completeness?.missing || ap.missing_profile_fields || [])
      setProfileSaved(true)
      // The profile drives which documents are required — reload the checklist so the
      // readiness card and the Compliance Documents card stay on the same answer.
      loadIntake()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }, [form, token, active, obligations, loadIntake])

  // Readiness is DERIVED from the checklist payload, not from a second local list, so the
  // card can never contradict Compliance Documents.
  const readiness = useMemo(() => buildReadiness(checklist, {
    form,
    missingFields: savedMissingFields.length ? savedMissingFields : (obligations.missing_profile_fields || []),
    obligations: (obligations.applicable_rules || []).length,
  }), [checklist, form, savedMissingFields, obligations])

  // Shared props for <Field>. Field itself lives at MODULE scope (see bottom of file) so
  // its component identity is stable across renders — that is what keeps input focus.
  const fp = { form, set, vstatus }

  const head = (
    <PageHeader eyebrow="Business Workspace · AI Accountant" title="Company Tax & Compliance Profile"
      actions={<><StatusBadge tone="info">Preliminary assessment</StatusBadge><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Btn></>} />
  )
  if (loading) return <>{head}<Card><LoadingSkeleton rows={6} height={18} /></Card></>
  if (error && !form) return <>{head}<ErrorState description={error} onRetry={() => location.reload()} /></>

  return (
    <>{head}
      {!intakeLoading && (
        <Card title="AI Accountant readiness" action={<StatusBadge tone="warning">Needs accountant review</StatusBadge>} className="cfo-accountant-readiness" >
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>
            {profileSaved ? 'Profile saved. ' : ''}Preliminary assessment (not final tax advice). Document counts come from the Compliance Documents checklist below:
          </div>
          <div className="cfo-grid cfo-grid-4" style={{ marginBottom: 14 }}>
            <Stat k="Likely obligations" v={readiness.obligations} />
            <Stat k="Missing documents" v={readiness.available ? readiness.missingDocs : '—'} tone={readiness.missingDocs ? 'neg' : 'pos'} />
            <Stat k="Need confirmation" v={readiness.available ? readiness.needsConfirmation : '—'} tone={readiness.needsConfirmation ? 'neg' : 'pos'} />
            <Stat k="Verification gaps" v={readiness.verificationGaps} tone={readiness.verificationGaps ? 'neg' : 'pos'} />
          </div>
          {readiness.riskFlags.map((r, i) => <div key={i} style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 4 }}>⚠ {r}</div>)}
          <div style={{ marginTop: 8, padding: 12, background: 'var(--info-soft)', borderRadius: 'var(--radius-md)', fontSize: 14 }}>
            <strong>Suggested next action:</strong> {readiness.next}
          </div>
        </Card>
      )}

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0' }}>{error}</div>}

      <div className="cfo-grid cfo-grid-2" style={{ marginTop: 18 }}>
        <Card title="1 · Basic Tax Profile">
          <div className="cfo-form2">
            <Field {...fp} label="Country" k="country" options={['Indonesia', 'Singapore', 'Other']} />
            <Field {...fp} label="Jurisdiction" k="jurisdiction" placeholder="e.g. ID" />
            <Field {...fp} label="Legal entity type" k="legal_entity_type" options={LEGAL_ENTITY} />
            <Field {...fp} label="Foreign-owned company" k="foreign_owned" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />
            <Field {...fp} label="Company legal name" k="company_legal_name" />
            <Field {...fp} label="Brand / trading name" k="brand_name" />
          </div>
        </Card>

        <Card title="2 · Tax Identity">
          <div className="cfo-form2">
            <Field {...fp} label="NPWP" k="npwp" placeholder="00.000.000.0-000.000" />
            <Field {...fp} label="KPP (registered tax office)" k="kpp" />
            <Field {...fp} label="PKP status" k="pkp_status" options={[{ value: 'pkp_registered', label: 'PKP registered' }, { value: 'non_pkp', label: 'Non-PKP' }, { value: 'unknown', label: 'Unknown' }]} />
            <Field {...fp} label="PKP effective date" k="pkp_effective_date" type="date" />
            <Field {...fp} label="Financial year start" k="financial_year_start" type="date" />
            <Field {...fp} label="Financial year end" k="financial_year_end" type="date" />
          </div>
        </Card>

        <Card title="3 · Business Activity">
          <div className="cfo-form2">
            <Field {...fp} label="NIB number" k="nib" />
            <Field {...fp} label="NIB issue date" k="nib_issue_date" type="date" />
            <Field {...fp} label="Primary KBLI" k="primary_kbli" placeholder="e.g. 62090" />
            <Field {...fp} label="Additional KBLI" k="additional_kbli" placeholder="comma-separated" />
            <Field {...fp} label="Actual business activities" k="actual_business_activities" />
          </div>
        </Card>

        <Card title="4 · Employees">
          <div className="cfo-form2">
            <Field {...fp} label="Has employees" k="employee_status" options={[{ value: 'has_employees', label: 'Yes' }, { value: 'no_employees', label: 'No' }]} />
            <Field {...fp} label="Employee count" k="employee_count" type="number" />
            <Field {...fp} label="Local employees" k="local_employee_count" type="number" />
            <Field {...fp} label="Foreign employees" k="foreign_employee_count" type="number" />
            <Field {...fp} label="Payroll frequency" k="payroll_frequency" options={['Monthly', 'Bi-weekly', 'Weekly']} />
            <Field {...fp} label="BPJS registered" k="bpjs_registered" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
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

      </div>

      {/* ── Document intake (Phase 1) ─────────────────────────────────────────
          One upload window; CFO AI classifies and files. The checklist is PRELIMINARY and
          driven by the saved profile — an uncertain match shows "needs review" and never
          counts as satisfied. */}
      <div style={{ marginTop: 18 }}>
        <Card
          title="Compliance documents · preliminary"
          action={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {intake?.needs_review_count > 0 && <StatusBadge tone="warning">{intake.needs_review_count} need review</StatusBadge>}
            <Btn sm onClick={() => setShowUpload(true)}>Upload documents</Btn>
          </span>}>

          {intakeErr && <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{intakeErr}</div>}
          {intakeLoading && <LoadingSkeleton rows={4} height={16} />}
          {!intakeLoading && !checklist && !intakeErr && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checklist unavailable.</div>}

          {!intakeLoading && checklist && <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <StatusBadge tone="success">{checklist.counts.uploaded} uploaded</StatusBadge>
              <StatusBadge tone="warning">{checklist.counts.needs_review} need review</StatusBadge>
              <StatusBadge tone="danger">{checklist.counts.missing} missing</StatusBadge>
              <StatusBadge tone="neutral">{checklist.counts.optional} optional</StatusBadge>
              <StatusBadge tone="neutral">{checklist.counts.not_required} not required</StatusBadge>
            </div>

            <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {checklist.items.map((it, i) => (
                <div key={it.type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '0.5px solid var(--border-subtle)' : 'none' }}>
                  <Icon.doc width="15" height="15" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.label}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{it.reason}</span>
                  </span>
                  <StatusBadge tone={
                    it.status === 'uploaded' ? 'success'
                      : it.status === 'needs_review' ? 'warning'
                        : it.status === 'missing' ? 'danger' : 'neutral'
                  }>{it.status.replace('_', ' ')}</StatusBadge>
                </div>
              ))}
            </div>

            {(checklist.warnings || []).map((w, i) => (
              <div key={i} style={{ marginTop: 8, fontSize: 12, color: 'var(--warning)' }}>⚠ {w}</div>
            ))}
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{checklist.disclaimer}</div>
          </>}
        </Card>
      </div>

      {/* Intake inbox — confirm or correct what was detected. */}
      {!intakeLoading && intake?.documents?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title={`Document intake · ${intake.documents.length}`} action={<StatusBadge tone="neutral">{intake.business?.name || 'This workspace'}</StatusBadge>}>
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {intake.documents.map((d, i) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderTop: i ? '0.5px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.file_name || '(unnamed file)'}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {d.intake.confidence} confidence · routed to {d.routed_to.replace('_', ' ')}
                      {intake.content_classification_enabled && d.intake.extraction?.text_available === false && ' · text could not be read'}
                    </span>
                    {/* Why we think so — marker labels only, never document text. */}
                    {d.intake.explanation && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {d.intake.explanation}
                      </span>
                    )}
                    {d.intake.signals?.conflict && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--warning)', marginTop: 2 }}>
                        ⚠ File name suggests {d.intake.signals.conflict.file_name_suggests}, content suggests {d.intake.signals.conflict.content_suggests}.
                      </span>
                    )}
                  </span>
                  <StatusBadge tone={
                    d.intake.classification_status === 'manually_confirmed' ? 'success'
                      : d.intake.classification_status === 'auto_classified' ? 'info' : 'warning'
                  }>{d.intake.classification_status.replace(/_/g, ' ')}</StatusBadge>
                  {/* Manual correction always available — AI classification is never the last word. */}
                  <select
                    className="cfo-input" style={{ maxWidth: 210 }}
                    value={d.intake.doc_type}
                    disabled={confirming === d.id}
                    onChange={e => confirmType(d.id, e.target.value)}>
                    {(intake.types || []).map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                  </select>
                  <Btn sm variant="ghost" disabled={confirming === d.id || d.intake.classification_status === 'manually_confirmed'}
                    onClick={() => confirmType(d.id, d.intake.doc_type)}>
                    {confirming === d.id ? '…' : 'Confirm'}
                  </Btn>
                  {intake.content_classification_enabled && d.intake.classification_status !== 'manually_confirmed' && (
                    <Btn sm variant="ghost" disabled={confirming === d.id} onClick={() => reclassify(d.id)}>
                      {confirming === d.id ? 'Reading…' : 'Re-read'}
                    </Btn>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {intake.note} Confirming a type files the document into its compliance area and updates the checklist.
              Documents are archived from the Document Center — nothing is deleted here.
            </div>
          </Card>
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Btn>
      </div>
      {showUpload && (
        <DocumentIntakeModal
          business={intake?.business || active}
          onClose={() => setShowUpload(false)}
          onUploaded={loadIntake}
        />
      )}
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        Verification states: {Object.values(VSTATES).map(v => v.label).join(' · ')}. Persisted fields sync to your account; “draft” fields are saved locally until the additive profile migration is applied. This is a preliminary assessment, not final legal/tax advice.
      </div>
    </>
  )
}
// Tax-profile input. MUST stay at module scope.
//
// This used to be declared inside BusinessAccountant. Because a component declared during
// render gets a NEW function identity on every render, React treated each keystroke as a
// different component type, unmounted the subtree and mounted a fresh <input> — so the field
// lost focus after a single character. Keeping the declaration here makes the element type
// stable, so React updates the existing input in place and focus/caret survive typing.
//
// Values stay STRINGS end to end: identifiers such as NPWP/NIB keep leading zeros, dots and
// dashes, and are never coerced to numbers. No masking is applied while typing.
function Field({ label, k, type = 'text', options, placeholder, form, set, vstatus }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={LBL}>{label} {!PERSISTED.has(k) && <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>· draft</span>}</label>
      {options
        ? <select style={INP} value={form[k] ?? ''} onChange={e => set(k, e.target.value)}><option value="">—</option>{options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select>
        : <input style={INP} type={type} value={form[k] ?? ''} placeholder={placeholder} onChange={e => set(k, e.target.value)} />}
      {/* Status chip may change while typing; it is a sibling, so it never remounts the input. */}
      <div style={{ marginTop: 6 }}><StatusBadge tone={VSTATES[vstatus(k)].tone}>{VSTATES[vstatus(k)].label}</StatusBadge></div>
    </div>
  )
}

const LBL = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }
const INP = { width: '100%', maxWidth: '100%', padding: '10px 11px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-ui)', fontSize: 14, background: 'var(--surface-card)', color: 'var(--text-primary)', boxSizing: 'border-box' }
