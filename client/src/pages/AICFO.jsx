import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusStyle(aiStatus) {
  if (aiStatus === 'critical')  return { dot: '#F04438', label: 'Critical',       borderColor: '#F04438' }
  if (aiStatus === 'attention') return { dot: '#F79009', label: 'Needs Attention', borderColor: '#F79009' }
  return                               { dot: '#12B76A', label: 'Healthy',         borderColor: '#12B76A' }
}

function getFallbackInsight(d) {
  const runway = d.runway ?? 999
  if (runway >= 0 && runway < 7)  return 'Cash risk is high. Focus on collecting receivables and delaying non-critical payments immediately.'
  if (runway >= 0 && runway < 14) return 'Runway is limited. Review upcoming payables and secure expected income this week.'
  if ((d.totalBalance || 0) < 0)  return 'Total cash is negative. Prioritise collecting receivables and reducing non-essential spend.'
  return 'Finances look stable. Keep tracking income, expenses, and upcoming obligations to stay ahead.'
}

function buildRisks(d) {
  const risks = []
  const runway = d.runway ?? 999
  if ((d.totalBalance || 0) < 0)      risks.push({ level: 'critical',  text: 'Negative total cash balance — immediate action required' })
  if (runway >= 0 && runway < 7)      risks.push({ level: 'critical',  text: `Only ${runway} days of cash runway — critical` })
  else if (runway >= 0 && runway < 14) risks.push({ level: 'attention', text: `Short runway: ${runway} days — monitor carefully` })
  if ((d.payables || 0) > (d.receivables || 0) && (d.payables || 0) > 0)
                                       risks.push({ level: 'attention', text: 'Payables exceed receivables — net cash pressure ahead' })
  const overdueCount = (d.debts || []).filter(x => !x.is_settled && daysUntil(x.due_date) < 0).length
  if (overdueCount > 0)               risks.push({ level: 'attention', text: `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} need resolution` })
  if (risks.length === 0)             risks.push({ level: 'healthy',   text: 'No significant financial risks detected' })
  return risks
}

const RISK_COLOR = { critical: 'var(--red)', attention: 'var(--amber)', healthy: 'var(--green)' }
const RISK_BG    = { critical: 'var(--red-light)', attention: 'var(--amber-light)', healthy: 'var(--green-light)' }
const RISK_BORDER = { critical: 'rgba(240,68,56,.25)', attention: 'rgba(247,144,9,.25)', healthy: 'rgba(18,183,106,.2)' }

// ── Main Component ────────────────────────────────────────────────────────────
export default function AICFO() {
  const { token } = useAuth()
  const navigate  = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    apiFetch('/pulse', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading && !data) return <div className="page-loading">Loading AI CFO…</div>

  const d       = data || {}
  const st      = getStatusStyle(d.aiStatus)
  const insight = d.aiText || getFallbackInsight(d)
  const risks   = buildRisks(d)
  const debts   = (d.debts || []).filter(x => !x.is_settled)
  const runway  = d.runway ?? 0

  const runwayColor = runway < 7 ? 'var(--red)' : runway < 14 ? 'var(--amber-dark)' : 'var(--green-dark)'

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">AI CFO</div>
          <div className="page-header-sub">Financial intelligence for your business</div>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* ── AI Status Card — premium dark navy ─── */}
      <div className="insight-card-dark" style={{ borderLeft: `3px solid ${st.borderColor}` }}>
        {/* Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.08)', border: '0.5px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '3px 10px 3px 8px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot, boxShadow: `0 0 6px ${st.dot}`, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{st.label}</span>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,.4)', letterSpacing: '0.06em' }}>AI STATUS</span>
        </div>

        {/* Insight text */}
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.82)', lineHeight: 1.65, marginBottom: 16 }}>{insight}</div>

        {/* 3 key metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'TOTAL CASH',    value: fmtFull(d.totalBalance), suffix: 'IDR', color: (d.totalBalance || 0) < 0 ? '#F87171' : '#fff' },
            { label: 'RUNWAY',        value: runway >= 999 ? '∞' : `${runway}`, suffix: 'days', color: runway < 7 ? '#F87171' : runway < 14 ? '#FBBF24' : '#34D399' },
            { label: 'NET POSITION',  value: fmt(d.netPosition), suffix: 'IDR', color: (d.netPosition || 0) >= 0 ? '#34D399' : '#F87171' },
          ].map(m => (
            <div key={m.label} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: '10px 12px', border: '0.5px solid rgba(255,255,255,.08)' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.38)', letterSpacing: '0.07em', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: m.color, lineHeight: 1.1 }}>{m.value}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>{m.suffix}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Summary cards ─── */}
      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-card">
          <div className="summary-card-label">Receivables</div>
          <div className="summary-card-value" style={{ color: 'var(--green-dark)' }}>+{fmt(d.receivables)}</div>
          <div className="summary-card-sub">Expected inflow · IDR</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Payables</div>
          <div className="summary-card-value" style={{ color: 'var(--red-dark)' }}>−{fmt(d.payables)}</div>
          <div className="summary-card-sub">Upcoming outflow · IDR</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Overdue Items</div>
          <div className="summary-card-value" style={{ color: debts.filter(x => daysUntil(x.due_date) < 0).length > 0 ? 'var(--red)' : 'var(--green-dark)' }}>
            {debts.filter(x => daysUntil(x.due_date) < 0).length}
          </div>
          <div className="summary-card-sub">{debts.filter(x => daysUntil(x.due_date) < 0).length > 0 ? 'Need attention' : 'All clear'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Burn Rate</div>
          <div className="summary-card-value" style={{ color: 'var(--text)' }}>{fmt(d.burnRate)}</div>
          <div className="summary-card-sub">Per day · IDR</div>
        </div>
      </div>

      {/* ── Risk Summary ─── */}
      <div style={{ marginBottom: 24 }}>
        <div className="section-title">Risk Summary</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {risks.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: RISK_BG[r.level], border: `1px solid ${RISK_BORDER[r.level]}`, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: RISK_COLOR[r.level] }} />
              <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.4 }}>{r.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Next Best Actions ─── */}
      <div style={{ marginBottom: 24 }}>
        <div className="section-title">Next Best Actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {[
            { label: 'Review Transactions', sub: 'All money movements',          path: '/transactions', bg: 'var(--blue-light)',  color: 'var(--blue-dark)'  },
            { label: 'Add Transaction',     sub: 'Keep data up to date',          path: '/add',          bg: 'var(--green-light)', color: 'var(--green-dark)' },
            { label: 'View Receivables',    sub: `${fmt(d.receivables)} IDR in`,  path: '/receivables',  bg: 'var(--green-light)', color: 'var(--green-dark)' },
            { label: 'View Payables',       sub: `${fmt(d.payables)} IDR out`,    path: '/payables',     bg: 'var(--red-light)',   color: 'var(--red-dark)'   },
          ].map(a => (
            <button key={a.label} onClick={() => navigate(a.path)} style={{ background: a.bg, borderRadius: 12, padding: '14px', cursor: 'pointer', border: 'none', textAlign: 'left', transition: 'opacity .15s' }}
              onMouseOver={e => e.currentTarget.style.opacity = '0.85'} onMouseOut={e => e.currentTarget.style.opacity = '1'}>
              <div style={{ fontSize: 13, fontWeight: 600, color: a.color, marginBottom: 3 }}>{a.label}</div>
              <div style={{ fontSize: 11, color: a.color, opacity: 0.7 }}>{a.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Open Items ─── */}
      {debts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">Open Items · {debts.length}</div>
          <div className="item-list-card">
            {debts.slice(0, 8).map((debt, i, arr) => {
              const days = daysUntil(debt.due_date)
              const isOverdue = days < 0
              return (
                <div key={debt.id} className="item-row">
                  <div className="item-row-left">
                    <div className="item-row-name">{debt.counterparty || '—'}</div>
                    <div className="item-row-sub" style={{ color: isOverdue ? 'var(--red)' : 'var(--text-4)' }}>
                      {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `Due in ${days}d`}
                      {debt.description ? ` · ${debt.description}` : ''}
                    </div>
                  </div>
                  <div className="item-row-right">
                    <div className="item-row-amount" style={{ color: debt.type === 'receivable' ? 'var(--green-dark)' : 'var(--red-dark)' }}>
                      {debt.type === 'receivable' ? '+' : '−'}{fmt(debt.amount)} IDR
                    </div>
                    <div className="item-row-status" style={{ textTransform: 'capitalize' }}>{debt.type}</div>
                  </div>
                </div>
              )
            })}
            {debts.length > 8 && (
              <div style={{ padding: '10px 16px', textAlign: 'center' }}>
                <button className="link-btn" onClick={() => navigate('/receivables')}>View all {debts.length} items</button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
