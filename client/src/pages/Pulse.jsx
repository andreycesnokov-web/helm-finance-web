import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

const SCOPE_LABELS = { all: 'All', business: 'Business', personal: 'Personal' }

// Hero card: always dark navy — status shown as accent/badge only, never full card fill
const STATUS = {
  healthy:   { accent: '#12B76A', label: 'Healthy'   },
  attention: { accent: '#F79009', label: 'Attention' },
  critical:  { accent: '#F04438', label: 'Critical'  },
}

// Today's Focus pill colours — use CSS tokens
const getPill = (type) => ({
  payable:    { bg: 'var(--red-light)',   color: 'var(--red-dark)',   text: 'Payable'    },
  receivable: { bg: 'var(--green-light)', color: 'var(--green-dark)', text: 'Receivable' },
  reminder:   { bg: 'var(--amber-light)', color: 'var(--amber-dark)', text: 'Reminder'   },
}[type] || { bg: 'var(--bg-3)', color: 'var(--text-3)', text: type })

// ── AI CFO Insight helpers ────────────────────────────────────────────────────

function getInsightContent(d) {
  if (d.aiText) return { text: d.aiText, urgency: d.aiStatus || 'healthy' }
  const runway = d.runway ?? 999
  const rec    = d.receivables ?? 0
  const pay    = d.payables ?? 0
  if (runway >= 0 && runway < 7)  return { urgency: 'critical',  text: 'Cash risk is high. Focus on collecting receivables and delaying non-critical payments.' }
  if (runway >= 0 && runway < 14) return { urgency: 'attention', text: 'Runway is limited. Review upcoming payables and secure expected income.' }
  if (rec > pay && rec > 0)       return { urgency: 'healthy',   text: 'Incoming money covers current obligations. Follow up on receivables to stay on track.' }
  if (pay > rec && pay > 0)       return { urgency: 'attention', text: 'Upcoming payments are higher than expected income. Review your cash pressure.' }
  return { urgency: 'healthy', text: 'Finances look stable. Keep tracking income, expenses, and upcoming obligations.' }
}

// AI status badge colours — use CSS tokens
const URGENCY = {
  healthy:   { badge: 'var(--green-dark)',  badgeBg: 'var(--green-light)',  label: 'Looking good'    },
  attention: { badge: 'var(--amber-dark)',  badgeBg: 'var(--amber-light)', label: 'Needs attention' },
  critical:  { badge: 'var(--red-dark)',    badgeBg: 'var(--red-light)',   label: 'Critical'        },
}

// Next Best Action card colours — use CSS tokens
const ACTION_COLORS = {
  green:   { bg: 'var(--green-light)', color: 'var(--green-dark)' },
  red:     { bg: 'var(--red-light)',   color: 'var(--red-dark)'   },
  amber:   { bg: 'var(--amber-light)', color: 'var(--amber-dark)' },
  blue:    { bg: 'var(--blue-light)',  color: 'var(--blue-dark)'  },
  default: { bg: 'var(--bg-3)',        color: 'var(--text-3)'     },
}

function getRecommendedAction(d, navigate) {
  const debts   = d.debts || []
  const runway  = d.runway ?? 999
  const rec     = d.receivables ?? 0
  const overP   = debts.filter(x => !x.is_settled && x.type === 'payable'  && daysUntil(x.due_date) < 0)
  const scroll  = () => document.getElementById('pulse-actions')?.scrollIntoView({ behavior: 'smooth' })

  if (overP.length > 0)
    return { icon: '!', title: 'Review overdue payables', meta: `${overP.length} past due — act now`, colorKey: 'red',   action: () => navigate('/payables') }
  if (runway >= 0 && runway < 7 && runway < 999)
    return { icon: '⚡', title: 'Protect runway',         meta: `Only ${runway} days left`,          colorKey: 'amber', action: () => navigate('/transactions') }
  if (rec > 0)
    return { icon: '↓', title: 'Follow up receivables',  meta: `${fmt(rec)} IDR expected`,           colorKey: 'green', action: () => navigate('/receivables') }
  if (debts.length === 0)
    return { icon: '+', title: 'Add a transaction',       meta: 'Keep your data current',             colorKey: 'blue',  action: () => navigate('/add') }
  return   { icon: '→', title: 'Review transactions',    meta: 'View all money movements',            colorKey: 'blue',  action: () => navigate('/transactions') }
}

function buildNextActions(d, navigate) {
  const acts   = []
  const debts  = d.debts || []
  const txs    = d.recentTxs || []
  const rec    = d.receivables ?? 0
  const pay    = d.payables ?? 0
  const runway = d.runway ?? 999
  const scrollAct = () => document.getElementById('pulse-actions')?.scrollIntoView({ behavior: 'smooth' })

  if (rec > 0)
    acts.push({ icon: '↓', colorKey: 'green',   title: 'Follow up receivables', meta: fmt(rec) + ' IDR expected',  action: scrollAct })
  if (pay > 0)
    acts.push({ icon: '↑', colorKey: 'red',     title: 'Review payables',       meta: fmt(pay) + ' IDR due',       action: scrollAct })
  if (runway >= 0 && runway < 14 && runway < 999)
    acts.push({ icon: '⚡', colorKey: 'amber',  title: 'Protect runway',        meta: runway + ' days left',       action: () => navigate('/transactions') })
  if (txs.length < 3)
    acts.push({ icon: '+', colorKey: 'default',  title: 'Add transactions',      meta: 'Keep data up to date',      action: () => navigate('/add') })
  const overdue = debts.filter(x => !x.is_settled && daysUntil(x.due_date) <= 0)
  if (overdue.length > 0)
    acts.push({ icon: '!', colorKey: 'red',      title: 'Resolve urgent items',  meta: overdue.length + ' overdue', action: scrollAct })

  // Always offer Review transactions as a safe default action
  if (acts.length < 4)
    acts.push({ icon: '→', colorKey: 'blue',     title: 'Review transactions',   meta: 'View all money movements', action: () => navigate('/transactions') })

  return acts.slice(0, 4)
}

// ── Modal ─────────────────────────────────────────────────────────────────────

const Modal = ({ onClose, children }) => createPortal(
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal-sheet" onClick={e => e.stopPropagation()}>
      <div className="modal-drag-handle" />
      <button className="modal-close-btn" onClick={onClose}>✕</button>
      {children}
    </div>
  </div>,
  document.body
)

export default function Pulse({ onDataLoad }) {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [scope, setScope]               = useState('all')
  const [data, setData]                 = useState(null)
  const [loading, setLoading]           = useState(true)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [focusDone, setFocusDone]       = useState({})
  const [payModal, setPayModal]         = useState(null)
  const [snoozeModal, setSnoozeModal]   = useState(null)
  const [snoozing, setSnoozing]         = useState(false)
  const [snoozeError, setSnoozeError]   = useState('')
  const [customDate, setCustomDate]     = useState('')
  const [payForm, setPayForm]           = useState({ amount: '', account: '' })
  const [paying, setPaying]             = useState(false)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/pulse?scope=${scope}`, token)
      .then(d => { setData(d); if (onDataLoad) onDataLoad(d) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [scope, token])

  const reload = () => {
    setLoading(true)
    apiFetch(`/pulse?scope=${scope}`, token).then(setData).finally(() => setLoading(false))
  }

  const handlePay = async () => {
    setPaying(true)
    try {
      await apiFetch(`/debts/${payModal.id}/pay`, token, {
        method: 'POST', body: { amount: Number(payForm.amount), account: payForm.account }
      })
      setPayModal(null)
      reload()
    } catch(e) { alert(e.message) }
    finally { setPaying(false) }
  }

  const openSnooze = (item) => {
    setSnoozeError('')
    setCustomDate('')
    setSnoozeModal(item)
  }

  const handleSnooze = async (days, untilDate) => {
    if (!snoozeModal) return
    // Client-side validation for custom date
    if (days === 0) {
      if (!customDate) { setSnoozeError('Pick a date'); return }
      if (new Date(customDate) <= new Date()) { setSnoozeError('Date must be in the future'); return }
    }
    // Only reminders are snoozed via API; debt snooze is future scope
    if (snoozeModal.entityType !== 'reminder') { setSnoozeModal(null); return }
    setSnoozing(true)
    setSnoozeError('')
    try {
      const body = days > 0 ? { days } : { until: new Date(customDate).toISOString() }
      await apiFetch(`/reminders/${snoozeModal.id}/snooze`, token, { method: 'PATCH', body })
      setSnoozeModal(null)
      setCustomDate('')
      reload()
    } catch(e) {
      setSnoozeError(e.message)
    } finally {
      setSnoozing(false)
    }
  }

  if (loading && !data) return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>Loading...</div>
  )

  const d = data || {}
  const st = STATUS[d.aiStatus] || STATUS.healthy
  const debts = d.debts || []
  const pendingFocus = (d.todayFocus || []).filter(f => !focusDone[f.id])
  // Show top accounts by absolute balance — no business-specific name filters
  const topAccounts = (d.accounts || []).slice(0, 5)

  // ── Contextual alert bar ─────────────────────────────────────────────────────
  const runway = d.runway ?? 999
  const overdueDebts   = debts.filter(x => !x.is_settled && daysUntil(x.due_date) < 0)
  const overduePayable = overdueDebts.filter(x => x.type === 'payable')
  const alerts = []
  if (overduePayable.length > 0)
    alerts.push({
      key: 'overdue',
      icon: '!',
      text: `${overduePayable.length} overdue payable${overduePayable.length > 1 ? 's' : ''} require${overduePayable.length === 1 ? 's' : ''} action`,
      cta: 'View Payables →',
      action: () => navigate('/payables'),
      accent: 'var(--red)',
      accentBg: 'var(--red-light)',
      accentText: 'var(--red-dark)',
    })
  if (runway >= 0 && runway < 7 && runway < 999)
    alerts.push({
      key: 'runway',
      icon: '⚡',
      text: `Only ${runway} days runway left`,
      cta: 'Review →',
      action: () => navigate('/transactions'),
      accent: 'var(--amber)',
      accentBg: 'var(--amber-light)',
      accentText: 'var(--amber-dark)',
    })
  if ((d.payables || 0) > (d.receivables || 0) && runway >= 0 && runway < 14 && runway < 999 && !alerts.find(a => a.key === 'runway'))
    alerts.push({
      key: 'pressure',
      icon: '↑',
      text: 'Upcoming payments exceed expected income',
      cta: 'Resolve →',
      action: () => document.getElementById('pulse-actions')?.scrollIntoView({ behavior: 'smooth' }),
      accent: 'var(--amber)',
      accentBg: 'var(--amber-light)',
      accentText: 'var(--amber-dark)',
    })
  const visibleAlerts = alerts.slice(0, 2)

  // AI CFO Insight
  const insight           = getInsightContent(d)
  const urgencyStyle      = URGENCY[insight.urgency] || URGENCY.healthy
  const nextActions       = buildNextActions(d, navigate)
  const recommendedAction = getRecommendedAction(d, navigate)

  const btnP = 'btn btn-block btn-lg'
  const btnS = 'btn btn-ghost btn-block btn-lg'

  return (
    <div className="page">

      <div style={{ padding: '14px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
        <div onClick={() => navigate('/settings')} style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--brand-dark)', cursor: 'pointer', border: '1px solid rgba(21,94,239,.15)' }}>
          {user?.firstName?.[0] || 'A'}
        </div>
      </div>

      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6 }}>
        {Object.entries(SCOPE_LABELS).map(([k, v]) => (
          <button key={k} onClick={() => setScope(k)} style={{
            padding: '5px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            border: scope === k ? 'none' : '0.5px solid var(--border)',
            background: scope === k ? 'var(--brand)' : 'none',
            color: scope === k ? '#fff' : 'var(--text-3)',
            fontWeight: scope === k ? 500 : 400,
          }}>{v}</button>
        ))}
      </div>

      {/* ── Contextual Alert Bar — only when urgent conditions exist ── */}
      {visibleAlerts.length > 0 && (
        <div className="pulse-alert-bar">
          {visibleAlerts.map(a => (
            <div key={a.key} className="pulse-alert-item" style={{ borderLeft: `3px solid ${a.accent}` }}>
              <div className="pulse-alert-icon" style={{ color: a.accentText, background: a.accentBg }}>{a.icon}</div>
              <span className="pulse-alert-text">{a.text}</span>
              <button className="pulse-alert-action" onClick={a.action} style={{ color: a.accentText }}>{a.cta}</button>
            </div>
          ))}
        </div>
      )}

      {/* ── KPI Cards Row — desktop only, mobile already shows these in hero + net position ── */}
      <div className="pulse-kpi-grid">
        {/* Total Cash */}
        <div className="pulse-kpi-card">
          <div className="kpi-label">Total Cash</div>
          <div
            className="kpi-value"
            style={{ color: (d.totalBalance ?? 0) >= 0 ? 'var(--text)' : 'var(--red)' }}
          >
            {fmtFull(d.totalBalance ?? 0)}
            <span className="kpi-currency">IDR</span>
          </div>
          <div className="kpi-subtitle">Available now</div>
        </div>

        {/* Runway */}
        <div className="pulse-kpi-card">
          <div className="kpi-label">Runway</div>
          <div
            className="kpi-value"
            style={{
              color: !d.runway || d.runway >= 999
                ? 'var(--text-3)'
                : d.runway > 14 ? 'var(--green-dark)'
                : d.runway > 7  ? 'var(--amber-dark)'
                : 'var(--red)',
            }}
          >
            {!d.runway || d.runway >= 999 ? '—' : d.runway}
            {d.runway && d.runway < 999 && <span className="kpi-unit">days</span>}
          </div>
          <div className="kpi-subtitle">Based on current burn</div>
        </div>

        {/* Receivables */}
        <div className="pulse-kpi-card">
          <div className="kpi-label">Receivables</div>
          <div className="kpi-value" style={{ color: 'var(--green-dark)' }}>
            {fmtFull(d.receivables ?? 0)}
            <span className="kpi-currency">IDR</span>
          </div>
          <div className="kpi-subtitle">
            {(d.debts || []).filter(x => x.type === 'receivable' && !x.is_settled).length} incoming
          </div>
        </div>

        {/* Payables */}
        <div className="pulse-kpi-card">
          <div className="kpi-label">Payables</div>
          <div className="kpi-value" style={{ color: 'var(--red)' }}>
            {fmtFull(d.payables ?? 0)}
            <span className="kpi-currency">IDR</span>
          </div>
          <div className="kpi-subtitle">
            {(d.debts || []).filter(x => x.type === 'payable' && !x.is_settled).length} to pay
          </div>
        </div>
      </div>

      <div className="pulse-desktop-grid">

        {/* ── Main column: hero + net position + actions required ──────── */}
        <div className="pulse-main-col">

          {/* Hero card — always premium dark navy, status shown via badge + border accent only */}
          <div style={{
            margin: '0 16px 12px',
            background: 'linear-gradient(140deg, #0D1B2E 0%, #162035 100%)',
            borderRadius: 24,
            padding: '18px 18px 16px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(11,18,32,0.28)',
            borderLeft: `3px solid ${st.accent}`,
          }}>
            {/* Decorative blobs */}
            <div style={{ position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,.03)' }} />
            <div style={{ position: 'absolute', bottom: -30, left: 20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(21,94,239,.06)' }} />

            {/* Status badge row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.08)', border: '0.5px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '3px 10px 3px 8px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: st.accent, flexShrink: 0, boxShadow: `0 0 6px ${st.accent}` }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{st.label}</span>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,.4)', letterSpacing: '0.04em' }}>AI STATUS</span>
            </div>

            {/* Label */}
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', letterSpacing: '0.08em', marginBottom: 4 }}>
              TOTAL CASH · {SCOPE_LABELS[scope].toUpperCase()}
            </div>

            {/* Big number */}
            <div style={{ fontSize: 32, fontWeight: 700, color: (d.totalBalance || 0) < 0 ? '#F87171' : '#FFFFFF', letterSpacing: -1, lineHeight: 1, marginBottom: 5 }}>
              {fmtFull(d.totalBalance)} <span style={{ fontSize: 14, color: 'rgba(255,255,255,.35)', fontWeight: 400 }}>IDR</span>
            </div>

            {/* Runway tagline */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginBottom: 12, lineHeight: 1.5 }}>
              Runway {d.runway} days &middot; {(d.aiText || '').split('.')[0]}
            </div>

            {/* Account chips */}
            {topAccounts.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                {topAccounts.map(a => (
                  <div key={a.id} style={{ background: a.balance < 0 ? 'rgba(248,113,113,.12)' : 'rgba(255,255,255,.07)', border: `0.5px solid ${a.balance < 0 ? 'rgba(248,113,113,.25)' : 'rgba(255,255,255,.12)'}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, color: a.balance < 0 ? '#F87171' : 'rgba(255,255,255,.8)' }}>
                    {a.name} <span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* AI CFO Insight strip */}
            <div style={{ background: 'rgba(21,94,239,.12)', borderRadius: 12, padding: '10px 12px', border: '0.5px solid rgba(21,94,239,.25)', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'rgba(99,152,255,.75)', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 600 }}>AI CFO INSIGHT</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.82)', lineHeight: 1.5, fontWeight: 500 }}>{d.aiText || 'Analysing your financial position...'}</div>
            </div>

            {/* Quick Actions — 3 navigation shortcuts */}
            <div className="pulse-quick-actions">
              <button className="pulse-quick-action-btn" onClick={() => navigate('/add')}>+ Add transaction</button>
              <button className="pulse-quick-action-btn" onClick={() => navigate('/receivables?new=1')}>+ New receivable</button>
              <button className="pulse-quick-action-btn" onClick={() => navigate('/payables?new=1')}>+ New payable</button>
            </div>

            {/* Analysis / Take action buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <button onClick={() => setShowAnalysis(true)} style={{ background: 'rgba(255,255,255,.07)', border: '0.5px solid rgba(255,255,255,.18)', borderRadius: 14, padding: '9px 0', fontSize: 12, color: 'rgba(255,255,255,.78)', cursor: 'pointer', fontWeight: 500 }}>View analysis</button>
              <button
                onClick={() => document.getElementById('pulse-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ background: '#fff', border: 'none', borderRadius: 14, padding: '9px 0', fontSize: 12, fontWeight: 600, color: '#0D1B2E', cursor: 'pointer' }}
              >Take action</button>
            </div>
          </div>

          {/* Net Position */}
          <div style={{ margin: '0 16px 10px', background: 'var(--bg-2)', borderRadius: 16, padding: '12px 14px', border: '0.5px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Net Position</div>
            {[
              { label: 'Cash',         value: fmtFull(d.totalBalance), color: (d.totalBalance||0) >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'They owe you', value: '+' + fmt(d.receivables), color: 'var(--green)' },
              { label: 'You owe',      value: '-' + fmt(d.payables),    color: 'var(--red)' },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '0.5px solid var(--border)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{r.label}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: r.color }}>{r.value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Net Position</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: (d.netPosition||0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {(d.netPosition||0) >= 0 ? '+' : ''}{fmtFull(d.netPosition)} IDR
              </span>
            </div>
          </div>

          {/* Receivables / Payables mini grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 12px' }}>
            <div style={{ background: 'var(--green-light)', borderRadius: 16, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--green-dark)', marginBottom: 4 }}>They owe you</div>
              <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--green-dark)', lineHeight: 1.1 }}>{fmt(d.receivables)}</div>
              <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 3 }}>{debts.filter(x => x.type === 'receivable').length} receivable</div>
            </div>
            <div style={{ background: 'var(--red-light)', borderRadius: 16, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--red-dark)', marginBottom: 4 }}>You owe</div>
              <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--red-dark)', lineHeight: 1.1 }}>{fmt(d.payables)}</div>
              <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>{debts.filter(x => x.type === 'payable').length} payable</div>
            </div>
          </div>

          {/* Actions Required */}
          {debts.length > 0 && (
            <div id="pulse-actions">
              <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.08em', padding: '0 16px', marginBottom: 8 }}>
                ACTIONS REQUIRED · {debts.length}
              </div>
              {debts.slice(0, 4).map(debt => {
                const days = daysUntil(debt.due_date)
                const isOut = debt.type === 'payable'
                return (
                  <div key={debt.id} style={{ margin: '0 16px 8px', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: isOut ? 'var(--red-light)' : 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15, color: isOut ? 'var(--red-dark)' : 'var(--green-dark)' }}>
                        {isOut ? '↑' : '↓'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{debt.counterparty}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{debt.description}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: isOut ? 'var(--red-dark)' : 'var(--green-dark)' }}>
                          {isOut ? '-' : '+'}{fmt(debt.amount)}
                        </div>
                        <div style={{ fontSize: 9, padding: '2px 7px', borderRadius: 8, background: days < 0 ? 'var(--red-light)' : 'var(--amber-light)', color: days < 0 ? 'var(--red-dark)' : 'var(--amber-dark)', display: 'inline-block', marginTop: 3 }}>
                          {days < 0 ? 'Overdue' : days === 0 ? 'Today' : days + 'd left'}
                        </div>
                      </div>
                    </div>
                    <div style={{ height: 3, background: 'var(--bg-2)', borderRadius: 2, margin: '10px 0 8px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: days < 0 ? 'var(--red)' : isOut ? 'var(--amber)' : 'var(--green)', width: Math.min(100, Math.max(5, days < 0 ? 100 : 100 - days * 5)) + '%' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                      <button onClick={() => openSnooze({ id: debt.id, entityType: 'debt', title: debt.counterparty, subtitle: fmt(debt.amount) + ' IDR' })} style={{ padding: '9px 0', borderRadius: 12, fontSize: 12, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
                        {isOut ? 'Snooze' : 'Remind'}
                      </button>
                      <button onClick={() => { setPayModal(debt); setPayForm({ amount: String(debt.amount), account: '' }) }} style={{ padding: '9px 0', borderRadius: 12, fontSize: 12, border: 'none', background: 'var(--brand)', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
                        {isOut ? 'Pay now' : 'Mark paid'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>{/* end pulse-main-col */}

        {/* ── Side column: AI insight + today's focus + financial vitals ── */}
        <div className="pulse-side-col">

          {/* AI CFO Insight card */}
          <div className="ai-insight-card">
            <div className="ai-insight-header">
              <span className="ai-insight-title">AI CFO Insight</span>
              <span className="ai-status-badge" style={{ background: urgencyStyle.badgeBg, color: urgencyStyle.badge }}>
                {urgencyStyle.label}
              </span>
            </div>
            <p className="ai-insight-text">{insight.text}</p>
            {/* Recommended Next Action — single featured card */}
            {recommendedAction && (() => {
              const col = ACTION_COLORS[recommendedAction.colorKey] || ACTION_COLORS.default
              return (
                <button className="pulse-recommended-action" onClick={recommendedAction.action}>
                  <div className="pulse-rec-icon" style={{ background: col.bg, color: col.color }}>{recommendedAction.icon}</div>
                  <div className="pulse-rec-body">
                    <div className="pulse-rec-label">RECOMMENDED</div>
                    <div className="pulse-rec-title">{recommendedAction.title}</div>
                    <div className="pulse-rec-meta">{recommendedAction.meta}</div>
                  </div>
                  <div className="pulse-rec-arrow" style={{ color: col.color }}>→</div>
                </button>
              )
            })()}

            {nextActions.length > 0 && (
              <>
                <div className="ai-insight-actions-label">NEXT BEST ACTIONS</div>
                <div className="next-actions-grid">
                  {nextActions.map((act, i) => {
                    const col = ACTION_COLORS[act.colorKey] || ACTION_COLORS.default
                    return (
                      <button key={i} className="next-action-card" onClick={act.action}>
                        <div className="next-action-icon" style={{ background: col.bg, color: col.color }}>{act.icon}</div>
                        <div className="next-action-body">
                          <div className="next-action-title">{act.title}</div>
                          <div className="next-action-meta">{act.meta}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Today's Focus — always shown; empty state when no items */}
          <>
            <div className="pulse-section-label">
              TODAY'S FOCUS{(d.todayFocus || []).length > 0 ? ` · ${pendingFocus.length} TASKS` : ''}
            </div>
            {(d.todayFocus || []).length === 0 ? (
              <div style={{ margin: '0 16px 12px', background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No urgent focus items today.</span>
              </div>
            ) : (d.todayFocus || []).map(f => {
              const p = getPill(f.type)
              const focusRoute = f.type === 'payable' ? '/payables' : f.type === 'receivable' ? '/receivables' : null
              return (
                <div key={f.id} onClick={() => setFocusDone(prev => ({ ...prev, [f.id]: !prev[f.id] }))}
                  style={{ margin: '0 16px 7px', background: 'var(--bg-2)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <div style={{ width: 18, height: 18, borderRadius: 6, border: focusDone[f.id] ? 'none' : '1.5px solid var(--border-2)', background: focusDone[f.id] ? 'var(--text)' : 'var(--bg)', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {focusDone[f.id] && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 2.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: focusDone[f.id] ? 'var(--text-3)' : 'var(--text)', textDecoration: focusDone[f.id] ? 'line-through' : 'none', lineHeight: 1.3 }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{f.meta}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <div style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: p.bg, color: p.color, display: 'inline-block' }}>{p.text}</div>
                      {focusRoute && !focusDone[f.id] && (
                        <button onClick={e => { e.stopPropagation(); navigate(focusRoute) }}
                          style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: 'none', border: `0.5px solid ${p.color}`, color: p.color, cursor: 'pointer' }}>
                          {f.type === 'payable' ? 'Pay now →' : 'Follow up →'}
                        </button>
                      )}
                      {f.type === 'reminder' && (
                        <button onClick={e => { e.stopPropagation(); openSnooze({ id: f.id, entityType: 'reminder', title: f.title, subtitle: f.meta || '' }) }}
                          style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: 'none', border: '0.5px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer' }}>
                          Snooze
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </>

          {/* Financial Vitals */}
          <div className="pulse-section-label" style={{ paddingTop: 12 }}>FINANCIAL VITALS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, padding: '0 16px 24px' }}>
            {[
              { label: 'RUNWAY',       value: d.runway + 'd',           sub: 'at current burn',  color: (d.runway||0) > 14 ? 'var(--green-dark)' : (d.runway||0) > 7 ? 'var(--amber-dark)' : 'var(--red-dark)', bar: Math.min(100, Math.max(5, (d.runway||0) * 3)), barColor: (d.runway||0) > 14 ? 'var(--green)' : (d.runway||0) > 7 ? 'var(--amber)' : 'var(--red)' },
              { label: 'BURN RATE',    value: fmt(d.burnRate) + '/d',   sub: '30-day avg',       color: 'var(--text)', bar: 40, barColor: 'var(--blue)' },
              { label: 'EXPECTED IN',  value: '+' + fmt(d.receivables), sub: 'receivables',      color: 'var(--green-dark)', bar: (d.receivables||0) > 0 ? 60 : 0, barColor: 'var(--green)' },
              { label: 'EXPECTED OUT', value: '-' + fmt(d.payables),    sub: 'payables',         color: (d.payables||0) > 0 ? 'var(--amber-dark)' : 'var(--text-3)', bar: (d.payables||0) > 0 ? 80 : 0, barColor: 'var(--amber)' },
            ].map(v => (
              <div key={v.label} style={{ background: 'var(--bg-2)', borderRadius: 16, padding: '12px 13px', border: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 4 }}>{v.label}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: v.color, lineHeight: 1, marginBottom: 2 }}>{v.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{v.sub}</div>
                {v.bar > 0 && (
                  <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: v.bar + '%', background: v.barColor, borderRadius: 2 }} />
                  </div>
                )}
              </div>
            ))}
          </div>

        </div>{/* end pulse-side-col */}

      </div>{/* end pulse-desktop-grid */}

      {showAnalysis && (
        <Modal onClose={() => setShowAnalysis(false)}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Financial Analysis</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 14 }}>{st.label} · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div style={{ background: 'var(--blue-light)', border: '0.5px solid rgba(21,94,239,.2)', borderRadius: 14, padding: '11px 13px', marginBottom: 10 }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-dark)', letterSpacing: '0.06em', marginBottom: 4 }}>AI CFO SUMMARY</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', lineHeight: 1.5, fontWeight: 500 }}>{d.aiText}</div>
          </div>
          {[
            { label: 'RUNWAY TREND',    text: (d.runway||0) + ' days at ' + fmt(d.burnRate) + '/day burn rate.' + ((d.runway||0) < 0 ? ' Deepens by ' + fmt(d.burnRate) + ' daily without income.' : '') },
            { label: 'MAIN RISK',       text: debts.find(x => x.type === 'payable') ? debts.find(x => x.type === 'payable').counterparty + ' — ' + fmt(debts.find(x => x.type === 'payable').amount) + ' IDR ' + (daysUntil(debts.find(x => x.type === 'payable').due_date) < 0 ? 'overdue.' : 'due soon.') : 'No outstanding payables.' },
            { label: 'RECOMMENDATION', text: (d.runway||0) < 7 ? 'Collect receivables immediately. Delay non-critical expenses.' : (d.runway||0) < 14 ? 'Review upcoming payments. Confirm receivables today.' : 'Finances healthy. Focus on growing income.' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg-2)', borderRadius: 14, padding: '10px 12px', border: '0.5px solid var(--border)', marginBottom: 8 }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', lineHeight: 1.5 }}>{item.text}</div>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 14 }}>
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 12, border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 3 }}>IF INCOME TODAY</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 500, color: 'var(--green-dark)' }}>+{Math.round(5000000 / ((d.burnRate||1)))} days</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>runway impact</div>
            </div>
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 12, border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 3 }}>IF NO ACTION</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 500, color: 'var(--red-dark)' }}>{fmt(d.netPosition)}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>in 30 days</div>
            </div>
          </div>
          <button onClick={() => setShowAnalysis(false)} className={btnP} style={{ background: 'var(--text)', color: '#fff' }}>Close</button>
        </Modal>
      )}

      {payModal && (
        <Modal onClose={() => setPayModal(null)}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{payModal.type === 'receivable' ? 'Mark as received' : 'Mark as paid'}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 14 }}>{payModal.counterparty} · {fmt(payModal.amount)} IDR total</div>
          <label className="modal-label">Amount (IDR)</label>
          <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
            className="modal-input" style={{ marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
            {[25, 50, 75, 100].map(pct => (
              <button key={pct} onClick={() => setPayForm(p => ({ ...p, amount: String(Math.round(payModal.amount * pct / 100)) }))}
                className="btn btn-ghost btn-sm">
                {pct}%
              </button>
            ))}
          </div>
          <label className="modal-label">Account</label>
          <select value={payForm.account} onChange={e => setPayForm(p => ({ ...p, account: e.target.value }))}
            className="modal-input" style={{ marginBottom: 14 }}>
            <option value="">Select account</option>
            {(d.accounts || []).map(a => <option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>)}
          </select>
          <button disabled={!payForm.amount || paying} onClick={handlePay}
            className={btnP}
            style={{
              background: payForm.amount ? (payModal.type === 'receivable' ? 'var(--green-dark)' : 'var(--brand)') : 'var(--bg-3)',
              color: payForm.amount ? '#fff' : 'var(--text-4)',
              marginBottom: 8,
            }}>
            {paying ? 'Processing...' : Number(payForm.amount) >= Number(payModal.amount)
              ? 'Pay in full · ' + fmt(Number(payForm.amount)) + ' IDR'
              : 'Pay ' + fmt(Number(payForm.amount)) + ' IDR'}
          </button>
          <button onClick={() => setPayModal(null)} className={btnS}>Cancel</button>
        </Modal>
      )}

      {snoozeModal && (
        <Modal onClose={() => { setSnoozeModal(null); setSnoozeError(''); setCustomDate('') }}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>Snooze reminder</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 16 }}>
            {snoozeModal.title}{snoozeModal.subtitle ? ' · ' + snoozeModal.subtitle : ''}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 8 }}>REMIND ME IN</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 10 }}>
            {[
              { label: '1 day',  days: 1, sub: new Date(Date.now() + 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
              { label: '3 days', days: 3, sub: new Date(Date.now() + 3*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), active: true },
              { label: '7 days', days: 7, sub: new Date(Date.now() + 7*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
              { label: 'Custom', days: 0, sub: 'Pick date' },
            ].map(opt => (
              <div key={opt.label} onClick={() => { if (opt.days > 0) handleSnooze(opt.days, null) }}
                style={{ background: opt.active ? 'var(--text)' : 'var(--bg-2)', border: opt.active ? 'none' : '0.5px solid var(--border)', borderRadius: 14, padding: 14, textAlign: 'center', cursor: snoozing ? 'not-allowed' : 'pointer', opacity: snoozing ? 0.6 : 1 }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 500, color: opt.active ? '#fff' : 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: opt.active ? 'rgba(255,255,255,.6)' : 'var(--text-3)', marginTop: 2 }}>{opt.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              type="date"
              value={customDate}
              min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
              onChange={e => { setCustomDate(e.target.value); setSnoozeError('') }}
              className="modal-input"
              style={{ border: snoozeError && !customDate ? '1px solid var(--red)' : undefined }}
            />
            {customDate && (
              <button disabled={snoozing} onClick={() => handleSnooze(0, null)}
                className={btnP} style={{ marginTop: 7, background: 'var(--text)', color: '#fff', opacity: snoozing ? 0.6 : 1 }}>
                {snoozing ? 'Saving...' : 'Snooze until ' + new Date(customDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </button>
            )}
          </div>
          {snoozeError && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--red)', marginBottom: 8, padding: '9px 13px', background: 'var(--red-light)', borderRadius: 10 }}>{snoozeError}</div>
          )}
          {snoozeModal.entityType === 'debt' && (
            <div style={{ background: 'var(--blue-light)', border: '0.5px solid rgba(21,94,239,.2)', borderRadius: 14, padding: '10px 13px', marginBottom: 10 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--brand-dark)', lineHeight: 1.5 }}>Debt snooze tracking coming soon. This will dismiss for now.</div>
            </div>
          )}
          <button onClick={() => { setSnoozeModal(null); setSnoozeError(''); setCustomDate('') }} className={btnS}>Cancel</button>
        </Modal>
      )}

    </div>
  )
}