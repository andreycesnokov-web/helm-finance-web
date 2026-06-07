import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

function TimelineItem({ dot, desc, date, amount, isIn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0, marginTop: 4, zIndex: 1 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>{desc}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{date}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: isIn ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>
        {isIn ? '+' : '-'}{fmt(Math.abs(amount))}
      </div>
    </div>
  )
}

export default function Radar() {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/pulse?scope=all', token),
    ]).then(([pulse]) => {
      setData(pulse)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>Loading...</div>

  const d = data || {}
  const balance = d.totalBalance || 0
  const burnRate = d.burnRate || 0
  const debts = d.debts || []
  const receivables = debts.filter(x => x.type === 'receivable')
  const payables = debts.filter(x => x.type === 'payable')
  const totalIn = receivables.reduce((s, x) => s + Number(x.amount), 0)
  const totalOut = payables.reduce((s, x) => s + Number(x.amount), 0)

  // Projections
  const proj30 = balance + totalIn - totalOut - burnRate * 30
  const projBest = balance + totalIn - totalOut * 0.5
  const projWorst = balance - totalOut - burnRate * 30

  // Monthly burn from transactions
  const monthlyBurn = burnRate * 30

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Radar</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>30-day cash forecast</div>
        </div>
      </div>

      {/* Projected balance */}
      <div style={{ margin: '0 16px 14px', background: proj30 >= 0 ? 'var(--green)' : 'var(--red)', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>Projected balance · 30 days</div>
        <div style={{ fontSize: 28, fontWeight: 600, color: '#fff', letterSpacing: -0.5 }}>
          {proj30 >= 0 ? '+' : ''}{fmtFull(Math.round(proj30))}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>IDR · if all planned transactions go through</div>
      </div>

      {/* Scenario cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 16px', marginBottom: 14 }}>
        <div style={{ background: 'var(--green-light)', borderRadius: 12, padding: '12px' }}>
          <div style={{ fontSize: 10, color: 'var(--green-dark)', marginBottom: 4 }}>Best case</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--green-dark)' }}>{fmt(Math.round(projBest))}</div>
          <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>all income received</div>
        </div>
        <div style={{ background: 'var(--red-light)', borderRadius: 12, padding: '12px' }}>
          <div style={{ fontSize: 10, color: 'var(--red-dark)', marginBottom: 4 }}>Worst case</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--red-dark)' }}>{fmt(Math.round(projWorst))}</div>
          <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>delays in receivables</div>
        </div>
      </div>

      {/* Burn rate card */}
      <div style={{ margin: '0 16px 14px', background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Monthly burn</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{fmt(monthlyBurn)} IDR</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Daily avg', val: fmt(burnRate) + '/day' },
            { label: 'Runway', val: burnRate > 0 ? Math.round(balance / burnRate) + ' days' : '∞' },
            { label: 'Current bal', val: fmt(balance) },
          ].map(s => (
            <div key={s.label} style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.label}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginTop: 2 }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {debts.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Key dates</div>

          {receivables.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Incoming</div>
              {receivables.map(d => (
                <TimelineItem key={d.id}
                  dot="var(--green)" desc={d.counterparty} isIn={true} amount={d.amount}
                  date={d.due_date ? new Date(d.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (daysUntil(d.due_date) >= 0 ? ` · ${daysUntil(d.due_date)}d` : ' · overdue') : 'No date'}
                />
              ))}
            </>
          )}

          {payables.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 6px' }}>Outgoing</div>
              {payables.map(d => (
                <TimelineItem key={d.id}
                  dot="var(--red)" desc={d.counterparty} isIn={false} amount={d.amount}
                  date={d.due_date ? new Date(d.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (daysUntil(d.due_date) >= 0 ? ` · ${daysUntil(d.due_date)}d` : ' · overdue') : 'No date'}
                />
              ))}
            </>
          )}
        </div>
      )}

      {debts.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>No planned transactions</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
            Add debts and receivables in the<br/>Add tab to see your cash forecast.
          </div>
        </div>
      )}

      {/* Net flow summary */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>30-day net flow</div>
        {[
          { label: 'Current balance', val: fmtFull(balance), color: 'var(--text)' },
          { label: '+ Expected income', val: '+' + fmtFull(totalIn), color: 'var(--green)' },
          { label: '- Expected payments', val: '-' + fmtFull(totalOut), color: 'var(--red)' },
          { label: '- Monthly burn', val: '-' + fmtFull(monthlyBurn), color: 'var(--red)' },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < 3 ? '0.5px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: row.color }}>{row.val}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 2px', borderTop: '1px solid var(--border-2)', marginTop: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Projected</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: proj30 >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {proj30 >= 0 ? '+' : ''}{fmtFull(Math.round(proj30))} IDR
          </span>
        </div>
      </div>
    </div>
  )
}
