import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'
import { RightPanel } from '../App'

const SCOPE_LABELS = { all: 'All', business: 'Business', personal: 'Personal' }
const STATUS_COLORS = {
  healthy: { bg: '#1D9E75', text: 'Healthy' },
  attention: { bg: '#EF9F27', text: 'Attention' },
  critical: { bg: '#E24B4A', text: 'Critical' }
}

export default function Pulse({ onDataLoad }) {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [scope, setScope] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [focusDone, setFocusDone] = useState({})
  const [payModal, setPayModal] = useState(null)
  const [payForm, setPayForm] = useState({ amount: '', account: '' })
  const [paying, setPaying] = useState(false)

  const isDesktop = window.innerWidth >= 1024

  useEffect(() => {
    setLoading(true)
    apiFetch(`/pulse?scope=${scope}`, token)
      .then(d => { setData(d); if (onDataLoad) onDataLoad(d) }).catch(console.error).finally(() => setLoading(false))
  }, [scope, token])

  const toggleFocus = (id) => setFocusDone(p => ({ ...p, [id]: !p[id] }))

  const handlePay = async () => {
    setPaying(true)
    try {
      await apiFetch(`/debts/${payModal.id}/pay`, token, { method: 'POST', body: { amount: Number(payForm.amount), account: payForm.account } })
      setPayModal(null)
      setLoading(true)
      apiFetch(`/pulse?scope=${scope}`, token).then(setData).finally(() => setLoading(false))
    } catch(e) { alert(e.message) }
    finally { setPaying(false) }
  }

  if (loading && !data) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>Loading...</div>

  const d = data || {}
  const status = STATUS_COLORS[d.aiStatus] || STATUS_COLORS.healthy
  const pendingFocus = (d.todayFocus || []).filter(f => !focusDone[f.id])

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>
      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ padding: '16px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '0.5px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 20, padding: 3, gap: 2 }}>
              {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                <button key={k} onClick={() => setScope(k)} style={{
                  padding: '4px 12px', borderRadius: 17, fontSize: 12, border: scope === k ? '0.5px solid var(--border)' : 'none',
                  background: scope === k ? 'var(--bg)' : 'none', color: scope === k ? 'var(--text)' : 'var(--text-3)',
                  fontWeight: scope === k ? 500 : 400, transition: 'all .15s', cursor: 'pointer'
                }}>{v}</button>
              ))}
            </div>
            <div onClick={() => navigate('/settings')} style={{ width: 32, height: 32, borderRadius: '50%', background: '#B5D4F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#0C447C', cursor: 'pointer' }}>
              {user?.first_name?.[0] || 'A'}
            </div>
          </div>
        </div>

        {/* Hero - Total Cash */}
        <div style={{ margin: '16px 20px', background: status.bg, borderRadius: 16, padding: '24px 28px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
          <div style={{ position: 'absolute', bottom: -20, right: 60, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Total Cash · {SCOPE_LABELS[scope]}
          </div>
          <div style={{ fontSize: 42, fontWeight: 700, color: '#fff', letterSpacing: -2, marginBottom: 8 }}>
            {fmtFull(d.totalBalance)} <span style={{ fontSize: 18, fontWeight: 400, opacity: 0.7 }}>IDR</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
              <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{status.text}</span>
            </div>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Runway {d.runway} days</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {(d.accounts || []).map(a => (
              <div key={a.id} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: '3px 10px', fontSize: 11, color: '#fff' }}>
                {a.name} <span style={{ fontWeight: 600 }}>{fmt(a.balance)}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setShowAnalysis(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
            View analysis →
          </button>
        </div>

        {/* 4 Vitals */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '0 20px', marginBottom: 16 }}>
          {[
            { label: 'Runway', value: `${d.runway}d`, sub: 'at current burn', color: d.runway > 14 ? 'var(--green-dark)' : d.runway > 7 ? 'var(--amber-dark)' : 'var(--red)' },
            { label: 'Burn rate', value: `${fmt(d.burnRate)}/d`, sub: '30-day avg', color: 'var(--text)' },
            { label: 'Expected in', value: `+${fmt(d.receivables)}`, sub: 'receivables', color: 'var(--green-dark)' },
            { label: 'Expected out', value: `-${fmt(d.payables)}`, sub: 'payables', color: 'var(--amber-dark)' },
          ].map(v => (
            <div key={v.label} style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 }}>{v.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: v.color }}>{v.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{v.sub}</div>
            </div>
          ))}
        </div>

        {/* Net Position */}
        <div style={{ margin: '0 20px 16px', background: 'var(--bg-2)', borderRadius: 12, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Net Position</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>cash + receivables − payables</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: d.netPosition >= 0 ? 'var(--green-dark)' : 'var(--red)' }}>
              {d.netPosition >= 0 ? '+' : ''}{fmtFull(d.netPosition)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>IDR</div>
          </div>
        </div>

        {/* Payables / Receivables */}
        <div style={{ padding: '0 20px', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Debts & Receivables</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ background: 'var(--green-light)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--green-dark)', marginBottom: 4 }}>They owe you</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--green)' }}>{fmt(d.receivables)}</div>
              <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>{(d.debts || []).filter(x => x.type === 'receivable').length} receivable</div>
            </div>
            <div style={{ background: 'var(--red-light)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--red-dark)', marginBottom: 4 }}>You owe</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--red)' }}>{fmt(d.payables)}</div>
              <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>{(d.debts || []).filter(x => x.type === 'payable').length} payable</div>
            </div>
          </div>
        </div>

        {/* Debt items */}
        {(d.debts || []).slice(0, 5).map(debt => {
          const days = daysUntil(debt.due_date)
          const isUrgent = days <= 8
          return (
            <div key={debt.id} style={{ margin: '0 20px 10px', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: debt.type === 'receivable' ? 'var(--green-light)' : 'var(--red-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                  {debt.type === 'receivable' ? '↙' : '↗'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{debt.counterparty}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{debt.description}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: debt.type === 'receivable' ? 'var(--green)' : 'var(--red)' }}>
                    {debt.type === 'receivable' ? '+' : '-'}{fmt(debt.amount)}
                  </div>
                  <div style={{ fontSize: 11, color: isUrgent ? 'var(--red)' : 'var(--text-3)', fontWeight: isUrgent ? 600 : 400 }}>
                    {days > 0 ? `${days}d left` : days === 0 ? 'Today' : 'Overdue'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                  <button style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, border: '0.5px solid var(--border-2)', background: 'none', color: 'var(--text-2)', cursor: 'pointer' }}>
                    {debt.type === 'receivable' ? 'Remind' : 'Snooze'}
                  </button>
                  <button onClick={() => { setPayModal(debt); setPayForm({ amount: String(debt.amount), account: '' }) }} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, border: 'none', background: 'var(--text)', color: '#fff', cursor: 'pointer' }}>
                    {debt.type === 'receivable' ? 'Mark paid' : 'Pay now'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {/* Today's Focus */}
        {(d.todayFocus || []).length > 0 && (
          <div style={{ margin: '16px 20px 0' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Today's Focus · {pendingFocus.length} tasks</div>
            <div style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {(d.todayFocus || []).map((f, i) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < d.todayFocus.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                  <button onClick={() => toggleFocus(f.id)} style={{ width: 20, height: 20, borderRadius: 6, border: '0.5px solid var(--border-2)', background: focusDone[f.id] ? 'var(--text)' : 'none', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {focusDone[f.id] && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 2.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: focusDone[f.id] ? 'var(--text-3)' : 'var(--text)', textDecoration: focusDone[f.id] ? 'line-through' : 'none' }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{f.meta}</div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: f.type === 'payable' ? 'var(--red-light)' : f.type === 'receivable' ? 'var(--amber-light)' : 'var(--blue-light)', color: f.type === 'payable' ? 'var(--red-dark)' : f.type === 'receivable' ? 'var(--amber-dark)' : '#185FA5' }}>
                    {f.type === 'receivable' ? 'Receivable' : f.type === 'payable' ? 'Payable' : 'Reminder'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Desktop only */}
      <RightPanel data={d} scope={scope} />

      {/* Analysis modal */}
      {showAnalysis && (
        <div onClick={() => setShowAnalysis(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 16, padding: '24px', width: '100%', maxWidth: 480, margin: '0 16px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Financial analysis · {status.text}</div>
            {[
              { icon: '📈', label: 'Runway trend', text: `Runway: ${d.runway} days at current burn rate of ${fmt(d.burnRate)}/day.` },
              { icon: '⚠️', label: 'Main risk', text: (d.debts || []).find(x => x.type === 'payable') ? `Payment to ${(d.debts || []).find(x => x.type === 'payable').counterparty} — ${fmt((d.debts || []).find(x => x.type === 'payable').amount)} IDR due ${daysUntil((d.debts || []).find(x => x.type === 'payable').due_date) === 0 ? 'today' : daysUntil((d.debts || []).find(x => x.type === 'payable').due_date) + 'd'}.` : 'No outstanding payables.' },
              { icon: '💚', label: 'Main incoming', text: (d.debts || []).find(x => x.type === 'receivable') ? `${(d.debts || []).find(x => x.type === 'receivable').counterparty} owes ${fmt((d.debts || []).find(x => x.type === 'receivable').amount)} IDR.` : 'No receivables scheduled.' },
              { icon: '💡', label: 'Recommendation', text: d.runway < 7 ? `Critical: only ${d.runway} days left. Collect receivables immediately.` : d.runway < 14 ? `Attention: runway is ${d.runway} days. Review upcoming expenses.` : d.payables > d.totalBalance ? 'Payables exceed cash balance. Prioritize collections.' : 'Finances healthy. Focus on growing income.' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{item.text}</div>
                </div>
              </div>
            ))}
            <button onClick={() => setShowAnalysis(false)} style={{ width: '100%', marginTop: 16, padding: 12, borderRadius: 10, background: 'var(--text)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* Pay modal */}
      {payModal && (
        <div onClick={() => setPayModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 16, padding: '24px', width: '100%', maxWidth: 420, margin: '0 16px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{payModal.type === 'receivable' ? 'Mark as received' : 'Mark as paid'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>{payModal.counterparty} · {fmt(payModal.amount)} IDR total</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Amount (IDR)</div>
              <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setPayForm(p => ({ ...p, amount: String(Math.round(payModal.amount * pct / 100)) }))}
                    style={{ flex: 1, padding: '5px', borderRadius: 8, fontSize: 11, border: '0.5px solid var(--border-2)', background: 'none', color: 'var(--text-2)', cursor: 'pointer' }}>
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Account</div>
              <select value={payForm.account} onChange={e => setPayForm(p => ({ ...p, account: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">Select account</option>
                {(d.accounts || []).map(a => <option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>)}
              </select>
            </div>
            <button disabled={!payForm.amount || paying} onClick={handlePay} style={{ width: '100%', padding: 13, borderRadius: 10, background: payForm.amount ? 'var(--text)' : 'var(--bg-2)', color: payForm.amount ? '#fff' : 'var(--text-3)', border: 'none', fontSize: 14, fontWeight: 500, marginBottom: 8, cursor: 'pointer' }}>
              {paying ? 'Processing...' : Number(payForm.amount) >= Number(payModal.amount) ? 'Pay in full' : `Pay ${fmt(Number(payForm.amount))} IDR`}
            </button>
            <button onClick={() => setPayModal(null)} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}