import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

function getStatusStyle(aiStatus) {
  if (aiStatus === 'critical')  return { dot: '#F04438', label: 'Critical',        border: '#F04438', glow: 'rgba(240,68,56,.3)' }
  if (aiStatus === 'attention') return { dot: '#F79009', label: 'Needs Attention',  border: '#F79009', glow: 'rgba(247,144,9,.3)' }
  return                               { dot: '#12B76A', label: 'Healthy',          border: '#12B76A', glow: 'rgba(18,183,106,.3)' }
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
  if ((d.totalBalance || 0) < 0)       risks.push({ level: 'critical',  text: 'Negative total cash balance — immediate action required' })
  if (runway >= 0 && runway < 7)       risks.push({ level: 'critical',  text: `Only ${runway} days of cash runway — critical` })
  else if (runway >= 0 && runway < 14) risks.push({ level: 'attention', text: `Short runway: ${runway} days — monitor carefully` })
  if ((d.payables || 0) > (d.receivables || 0) && (d.payables || 0) > 0)
                                        risks.push({ level: 'attention', text: 'Payables exceed receivables — net cash pressure ahead' })
  const overdueCount = (d.debts || []).filter(x => !x.is_settled && daysUntil(x.due_date) < 0).length
  if (overdueCount > 0)                risks.push({ level: 'attention', text: `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} need resolution` })
  if (risks.length === 0)              risks.push({ level: 'healthy',   text: 'No significant financial risks detected' })
  return risks
}

const RISK_CFG = {
  critical:  { bg: 'var(--red-light)',   border: 'rgba(220,38,38,.18)',  dot: 'var(--red-dark)',   text: 'var(--red-dark)' },
  attention: { bg: 'var(--amber-light)', border: 'rgba(217,119,6,.18)', dot: 'var(--amber-dark)', text: 'var(--amber-dark)' },
  healthy:   { bg: 'var(--green-light)', border: 'rgba(6,95,70,.15)',   dot: 'var(--green-dark)', text: 'var(--green-dark)' },
}

export default function AICFO() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    apiFetch('/pulse', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading && !data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite' }} />
    </div>
  )

  const d       = data || {}
  const st      = getStatusStyle(d.aiStatus)
  const insight = d.aiText || getFallbackInsight(d)
  const risks   = buildRisks(d)
  const debts   = (d.debts || []).filter(x => !x.is_settled)
  const runway  = d.runway ?? 0

  const runwayColor = runway < 7 ? 'var(--red-dark)' : runway < 14 ? 'var(--amber-dark)' : 'var(--green-dark)'

  return (
    <div className="hf-page">

      {/* ── Page header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">AI CFO</div>
          <div className="hf-page-subtitle">Financial intelligence · executive dashboard</div>
        </div>
        <div className="hf-badge hf-badge-blue" style={{ fontSize: 13, padding: '6px 14px' }}>
          ✦ AI Powered
        </div>
      </div>

      {error && <div className="page-error" style={{ marginBottom: 20 }}>{error}</div>}

      {/* ── AI Status Hero Card ─── */}
      <div className="hf-dark-card" style={{ borderLeft: `4px solid ${st.border}` }}>
        <div style={{ position: 'relative' }}>
          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.08)', border: '0.5px solid rgba(255,255,255,.14)', borderRadius: 20, padding: '5px 14px 5px 10px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, boxShadow: `0 0 8px ${st.glow}`, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>{st.label}</span>
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI STATUS</span>
          </div>

          {/* Insight text */}
          <div style={{ fontSize: 'var(--text-base)', color: 'rgba(255,255,255,.82)', lineHeight: 1.7, marginBottom: 24, maxWidth: 680 }}>
            {insight}
          </div>

          {/* 3 key KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: 'TOTAL CASH',   value: fmtFull(d.totalBalance), suffix: 'IDR', color: (d.totalBalance || 0) < 0 ? '#F87171' : '#fff' },
              { label: 'RUNWAY',       value: runway >= 999 ? '∞' : String(runway),   suffix: 'days', color: runway < 7 ? '#F87171' : runway < 14 ? '#FBBF24' : '#34D399' },
              { label: 'NET POSITION', value: fmt(d.netPosition),                      suffix: 'IDR',  color: (d.netPosition || 0) >= 0 ? '#34D399' : '#F87171' },
            ].map(m => (
              <div key={m.label} style={{ background: 'rgba(255,255,255,.06)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.09)' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: m.color, lineHeight: 1.1, letterSpacing: -0.5 }}>{m.value}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>{m.suffix}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Financial KPIs grid ─── */}
      <div className="hf-card-grid hf-card-grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Receivables', value: '+' + fmt(d.receivables), sub: 'Expected inflow · IDR', color: 'var(--green-dark)', click: () => navigate('/receivables') },
          { label: 'Payables',    value: '−' + fmt(d.payables),    sub: 'Upcoming outflow · IDR', color: 'var(--red-dark)',   click: () => navigate('/payables') },
          { label: 'Overdue Items', value: String(debts.filter(x => daysUntil(x.due_date) < 0).length), sub: debts.filter(x => daysUntil(x.due_date) < 0).length > 0 ? 'Need action' : 'All clear', color: debts.filter(x => daysUntil(x.due_date) < 0).length > 0 ? 'var(--red-dark)' : 'var(--green-dark)', click: null },
          { label: 'Burn Rate',   value: fmt(d.burnRate),           sub: 'Per day · IDR',          color: 'var(--text)',      click: () => navigate('/transactions') },
        ].map(c => (
          <div key={c.label} className="hf-card" style={{ cursor: c.click ? 'pointer' : 'default' }} onClick={c.click || undefined}>
            <div className="hf-kpi-label">{c.label}</div>
            <div className="hf-kpi-value" style={{ color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 6 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Risk summary ─── */}
      <div style={{ marginBottom: 24 }}>
        <div className="hf-section-title">Risk Summary</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {risks.map((r, i) => {
            const cfg = RISK_CFG[r.level]
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '13px 16px' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: cfg.dot }} />
                <span style={{ fontSize: 'var(--text-base)', color: cfg.text, lineHeight: 1.4, fontWeight: 500 }}>{r.text}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Next best actions ─── */}
      <div style={{ marginBottom: 24 }}>
        <div className="hf-section-title">Next Best Actions</div>
        <div className="hf-card-grid hf-card-grid-2" style={{ gap: 12 }}>
          {[
            { label: 'Review Transactions', sub: 'All money movements',         path: '/transactions', bg: 'var(--brand-light)',  color: 'var(--brand-dark)',  icon: '📊' },
            { label: 'Add Transaction',     sub: 'Keep data up to date',         path: '/add',          bg: '#F0FDF4',             color: 'var(--green-dark)', icon: '➕' },
            { label: 'View Receivables',    sub: fmt(d.receivables) + ' IDR in', path: '/receivables',  bg: '#F0FDF4',             color: 'var(--green-dark)', icon: '↓' },
            { label: 'View Payables',       sub: fmt(d.payables) + ' IDR out',   path: '/payables',     bg: 'var(--red-light)',    color: 'var(--red-dark)',   icon: '↑' },
          ].map(a => (
            <button key={a.label} onClick={() => navigate(a.path)}
              style={{ background: a.bg, borderRadius: 14, padding: '16px 18px', cursor: 'pointer', border: `1px solid ${a.color}22`, textAlign: 'left', transition: 'box-shadow .15s', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 14 }}
              onMouseOver={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,.12)' }}
              onMouseOut={e => { e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{a.icon}</div>
              <div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: a.color, marginBottom: 3 }}>{a.label}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: a.color, opacity: 0.75 }}>{a.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Open items ─── */}
      {debts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="hf-section-title">Open Items · {debts.length}</div>
          <div className="item-list-card">
            {debts.slice(0, 8).map(debt => {
              const days = daysUntil(debt.due_date)
              const isOverdue = days < 0
              return (
                <div key={debt.id} className="item-row">
                  <div className="item-row-left">
                    <div className="item-row-name">{debt.counterparty || '—'}</div>
                    <div className="item-row-sub" style={{ color: isOverdue ? 'var(--red-dark)' : undefined }}>
                      {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `Due in ${days}d`}
                      {debt.description ? ` · ${debt.description}` : ''}
                    </div>
                  </div>
                  <div className="item-row-right">
                    <div className="item-row-amount" style={{ color: debt.type === 'receivable' ? 'var(--green-dark)' : 'var(--red-dark)' }}>
                      {debt.type === 'receivable' ? '+' : '−'}{fmt(debt.amount)} IDR
                    </div>
                    <div className="item-row-status">{debt.type}</div>
                  </div>
                </div>
              )
            })}
            {debts.length > 8 && (
              <div style={{ padding: '12px 18px', textAlign: 'center' }}>
                <button className="link-btn" onClick={() => navigate('/receivables')}>View all {debts.length} items →</button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
