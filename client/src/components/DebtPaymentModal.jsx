/**
 * DebtPaymentModal — reusable payment modal for Receivables and Payables pages.
 *
 * Supports partial and full payments.
 * Uses POST /api/debts/:id/pay with { amount, account?, wallet_id?, date? }
 *
 * The backend:
 *   - increments paid_amount (never modifies original amount)
 *   - creates income/expense transaction
 *   - sets status = 'partial' | 'paid'
 *   - sets is_settled = true when fully paid
 *
 * Props:
 *   debt      — enriched debt object (original_amount, paid_amount, remaining_amount)
 *   accounts  — accounts array from /api/pulse accounts[]
 *   token     — auth token from useAuth()
 *   onClose() — called when modal dismissed
 *   onSuccess(result) — called after successful payment
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch, fmt } from '../lib/api'

export default function DebtPaymentModal({ debt, accounts, token, onClose, onSuccess }) {
  const isReceivable = debt.type === 'receivable'

  // Derive amounts — handle both old (no original_amount) and new schema
  const originalAmount  = Number(debt.original_amount || debt.amount || 0)
  const alreadyPaid     = Number(debt.paid_amount     || 0)
  const remaining       = Number(debt.remaining_amount ?? Math.max(0, originalAmount - alreadyPaid))
  const isPartialAlready = alreadyPaid > 0 && alreadyPaid < originalAmount

  const [amount,   setAmount]   = useState(String(remaining || ''))
  const [walletId, setWalletId] = useState('')
  const [payDate,  setPayDate]  = useState(new Date().toISOString().slice(0, 10))
  const [paying,   setPaying]   = useState(false)
  const [error,    setError]    = useState('')

  const amountNum   = Number(amount)
  const isFullPay   = amountNum >= remaining - 0.01
  const selectedAcc = (accounts || []).find(a => String(a.id) === String(walletId))
  // Wallet choice is required so the payment debits/credits the right account.
  const canSubmit   = amountNum > 0 && amountNum <= remaining + 0.01 && !!walletId && !paying

  const handlePay = async () => {
    if (!canSubmit) return
    setPaying(true); setError('')
    try {
      const result = await apiFetch(`/debts/${debt.id}/pay`, token, {
        method: 'POST',
        body: {
          amount:    amountNum,
          wallet_id: walletId,
          account:   selectedAcc?.name || undefined,
          date:      payDate || undefined,
        },
      })
      onSuccess(result)
    } catch (e) {
      setError(e.message || 'Payment failed. Please try again.')
    } finally {
      setPaying(false)
    }
  }

  const pctFill = (pct) => {
    setAmount(String(Math.round(remaining * pct / 100)))
    setError('')
  }

  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 0', borderBottom: '0.5px solid var(--border)',
  }
  const lblStyle  = { fontSize: 12, color: 'var(--text-3)' }
  const valStyle  = { fontSize: 14, fontWeight: 700, color: 'var(--text)' }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        {/* Title */}
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          {isReceivable ? 'Record payment received' : 'Record payment made'}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 16 }}>
          {debt.counterparty}
        </div>

        {/* Amount breakdown */}
        <div style={{ background: 'var(--bg-3)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, border: '0.5px solid var(--border)' }}>
          <div style={rowStyle}>
            <span style={lblStyle}>Total amount</span>
            <span style={valStyle}>{fmt(originalAmount)} IDR</span>
          </div>
          {isPartialAlready && (
            <div style={rowStyle}>
              <span style={lblStyle}>Already {isReceivable ? 'received' : 'paid'}</span>
              <span style={{ ...valStyle, color: isReceivable ? 'var(--green-dark)' : 'var(--red-dark)' }}>
                {fmt(alreadyPaid)} IDR
              </span>
            </div>
          )}
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={{ ...lblStyle, fontWeight: 700, color: 'var(--text-2)' }}>Remaining</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: isReceivable ? 'var(--green-dark)' : 'var(--brand)' }}>
              {fmt(remaining)} IDR
            </span>
          </div>
        </div>

        {/* Payment amount */}
        <label className="modal-label">Payment amount (IDR)</label>
        <input
          type="number"
          className="modal-input"
          value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          style={{ marginBottom: 10 }}
          autoFocus
          min="1"
          max={remaining}
        />

        {/* % quick-fill based on REMAINING */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 14 }}>
          {[25, 50, 75, 100].map(pct => (
            <button key={pct} onClick={() => pctFill(pct)} className="btn btn-ghost btn-sm">
              {pct}%
            </button>
          ))}
        </div>

        {/* Payment date */}
        <label className="modal-label">Payment date</label>
        <input
          type="date"
          className="modal-input"
          value={payDate}
          onChange={e => setPayDate(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {/* Account / wallet selector — required, debits the chosen wallet */}
        <label className="modal-label">{isReceivable ? 'Receive into account' : 'Pay from account'}</label>
        <select
          value={walletId}
          onChange={e => { setWalletId(e.target.value); setError('') }}
          className="modal-input"
          style={{ marginBottom: walletId ? 14 : 8 }}
        >
          <option value="">Select account…</option>
          {(accounts || []).map(a => (
            <option key={a.id || a.name} value={a.id}>{a.name} · {fmt(a.balance)} IDR</option>
          ))}
        </select>
        {!walletId && (accounts || []).length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--amber-dark)', marginBottom: 14 }}>
            No accounts yet — add one in Accounts first.
          </div>
        )}

        {/* Status preview */}
        {amountNum > 0 && amountNum <= remaining + 0.01 && (
          <div style={{
            padding: '8px 12px', borderRadius: 9, marginBottom: 12,
            background: isFullPay ? (isReceivable ? '#E1F5EE' : '#EFF6FF') : '#FEF9EE',
            border: isFullPay ? (isReceivable ? '1px solid #A7F3D0' : '1px solid #BFDBFE') : '1px solid #FDE68A',
            fontSize: 12, fontWeight: 600,
            color: isFullPay ? (isReceivable ? '#085041' : '#1D4ED8') : '#92400E',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <span>{isFullPay ? '✓' : '◑'}</span>
            {isFullPay
              ? `Will be marked as fully ${isReceivable ? 'received' : 'paid'}`
              : `Partial payment — ${fmt(remaining - amountNum)} IDR remaining`}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: 'var(--red-light)', color: 'var(--red-dark)',
            borderRadius: 10, padding: '9px 13px', fontSize: 'var(--text-sm)', marginBottom: 12,
            border: '1px solid rgba(240,68,56,.2)',
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          disabled={!canSubmit}
          onClick={handlePay}
          className="btn btn-block btn-lg"
          style={{
            background: canSubmit
              ? (isReceivable ? 'var(--green-dark)' : 'var(--brand)')
              : 'var(--bg-3)',
            color: canSubmit ? '#fff' : 'var(--text-4)',
            marginBottom: 8,
            opacity: paying ? 0.7 : 1,
          }}
        >
          {paying
            ? 'Processing…'
            : isFullPay
              ? `${isReceivable ? '✓ Mark fully received' : '✓ Mark fully paid'} · ${fmt(amountNum)} IDR`
              : `Record partial · ${fmt(amountNum)} IDR`}
        </button>

        <button onClick={onClose} disabled={paying} className="btn btn-ghost btn-block btn-lg">
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}
