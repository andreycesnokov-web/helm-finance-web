import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt } from '../lib/api'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Payroll() {
  const { token } = useAuth()
  const navigate  = useNavigate()
  const [txs, setTxs]         = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    // Use existing transactions endpoint — filter payroll type
    apiFetch('/transactions?type=payroll', token)
      .then(data => setTxs(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading && !txs.length) return <div className="page-loading">Loading payroll…</div>

  const now       = new Date()
  const thisMonth = txs.filter(t => {
    const d = new Date(t.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })

  const totalPaidThisMonth = thisMonth.reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)
  const totalAll           = txs.reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Payroll</div>
          <div className="page-header-sub">Salary obligations and payment tracking</div>
        </div>
        <button className="page-header-action" onClick={() => navigate('/add')}>Add Payroll</button>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* ── Summary ─── */}
      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-card">
          <div className="summary-card-label">Paid This Month</div>
          <div className="summary-card-value" style={{ color: 'var(--text)' }}>{fmt(totalPaidThisMonth)}</div>
          <div className="summary-card-sub">IDR · {thisMonth.length} payment{thisMonth.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Total Records</div>
          <div className="summary-card-value" style={{ color: 'var(--text)' }}>{txs.length}</div>
          <div className="summary-card-sub">All payroll transactions</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Due Today</div>
          <div className="summary-card-value" style={{ color: 'var(--text-3)' }}>—</div>
          <div className="summary-card-sub">Scheduled payroll</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Total Paid</div>
          <div className="summary-card-value" style={{ color: 'var(--red-dark)' }}>{fmt(totalAll)}</div>
          <div className="summary-card-sub">IDR all time</div>
        </div>
      </div>

      {/* ── List or empty state ─── */}
      {txs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💼</div>
          <div className="empty-state-title">No payroll records yet</div>
          <div className="empty-state-sub">Add payroll transactions to track salary obligations and payment history. Use the "Payroll" type when adding a transaction.</div>
          <button className="empty-state-cta" onClick={() => navigate('/add')}>Add Payroll Transaction</button>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">Payroll History · {txs.length}</div>
          <div className="item-list-card">
            {txs.map((t, i, arr) => {
              const amount = Number(t.amount_original || t.amount_idr || 0)
              const cur = t.currency_original && t.currency_original !== 'IDR' ? t.currency_original : 'IDR'
              return (
                <div key={t.id} className="item-row">
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                    💼
                  </div>
                  <div className="item-row-left">
                    <div className="item-row-name">{t.description || t.category || 'Payroll'}</div>
                    <div className="item-row-sub">{fmtDate(t.created_at)}{t.source ? ` · ${t.source}` : ''}</div>
                  </div>
                  <div className="item-row-right">
                    <div className="item-row-amount" style={{ color: 'var(--red-dark)' }}>−{fmt(amount)} {cur}</div>
                    <div className="item-row-status">Payroll</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ textAlign: 'center' }}>
            <button className="link-btn" onClick={() => navigate('/transactions')}>View all transactions →</button>
          </div>
        </div>
      )}

    </div>
  )
}
