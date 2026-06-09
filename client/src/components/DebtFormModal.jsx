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

  const inputStyle = {
    width: '100%', padding: '11px 13px', borderRadius: 14,
    border: '0.5px solid var(--border-2)', fontSize: 14,
    background: 'var(--bg-2)', color: 'var(--text)',
    boxSizing: 'border-box', outline: 'none',
    fontFamily: 'inherit',
  }
  const labelStyle = {
    fontSize: 11, color: 'var(--text-3)', marginBottom: 5, display: 'block',
  }
  const btnP = {
    padding: '12px 0', borderRadius: 14, border: 'none',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', marginBottom: 8,
  }
  const btnS = {
    ...btnP, background: 'none', border: '0.5px solid var(--border)',
    color: 'var(--text-3)', marginBottom: 0, fontWeight: 400,
    cursor: saving ? 'not-allowed' : 'pointer',
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
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />

        {/* Title */}
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
          {cfg.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 18 }}>
          {mode === 'receivable' ? 'Track money a client owes you' : 'Track money you need to pay'}
        </div>

        {/* Counterparty */}
        <label style={labelStyle}>{cfg.counterpartyLabel.toUpperCase()}</label>
        <input
          type="text"
          value={counterparty}
          onChange={e => { setCounterparty(e.target.value); setError('') }}
          onKeyDown={onKey}
          placeholder={cfg.counterpartyPlaceholder}
          style={{ ...inputStyle, marginBottom: 12 }}
          autoFocus
        />

        {/* Amount */}
        <label style={labelStyle}>AMOUNT (IDR)</label>
        <input
          type="number"
          value={amount}
          onChange={e => { setAmount(e.target.value); setError('') }}
          onKeyDown={onKey}
          placeholder="e.g. 5000000"
          min="1"
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        {/* Due date */}
        <label style={labelStyle}>DUE DATE</label>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        {/* Description */}
        <label style={labelStyle}>DESCRIPTION (OPTIONAL)</label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={onKey}
          placeholder={cfg.descPlaceholder}
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        {/* Scope */}
        <label style={labelStyle}>SCOPE</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {[
            { value: 'business', label: 'Business' },
            { value: 'personal', label: 'Personal' },
          ].map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setScope(s.value)}
              style={{
                padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 500,
                border: scope === s.value ? 'none' : '0.5px solid var(--border)',
                background: scope === s.value ? 'var(--brand-light)' : 'none',
                color: scope === s.value ? 'var(--brand-dark)' : 'var(--text-3)',
                cursor: 'pointer', transition: 'all .12s',
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
            borderRadius: 10, padding: '8px 12px', fontSize: 12,
            border: '1px solid rgba(240,68,56,.2)', marginBottom: 10,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{
            ...btnP,
            background: canSubmit ? cfg.submitColor : 'var(--bg-3)',
            color: canSubmit ? '#fff' : 'var(--text-4)',
            opacity: saving ? 0.7 : 1,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving…' : cfg.submitLabel}
        </button>

        <button onClick={onClose} style={btnS} disabled={saving}>Cancel</button>
      </div>
    </div>,
    document.body
  )
}
