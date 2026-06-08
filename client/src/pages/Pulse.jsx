import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

const SCOPE_LABELS = { all: 'All', business: 'Business', personal: 'Personal' }

const STATUS_COLORS = {
  healthy: { bg: '#1D9E75', text: 'Healthy' },
  attention: { bg: '#EF9F27', text: 'Attention' },
  critical: { bg: '#E24B4A', text: 'Critical' }
}

export default function Pulse() {
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

  useEffect(() => {
    setLoading(true)
    apiFetch(`/pulse?scope=${scope}`, token)
      .then(setData).catch(console.error).finally(() => setLoading(false))
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

  if (loading && !data) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>Loading...</div>
  )

  const d = data || {}
  const status = STATUS_COLORS[d.aiStatus] || STATUS_COLORS.healthy
  const pendingFocus = (d.todayFocus || []).filter(f => !focusDone[f.id])

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })} · Bali
          </div>
        </div>
        <div onClick={() => navigate('/settings')} style={{ width: 32, height: 32, borderRadius: '50%', background: '#B5D4F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#0C447C', cursor: 'pointer' }}>
          {user?.first_name?.[0] || 'A'}
        </div>
      </div>

      <div style={{ padding: '4px 16px 12px' }}>
        <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 20, padding: 3, gap: 2, width: 'fit-content' }}>
          {Object.entries(SCOPE_LABELS).map(([k, v]) => (
            <button key={k} onClick={() => setScope(k)} style={{
              padding: '5px 14px', borderRadius: 17, fontSize: 13, border: scope === k ? '0.5px solid var(--border)' : 'none',
              background: scope === k ? 'var(--bg)' : 'none', color: scope === k ? 'var(--text)' : 'var(--text-3)',
              fontWeight: scope === k ? 500 : 400, transition: 'all .15s'
            }}>{v}</button>
          ))}
        </div>
      </div>

      <div style={{ margin: '0 16px 14px', background: status.bg, borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{status.text}</span>
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>AI status</span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 1.6, marginBottom: 12 }}>{d.aiText}</div>
        <button onClick={() => setShowAnalysis(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500, padding: '6px 13px', borderRadius: 20, background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>
          View analysis →
        </button>
      </div>

      <div style={{ padding: '0 16px 14px', borderBottom: '0.5px solid var(--border)', marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Total cash · {SCOPE_LABELS[scope].toLowerCase()}</div>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: -1, color: 'var(--text)' }}>
          {fmtFull(d.totalBalance)} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>IDR</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {(d.accounts || []).map(a => (
            <div key={a.id} style={{ background: 'var(--bg-2)', borderRadius: 20, padding: '3px 9px', fontSize: 11, color: 'var(--text-2)' }}>
              {a.name} <span style={{ color: 'var(--text)', fontWeight: 500 }}>{fmt(a.balance)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin: '0 16px 14px', background: 'var(--bg-2)', borderRadius: 10, padding: '11px 13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Net position</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>cash + receivables − payables</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: d.netPosition >= 0 ? 'var(--green-dark)' : 'var(--red)' }}>
            {d.netPosition >= 0 ? '+' : ''}{fmtFull(d.netPosition)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>IDR</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 16px', marginBottom: 10 }}>
        <div style={{ background: 'var(--green-light)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--green-dark)', marginBottom: 4 }}>They owe you</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--green)' }}>{fmt(d.receivables)}</div>
          <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>{(d.debts || []).filter(x => x.type === 'receivable').length} receivable</div>
        </div>
        <div style={{ background: 'var(--red-light)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--red-dark)', marginBottom: 4 }}>You owe</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--red)' }}>{fmt(d.payables)}</div>
          <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>{(d.debts || []).filter(x => x.type === 'payable').length} payable</div>
        </div>
      </div>

      {(d.debts || []).slice(0, 3).map(debt => {
        const days = daysUntil(debt.due_date)
        const isUrgent = days <= 8
        return (
          <div key={debt.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: debt.type === 'receivable' ? 'var(--green-light)' : 'var(--red-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>
                {debt.type === 'receivable' ? '↙' : '↗'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{debt.counterparty}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{debt.description}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: debt.type === 'receivable' ? 'var(--green)' : 'var(--red)' }}>
                  {debt.type === 'receivable' ? '+' : '-'}{fmt(debt.amount)}
                </div>
                <div style={{ fontSize: 10, color: isUrgent ? 'var(--red)' : 'var(--text-3)', marginTop: 2, fontWeight: isUrgent ? 600 : 400 }}>
                  {days > 0 ? `${days}d left` : days === 0 ? 'Today' : 'Overdue'}
                </div>
              </div>
            </div>
            <div style={{ height: 3, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden', marginTop: 10 }}>
              <div style={{ height: '100%', borderRadius: 2, background: debt.type === 'receivable' ? 'var(--green)' : isUrgent ? 'var(--red)' : '#D85A30', width: `${Math.min(100, Math.max(5, 100 - days * 5))}%` }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button style={{ flex: 1, padding: '6px', borderRadius: 8, fontSize: 11, border: '0.5px solid var(--border-2)', background: 'none', color: 'var(--text-2)' }}>
                {debt.type === 'receivable' ? 'Send reminder' : 'Snooze'}
              </button>
              <button onClick={() => { setPayModal(debt); setPayForm({ amount: String(debt.amount), account: '' }) }} style={{ flex: 1, padding: '6px', borderRadius: 8, fontSize: 11, border: 'none', background: 'var(--text)', color: '#fff' }}>
                {debt.type === 'receivable' ? 'Mark paid' : 'Pay now'}
              </button>
            </div>
          </div>
        )
      })}

      {(d.todayFocus || []).length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Today's focus</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{pendingFocus.length} tasks</div>
          </div>
          {(d.todayFocus || []).map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
              <button onClick={() => toggleFocus(f.id)} style={{ width: 20, height: 20, borderRadius: 6, border: '0.5px solid var(--border-2)', background: focusDone[f.id] ? 'var(--text)' : 'none', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {focusDone[f.id] && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 2.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: focusDone[f.id] ? 'var(--text-3)' : 'var(--text)', textDecoration: focusDone[f.id] ? 'line-through' : 'none', lineHeight: 1.4 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{f.meta}</div>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, marginTop: 4, display: 'inline-block', background: f.type === 'receivable' ? 'var(--amber-light)' : f.type === 'payable' ? 'var(--red-light)' : 'var(--blue-light)', color: f.type === 'receivable' ? 'var(--amber-dark)' : f.type === 'payable' ? 'var(--red-dark)' : '#185FA5' }}>
                  {f.type === 'receivable' ? 'Receivable' : f.type === 'payable' ? 'Payable' : 'Reminder'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-divider">Financial vitals</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 16px 4px' }}>
        {[
          { label: 'Runway', value: `${d.runway} days`, sub: 'at current burn', color: d.runway > 14 ? 'var(--green-dark)' : d.runway > 7 ? 'var(--amber-dark)' : 'var(--red)', barW: Math.min(100, d.runway * 3), barC: d.runway > 14 ? 'var(--green)' : d.runway > 7 ? 'var(--amber)' : 'var(--red)' },
          { label: 'Burn rate', value: `${fmt(d.burnRate)}/day`, sub: '30-day avg', color: 'var(--text)', barW: 38, barC: 'var(--blue)' },
          { label: 'Expected in', value: `+${fmt(d.receivables)}`, sub: 'receivables', color: 'var(--green-dark)' },
          { label: 'Expected out', value: `-${fmt(d.payables)}`, sub: 'payables', color: 'var(--amber-dark)' },
        ].map(v => (
          <div key={v.label} style={{ background: 'var(--bg-2)', borderRadius: 10, padding: 11 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{v.label}</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: v.color }}>{v.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{v.sub}</div>
            {v.barW && <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden', marginTop: 7 }}>
              <div style={{ height: '100%', borderRadius: 2, background: v.barC, width: `${v.barW}%` }} />
            </div>}
          </div>
        ))}
      </div>

      {showAnalysis && (
        <div onClick={() => setShowAnalysis(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', maxWidth: 430, margin: '0 auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Financial analysis · {status.text}</div>
            {[
              { icon: '📈', label: 'Runway trend', text: `Runway: ${d.runway} days at current burn rate of ${fmt(d.burnRate)}/day.` },
              { icon: '⚠️', label: 'Main risk', text: (d.debts || []).find(x => x.type === 'payable') ? `Payment to ${(d.debts || []).find(x => x.type === 'payable').counterparty} — ${fmt((d.debts || []).find(x => x.type === 'payable').amount)} IDR due ${daysUntil((d.debts || []).find(x => x.type === 'payable').due_date) === 0 ? 'today' : daysUntil((d.debts || []).find(x => x.type === 'payable').due_date) + 'd'}.` : 'No outstanding payables.' },
              { icon: '💚', label: 'Main incoming', text: (d.debts || []).find(x => x.type === 'receivable') ? `${(d.debts || []).find(x => x.type === 'receivable').counterparty} owes ${fmt((d.debts || []).find(x => x.type === 'receivable').amount)} IDR.` : 'No receivables scheduled.' },
              { icon: '💡', label: 'Recommendation', text: d.runway < 7 ? `Critical: only ${d.runway} days left. Collect receivables immediately.` : d.runway < 14 ? `Attention: runway is ${d.runway} days. Review upcoming expenses.` : d.payables > d.totalBalance ? 'Payables exceed cash balance. Prioritize collections.' : 'Finances healthy. Focus on growing income.' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14, marginTop: 1 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{item.text}</div>
                </div>
              </div>
            ))}
            <button onClick={() => setShowAnalysis(false)} style={{ width: '100%', marginTop: 16, padding: 12, borderRadius: 10, background: 'var(--text)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 500 }}>Close</button>
          </div>
        </div>
      )}

      {payModal && (
        <div onClick={() => setPayModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', maxWidth: 430, margin: '0 auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{payModal.type === 'receivable' ? 'Mark as received' : 'Mark as paid'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>{payModal.counterparty} · {fmt(payModal.amount)} IDR total</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Amount (IDR)</div>
              <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setPayForm(p => ({ ...p, amount: String(Math.round(payModal.amount * pct / 100)) }))}
                    style={{ flex: 1, padding: '5px', borderRadius: 8, fontSize: 11, border: '0.5px solid var(--border-2)', background: 'none', color: 'var(--text-2)' }}>
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
            <button disabled={!payForm.amount || paying} onClick={handlePay} style={{ width: '100%', padding: 13, borderRadius: 10, background: payForm.amount ? 'var(--text)' : 'var(--bg-2)', color: payForm.amount ? '#fff' : 'var(--text-3)', border: 'none', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
              {paying ? 'Processing...' : Number(payForm.amount) >= Number(payModal.amount) ? 'Pay in full' : `Pay ${fmt(Number(payForm.amount))} IDR`}
            </button>
            <button onClick={() => setPayModal(null)} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}