import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

const SCOPE_LABELS = { all: 'All', business: 'Business', personal: 'Personal' }
const STATUS = {
  healthy:   { bg: '#16A34A', label: 'Healthy' },
  attention: { bg: '#D97706', label: 'Attention' },
  critical:  { bg: '#E24B4A', label: 'Critical' },
}
const getPill = (type) => ({
  payable:    { bg: '#FCEBEB', color: '#A32D2D', text: 'Payable' },
  receivable: { bg: '#EAF3DE', color: '#3B6D11', text: 'Receivable' },
  reminder:   { bg: '#FAEEDA', color: '#633806', text: 'Reminder' },
}[type] || { bg: '#F3F4F6', color: '#6B7280', text: type })

const Modal = ({ onClose, children }) => createPortal(
  <div onClick={onClose} style={{
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    background: 'rgba(0,0,0,.6)', zIndex: 99999,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: 'var(--bg)', borderRadius: '24px 24px 0 0',
      padding: '16px 18px 36px', width: '100%', maxWidth: 520,
      boxShadow: '0 -8px 40px rgba(0,0,0,.3)'
    }}>
      <div style={{ width: 36, height: 4, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
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

  const btnP = { padding: '12px 0', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%', marginBottom: 8 }
  const btnS = { ...btnP, background: 'none', border: '0.5px solid var(--border)', color: 'var(--text-3)', marginBottom: 0 }

  return (
    <div className="page">

      <div style={{ padding: '14px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
        <div onClick={() => navigate('/settings')} style={{ width: 28, height: 28, borderRadius: '50%', background: '#B5D4F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#0C447C', cursor: 'pointer' }}>
          {user?.firstName?.[0] || 'A'}
        </div>
      </div>

      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6 }}>
        {Object.entries(SCOPE_LABELS).map(([k, v]) => (
          <button key={k} onClick={() => setScope(k)} style={{
            padding: '5px 16px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            border: scope === k ? 'none' : '0.5px solid var(--border)',
            background: scope === k ? 'var(--text)' : 'none',
            color: scope === k ? '#fff' : 'var(--text-3)',
            fontWeight: scope === k ? 500 : 400,
          }}>{v}</button>
        ))}
      </div>

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

      <div style={{ margin: '0 16px 12px', background: st.bg, borderRadius: 24, padding: '18px 18px 16px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,.07)' }} />
        <div style={{ position: 'absolute', bottom: -30, left: 20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(0,0,0,.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,.55)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{st.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,.6)' }}>AI status</span>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)', letterSpacing: '0.08em', marginBottom: 4 }}>
          TOTAL CASH · {SCOPE_LABELS[scope].toUpperCase()}
        </div>
        <div style={{ fontSize: 32, fontWeight: 500, color: '#fff', letterSpacing: -1, lineHeight: 1, marginBottom: 5 }}>
          {fmtFull(d.totalBalance)} <span style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', fontWeight: 400 }}>IDR</span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginBottom: 12, lineHeight: 1.4 }}>
          Runway {d.runway} days &middot; {(d.aiText || '').split('.')[0]}
        </div>
        {topAccounts.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
            {topAccounts.map(a => (
              <div key={a.id} style={{ background: a.balance < 0 ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.15)', border: '0.5px solid rgba(255,255,255,.2)', borderRadius: 20, padding: '3px 10px', fontSize: 10, color: '#fff' }}>
                {a.name} <span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ background: 'rgba(0,0,0,.18)', borderRadius: 14, padding: '10px 12px', border: '0.5px solid rgba(255,255,255,.12)', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', letterSpacing: '0.08em', marginBottom: 4 }}>AI CFO INSIGHT</div>
          <div style={{ fontSize: 12, color: '#fff', lineHeight: 1.5, fontWeight: 500 }}>{d.aiText || 'Analysing your financial position...'}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {/* View analysis — opens AI summary / detail modal */}
          <button onClick={() => setShowAnalysis(true)} style={{ background: 'rgba(255,255,255,.2)', border: '0.5px solid rgba(255,255,255,.35)', borderRadius: 14, padding: '9px 0', fontSize: 12, color: '#fff', cursor: 'pointer' }}>View analysis</button>
          {/* Take action — scrolls to Actions Required section */}
          <button
            onClick={() => document.getElementById('pulse-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{ background: '#fff', border: 'none', borderRadius: 14, padding: '9px 0', fontSize: 12, fontWeight: 500, color: st.bg, cursor: 'pointer' }}
          >Take action</button>
        </div>
      </div>

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 12px' }}>
        <div style={{ background: '#DCFCE7', borderRadius: 16, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: '#15803D', marginBottom: 4 }}>They owe you</div>
          <div style={{ fontSize: 24, fontWeight: 500, color: '#16A34A', lineHeight: 1.1 }}>{fmt(d.receivables)}</div>
          <div style={{ fontSize: 10, color: '#16A34A', marginTop: 3 }}>{debts.filter(x => x.type === 'receivable').length} receivable</div>
        </div>
        <div style={{ background: '#FEE2E2', borderRadius: 16, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: '#B91C1C', marginBottom: 4 }}>You owe</div>
          <div style={{ fontSize: 24, fontWeight: 500, color: '#E24B4A', lineHeight: 1.1 }}>{fmt(d.payables)}</div>
          <div style={{ fontSize: 10, color: '#E24B4A', marginTop: 3 }}>{debts.filter(x => x.type === 'payable').length} payable</div>
        </div>
      </div>

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
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: isOut ? '#FCEBEB' : '#EAF3DE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15, color: isOut ? '#A32D2D' : '#3B6D11' }}>
                    {isOut ? '↑' : '↓'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{debt.counterparty}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{debt.description}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: isOut ? '#E24B4A' : '#16A34A' }}>
                      {isOut ? '-' : '+'}{fmt(debt.amount)}
                    </div>
                    <div style={{ fontSize: 9, padding: '2px 7px', borderRadius: 8, background: days < 0 ? '#FCEBEB' : '#FAEEDA', color: days < 0 ? '#A32D2D' : '#633806', display: 'inline-block', marginTop: 3 }}>
                      {days < 0 ? 'Overdue' : days === 0 ? 'Today' : days + 'd left'}
                    </div>
                  </div>
                </div>
                <div style={{ height: 3, background: 'var(--bg-2)', borderRadius: 2, margin: '10px 0 8px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 2, background: days < 0 ? '#E24B4A' : isOut ? '#D97706' : '#16A34A', width: Math.min(100, Math.max(5, days < 0 ? 100 : 100 - days * 5)) + '%' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                  <button onClick={() => openSnooze({ id: debt.id, entityType: 'debt', title: debt.counterparty, subtitle: fmt(debt.amount) + ' IDR' })} style={{ padding: '9px 0', borderRadius: 12, fontSize: 12, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
                    {isOut ? 'Snooze' : 'Remind'}
                  </button>
                  <button onClick={() => { setPayModal(debt); setPayForm({ amount: String(debt.amount), account: '' }) }} style={{ padding: '9px 0', borderRadius: 12, fontSize: 12, border: 'none', background: 'var(--text)', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
                    {isOut ? 'Pay now' : 'Mark paid'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(d.todayFocus || []).length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.08em', padding: '4px 16px 8px' }}>
            TODAY'S FOCUS · {pendingFocus.length} TASKS
          </div>
          {(d.todayFocus || []).map(f => {
            const p = getPill(f.type)
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
      )}

      <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.08em', padding: '12px 16px 8px' }}>FINANCIAL VITALS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, padding: '0 16px 24px' }}>
        {[
          { label: 'RUNWAY',       value: d.runway + 'd',           sub: 'at current burn',  color: (d.runway||0) > 14 ? '#16A34A' : (d.runway||0) > 7 ? '#D97706' : '#E24B4A', bar: Math.min(100, Math.max(5, (d.runway||0) * 3)), barColor: (d.runway||0) > 14 ? '#16A34A' : (d.runway||0) > 7 ? '#D97706' : '#E24B4A' },
          { label: 'BURN RATE',    value: fmt(d.burnRate) + '/d',   sub: '30-day avg',       color: 'var(--text)', bar: 40, barColor: '#38BDF8' },
          { label: 'EXPECTED IN',  value: '+' + fmt(d.receivables), sub: 'receivables',      color: '#16A34A', bar: (d.receivables||0) > 0 ? 60 : 0, barColor: '#16A34A' },
          { label: 'EXPECTED OUT', value: '-' + fmt(d.payables),    sub: 'payables',         color: (d.payables||0) > 0 ? '#D97706' : 'var(--text-3)', bar: (d.payables||0) > 0 ? 80 : 0, barColor: '#D97706' },
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

      {showAnalysis && (
        <Modal onClose={() => setShowAnalysis(false)}>
          <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Financial Analysis</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>{st.label} · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div style={{ background: 'rgba(14,165,233,.08)', border: '0.5px solid rgba(14,165,233,.25)', borderRadius: 14, padding: '11px 13px', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: '#0369A1', letterSpacing: '0.06em', marginBottom: 4 }}>AI CFO SUMMARY</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, fontWeight: 500 }}>{d.aiText}</div>
          </div>
          {[
            { label: 'RUNWAY TREND',    text: (d.runway||0) + ' days at ' + fmt(d.burnRate) + '/day burn rate.' + ((d.runway||0) < 0 ? ' Deepens by ' + fmt(d.burnRate) + ' daily without income.' : '') },
            { label: 'MAIN RISK',       text: debts.find(x => x.type === 'payable') ? debts.find(x => x.type === 'payable').counterparty + ' — ' + fmt(debts.find(x => x.type === 'payable').amount) + ' IDR ' + (daysUntil(debts.find(x => x.type === 'payable').due_date) < 0 ? 'overdue.' : 'due soon.') : 'No outstanding payables.' },
            { label: 'RECOMMENDATION', text: (d.runway||0) < 7 ? 'Collect receivables immediately. Delay non-critical expenses.' : (d.runway||0) < 14 ? 'Review upcoming payments. Confirm receivables today.' : 'Finances healthy. Focus on growing income.' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg-2)', borderRadius: 14, padding: '10px 12px', border: '0.5px solid var(--border)', marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{item.text}</div>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 12 }}>
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 10, border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 3 }}>IF INCOME TODAY</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#16A34A' }}>+{Math.round(5000000 / ((d.burnRate||1)))} days</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>runway impact</div>
            </div>
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 10, border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 3 }}>IF NO ACTION</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#E24B4A' }}>{fmt(d.netPosition)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>in 30 days</div>
            </div>
          </div>
          <button onClick={() => setShowAnalysis(false)} style={{ ...btnP, background: 'var(--text)', color: '#fff' }}>Close</button>
        </Modal>
      )}

      {payModal && (
        <Modal onClose={() => setPayModal(null)}>
          <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>{payModal.type === 'receivable' ? 'Mark as received' : 'Mark as paid'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>{payModal.counterparty} · {fmt(payModal.amount)} IDR total</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>AMOUNT (IDR)</div>
          <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
            style={{ width: '100%', padding: '11px 13px', borderRadius: 14, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg-2)', color: 'var(--text)', marginBottom: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
            {[25, 50, 75, 100].map(pct => (
              <button key={pct} onClick={() => setPayForm(p => ({ ...p, amount: String(Math.round(payModal.amount * pct / 100)) }))}
                style={{ padding: '8px 0', borderRadius: 10, fontSize: 11, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
                {pct}%
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>ACCOUNT</div>
          <select value={payForm.account} onChange={e => setPayForm(p => ({ ...p, account: e.target.value }))}
            style={{ width: '100%', padding: '11px 13px', borderRadius: 14, border: '0.5px solid var(--border-2)', fontSize: 13, background: 'var(--bg-2)', color: 'var(--text)', marginBottom: 12 }}>
            <option value="">Select account</option>
            {(d.accounts || []).map(a => <option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>)}
          </select>
          <button disabled={!payForm.amount || paying} onClick={handlePay} style={{
            ...btnP,
            background: payForm.amount ? (payModal.type === 'receivable' ? '#16A34A' : 'var(--text)') : 'var(--bg-2)',
            color: payForm.amount ? '#fff' : 'var(--text-3)'
          }}>
            {paying ? 'Processing...' : Number(payForm.amount) >= Number(payModal.amount)
              ? 'Pay in full · ' + fmt(Number(payForm.amount)) + ' IDR'
              : 'Pay ' + fmt(Number(payForm.amount)) + ' IDR'}
          </button>
          <button onClick={() => setPayModal(null)} style={btnS}>Cancel</button>
        </Modal>
      )}

      {snoozeModal && (
        <Modal onClose={() => { setSnoozeModal(null); setSnoozeError(''); setCustomDate('') }}>
          <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>Snooze reminder</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            {snoozeModal.title}{snoozeModal.subtitle ? ' · ' + snoozeModal.subtitle : ''}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 8 }}>REMIND ME IN</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 10 }}>
            {[
              { label: '1 day',  days: 1, sub: new Date(Date.now() + 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
              { label: '3 days', days: 3, sub: new Date(Date.now() + 3*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), active: true },
              { label: '7 days', days: 7, sub: new Date(Date.now() + 7*86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
              { label: 'Custom', days: 0, sub: 'Pick date' },
            ].map(opt => (
              <div key={opt.label} onClick={() => { if (opt.days > 0) handleSnooze(opt.days, null) }}
                style={{ background: opt.active ? 'var(--text)' : 'var(--bg-2)', border: opt.active ? 'none' : '0.5px solid var(--border)', borderRadius: 14, padding: 13, textAlign: 'center', cursor: snoozing ? 'not-allowed' : 'pointer', opacity: snoozing ? 0.6 : 1 }}>
                <div style={{ fontSize: 18, fontWeight: 500, color: opt.active ? '#fff' : 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: opt.active ? 'rgba(255,255,255,.6)' : 'var(--text-3)', marginTop: 2 }}>{opt.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              type="date"
              value={customDate}
              min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
              onChange={e => { setCustomDate(e.target.value); setSnoozeError('') }}
              style={{ width: '100%', padding: '10px 13px', borderRadius: 14, border: snoozeError && !customDate ? '1px solid var(--red)' : '0.5px solid var(--border-2)', fontSize: 13, background: 'var(--bg-2)', color: 'var(--text)' }}
            />
            {customDate && (
              <button disabled={snoozing} onClick={() => handleSnooze(0, null)}
                style={{ marginTop: 7, width: '100%', padding: '11px 0', borderRadius: 14, border: 'none', fontSize: 13, fontWeight: 500, background: 'var(--text)', color: '#fff', cursor: snoozing ? 'not-allowed' : 'pointer', opacity: snoozing ? 0.6 : 1 }}>
                {snoozing ? 'Saving...' : 'Snooze until ' + new Date(customDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </button>
            )}
          </div>
          {snoozeError && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8, padding: '8px 12px', background: 'var(--red-light)', borderRadius: 10 }}>{snoozeError}</div>
          )}
          {snoozeModal.entityType === 'debt' && (
            <div style={{ background: 'rgba(14,165,233,.08)', border: '0.5px solid rgba(14,165,233,.25)', borderRadius: 14, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#0369A1', lineHeight: 1.5 }}>Debt snooze tracking coming soon. This will dismiss for now.</div>
            </div>
          )}
          <button onClick={() => { setSnoozeModal(null); setSnoozeError(''); setCustomDate('') }} style={btnS}>Cancel</button>
        </Modal>
      )}

    </div>
  )
}