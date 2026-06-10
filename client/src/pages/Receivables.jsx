import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, daysUntil } from '../lib/api'
import DebtPaymentModal from '../components/DebtPaymentModal'
import DebtFormModal from '../components/DebtFormModal'

function getStatusPill(days, isSettled) {
  if (isSettled) return { cls: 'paid',     label: 'Received' }
  if (days < 0)  return { cls: 'overdue',  label: `${Math.abs(days)}d overdue` }
  if (days <= 3) return { cls: 'due-soon', label: 'Due soon' }
  return               { cls: 'open',      label: `In ${days}d` }
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Single row with Mark Received button
function DebtRow({ debt, accounts, token, onRefresh }) {
  const [modal,   setModal]   = useState(false)
  const [success, setSuccess] = useState(false)

  const days = daysUntil(debt.due_date)
  const pill = getStatusPill(days, debt.is_settled)

  const handleSuccess = () => {
    setModal(false)
    setSuccess(true)
    // Refresh parent list after short delay so user sees success flash
    setTimeout(onRefresh, 600)
  }

  return (
    <>
      <div className="item-row" style={{ opacity: success ? 0.5 : 1, transition: 'opacity .3s' }}>
        <div className="item-row-left">
          <div className="item-row-name">{debt.counterparty || '—'}</div>
          <div className="item-row-sub" style={{ color: days < 0 && !debt.is_settled ? 'var(--red)' : undefined }}>
            {fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="item-row-amount" style={{ color: 'var(--green-dark)' }}>+{fmt(debt.amount)} IDR</div>
            <span className={`status-pill ${pill.cls}`}>{success ? 'Received ✓' : pill.label}</span>
          </div>
          {!debt.is_settled && !success && (
            <button
              onClick={() => setModal(true)}
              style={{
                padding: '6px 13px', borderRadius: 9, fontSize: 11, fontWeight: 600,
                background: 'var(--green-light)', color: 'var(--green-dark)',
                border: '1px solid rgba(18,183,106,.25)', cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Mark received
            </button>
          )}
        </div>
      </div>

      {modal && (
        <DebtPaymentModal
          debt={debt}
          accounts={accounts}
          token={token}
          onClose={() => setModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Receivables() {
  const { token } = useAuth()
  const navigate  = useNavigate()
  const [searchParams] = useSearchParams()
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [showForm, setShowForm] = useState(false)

  // Auto-open form when navigated with ?new=1 (e.g. from Pulse quick actions)
  useEffect(() => {
    if (searchParams.get('new') === '1') setShowForm(true)
  }, [searchParams])

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/pulse', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading && !data) return <div className="page-loading">Loading receivables…</div>

  const d           = data || {}
  const accounts    = d.accounts || []
  const allDebts    = d.debts || []
  const receivables = allDebts.filter(x => x.type === 'receivable')
  const open        = receivables.filter(x => !x.is_settled)
  const overdue     = open.filter(x => daysUntil(x.due_date) < 0)
  const dueSoon     = open.filter(x => { const days = daysUntil(x.due_date); return days >= 0 && days <= 7 })
  const settled     = receivables.filter(x => x.is_settled)
  const totalAmount = open.reduce((s, x) => s + Number(x.amount || 0), 0)

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Receivables</div>
          <div className="page-header-sub">Money expected from clients and partners</div>
        </div>
        <button className="page-header-action" onClick={() => setShowForm(true)}>+ New</button>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* ── Summary cards ─── */}
      <div className="summary-grid" style={{ marginBottom: 20 }}>
        <div className="summary-card">
          <div className="summary-card-label">Total Open</div>
          <div className="summary-card-value" style={{ color: 'var(--green-dark)' }}>+{fmt(totalAmount)}</div>
          <div className="summary-card-sub">IDR expected</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Open Items</div>
          <div className="summary-card-value" style={{ color: 'var(--text)' }}>{open.length}</div>
          <div className="summary-card-sub">Awaiting receipt</div>
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

      {/* ── Empty state ─── */}
      {receivables.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📥</div>
          <div className="empty-state-title">No receivables yet</div>
          <div className="empty-state-sub">Track money that clients and partners owe you. Add a receivable entry to get started.</div>
          <button className="empty-state-cta" onClick={() => navigate('/add')}>Add Transaction</button>
        </div>
      )}

      {/* ── Overdue ─── */}
      {overdue.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="section-title" style={{ color: 'var(--red-dark)' }}>Overdue · {overdue.length}</div>
          <div className="item-list-card" style={{ borderColor: 'rgba(240,68,56,.2)' }}>
            {overdue.map(debt => (
              <DebtRow key={debt.id} debt={debt} accounts={accounts} token={token} onRefresh={load} />
            ))}
          </div>
        </div>
      )}

      {/* ── Open ─── */}
      {open.filter(x => daysUntil(x.due_date) >= 0).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="section-title">Open · {open.filter(x => daysUntil(x.due_date) >= 0).length}</div>
          <div className="item-list-card">
            {open.filter(x => daysUntil(x.due_date) >= 0).map(debt => (
              <DebtRow key={debt.id} debt={debt} accounts={accounts} token={token} onRefresh={load} />
            ))}
          </div>
        </div>
      )}

      {/* ── Received / settled ─── */}
      {settled.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="section-title">Received · {settled.length}</div>
          <div className="item-list-card">
            {settled.slice(0, 5).map(debt => (
              <div key={debt.id} className="item-row" style={{ opacity: 0.55 }}>
                <div className="item-row-left">
                  <div className="item-row-name">{debt.counterparty || '—'}</div>
                  <div className="item-row-sub">{fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}</div>
                </div>
                <div className="item-row-right">
                  <div className="item-row-amount" style={{ color: 'var(--green-dark)' }}>+{fmt(debt.amount)} IDR</div>
                  <span className="status-pill paid">Received</span>
                </div>
              </div>
            ))}
            {settled.length > 5 && (
              <div style={{ padding: '10px 16px', textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>+{settled.length - 5} more settled</span>
              </div>
            )}
          </div>
        </div>
      )}

      {receivables.length > 0 && (
        <div style={{ textAlign: 'center', paddingBottom: 16 }}>
          <button className="link-btn" onClick={() => navigate('/transactions')}>View all transactions →</button>
        </div>
      )}

      {/* ── Create modal ─── */}
      {showForm && (
        <DebtFormModal
          mode="receivable"
          token={token}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load() }}
        />
      )}

    </div>
  )
}
