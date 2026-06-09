import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, daysUntil } from '../lib/api'

function getStatusPill(days, isSettled) {
  if (isSettled) return { cls: 'paid',     label: 'Paid' }
  if (days < 0)  return { cls: 'overdue',  label: `${Math.abs(days)}d overdue` }
  if (days <= 3) return { cls: 'due-soon', label: 'Due soon' }
  return               { cls: 'open',      label: `In ${days}d` }
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Payables() {
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

  if (loading && !data) return <div className="page-loading">Loading payables…</div>

  const d        = data || {}
  const allDebts = d.debts || []
  const payables = allDebts.filter(x => x.type === 'payable')
  const open     = payables.filter(x => !x.is_settled)
  const overdue  = open.filter(x => daysUntil(x.due_date) < 0)
  const dueSoon  = open.filter(x => { const days = daysUntil(x.due_date); return days >= 0 && days <= 7 })
  const totalAmount = open.reduce((s, x) => s + Number(x.amount || 0), 0)

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Payables</div>
          <div className="page-header-sub">Money your business needs to pay</div>
        </div>
        <button className="page-header-action" onClick={() => navigate('/transactions')}>View Transactions</button>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* ── Summary cards ─── */}
      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-card">
          <div className="summary-card-label">Total Payables</div>
          <div className="summary-card-value" style={{ color: 'var(--red-dark)' }}>−{fmt(totalAmount)}</div>
          <div className="summary-card-sub">IDR to pay</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Open Items</div>
          <div className="summary-card-value" style={{ color: 'var(--text)' }}>{open.length}</div>
          <div className="summary-card-sub">Awaiting payment</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Overdue</div>
          <div className="summary-card-value" style={{ color: overdue.length > 0 ? 'var(--red)' : 'var(--green-dark)' }}>{overdue.length}</div>
          <div className="summary-card-sub">{overdue.length > 0 ? 'Past due date' : 'None overdue'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Due Soon</div>
          <div className="summary-card-value" style={{ color: dueSoon.length > 0 ? 'var(--amber-dark)' : 'var(--text)' }}>{dueSoon.length}</div>
          <div className="summary-card-sub">Within 7 days</div>
        </div>
      </div>

      {/* ── List ─── */}
      {payables.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📤</div>
          <div className="empty-state-title">No payables yet</div>
          <div className="empty-state-sub">Track money your business owes to vendors, contractors, or partners.</div>
          <button className="empty-state-cta" onClick={() => navigate('/add')}>Add Transaction</button>
        </div>
      ) : (
        <>
          {/* Overdue */}
          {overdue.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="section-title" style={{ color: 'var(--red-dark)' }}>Overdue · {overdue.length}</div>
              <div className="item-list-card" style={{ borderColor: 'rgba(240,68,56,.2)' }}>
                {overdue.map(debt => {
                  const days = daysUntil(debt.due_date)
                  const pill = getStatusPill(days, debt.is_settled)
                  return (
                    <div key={debt.id} className="item-row">
                      <div className="item-row-left">
                        <div className="item-row-name">{debt.counterparty || '—'}</div>
                        <div className="item-row-sub">{fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}</div>
                      </div>
                      <div className="item-row-right">
                        <div className="item-row-amount" style={{ color: 'var(--red-dark)' }}>−{fmt(debt.amount)} IDR</div>
                        <span className={`status-pill ${pill.cls}`}>{pill.label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Open */}
          {open.filter(x => daysUntil(x.due_date) >= 0).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="section-title">Open · {open.filter(x => daysUntil(x.due_date) >= 0).length}</div>
              <div className="item-list-card">
                {open.filter(x => daysUntil(x.due_date) >= 0).map(debt => {
                  const days = daysUntil(debt.due_date)
                  const pill = getStatusPill(days, debt.is_settled)
                  return (
                    <div key={debt.id} className="item-row">
                      <div className="item-row-left">
                        <div className="item-row-name">{debt.counterparty || '—'}</div>
                        <div className="item-row-sub">{fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}</div>
                      </div>
                      <div className="item-row-right">
                        <div className="item-row-amount" style={{ color: 'var(--red-dark)' }}>−{fmt(debt.amount)} IDR</div>
                        <span className={`status-pill ${pill.cls}`}>{pill.label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Paid / settled */}
          {payables.filter(x => x.is_settled).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="section-title">Paid · {payables.filter(x => x.is_settled).length}</div>
              <div className="item-list-card">
                {payables.filter(x => x.is_settled).slice(0, 5).map(debt => (
                  <div key={debt.id} className="item-row" style={{ opacity: 0.6 }}>
                    <div className="item-row-left">
                      <div className="item-row-name">{debt.counterparty || '—'}</div>
                      <div className="item-row-sub">{fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}</div>
                    </div>
                    <div className="item-row-right">
                      <div className="item-row-amount" style={{ color: 'var(--text-3)' }}>−{fmt(debt.amount)} IDR</div>
                      <span className="status-pill paid">Paid</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', paddingBottom: 16 }}>
            <button className="link-btn" onClick={() => navigate('/transactions')}>View all transactions →</button>
          </div>
        </>
      )}
    </div>
  )
}
