/**
 * DebtFormModal — create a new receivable or payable.
 *
 * Uses POST /api/debts with:
 *   { type, counterparty, amount, due_date, description?, scope? }
 *
 * Props:
 *   mode        — 'receivable' | 'payable'
 *   token       — auth token from useAuth()
 *   onClose()   — dismiss without saving
 *   onSuccess(debt) — called with the created debt; parent reloads data
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../lib/api'

const CONFIG = {
  receivable: {
    title:       'New Receivable',
    submitLabel: 'Create Receivable',
    submitColor: 'var(--green-dark)',
    counterpartyLabel: 'Who owes you?',
    counterpartyPlaceholder: 'Client or partner name',
    descPlaceholder: 'Invoice, contract, or note (optional)',
  },
  payable: {
    title:       'New Payable',
    submitLabel: 'Create Payable',
    submitColor: 'var(--brand)',
    counterpartyLabel: 'Who do you owe?',
    counterpartyPlaceholder: 'Vendor, supplier, or landlord',
    descPlaceholder: 'Rent, salary, bill, or note (optional)',
  },
}

// Default due date: 7 days from now
function defaultDueDate() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

export default function DebtFormModal({ mode, token, onClose, onSuccess }) {
  const cfg = CONFIG[mode] || CONFIG.receivable

  const [counterparty, setCounterparty] = useState('')
  const [description,  setDescription]  = useState('')
  const [amount,       setAmount]        = useState('')
  const [dueDate,      setDueDate]       = useState(defaultDueDate())
  const [scope,        setScope]         = useState('business')
  const [saving,       setSaving]        = useState(false)
  const [error,        setError]         = useState('')

  const amountNum = Number(amount)
  const canSubmit = counterparty.trim().length > 0 && amountNum > 0 && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const body = {
        type:         mode,
        counterparty: counterparty.trim(),
        amount:       amountNum,
        due_date:     dueDate || null,
        scope,
      }
      if (description.trim()) body.description = description.trim()

      const debt = await apiFetch('/debts', token, { method: 'POST', body })
      onSuccess(debt)
    } catch (e) {
      setError(e.message || 'Failed to create. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Allow submit on Enter key in inputs
  const onKey = (e) => { if (e.key === 'Enter' && canSubmit) handleSubmit() }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        {/* Title */}
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          {cfg.title}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 20 }}>
          {mode === 'receivable' ? 'Track money a client owes you' : 'Track money you need to pay'}
        </div>

        {/* Counterparty */}
        <label className="modal-label">{cfg.counterpartyLabel}</label>
        <input
          type="text"
          className="modal-input"
          value={counterparty}
          onChange={e => { setCounterparty(e.target.value); setError('') }}
          onKeyDown={onKey}
          placeholder={cfg.counterpartyPlaceholder}
          style={{ marginBottom: 12 }}
          autoFocus
        />

        {/* Amount */}
        <label className="modal-label">Amount (IDR)</label>
        <input
          type="number"
          className="modal-input"
          value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          onKeyDown={onKey}
          placeholder="e.g. 5000000"
          min="1"
          style={{ marginBottom: 12 }}
        />

        {/* Due date */}
        <label className="modal-label">Due Date</label>
        <input
          type="date"
          className="modal-input"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {/* Description */}
        <label className="modal-label">Description (optional)</label>
        <input
          type="text"
          className="modal-input"
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={onKey}
          placeholder={cfg.descPlaceholder}
          style={{ marginBottom: 12 }}
        />

        {/* Scope */}
        <label className="modal-label">Scope</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
          {[
            { value: 'business', label: '💼 Business' },
            { value: 'personal', label: '👤 Personal' },
          ].map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setScope(s.value)}
              style={{
                padding: '10px 0', borderRadius: 10,
                fontSize: 'var(--text-sm)', fontWeight: 500,
                border: scope === s.value ? 'none' : '0.5px solid var(--border)',
                background: scope === s.value ? 'var(--brand-light)' : 'none',
                color: scope === s.value ? 'var(--brand-dark)' : 'var(--text-3)',
                cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'var(--red-light)', color: 'var(--red-dark)',
            borderRadius: 10, padding: '9px 13px', fontSize: 'var(--text-sm)',
            border: '1px solid rgba(240,68,56,.2)', marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="btn btn-block btn-lg"
          style={{
            background: canSubmit ? cfg.submitColor : 'var(--bg-3)',
            color: canSubmit ? '#fff' : 'var(--text-4)',
            marginBottom: 8,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : cfg.submitLabel}
        </button>

        <button
          onClick={onClose}
          disabled={saving}
          className="btn btn-ghost btn-block btn-lg"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}
