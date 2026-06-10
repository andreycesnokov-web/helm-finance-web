/**
 * DebtPaymentModal — reusable payment modal for Receivables and Payables pages.
 *
 * Uses POST /api/debts/:id/pay with { amount, account? }
 * The backend handles both types:
 *   payable   → creates expense transaction + settles if fully paid
 *   receivable → creates income transaction + settles if fully paid
 *
 * Props:
 *   debt      — full debt object from /api/pulse debts[]
 *   accounts  — accounts array from /api/pulse accounts[]
 *   token     — auth token from useAuth()
 *   onClose() — called when modal dismissed
 *   onSuccess(result) — called after successful payment; parent reloads data
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch, fmt } from '../lib/api'

export default function DebtPaymentModal({ debt, accounts, token, onClose, onSuccess }) {
  const [amount,  setAmount]  = useState(String(debt.amount || ''))
  const [account, setAccount] = useState('')
  const [paying,  setPaying]  = useState(false)
  const [error,   setError]   = useState('')

  const isReceivable = debt.type === 'receivable'
  const amountNum    = Number(amount)
  const isFullPay    = amountNum >= Number(debt.amount)
  const canSubmit    = amountNum > 0 && !paying

  const handlePay = async () => {
    if (!canSubmit) return
    setPaying(true)
    setError('')
    try {
      const result = await apiFetch(`/debts/${debt.id}/pay`, token, {
        method: 'POST',
        body:   { amount: amountNum, account: account || undefined },
      })
      onSuccess(result)
    } catch (e) {
      setError(e.message || 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        {/* Title */}
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          {isReceivable ? 'Mark as received' : 'Mark as paid'}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 16 }}>
          {debt.counterparty} · {fmt(debt.amount)} IDR total
        </div>

        {/* Amount field */}
        <label className="modal-label">Amount (IDR)</label>
        <input
          type="number"
          className="modal-input"
          value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          style={{ marginBottom: 10 }}
        />

        {/* % quick-fill */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 14 }}>
          {[25, 50, 75, 100].map(pct => (
            <button
              key={pct}
              onClick={() => setAmount(String(Math.round(Number(debt.amount) * pct / 100)))}
              className="btn btn-ghost btn-sm"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Account selector */}
        <label className="modal-label">Account (optional)</label>
        <select
          value={account}
          onChange={e => setAccount(e.target.value)}
          className="modal-input"
          style={{ marginBottom: 14 }}
        >
          <option value="">Select account</option>
          {(accounts || []).map(a => (
            <option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>
          ))}
        </select>

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
              ? `${isReceivable ? 'Confirm received' : 'Pay'} · ${fmt(amountNum)} IDR (full)`
              : `${isReceivable ? 'Record received' : 'Pay'} · ${fmt(amountNum)} IDR`}
        </button>

        <button onClick={onClose} disabled={paying} className="btn btn-ghost btn-block btn-lg">
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}
