// AI Accountant — PREMIUM module (P1 of _specs/business-premium-redesign.md).
// Gated by VITE_AI_ACCOUNTANT_PREMIUM; flag OFF renders the existing profile page
// unchanged. In-module tabs: Workbench · Compliance Calendar · Tax Draft · Tax Profile.
//
// HONESTY CONTRACT: engines calculate, AI explains. Only REAL data is shown as real
// (profile completeness, deterministic obligations from /accountant/applicability,
// payables/receivables presence). Everything the tax engine doesn't provide yet is
// explicitly labelled "preview / engine not connected" — never fake numbers.
// No backend, no migrations. Frontend + existing endpoints only.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { PageHeader, Card, Btn, StatusBadge, Stat, DataList, LoadingSkeleton, Icon, PageTabs } from '../../shell/ui'
import { BusinessAccountant } from './Accountant'

const PREMIUM = import.meta.env.VITE_AI_ACCOUNTANT_PREMIUM === 'true'

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
  const [state, setState] = useState({ loading: true, applicability: null, profile: null, pulse: null })

  useEffect(() => {
    if (!token || !active) return
    let on = true
    Promise.all([
      apiFetch('/accountant/applicability', token).catch(() => null),
      apiFetch('/accountant/profile', token).catch(() => null),
      apiFetch('/pulse', token).catch(() => null),
    ]).then(([applicability, profile, pulse]) => on && setState({ loading: false, applicability, profile: profile?.profile || null, pulse }))
    return () => { on = false }
  }, [token, active?.id, scopeKey])

  const head = (
    <PageHeader eyebrow="AI Accountant · Indonesia" title="Tax & Compliance Workbench"
      actions={<StatusBadge tone="info">Preview — engine wiring in progress</StatusBadge>} />
  )
  const tabs = [
    { key: 'workbench', label: 'Workbench' },
    { key: 'calendar', label: 'Compliance Calendar' },
    { key: 'taxdraft', label: 'Tax Draft' },
    { key: 'profile', label: 'Tax Profile' },
  ]
  return (
    <>
      {tab !== 'profile' && head}
      <div style={{ margin: tab !== 'profile' ? '0 0 18px' : '0 0 18px' }}>
        <PageTabs tabs={tabs} active={tab} onChange={setTab} />
      </div>
      {tab === 'workbench' && <Workbench state={state} setTab={setTab} navigate={navigate} />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'taxdraft' && <TaxDraftTab />}
      {tab === 'profile' && <BusinessAccountant />}
    </>
  )
}

// ── Workbench (dashboard) ─────────────────────────────────────────────────────
function Workbench({ state, setTab, navigate }) {
  if (state.loading) return <Card><LoadingSkeleton rows={5} height={18} /></Card>
  const ap = state.applicability || { applicable_rules: [], missing_profile_fields: [] }
  const missing = ap.missing_profile_fields || []
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

  const actions = []
  if (missing.length) actions.push({ id: 'profile', label: 'Complete your tax profile', sub: `${missing.length} field${missing.length > 1 ? 's' : ''} missing — obligations depend on it`, cta: 'Complete', go: () => setTab('profile') })
  actions.push({ id: 'docs', label: 'Link compliance documents', sub: 'NPWP, NIB, PKP certificate — via Document Center', cta: 'Open', go: () => navigate('/business/documents') })

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
          <div className="cfo-summary-value" style={{ fontSize: 30 }}>—</div>
          <div className="cfo-summary-meta">Calculated by the deterministic tax engine — <b>not connected yet</b>. No estimates are shown until real numbers exist.</div>
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

      <div className="cfo-grid cfo-grid-2">
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
          <PlainCard k="What to prepare" v={(state.applicability?.missing_profile_fields || []).length ? 'Finish your tax profile so obligations can be computed.' : 'Keep invoices and payroll records confirmed and up to date.'} />
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
function CalendarTab() {
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
        <DataList items={deadlines.map(x => ({
          id: x.key, label: x.title, sub: x.sub,
          amount: x.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), amountTone: '',
        }))} />
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          Fixed Indonesian statutory schedule. Per-deadline amounts and your filing status arrive with the tax engine — nothing here is an estimate.
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

// ── Tax Draft (layout preview — engine not connected; NO fake numbers) ────────
function TaxDraftTab() {
  const row = (label, mono = '—') => ({ id: label, label, amount: mono, amountTone: '' })
  return (
    <>
      <div className="cfo-grid cfo-grid-2">
        <Card title="Deterministic calculation" action={<StatusBadge tone="neutral">Base currency: IDR</StatusBadge>}>
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

function SourceCard({ title, sub }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface-page)', borderRadius: 'var(--radius-md)', padding: '9px 11px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}
