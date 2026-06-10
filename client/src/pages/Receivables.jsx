import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, daysUntil } from '../lib/api'
import DebtPaymentModal from '../components/DebtPaymentModal'
import DebtFormModal from '../components/DebtFormModal'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * getStatusBadge — returns style config for status badge.
 * Handles the enriched status from backend.
 */
function getStatusBadge(debt) {
  const { status, days_overdue } = debt
  if (status === 'paid')      return { cls: 'paid',     label: 'Received ✓' }
  if (status === 'overdue')   return { cls: 'overdue',  label: days_overdue > 0 ? `${days_overdue}d overdue` : 'Overdue' }
  if (status === 'partial')   return { cls: 'due-soon', label: 'Partial' }
  if (status === 'cancelled') return { cls: 'open',     label: 'Cancelled' }
  // open — check due_date for urgency
  const days = daysUntil(debt.due_date)
  if (days !== null && days <= 3) return { cls: 'due-soon', label: `Due in ${days}d` }
  if (days !== null && days <= 7) return { cls: 'open',     label: `In ${days}d` }
  return                               { cls: 'open',     label: days !== null ? `In ${days}d` : 'Open' }
}

function getCashRiskLabel(debt) {
  const { status, days_overdue, remaining_amount } = debt
  if (status === 'overdue' && days_overdue >= 7) return { text: `⚠ Overdue ${days_overdue}d`, color: 'var(--red-dark)' }
  if (status === 'overdue')                      return { text: '⚠ Overdue', color: 'var(--red)' }
  if (status === 'partial')                      return { text: '◑ Partial payment', color: 'var(--amber-dark)' }
  const days = daysUntil(debt.due_date)
  if (days !== null && days <= 3 && days >= 0)   return { text: '⏰ Due soon', color: 'var(--amber-dark)' }
  if (remaining_amount > 10_000_000)             return { text: '💰 Large receivable', color: 'var(--brand)' }
  return null
}

function DebtRow({ debt, accounts, token, onRefresh }) {
  const [modal,   setModal]   = useState(false)
  const [success, setSuccess] = useState(false)

  const badge     = getStatusBadge(debt)
  const riskLabel = getCashRiskLabel(debt)
  const remaining = Number(debt.remaining_amount ?? debt.amount ?? 0)
  const isOpen    = !['paid', 'cancelled'].includes(debt.status)

  const handleSuccess = () => {
    setModal(false)
    setSuccess(true)
    setTimeout(onRefresh, 500)
  }

  return (
    <>
      <div className="item-row" style={{ opacity: success || debt.status === 'paid' ? 0.55 : 1, transition: 'opacity .3s', alignItems: 'flex-start', padding: '12px 14px' }}>
        <div className="item-row-left" style={{ flex: 1, minWidth: 0 }}>
          <div className="item-row-name">{debt.counterparty || '—'}</div>
          <div className="item-row-sub">
            {fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}
          </div>
          {/* Partial progress bar */}
          {debt.status === 'partial' && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginBottom: 3 }}>
                <span>Received {fmt(debt.paid_amount || 0)}</span>
                <span>Remaining {fmt(remaining)}</span>
              </div>
              <div style={{ height: 4, background: 'var(--border-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--green-dark)',
                  width: `${Math.min(100, ((debt.paid_amount || 0) / (debt.original_amount || debt.amount || 1)) * 100)}%`,
                  transition: 'width .3s',
                }} />
              </div>
            </div>
          )}
          {riskLabel && (
            <div style={{ fontSize: 10, fontWeight: 700, color: riskLabel.color, marginTop: 4, letterSpacing: '0.02em' }}>
              {riskLabel.text}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexShrink: 0, marginTop: 1 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="item-row-amount" style={{ color: 'var(--green-dark)' }}>
              +{fmt(debt.status === 'partial' ? remaining : Number(debt.original_amount || debt.amount))} IDR
            </div>
            {debt.status === 'partial' && (
              <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 1 }}>
                of {fmt(debt.original_amount || debt.amount)} total
              </div>
            )}
            <span className={`status-pill ${badge.cls}`}>{success ? 'Received ✓' : badge.label}</span>
          </div>
          {isOpen && !success && (
            <button
              onClick={() => setModal(true)}
              style={{
                padding: '6px 12px', borderRadius: 9, fontSize: 11, fontWeight: 600,
                background: debt.status === 'overdue' ? 'var(--red-light)' : 'var(--green-light)',
                color: debt.status === 'overdue' ? 'var(--red-dark)' : 'var(--green-dark)',
                border: debt.status === 'overdue' ? '1px solid rgba(240,68,56,.25)' : '1px solid rgba(18,183,106,.25)',
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {debt.status === 'partial' ? 'More' : 'Mark received'}
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

// ── Filter tabs ────────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'open',    label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid',    label: 'Received' },
]

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Receivables() {
  const { token } = useAuth()
  const navigate  = useNavigate()
  const [searchParams] = useSearchParams()

  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter,   setFilter]   = useState('all')

  useEffect(() => {
    if (searchParams.get('new') === '1') setShowForm(true)
  }, [searchParams])

  const load = useCallback(() => {
    setLoading(true)
    // Load from /api/pulse (includes enriched debts array) for full compatibility
    apiFetch('/pulse', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading && !data) return <div className="page-loading">Loading receivables…</div>

  const d            = data || {}
  const accounts     = d.accounts || []
  const allDebts     = d.debts || []
  const receivables  = allDebts.filter(x => x.type === 'receivable')

  // Counts for filter tabs
  const openItems    = receivables.filter(x => x.status === 'open')
  const overdueItems = receivables.filter(x => x.status === 'overdue')
  const partialItems = receivables.filter(x => x.status === 'partial')
  const paidItems    = receivables.filter(x => x.status === 'paid')

  // Active filter
  const filtered = filter === 'all'     ? receivables
                 : filter === 'open'    ? openItems
                 : filter === 'overdue' ? overdueItems
                 : filter === 'partial' ? partialItems
                 :                        paidItems

  // Summary totals — only open (unpaid)
  const openAll       = receivables.filter(x => !['paid', 'cancelled'].includes(x.status))
  const totalRemaining = openAll.reduce((s, x) => s + Number(x.remaining_amount ?? x.amount ?? 0), 0)

  const FILTER_COUNTS = { all: receivables.length, open: openItems.length, overdue: overdueItems.length, partial: partialItems.length, paid: paidItems.length }

  return (
    <div className="hf-page">

      {/* ── Header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">Receivables</div>
          <div className="hf-page-subtitle">Money expected from clients and partners</div>
        </div>
        <div className="hf-page-actions">
          <button className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>+ New</button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* ── Summary cards ─── */}
      <div className="summary-grid" style={{ marginBottom: 16 }}>
        <div className="summary-card">
          <div className="summary-card-label">Total Remaining</div>
          <div className="summary-card-value" style={{ color: 'var(--green-dark)' }}>+{fmt(totalRemaining)}</div>
          <div className="summary-card-sub">IDR expected</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Open</div>
          <div className="summary-card-value">{openItems.length + partialItems.length}</div>
          <div className="summary-card-sub">Awaiting receipt</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Overdue</div>
          <div className="summary-card-value" style={{ color: overdueItems.length > 0 ? 'var(--red)' : 'var(--green-dark)' }}>
            {overdueItems.length}
          </div>
          <div className="summary-card-sub">{overdueItems.length > 0 ? 'Past due date' : 'All on time'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">Partial</div>
          <div className="summary-card-value" style={{ color: partialItems.length > 0 ? 'var(--amber-dark)' : 'var(--text)' }}>
            {partialItems.length}
          </div>
          <div className="summary-card-sub">Partially received</div>
        </div>
      </div>

      {/* ── Filter tabs ─── */}
      {receivables.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 2 }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                whiteSpace: 'nowrap', cursor: 'pointer', transition: 'all .12s',
                background: filter === f.key ? 'var(--text)' : 'var(--bg-2)',
                color:      filter === f.key ? 'var(--bg)'  : 'var(--text-3)',
                border:     filter === f.key ? 'none'       : '0.5px solid var(--border)',
              }}
            >
              {f.label}{FILTER_COUNTS[f.key] > 0 ? ` · ${FILTER_COUNTS[f.key]}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* ── Empty state ─── */}
      {receivables.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📥</div>
          <div className="empty-state-title">No receivables yet</div>
          <div className="empty-state-sub">Track money that clients and partners owe you.</div>
          <button className="empty-state-cta" onClick={() => setShowForm(true)}>+ New Receivable</button>
        </div>
      )}

      {/* ── Filtered list ─── */}
      {filtered.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="item-list-card" style={{
            borderColor: filter === 'overdue' ? 'rgba(240,68,56,.2)' : undefined,
          }}>
            {filtered.map(debt => (
              <DebtRow key={debt.id} debt={debt} accounts={accounts} token={token} onRefresh={load} />
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && receivables.length > 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-4)', fontSize: 13 }}>
          No {filter} receivables
        </div>
      )}

      {receivables.length > 0 && (
        <div style={{ textAlign: 'center', paddingBottom: 16 }}>
          <button className="link-btn" onClick={() => navigate('/transactions')}>View all transactions →</button>
        </div>
      )}

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
