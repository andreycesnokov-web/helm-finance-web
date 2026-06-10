import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'

function KeyDateRow({ dot, desc, date, amount, isIn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 3 }}>{date}</div>
      </div>
      <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: isIn ? 'var(--green-dark)' : 'var(--red-dark)', flexShrink: 0 }}>
        {isIn ? '+' : '-'}{fmt(Math.abs(amount))}
      </div>
    </div>
  )
}

export default function Radar() {
  const { token } = useAuth()
  const { hasFeature, effectivePlan } = useAccess()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/pulse?scope=all', token)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite' }} />
    </div>
  )

  const d = data || {}
  const balance  = d.totalBalance || 0
  const burnRate = d.burnRate || 0
  const debts    = d.debts || []
  const receivables = debts.filter(x => x.type === 'receivable')
  const payables    = debts.filter(x => x.type === 'payable')
  const totalIn  = receivables.reduce((s, x) => s + Number(x.amount), 0)
  const totalOut = payables.reduce((s, x) => s + Number(x.amount), 0)

  const proj30    = balance + totalIn - totalOut - burnRate * 30
  const projBest  = balance + totalIn - totalOut * 0.5
  const projWorst = balance - totalOut - burnRate * 30
  const monthlyBurn = burnRate * 30
  const runway    = burnRate > 0 ? Math.round(balance / burnRate) : null

  const isHealthy = proj30 >= 0

  return (
    <div className="hf-page">
      {/* Page header */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">Radar</div>
          <div className="hf-page-subtitle">30-day cash forecast · scenario analysis</div>
        </div>
        <div className={`hf-badge ${isHealthy ? 'hf-badge-green' : 'hf-badge-red'}`} style={{ fontSize: 13, padding: '6px 14px' }}>
          {isHealthy ? '✓ Healthy' : '⚠ At Risk'}
        </div>
      </div>

      {/* Advanced Radar upgrade banner — shown only when feature not enabled */}
      {!hasFeature('advanced_radar_enabled') && (
        <div style={{
          margin: '0 0 16px',
          padding: '11px 16px',
          borderRadius: 12,
          background: 'rgba(37,99,235,0.07)',
          border: '1px solid rgba(37,99,235,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>📡</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 1 }}>Basic Radar</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Advanced Radar — multi-scenario AI forecast — available on Founder plan</div>
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700,
            background: 'rgba(37,99,235,0.12)', color: '#2563EB',
            padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            Founder+
          </span>
        </div>
      )}

      {/* Hero projected balance — dark navy premium card */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--text) 0%, #1e2d4a 100%)',
          borderRadius: 20,
          padding: '24px 24px 20px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(11,18,32,0.22)',
        }}>
          {/* Subtle grid texture */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.04,
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 24px, #fff 24px, #fff 25px), repeating-linear-gradient(90deg, transparent, transparent 24px, #fff 24px, #fff 25px)',
          }} />

          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              Projected balance · 30 days
            </div>
            <div style={{ fontSize: 'var(--text-hero)', fontWeight: 700, color: '#fff', letterSpacing: -1, lineHeight: 1 }}>
              {proj30 >= 0 ? '+' : ''}{fmtFull(Math.round(proj30))}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>IDR · if all planned transactions go through</div>

            {/* Mini stats row */}
            <div style={{ display: 'flex', gap: 20, marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { label: 'Current balance', val: fmtFull(balance) + ' IDR' },
                { label: 'Monthly burn',    val: fmtFull(monthlyBurn) + ' IDR' },
                { label: 'Runway',          val: runway != null ? runway + ' days' : '∞' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: '#fff' }}>{s.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Scenario cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'var(--green-light)', borderRadius: 16, padding: '16px 18px', border: '1px solid rgba(2,122,72,.12)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--green-dark)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>Best case</div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--green-dark)', letterSpacing: -0.5 }}>{fmt(Math.round(projBest))}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--green)', marginTop: 5 }}>All income received</div>
        </div>
        <div style={{ background: 'var(--red-light)', borderRadius: 16, padding: '16px 18px', border: '1px solid rgba(180,35,24,.12)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--red-dark)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>Worst case</div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--red-dark)', letterSpacing: -0.5 }}>{fmt(Math.round(projWorst))}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--red)', marginTop: 5 }}>Delays in receivables</div>
        </div>
      </div>

      {/* Burn rate metrics card */}
      <div className="hf-card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-3)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monthly burn breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { label: 'Monthly burn', val: fmtFull(monthlyBurn), sub: 'IDR / month', color: 'var(--red-dark)' },
            { label: 'Daily average', val: fmt(burnRate), sub: 'IDR / day', color: 'var(--text)' },
            { label: 'Runway left', val: runway != null ? runway + 'd' : '∞', sub: burnRate > 0 ? 'at current burn' : 'no burn data', color: runway != null && runway < 14 ? 'var(--red-dark)' : runway != null && runway < 30 ? 'var(--amber-dark)' : 'var(--green-dark)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-2)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: s.color, letterSpacing: -0.3 }}>{s.val}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-4)', marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Key dates timeline */}
      {debts.length > 0 && (
        <div className="hf-card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Key dates</div>

          {receivables.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>Incoming</div>
              {receivables.map(d => (
                <KeyDateRow key={d.id}
                  dot="var(--green)" desc={d.counterparty} isIn={true} amount={d.amount}
                  date={d.due_date ? new Date(d.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (daysUntil(d.due_date) >= 0 ? ` · in ${daysUntil(d.due_date)}d` : ' · overdue') : 'No date'}
                />
              ))}
            </>
          )}

          {payables.length > 0 && (
            <>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--red-dark)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 8px', fontWeight: 600 }}>Outgoing</div>
              {payables.map(d => (
                <KeyDateRow key={d.id}
                  dot="var(--red)" desc={d.counterparty} isIn={false} amount={d.amount}
                  date={d.due_date ? new Date(d.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (daysUntil(d.due_date) >= 0 ? ` · in ${daysUntil(d.due_date)}d` : ' · overdue') : 'No date'}
                />
              ))}
            </>
          )}
        </div>
      )}

      {debts.length === 0 && (
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📡</div>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>No planned transactions</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', lineHeight: 1.6 }}>
            Add receivables and payables to see your 30-day cash forecast.
          </div>
        </div>
      )}

      {/* 30-day net flow summary */}
      <div className="hf-card">
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>30-day net flow</div>
        {[
          { label: 'Current balance',    val: fmtFull(balance),    color: 'var(--text)',      sign: '' },
          { label: '+ Expected income',  val: fmtFull(totalIn),    color: 'var(--green-dark)', sign: '+' },
          { label: '− Expected payments',val: fmtFull(totalOut),   color: 'var(--red-dark)',   sign: '−' },
          { label: '− Monthly burn',     val: fmtFull(monthlyBurn),color: 'var(--red-dark)',   sign: '−' },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < 3 ? '0.5px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>{row.label}</span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: row.color }}>{row.sign}{row.val}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 2px', borderTop: '2px solid var(--border-2)', marginTop: 4 }}>
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>Projected balance</span>
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: isHealthy ? 'var(--green-dark)' : 'var(--red-dark)' }}>
            {proj30 >= 0 ? '+' : ''}{fmtFull(Math.round(proj30))} IDR
          </span>
        </div>
      </div>
    </div>
  )
}
