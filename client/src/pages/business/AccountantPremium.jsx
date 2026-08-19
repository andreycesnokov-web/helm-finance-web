// AI Accountant — PREMIUM module (P1 of _specs/business-premium-redesign.md).
// Gated by VITE_AI_ACCOUNTANT_PREMIUM; flag OFF renders the existing profile page
// unchanged. In-module tabs: Workbench · Compliance Calendar · Tax Draft · Tax Profile.
//
// HONESTY CONTRACT: engines calculate, AI explains. Only REAL data is shown as real
// (profile completeness, deterministic obligations from /accountant/applicability,
// payables/receivables presence). Everything the tax engine doesn't provide yet is
// explicitly labelled "preview / engine not connected" — never fake numbers.
// No backend, no migrations. Frontend + existing endpoints only.
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { PageHeader, Card, Btn, StatusBadge, Stat, DataList, LoadingSkeleton, Icon, PageTabs, EmptyState } from '../../shell/ui'
import { BusinessAccountant } from './Accountant'
import { buildDocumentActions, applicableMissingFields } from '../../lib/accountantReadiness'
import { createRequestGuard } from '../../lib/requestGuard'

const PREMIUM = import.meta.env.VITE_AI_ACCOUNTANT_PREMIUM === 'true'
const SYMBOL = '/brand/symbol_navy_blue_dot_transparent.svg'

const idr = (v) => 'Rp ' + Number(v || 0).toLocaleString('en-US')
// Deterministic obligation → display. calculated shows the real amount; the other two
// states show honest text and are visually distinct (never look like a number).
function obligationDisplay(o) {
  if (!o) return { amount: '—', note: '', tone: 'muted' }
  if (o.status === 'calculated') return { amount: idr(o.amount), note: o.source_label, tone: 'calc' }
  if (o.status === 'insufficient_data') return { amount: 'insufficient data', note: o.source_label, tone: 'muted' }
  return { amount: 'not enabled', note: o.source_label, tone: 'muted' } // unavailable
}
const findOb = (obligations, type) => (obligations?.obligations || []).find(o => o.obligation_type === type)

// ── Static Indonesian compliance schedule (deterministic; engine wiring later) ──
// Generic monthly deadlines under Indonesian tax law. Amount/source wiring arrives
// with the tax-engine endpoints; dates themselves are fixed statutory rules.
export function idComplianceDeadlines(year, month /* 0-based */) {
  const mk = (day, key, title, sub, kind) => ({ day, key, title, sub, kind, date: new Date(year, month, day) })
  return [
    mk(10, 'pph2126', 'PPH 21/26 payment', 'Employee withholding · from Payroll', 'withholding'),
    mk(10, 'pph23', 'PPH 23 payment', 'Service withholding · from Payables', 'service'),
    mk(15, 'pph25', 'PPH 25 installment', 'Corporate income tax installment', 'cit'),
    mk(20, 'pph21file', 'PPH 21/26 filing', 'Monthly withholding return', 'withholding'),
    mk(new Date(year, month + 1, 0).getDate(), 'ppn', 'PPN filing & payment', 'VAT for the previous period · from Invoices', 'ppn'),
  ]
}

const KIND_TONE = { ppn: 'info', withholding: 'danger', service: 'neutral', cit: 'warning' }

export function BusinessAccountantHub() {
  if (!PREMIUM) return <BusinessAccountant />
  return <PremiumAccountant />
}

function PremiumAccountant() {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const navigate = useNavigate()
  const [tab, setTab] = useState('workbench')
  // Bumped when the Tax Profile tab saves, so the Workbench reloads its checklist:
  // changing PKP status changes which documents are required.
  const [profileVersion, setProfileVersion] = useState(0)
  const EMPTY = { loading: true, applicability: null, profile: null, pulse: null, obligations: null, checklist: null }
  const [state, setState] = useState(EMPTY)
  // Ignores a response from a workspace the user has already switched away from.
  const guard = useRef(createRequestGuard())

  useEffect(() => {
    // Clear FIRST so business A's pending actions can never render under business B.
    setState(EMPTY)
    if (!token || !active) return
    const req = guard.current.start()
    const opts = { signal: req.signal }
    Promise.all([
      apiFetch('/accountant/applicability', token, opts).catch(() => null),
      apiFetch('/accountant/profile', token, opts).catch(() => null),
      apiFetch('/pulse', token, opts).catch(() => null),
      apiFetch('/accountant/obligations', token, opts).catch(() => null),
      // Same source of truth as the Compliance Documents checklist.
      apiFetch('/ai-accountant/required-documents', token, opts).catch(() => null),
    ]).then(([applicability, profile, pulse, obligations, checklist]) => {
      if (req.isStale()) return
      setState({ loading: false, applicability, profile: profile?.profile || null, pulse, obligations, checklist })
    })
    return () => guard.current.abort()
  }, [token, active?.id, scopeKey, profileVersion])

  const head = (
    <PageHeader eyebrow="AI Accountant · Indonesia" title="Tax & Compliance Workbench"
      actions={<StatusBadge tone="info">Preview — engine wiring in progress</StatusBadge>} />
  )
  const tabs = [
    { key: 'workbench', label: 'Workbench' },
    { key: 'calendar', label: 'Compliance Calendar' },
    { key: 'taxdraft', label: 'Tax Draft' },
    { key: 'audit', label: 'Audit' },
    { key: 'profile', label: 'Tax Profile' },
  ]
  return (
    <>
      {tab !== 'profile' && head}
      <div style={{ margin: tab !== 'profile' ? '0 0 18px' : '0 0 18px' }}>
        <PageTabs tabs={tabs} active={tab} onChange={setTab} />
      </div>
      {tab === 'workbench' && <Workbench state={state} setTab={setTab} navigate={navigate} />}
      {tab === 'calendar' && <CalendarTab obligations={state.obligations} />}
      {tab === 'taxdraft' && <TaxDraftTab obligations={state.obligations} />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'profile' && <BusinessAccountant
        onProfileSaved={() => setProfileVersion(v => v + 1)}
        onDocumentsChanged={() => setProfileVersion(v => v + 1)} />}
    </>
  )
}

// ── Workbench (dashboard) ─────────────────────────────────────────────────────
function Workbench({ state, setTab, navigate }) {
  if (state.loading) return <Card><LoadingSkeleton rows={5} height={18} /></Card>
  const ap = state.applicability || { applicable_rules: [], missing_profile_fields: [] }
  // Fields that do not apply to this profile (vat_status on a Non-PKP company) are not gaps.
  // The Tax Profile badges say "Not required"; the Workbench must not contradict them.
  const missing = applicableMissingFields(state.profile || {}, ap.missing_profile_fields || [])
  const rules = ap.applicable_rules || []
  const d = state.pulse || {}

  // Profile completeness — REAL: persisted fields present vs missing (deterministic).
  const knownFields = 9 // country, jurisdiction, entity, npwp, pkp, fy start/end, nib, employees
  const completeness = Math.max(0, Math.min(100, Math.round(((knownFields - Math.min(missing.length, knownFields)) / knownFields) * 100)))

  // Synced modules — real presence signals from /pulse (no fake counts).
  const chips = [
    { label: 'Transactions', ok: (d.recentTxs || []).length > 0 },
    { label: 'Receivables', ok: Number(d.receivables || 0) > 0 || Number(d.pendingReceivables || 0) > 0 },
    { label: 'Payables', ok: Number(d.payables || 0) > 0 || Number(d.pendingPayables || 0) > 0 },
    { label: 'Payroll', ok: null }, { label: 'Bank Import', ok: null }, // presence unknown here — neutral
  ]

  const nextDeadlines = upcomingDeadlines(3)
  const obs = state.obligations?.obligations || []
  const reserve = Number(state.obligations?.reserve?.amount || 0)
  const reserveLines = (state.obligations?.reserve?.lines || []).length

  // Document actions come from the SAME payload the Compliance Documents checklist renders —
  // never from a hardcoded list, which is how the Workbench used to ask for an already
  // uploaded NPWP/NIB. Everything routes to Tax Profile, where the checklist and the upload
  // window live, rather than to the generic Document Center.
  const docActions = buildDocumentActions(state.checklist, { form: state.profile || {} })
  const goDocs = () => setTab('profile')

  const actions = []
  if (missing.length) actions.push({ id: 'profile', label: 'Complete your tax profile', sub: `${missing.length} field${missing.length > 1 ? 's' : ''} missing — obligations depend on it`, cta: 'Complete', go: () => setTab('profile') })
  // Already ordered identity -> tax registration -> payroll by the helper, and each action
  // carries the priority label, so a BPJS row never reads like a foundation document.
  for (const a of docActions.actions) {
    actions.push({ id: a.id, label: a.label, sub: a.sub, group: a.group, priority: a.priority,
      cta: a.type === 'upload' ? 'Upload' : a.type === 'confirm' ? 'Confirm' : 'Enter', go: goDocs })
  }
  if (docActions.available && !docActions.actions.length) {
    actions.push({ id: 'docs-ok', label: 'Required documents are in place',
      sub: 'Preliminary — the checklist reflects your profile and the documents you uploaded, not an official validation',
      cta: 'Review', go: goDocs })
  }
  if (!docActions.available) {
    actions.push({ id: 'docs-unknown', label: 'Complete compliance documents',
      sub: docActions.reason === 'truncated'
        ? 'Too many documents to check at once — open the checklist to review them'
        : 'Open the Compliance Documents checklist to see what is still needed',
      cta: 'Open', go: goDocs })
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {chips.map(c => (
          <StatusBadge key={c.label} tone={c.ok === null ? 'neutral' : c.ok ? 'success' : 'neutral'}>
            {c.ok ? <Icon.check width="13" height="13" /> : null} {c.label}{c.ok === false ? ' · no data yet' : ''}
          </StatusBadge>
        ))}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Synced read-only from your workspace modules.</span>
      </div>

      <div className="cfo-grid cfo-grid-2" style={{ marginBottom: 18 }}>
        <div className="cfo-summary" style={{ padding: '20px 22px' }}>
          <div className="cfo-summary-label">Tax reserve · IDR</div>
          <div className="cfo-summary-value" style={{ fontSize: 30 }}>{reserve > 0 ? idr(reserve) : '—'}</div>
          <div className="cfo-summary-meta">
            {reserve > 0
              ? <>Sum of obligations with a real deterministic amount ({reserveLines} line{reserveLines === 1 ? '' : 's'}). Insufficient-data rows and PPN are excluded.</>
              : <>No obligation has a deterministic amount yet — nothing is estimated. Record tax withholding in Payroll and it appears here.</>}
          </div>
        </div>
        <Card title="Profile completeness" action={<StatusBadge tone={completeness >= 80 ? 'success' : 'warning'}>{completeness}%</StatusBadge>}>
          <div style={{ height: 8, borderRadius: 5, background: 'var(--surface-page)', margin: '6px 0 10px' }}>
            <div style={{ height: 8, width: `${completeness}%`, borderRadius: 5, background: completeness >= 80 ? 'var(--success)' : 'var(--brand-electric-blue)' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {rules.length} deterministic obligation{rules.length === 1 ? '' : 's'} identified from your profile{missing.length ? ` · ${missing.length} field${missing.length > 1 ? 's' : ''} still missing` : ''}.
          </div>
        </Card>
      </div>

      <Card title="Tax obligations" className="cfo-mt" action={<StatusBadge tone="neutral">{state.obligations?.period || ''}</StatusBadge>}>
        {obs.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No obligations resolved yet.</div>
          : <DataList items={obs.map(o => {
              const dsp = obligationDisplay(o)
              return {
                id: o.obligation_type,
                label: o.title,
                sub: dsp.note,
                amount: dsp.amount,
                amountTone: dsp.tone === 'calc' ? 'cfo-neg' : '',
              }
            })} />}
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Amounts are read only from data you recorded — the engine calculates, it never estimates. PPN needs invoicing (not enabled).
        </div>
      </Card>

      <div className="cfo-grid cfo-grid-2 cfo-mt">
        <Card title="Pending actions">
          {actions.length === 0
            ? <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nothing pending — nice.</div>
            : <DataList items={actions.map(a => ({ id: a.id, label: a.label, sub: a.sub, action: <Btn sm variant="ghost" onClick={a.go}>{a.cta}</Btn> }))} />}
        </Card>
        <Card title="Compliance calendar" action={<Btn sm variant="ghost" onClick={() => setTab('calendar')}>Open calendar</Btn>}>
          <DataList items={nextDeadlines.map(x => ({
            id: x.key + x.date.toISOString(),
            label: x.title,
            sub: x.sub,
            amount: x.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            amountTone: '',
          }))} />
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Statutory schedule (static rules). Amounts appear once the engine is connected.</div>
        </Card>
      </div>

      <Card title="This month, in plain language" className="cfo-mt" style={{ borderLeft: '3px solid var(--brand-electric-blue)' }}>
        <div className="cfo-grid cfo-grid-3">
          <PlainCard k="What to do" v={nextDeadlines[0] ? `${nextDeadlines[0].title} by ${nextDeadlines[0].date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` : 'No statutory deadlines left this month.'} />
          <PlainCard k="Why" v="These are fixed Indonesian statutory deadlines. Exact amounts will come from the deterministic tax engine with legal source references." />
          {/* `missing` is the FILTERED list — a field that does not apply (vat_status on a
              Non-PKP company) must not read as an unfinished profile here either. */}
          <PlainCard k="What to prepare" v={missing.length ? 'Finish your tax profile so obligations can be computed.' : 'Keep invoices and payroll records confirmed and up to date.'} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Btn disabled title="Available once the tax engine is connected">Prepare filing pack (soon)</Btn>
          <Btn variant="ghost" onClick={() => navigate('/business/ai-cfo')}>Ask AI CFO</Btn>
        </div>
      </Card>
    </>
  )
}

function PlainCard({ k, v }) {
  return (
    <div style={{ background: 'var(--surface-page)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div style={{ fontSize: 11, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--brand-electric-blue-ink)' }}>{k}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.5 }}>{v}</div>
    </div>
  )
}

export function upcomingDeadlines(n = 3) {
  const now = new Date()
  const list = [
    ...idComplianceDeadlines(now.getFullYear(), now.getMonth()),
    ...idComplianceDeadlines(now.getFullYear(), now.getMonth() + 1),
  ].filter(x => x.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  return list.sort((a, b) => a.date - b.date).slice(0, n)
}

// ── Compliance Calendar (real month grid, per owner decision) ─────────────────
// Deadline key → obligation type, so each row can show its deterministic amount/state.
const DEADLINE_OB = { pph2126: 'pph_21_26', pph21file: 'pph_21_26', pph23: 'pph_23', ppn: 'ppn' }
function CalendarTab({ obligations }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const deadlines = idComplianceDeadlines(ym.y, ym.m)
  const byDay = new Map(deadlines.map(d => [d.day, d]))
  const first = new Date(ym.y, ym.m, 1)
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isToday = (day) => day && ym.y === now.getFullYear() && ym.m === now.getMonth() && day === now.getDate()

  const cellStyle = (day) => {
    const dl = byDay.get(day)
    if (!dl) return {}
    if (dl.kind === 'ppn') return { background: 'var(--brand-electric-blue)', color: '#fff', fontWeight: 700 }
    if (dl.kind === 'withholding') return { background: 'var(--danger-soft)', color: 'var(--danger)', fontWeight: 700 }
    if (dl.kind === 'cit') return { background: 'var(--warning-soft)', color: 'var(--warning)', fontWeight: 700 }
    return { background: 'var(--info-soft)', color: 'var(--brand-navy)', fontWeight: 700 }
  }

  return (
    <div className="cfo-grid cfo-grid-2">
      <Card title={title} action={<span style={{ display: 'flex', gap: 6 }}>
        <Btn sm variant="ghost" onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>←</Btn>
        <Btn sm variant="ghost" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>→</Btn>
      </span>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 4 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600, padding: '2px 0' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
          {cells.map((day, i) => (
            <div key={i} className="cfo-mono" style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, borderRadius: 9, color: 'var(--text-secondary)', outline: isToday(day) ? '2px solid var(--brand-electric-blue)' : 'none', outlineOffset: -2, ...cellStyle(day) }}>
              {day || ''}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
          <Legend color="var(--brand-electric-blue)" label="PPN" />
          <Legend color="var(--danger)" label="Withholding (PPH 21/26)" />
          <Legend color="var(--brand-navy)" label="Service tax (PPH 23)" />
          <Legend color="var(--warning)" label="CIT installment (PPH 25)" />
        </div>
      </Card>
      <Card title="Deadlines this month">
        <DataList items={deadlines.map(x => {
          const ob = DEADLINE_OB[x.key] ? findOb(obligations, DEADLINE_OB[x.key]) : null
          const dsp = ob ? obligationDisplay(ob) : null
          return {
            id: x.key,
            label: x.title,
            sub: dsp ? `${x.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · ${dsp.amount}` : `${x.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · ${x.sub}`,
            amount: dsp && dsp.tone === 'calc' ? dsp.amount : x.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            amountTone: '',
          }
        })} />
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          Fixed Indonesian statutory schedule. Amounts shown are computed only from data you recorded; “insufficient data” / “not enabled” means no estimate is made.
        </div>
        <Btn disabled title="Available once the tax engine is connected" style={{ marginTop: 12 }}>Prepare filing pack (soon)</Btn>
      </Card>
    </div>
  )
}

function Legend({ color, label }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary)' }}>
    <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} /> {label}
  </span>
}

// ── Tax Draft (layout preview — CIT engine not connected; only recorded numbers) ─
function TaxDraftTab({ obligations }) {
  const row = (label, mono = '—') => ({ id: label, label, amount: mono, amountTone: '' })
  const pph21 = findOb(obligations, 'pph_21_26')
  const hasWithholding = pph21 && pph21.status === 'calculated'
  return (
    <>
      {hasWithholding && (
        <Card title="Payroll withholding (PPH 21/26)" className="cfo-mb" style={{ borderLeft: '3px solid var(--success)' }} action={<StatusBadge tone="success">Calculated</StatusBadge>}>
          <DataList items={[{ id: 'w', label: 'Withholding to remit', sub: pph21.source_label, amount: idr(pph21.amount), amountTone: '' }]} />
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>Period {pph21.period} · due {new Date(pph21.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. Read from recorded payroll withholding lines — not an estimate.</div>
        </Card>
      )}
      <div className="cfo-grid cfo-grid-2">
        <Card title="Deterministic calculation" action={<StatusBadge tone="neutral">Base currency: IDR</StatusBadge>}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Corporate Income Tax (CIT) draft — the CIT engine is not connected yet. No estimated numbers are shown.</div>
          <DataList items={[
            row('Gross revenue'), row('Non-object income'), row('Operating expenses'),
            row('Deductible splits'), row('Non-deductible splits'),
          ]} />
          <div style={{ background: 'var(--info-soft)', borderRadius: 'var(--radius-md)', padding: '10px 12px', margin: '10px 0', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13.5 }}>
            <span>Taxable income</span><span className="cfo-mono">—</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14 }}>
            <span>Estimated tax liability</span><span className="cfo-mono">—</span>
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 700 }}>Official source traceability</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <SourceCard title="UU No. 36 / 2008" sub="Income tax law" />
            <SourceCard title="PP No. 94 / 2010" sub="Implementation reg." />
          </div>
        </Card>
        <Card title="AI explanation">
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            When the deterministic tax engine computes your draft, this panel explains each line in plain language —
            income classification, cost segregation and applicable facilities (e.g. Article 31E) — always citing the
            legal source. <b>The engine calculates; AI only explains.</b>
          </div>
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface-page)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text-muted)' }}>
            No draft exists yet — the tax engine is not connected. This screen shows the final layout; no estimated
            numbers are displayed until they are real.
          </div>
        </Card>
      </div>
      <Card className="cfo-mt">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <StatusBadge tone="neutral">Status: no draft — engine not connected</StatusBadge>
          <span style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" disabled title="Available once the tax engine is connected">Export PDF (soon)</Btn>
            <Btn disabled title="Available once the tax engine is connected">Request professional review (soon)</Btn>
          </span>
        </div>
      </Card>
    </>
  )
}

// ── Audit trail (P3 — REAL data from GET /api/audit/events, 023 audit_events) ─
function AuditTab() {
  const { token } = useAuth()
  const { active, scopeKey } = useWorkspace()
  const [state, setState] = useState({ loading: true, events: [], total: 0, error: null })
  const [entityType, setEntityType] = useState('')

  useEffect(() => {
    if (!token || !active) return
    let on = true; setState(s => ({ ...s, loading: true, error: null }))
    apiFetch(`/audit/events?limit=50${entityType ? `&entity_type=${encodeURIComponent(entityType)}` : ''}`, token)
      .then(d => on && setState({ loading: false, events: d.events || [], total: d.total || 0, error: null }))
      .catch(e => on && setState({ loading: false, events: [], total: 0, error: e.message }))
    return () => { on = false }
  }, [token, active?.id, scopeKey, entityType])

  if (state.loading) return <Card><LoadingSkeleton rows={6} height={16} /></Card>
  if (state.error) {
    const forbidden = /role|forbidden/i.test(state.error)
    return <Card><div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{forbidden ? 'Your role cannot view the audit trail (owner / admin / CFO / auditor only).' : state.error}</div></Card>
  }
  const types = [...new Set(state.events.map(e => e.entity_type))]
  const actors = new Set(state.events.map(e => e.actor_name))
  const fmtTs = (t) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <div className="cfo-grid cfo-grid-3" style={{ marginBottom: 16 }}>
        <Card title="Total entries"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 22 }}>{state.total.toLocaleString('en-US')}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>business-scoped, append-only</div></Card>
        <Card title="Actors in view"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 22 }}>{actors.size}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>people + system processes</div></Card>
        <Card title="Latest event"><div className="cfo-stat-v cfo-mono" style={{ fontSize: 16 }}>{state.events[0] ? fmtTs(state.events[0].created_at) : '—'}</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>most recent activity</div></Card>
      </div>
      <Card title="Audit trail" action={
        <select className="cfo-input" style={{ maxWidth: 200 }} value={entityType} onChange={e => setEntityType(e.target.value)}>
          <option value="">All entity types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      }>
        {state.events.length === 0
          ? <EmptyState symbol={SYMBOL} title="No audit events yet" description="Actions across your workspace (profile changes, rule updates, approvals) will appear here as an append-only trail." />
          : <DataList items={state.events.map(e => ({
              id: e.id,
              label: `${e.entity_type} · ${e.action}`,
              tag: e.channel || undefined,
              sub: `${e.actor_name}${e.actor_role ? ` (${e.actor_role})` : ''}${e.entity_id ? ` · ${String(e.entity_id).slice(0, 12)}` : ''}`,
              amount: fmtTs(e.created_at), amountTone: '',
            }))} />}
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          Read-only envelope (who / what / when / channel). Record snapshots are never exposed here.
        </div>
      </Card>
    </>
  )
}

function SourceCard({ title, sub }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface-page)', borderRadius: 'var(--radius-md)', padding: '9px 11px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}
