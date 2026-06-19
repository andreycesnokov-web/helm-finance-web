import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt, daysUntil } from '../lib/api'
import DebtPaymentModal from '../components/DebtPaymentModal'
import DebtFormModal from '../components/DebtFormModal'
import ReceiptList from '../components/ReceiptList'
import DocumentsPanel from '../components/DocumentsPanel'

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getStatusBadge(debt) {
  const { status, days_overdue, approval_status } = debt
  if (approval_status === 'pending_approval') return { cls: 'due-soon', label: '⏳ Pending approval' }
  if (approval_status === 'rejected')         return { cls: 'open',     label: 'Rejected' }
  if (status === 'paid')      return { cls: 'paid',     label: 'Paid ✓' }
  if (status === 'overdue')   return { cls: 'overdue',  label: days_overdue > 0 ? `${days_overdue}d overdue` : 'Overdue' }
  if (status === 'partial')   return { cls: 'due-soon', label: 'Partial' }
  if (status === 'cancelled') return { cls: 'open',     label: 'Cancelled' }
  const days = daysUntil(debt.due_date)
  if (days === 0)             return { cls: 'overdue',  label: 'Due today' }
  if (days !== null && days <= 3) return { cls: 'due-soon', label: `Due in ${days}d` }
  return                           { cls: 'open',       label: days !== null ? `In ${days}d` : 'Open' }
}

function getCashPressureLabel(debt) {
  const { status, days_overdue, remaining_amount } = debt
  const days = daysUntil(debt.due_date)
  if (status === 'overdue' && days_overdue >= 7) return { text: `⚠ Overdue ${days_overdue}d`, color: 'var(--red-dark)' }
  if (status === 'overdue')                      return { text: '⚠ Overdue', color: 'var(--red)' }
  if (days === 0)                                return { text: '🔴 Due today', color: 'var(--red-dark)' }
  if (days !== null && days <= 3 && days > 0)    return { text: '⏰ Due this week', color: 'var(--amber-dark)' }
  if (status === 'partial')                      return { text: '◑ Partial payment made', color: 'var(--amber-dark)' }
  if (remaining_amount > 10_000_000)             return { text: '💸 Large payable', color: 'var(--red)' }
  return null
}

function DebtRow({ debt, accounts, token, onRefresh }) {
  const [modal,           setModal]           = useState(false)
  const [editModal,       setEditModal]       = useState(false)
  const [success,         setSuccess]         = useState(false)
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [docsOpen,        setDocsOpen]        = useState(false)
  const { t } = useTranslation()

  const badge         = getStatusBadge(debt)
  const pressureLabel = getCashPressureLabel(debt)
  const remaining     = Number(debt.remaining_amount ?? debt.amount ?? 0)
  const isOpen        = !['paid', 'cancelled'].includes(debt.status)
  const isPending     = debt.approval_status === 'pending_approval'
  const days          = daysUntil(debt.due_date)
  const isUrgent      = debt.status === 'overdue' || days === 0

  const handleApprove = async () => {
    setApprovalLoading(true)
    try {
      await apiFetch(`/debts/${debt.id}/approve`, token, { method: 'PATCH' })
      onRefresh()
    } catch (_) {}
    setApprovalLoading(false)
  }
  const handleReject = async () => {
    const reason = window.prompt('Причина отклонения (необязательно):', '')
    if (reason === null) return // cancelled
    setApprovalLoading(true)
    try {
      await apiFetch(`/debts/${debt.id}/reject`, token, { method: 'PATCH', body: { reason: reason.trim() || 'Rejected via Web App' } })
      onRefresh()
    } catch (_) {}
    setApprovalLoading(false)
  }

  const handleSuccess = () => {
    setModal(false)
    setSuccess(true)
    setTimeout(onRefresh, 500)
  }

  return (
    <>
      <div className="item-row" style={{ opacity: success || debt.status === 'paid' ? 0.55 : 1, transition: 'opacity .3s', alignItems: 'flex-start', padding: '12px 14px', borderLeft: isPending ? '3px solid var(--amber-dark)' : undefined }}>
        <div className="item-row-left" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div className="item-row-name">{debt.counterparty || '—'}</div>
            {debt.source_channel === 'telegram' && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#E8F4FF', color: '#1565C0', borderRadius: 6, padding: '2px 6px', letterSpacing: '0.02em' }}>
                ✈ Telegram
              </span>
            )}
          </div>
          <div className="item-row-sub">
            {fmtDate(debt.due_date)}{debt.description ? ` · ${debt.description}` : ''}
          </div>
          {debt.created_by_name && debt.source_channel === 'telegram' && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              By {debt.created_by_name}{debt.created_by_role ? ` · ${debt.created_by_role}` : ''}
            </div>
          )}
          {debt.source_channel === 'telegram' && debt.approval_status === 'approved' && debt.approved_via_channel && (
            <div style={{ fontSize: 11, color: 'var(--green-dark)', marginTop: 2 }}>
              ✓ Approved via {debt.approved_via_channel === 'telegram' ? 'Telegram' : 'Web App'}
            </div>
          )}
          {debt.raw_input_text && (
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2, fontStyle: 'italic' }}>
              "{debt.raw_input_text}"
            </div>
          )}
          {debt.info_request_note && (
            <div style={{ fontSize: 11, color: 'var(--amber-dark)', marginTop: 2 }}>
              ℹ️ Запрошено: {debt.info_request_note}
            </div>
          )}
          <ReceiptList debt={debt} token={token} />
          {/* Partial progress bar */}
          {debt.status === 'partial' && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginBottom: 3 }}>
                <span>{t('payables.paidAmount')}{fmt(debt.paid_amount || 0)}</span>
                <span>{t('payables.remaining')}{fmt(remaining)}</span>
              </div>
              <div style={{ height: 4, background: 'var(--border-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--brand)',
                  width: `${Math.min(100, ((debt.paid_amount || 0) / (debt.original_amount || debt.amount || 1)) * 100)}%`,
                  transition: 'width .3s',
                }} />
              </div>
            </div>
          )}
          {pressureLabel && (
            <div style={{ fontSize: 10, fontWeight: 700, color: pressureLabel.color, marginTop: 4, letterSpacing: '0.02em' }}>
              {pressureLabel.text}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexShrink: 0, marginTop: 1 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="item-row-amount" style={{ color: debt.status === 'paid' ? 'var(--text-3)' : 'var(--red-dark)' }}>
              −{fmt(debt.status === 'partial' ? remaining : Number(debt.original_amount || debt.amount))} IDR
            </div>
            {debt.status === 'partial' && (
              <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 1 }}>
                of {fmt(debt.original_amount || debt.amount)} total
              </div>
            )}
            <span className={`status-pill ${badge.cls}`}>{success ? 'Paid ✓' : badge.label}</span>
          </div>
          {isPending ? (
            <div style={{ display: 'flex', gap: 5, flexDirection: 'column', alignItems: 'flex-end' }}>
              <button
                onClick={handleApprove}
                disabled={approvalLoading}
                style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--green-light)', color: 'var(--green-dark)', border: '1px solid rgba(18,183,106,.3)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ✓ Approve
              </button>
              <button
                onClick={() => setEditModal(true)}
                style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--bg-3, #F1F3F5)', color: 'var(--text-2)', border: '1px solid var(--border-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ✏️ Edit
              </button>
              <button
                onClick={handleReject}
                disabled={approvalLoading}
                style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--red-light)', color: 'var(--red-dark)', border: '1px solid rgba(240,68,56,.2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ✗ Reject
              </button>
            </div>
          ) : isOpen && !success ? (
            <div style={{ display: 'flex', gap: 5, flexDirection: 'column', alignItems: 'flex-end' }}>
              <button
                onClick={() => setModal(true)}
                style={{
                  padding: '6px 12px', borderRadius: 9, fontSize: 11, fontWeight: 600,
                  background: isUrgent ? 'var(--red)' : 'var(--brand)',
                  color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {debt.status === 'partial' ? t('payables.payMore') : t('payables.payNow')}
              </button>
              <button
                onClick={() => setEditModal(true)}
                style={{ padding: '4px 10px', borderRadius: 8, fontSize: 10.5, fontWeight: 600, background: 'none', color: 'var(--text-3)', border: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ✏️ Edit
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <button onClick={() => setDocsOpen(o => !o)} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }}>
          📄 {t('nav.documents')} {docsOpen ? '▲' : '▼'}
        </button>
        {docsOpen && <DocumentsPanel targetType="debt" targetId={debt.id} />}
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
      {editModal && (
        <DebtFormModal
          mode="payable"
          initialDebt={debt}
          token={token}
          onClose={() => setEditModal(false)}
          onSuccess={() => { setEditModal(false); onRefresh && onRefresh() }}
        />
      )}
    </>
  )
}

// ── Filter tabs ────────────────────────────────────────────────────────────────
const FILTER_KEYS = ['all', 'pending', 'open', 'due_soon', 'overdue', 'partial', 'paid']

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Payables() {
  const { token } = useAuth()
  const navigate  = useNavigate()
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()

  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [filter,   setFilter]   = useState('all')

  useEffect(() => {
    if (searchParams.get('new') === '1') setShowForm(true)
  }, [searchParams])

  const [wallets, setWallets] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiFetch('/pulse', token),
      apiFetch('/wallets', token).catch(() => ({ wallets: [] })),
    ])
      .then(([pulse, w]) => { setData(pulse); setWallets(w.wallets || []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading && !data) return <div className="page-loading">{t('payables.loading')}</div>

  const d        = data || {}
  // Prefer real wallets (proper wallet_id) for the payment selector; fall back to pulse accounts.
  const accounts = wallets.length ? wallets : (d.accounts || [])
  const allDebts = d.debts || []
  const payables = allDebts.filter(x => x.type === 'payable')

  const pendingItems = payables.filter(x => x.approval_status === 'pending_approval')
  const openItems    = payables.filter(x => x.status === 'open'    && x.approval_status !== 'pending_approval')
  const overdueItems = payables.filter(x => x.status === 'overdue' && x.approval_status !== 'pending_approval')
  const partialItems = payables.filter(x => x.status === 'partial' && x.approval_status !== 'pending_approval')
  const paidItems    = payables.filter(x => x.status === 'paid')
  const dueSoonItems = payables.filter(x => {
    if (['paid','cancelled','overdue'].includes(x.status) || x.approval_status === 'pending_approval') return false
    const days = daysUntil(x.due_date)
    return days !== null && days <= 7 && days >= 0
  })

  const filtered = filter === 'all'      ? payables
                 : filter === 'pending'  ? pendingItems
                 : filter === 'open'     ? openItems
                 : filter === 'overdue'  ? overdueItems
                 : filter === 'partial'  ? partialItems
                 : filter === 'due_soon' ? dueSoonItems
                 :                         paidItems

  const openAll        = payables.filter(x => !['paid', 'cancelled'].includes(x.status) && x.approval_status !== 'pending_approval')
  const totalRemaining = openAll.reduce((s, x) => s + Number(x.remaining_amount ?? x.amount ?? 0), 0)

  const FILTER_COUNTS = {
    all: payables.length, pending: pendingItems.length, open: openItems.length, overdue: overdueItems.length,
    partial: partialItems.length, paid: paidItems.length, due_soon: dueSoonItems.length,
  }

  return (
    <div className="hf-page">

      {/* ── Header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">{t('payables.title')}</div>
          <div className="hf-page-subtitle">{t('payables.subtitle')}</div>
        </div>
        <div className="hf-page-actions">
          <button className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>{t('payables.newPayable')}</button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* ── Summary cards ─── */}
      <div className="summary-grid" style={{ marginBottom: 16 }}>
        <div className="summary-card">
          <div className="summary-card-label">{t('payables.totalRemaining')}</div>
          <div className="summary-card-value" style={{ color: 'var(--red-dark)' }}>−{fmt(totalRemaining)}</div>
          <div className="summary-card-sub">{t('payables.idrToPay')}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">{t('payables.open')}</div>
          <div className="summary-card-value">{openItems.length + partialItems.length}</div>
          <div className="summary-card-sub">{t('payables.awaitingPayment')}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">{t('payables.overdue')}</div>
          <div className="summary-card-value" style={{ color: overdueItems.length > 0 ? 'var(--red)' : 'var(--green-dark)' }}>
            {overdueItems.length}
          </div>
          <div className="summary-card-sub">{overdueItems.length > 0 ? t('payables.pastDueDate') : t('payables.noneOverdue')}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-label">{t('payables.dueSoon')}</div>
          <div className="summary-card-value" style={{ color: dueSoonItems.length > 0 ? 'var(--amber-dark)' : 'var(--text)' }}>
            {dueSoonItems.length}
          </div>
          <div className="summary-card-sub">{t('payables.within7Days')}</div>
        </div>
      </div>

      {/* ── Filter tabs ─── */}
      {payables.length > 0 && (
        <div className="filter-tabs" style={{ marginBottom: 16 }}>
          {FILTER_KEYS.map(key => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                whiteSpace: 'nowrap', cursor: 'pointer', transition: 'all .12s',
                background: filter === key ? 'var(--text)' : 'var(--bg-2)',
                color:      filter === key ? 'var(--bg)'  : 'var(--text-3)',
                border:     filter === key ? 'none'       : '0.5px solid var(--border)',
              }}
            >
              {({ all: t('common.all'), pending: '⏳ Pending', open: t('payables.open'), due_soon: t('payables.dueSoon'), overdue: t('payables.overdue'), partial: t('payables.partial'), paid: t('payables.paid') })[key]}{FILTER_COUNTS[key] > 0 ? ` · ${FILTER_COUNTS[key]}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* ── Empty state ─── */}
      {payables.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📤</div>
          <div className="empty-state-title">{t('payables.noPayables')}</div>
          <div className="empty-state-sub">{t('payables.noPayablesSub')}</div>
          <button className="empty-state-cta" onClick={() => setShowForm(true)}>{t('payables.newPayableCta')}</button>
        </div>
      )}

      {/* ── Filtered list ─── */}
      {filtered.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="item-list-card" style={{
            borderColor: ['overdue', 'due_soon'].includes(filter) ? 'rgba(240,68,56,.15)' : undefined,
          }}>
            {filtered.map(debt => (
              <DebtRow key={debt.id} debt={debt} accounts={accounts} token={token} onRefresh={load} />
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && payables.length > 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-4)', fontSize: 13 }}>
          No {filter.replace('_', ' ')} payables
        </div>
      )}

      {payables.length > 0 && (
        <div style={{ textAlign: 'center', paddingBottom: 16 }}>
          <button className="link-btn" onClick={() => navigate('/transactions')}>{t('payables.viewAllTransactions')}</button>
        </div>
      )}

      {showForm && (
        <DebtFormModal
          mode="payable"
          token={token}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}
