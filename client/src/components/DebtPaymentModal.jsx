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
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch, fmt } from '../lib/api'

const REC_COLOR = { safe: '#085041', caution: '#92400E', not_recommended: '#B42318', insufficient_data: '#475467' }
const REC_BG    = { safe: '#E1F5EE', caution: '#FEF9EE', not_recommended: '#FEF3F2', insufficient_data: '#F2F4F7' }
const REC_LABEL = {
  safe:               { en: 'SAFE', ru: 'БЕЗОПАСНО', id: 'AMAN' },
  caution:            { en: 'CAUTION', ru: 'ОСТОРОЖНО', id: 'HATI-HATI' },
  not_recommended:    { en: 'NOT RECOMMENDED', ru: 'НЕ РЕКОМЕНДУЕТСЯ', id: 'TIDAK DISARANKAN' },
  insufficient_data:  { en: 'INSUFFICIENT DATA', ru: 'НЕДОСТАТОЧНО ДАННЫХ', id: 'DATA KURANG' },
}

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

  // ── AI CFO payment check (deterministic simulation, no data change) ────────
  const [sim, setSim]       = useState(null)
  const [simLoading, setSimLoading] = useState(false)
  const [ack, setAck]       = useState(false)
  const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('hf_lang')) || 'en'
  useEffect(() => {
    if (!walletId || !(amountNum > 0)) { setSim(null); return }
    let cancelled = false
    setSimLoading(true)
    const tid = setTimeout(() => {
      apiFetch(`/decisions/debts/${debt.id}/payment`, token, { method: 'POST', body: { amount: amountNum, wallet_id: walletId, payment_date: payDate } })
        .then(r => { if (!cancelled) setSim(r) })
        .catch(() => { if (!cancelled) setSim(null) })
        .finally(() => { if (!cancelled) setSimLoading(false) })
    }, 350)
    return () => { cancelled = true; clearTimeout(tid) }
  }, [walletId, amountNum, payDate, debt.id, token])

  const blockedNoAck = sim && sim.recommendation === 'not_recommended' && !ack
  const fmtRunway = (r) => r === null || r === undefined ? '—' : (r >= 999 ? '∞' : `${r}d`)

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

        {/* AI CFO payment check — deterministic before/after, no data change */}
        {simLoading && !sim && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>AI CFO: анализирую…</div>
        )}
        {sim && (
          <div style={{ borderRadius: 12, padding: '11px 13px', marginBottom: 12,
            background: REC_BG[sim.recommendation] || '#F2F4F7',
            border: `1px solid ${(REC_COLOR[sim.recommendation] || '#475467')}33` }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: REC_COLOR[sim.recommendation] || '#475467', marginBottom: 6 }}>
              AI CFO · {(REC_LABEL[sim.recommendation] || REC_LABEL.insufficient_data)[lang] || (REC_LABEL[sim.recommendation] || {}).en}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
              {sim.current.wallet_balance !== null && (
                <div>{selectedAcc?.name}: {fmt(sim.current.wallet_balance)} → <b>{fmt(sim.after.wallet_balance)}</b></div>
              )}
              <div>{lang === 'ru' ? 'Касса' : lang === 'id' ? 'Kas' : 'Cash'}: {fmt(sim.current.cash)} → <b>{fmt(sim.after.cash)}</b></div>
              <div>{lang === 'ru' ? 'Запас' : 'Runway'}: {fmtRunway(sim.current.runway_days)} → <b>{fmtRunway(sim.after.runway_days)}</b></div>
              {sim.upcoming.payroll_7d > 0 && (
                <div style={{ color: '#92400E' }}>{lang === 'ru' ? 'Зарплата в течение 7 дней' : 'Payroll in 7 days'}: {fmt(sim.upcoming.payroll_7d)}</div>
              )}
            </div>
            {(sim.factors || []).filter(f => ['high','critical','medium'].includes(f.severity)).slice(0, 2).map((f, i) => (
              <div key={i} style={{ fontSize: 11.5, color: REC_COLOR[sim.recommendation], marginTop: 5 }}>• {f.label}</div>
            ))}
          </div>
        )}

        {/* not_recommended requires explicit acknowledgement */}
        {blockedNoAck && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--red-dark)', marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 2 }} />
            <span>{lang === 'ru' ? 'Я понимаю финансовый риск и хочу продолжить.' : lang === 'id' ? 'Saya memahami risiko keuangan dan ingin lanjut.' : 'I understand the financial risk and want to continue.'}</span>
          </label>
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
          disabled={!canSubmit || blockedNoAck}
          onClick={handlePay}
          className="btn btn-block btn-lg"
          style={{
            background: (canSubmit && !blockedNoAck)
              ? (isReceivable ? 'var(--green-dark)' : 'var(--brand)')
              : 'var(--bg-3)',
            color: (canSubmit && !blockedNoAck) ? '#fff' : 'var(--text-4)',
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
