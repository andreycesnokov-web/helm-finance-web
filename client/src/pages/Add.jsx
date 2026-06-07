import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt } from '../lib/api'

const QUICK = [
  { label: 'Еда', emoji: '🍜', type: 'expense', scope: 'personal' },
  { label: 'Транспорт', emoji: '⛽', type: 'expense', scope: 'personal' },
  { label: 'Helm Care', emoji: '🪖', type: 'expense', scope: 'business' },
  { label: 'Доход', emoji: '💚', type: 'income', scope: 'personal' },
]

export default function Add() {
  const { token } = useAuth()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // parsed transactions
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Debt form
  const [tab, setTab] = useState('tx') // tx | debt | reminder
  const [debt, setDebt] = useState({ type: 'receivable', counterparty: '', amount: '', due_date: '', description: '' })
  const [reminder, setReminder] = useState({ title: '', due_date: '', meta: '' })
  const [saving, setSaving] = useState(false)

  const parse = async () => {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    setSaved(false)
    try {
      const data = await apiFetch('/parse', token, { method: 'POST', body: { text } })
      setResult(data.transactions)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await apiFetch('/transactions/batch', token, { method: 'POST', body: { transactions: result } })
      setSaved(true)
      setResult(null)
      setText('')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveDebt = async () => {
    setSaving(true)
    try {
      await apiFetch('/debts', token, { method: 'POST', body: { ...debt, amount: Number(debt.amount) } })
      setSaved(true)
      setDebt({ type: 'receivable', counterparty: '', amount: '', due_date: '', description: '' })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveReminder = async () => {
    setSaving(true)
    try {
      await apiFetch('/reminders', token, { method: 'POST', body: reminder })
      setSaved(true)
      setReminder({ title: '', due_date: '', meta: '' })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Add</div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 16px' }}>
        {[
          { key: 'tx', label: '💳 Transaction' },
          { key: 'debt', label: '📋 Debt' },
          { key: 'reminder', label: '🔔 Reminder' },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSaved(false); setError('') }} style={{
            padding: '6px 12px', borderRadius: 20, fontSize: 12, border: '0.5px solid var(--border-2)',
            background: tab === t.key ? 'var(--text)' : 'none',
            color: tab === t.key ? '#fff' : 'var(--text-2)', fontWeight: tab === t.key ? 500 : 400
          }}>{t.label}</button>
        ))}
      </div>

      {/* Success */}
      {saved && (
        <div style={{ margin: '0 16px 16px', background: 'var(--green-light)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <span style={{ fontSize: 14, color: 'var(--green-dark)', fontWeight: 500 }}>Saved successfully!</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ margin: '0 16px 16px', background: 'var(--red-light)', borderRadius: 10, padding: '12px 14px' }}>
          <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
        </div>
      )}

      {/* TRANSACTION TAB */}
      {tab === 'tx' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Write naturally in Russian or English</div>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false); setResult(null) }}
            placeholder={'Заплатил 300к за бензин в Убуде\nПолучил 5М с клиента за проект\nКофе 35000 наличными'}
            style={{ width: '100%', minHeight: 100, borderRadius: 12, border: '0.5px solid var(--border-2)', padding: '12px', fontSize: 14, fontFamily: 'inherit', color: 'var(--text)', background: 'var(--bg)', resize: 'none', lineHeight: 1.6 }}
          />

          {/* Quick tags */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {QUICK.map(q => (
              <button key={q.label} onClick={() => setText(p => p + (p ? '\n' : '') + q.emoji + ' ')} style={{
                padding: '5px 11px', borderRadius: 20, fontSize: 12, border: '0.5px solid var(--border)',
                background: 'var(--bg-2)', color: 'var(--text-2)'
              }}>{q.emoji} {q.label}</button>
            ))}
          </div>

          <button onClick={parse} disabled={!text.trim() || loading} style={{
            width: '100%', marginTop: 12, padding: 13, borderRadius: 12,
            background: text.trim() ? 'var(--text)' : 'var(--bg-2)',
            color: text.trim() ? '#fff' : 'var(--text-3)', border: 'none', fontSize: 14, fontWeight: 500
          }}>
            {loading ? '🤔 Analyzing...' : 'Parse & preview →'}
          </button>

          {/* Parsed result */}
          {result && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>Found {result.length} transaction{result.length !== 1 ? 's' : ''}:</div>
              {result.map((t, i) => (
                <div key={i} style={{ background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{t.description}</div>
                      {t.source && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>💳 {t.source}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                        {t.scope === 'business' ? '💼 Business' : '👤 Personal'}
                        {t.project ? ` · ${t.project}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: t.type === 'income' ? 'var(--green)' : 'var(--red)', flexShrink: 0, marginLeft: 12 }}>
                      {t.type === 'income' ? '+' : '-'}{fmt(t.amount)} {t.currency}
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={save} disabled={saving} style={{
                width: '100%', padding: 13, borderRadius: 12, background: '#1D9E75',
                color: '#fff', border: 'none', fontSize: 14, fontWeight: 500, marginTop: 4
              }}>
                {saving ? 'Saving...' : `✅ Save ${result.length} transaction${result.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => setResult(null)} style={{
                width: '100%', padding: 11, borderRadius: 12, background: 'none',
                color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13, marginTop: 8
              }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* DEBT TAB */}
      {tab === 'debt' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'receivable', label: '💚 They owe me' },
              { key: 'payable', label: '❤️ I owe them' },
            ].map(t => (
              <button key={t.key} onClick={() => setDebt(p => ({ ...p, type: t.key }))} style={{
                flex: 1, padding: '10px', borderRadius: 12, fontSize: 13, border: '0.5px solid var(--border-2)',
                background: debt.type === t.key ? 'var(--text)' : 'none',
                color: debt.type === t.key ? '#fff' : 'var(--text-2)', fontWeight: debt.type === t.key ? 500 : 400
              }}>{t.label}</button>
            ))}
          </div>

          {[
            { key: 'counterparty', label: debt.type === 'receivable' ? 'Who owes you?' : 'Who do you owe?', placeholder: 'e.g. Client Ivan, Spa Factory Bali' },
            { key: 'description', label: 'Description', placeholder: 'e.g. Invoice #004, disinfectant order' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{f.label}</div>
              <input value={debt[f.key]} onChange={e => setDebt(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Amount (IDR)</div>
              <input type="number" value={debt.amount} onChange={e => setDebt(p => ({ ...p, amount: e.target.value }))}
                placeholder="5000000" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Due date</div>
              <input type="date" value={debt.due_date} onChange={e => setDebt(p => ({ ...p, due_date: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
            </div>
          </div>

          <button onClick={saveDebt} disabled={!debt.counterparty || !debt.amount || saving} style={{
            width: '100%', padding: 13, borderRadius: 12,
            background: debt.counterparty && debt.amount ? 'var(--text)' : 'var(--bg-2)',
            color: debt.counterparty && debt.amount ? '#fff' : 'var(--text-3)', border: 'none', fontSize: 14, fontWeight: 500
          }}>
            {saving ? 'Saving...' : `Add ${debt.type === 'receivable' ? 'receivable' : 'payable'}`}
          </button>
        </div>
      )}

      {/* REMINDER TAB */}
      {tab === 'reminder' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>What to remind?</div>
            <input value={reminder.title} onChange={e => setReminder(p => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Check Gojek settlement" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Note (optional)</div>
            <input value={reminder.meta} onChange={e => setReminder(p => ({ ...p, meta: e.target.value }))}
              placeholder="e.g. every 2 weeks, IDR 2,500,000" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Due date</div>
            <input type="date" value={reminder.due_date} onChange={e => setReminder(p => ({ ...p, due_date: e.target.value }))}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <button onClick={saveReminder} disabled={!reminder.title || saving} style={{
            width: '100%', padding: 13, borderRadius: 12,
            background: reminder.title ? 'var(--text)' : 'var(--bg-2)',
            color: reminder.title ? '#fff' : 'var(--text-3)', border: 'none', fontSize: 14, fontWeight: 500
          }}>
            {saving ? 'Saving...' : 'Set reminder'}
          </button>
        </div>
      )}
    </div>
  )
}
