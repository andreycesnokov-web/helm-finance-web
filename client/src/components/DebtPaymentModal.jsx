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

  const btnP = {
    padding: '12px 0', borderRadius: 14, border: 'none',
    fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%', marginBottom: 8,
  }
  const btnS = {
    ...btnP, background: 'none', border: '0.5px solid var(--border)',
    color: 'var(--text-3)', marginBottom: 0, cursor: 'pointer',
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        background: 'rgba(0,0,0,.6)', zIndex: 99999,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: '24px 24px 0 0',
          padding: '16px 18px 36px', width: '100%', maxWidth: 520,
          boxShadow: '0 -8px 40px rgba(0,0,0,.3)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />

        {/* Title */}
        <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>
          {isReceivable ? 'Mark as received' : 'Mark as paid'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
          {debt.counterparty} · {fmt(debt.amount)} IDR total
        </div>

        {/* Amount field */}
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>AMOUNT (IDR)</div>
        <input
          type="number"
          value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          style={{
            width: '100%', padding: '11px 13px', borderRadius: 14,
            border: '0.5px solid var(--border-2)', fontSize: 14,
            background: 'var(--bg-2)', color: 'var(--text)', marginBottom: 8,
            boxSizing: 'border-box',
          }}
        />

        {/* % quick-fill */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 12 }}>
          {[25, 50, 75, 100].map(pct => (
            <button
              key={pct}
              onClick={() => setAmount(String(Math.round(Number(debt.amount) * pct / 100)))}
              style={{
                padding: '8px 0', borderRadius: 10, fontSize: 11,
                border: '0.5px solid var(--border)', background: 'none',
                color: 'var(--text-3)', cursor: 'pointer',
              }}
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Account selector */}
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>ACCOUNT</div>
        <select
          value={account}
          onChange={e => setAccount(e.target.value)}
          style={{
            width: '100%', padding: '11px 13px', borderRadius: 14,
            border: '0.5px solid var(--border-2)', fontSize: 13,
            background: 'var(--bg-2)', color: 'var(--text)', marginBottom: 12,
            boxSizing: 'border-box',
          }}
        >
          <option value="">Select account (optional)</option>
          {(accounts || []).map(a => (
            <option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>
          ))}
        </select>

        {/* Error */}
        {error && (
          <div style={{
            background: 'var(--red-light)', color: 'var(--red-dark)',
            borderRadius: 10, padding: '8px 12px', fontSize: 12, marginBottom: 10,
            border: '1px solid rgba(240,68,56,.2)',
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          disabled={!canSubmit}
          onClick={handlePay}
          style={{
            ...btnP,
            background: canSubmit
              ? (isReceivable ? 'var(--green-dark)' : 'var(--brand)')
              : 'var(--bg-2)',
            color: canSubmit ? '#fff' : 'var(--text-3)',
            opacity: paying ? 0.7 : 1,
          }}
        >
          {paying
            ? 'Processing…'
            : isFullPay
              ? `${isReceivable ? 'Confirm received' : 'Pay'} · ${fmt(amountNum)} IDR (full)`
              : `${isReceivable ? 'Record received' : 'Pay'} · ${fmt(amountNum)} IDR`}
        </button>

        <button onClick={onClose} style={btnS} disabled={paying}>Cancel</button>
      </div>
    </div>,
    document.body
  )
}
