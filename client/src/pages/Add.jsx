import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, daysUntil } from '../lib/api'

const QUICK = [
  { label: 'Еда', emoji: '🍜', type: 'expense', scope: 'personal' },
  { label: 'Транспорт', emoji: '⛽', type: 'expense', scope: 'personal' },
  { label: 'Helm Care', emoji: '🪖', type: 'expense', scope: 'business' },
  { label: 'Доход', emoji: '💚', type: 'income', scope: 'personal' },
]

function debtLabel(d) {
  const days = daysUntil(d.due_date)
  const tag  = days < 0 ? `${Math.abs(days)}d overdue` : `due in ${days}d`
  return `${d.counterparty} · ${fmt(d.amount)} IDR · ${tag}`
}

export default function Add() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const [text, setText]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null) // parsed transactions
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Debt form
  const [tab, setTab]         = useState('tx') // tx | debt | reminder
  const [debt, setDebt]       = useState({ type: 'receivable', counterparty: '', amount: '', due_date: '', description: '' })
  const [reminder, setReminder] = useState({ title: '', due_date: '', meta: '' })
  const [saving, setSaving]   = useState(false)

  // Open debts for linking
  const [openDebts, setOpenDebts] = useState([])   // all unsettled debts
  const [linkedDebts, setLinkedDebts] = useState({}) // index → debt id or ''

  // Load open debts once on mount
  useEffect(() => {
    if (!token) return
    apiFetch('/pulse', token)
      .then(d => {
        const debts = (d.debts || []).filter(x => !x.is_settled)
        setOpenDebts(debts)
      })
      .catch(() => {}) // non-critical — just don't show link UI
  }, [token])

  const openReceivables = openDebts.filter(d => d.type === 'receivable')
  const openPayables    = openDebts.filter(d => d.type === 'payable')

  const parse = async () => {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    setSaved(false)
    setSaveMsg('')
    setLinkedDebts({})
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
    setError('')
    try {
      const linked   = [] // { tx, debtId }
      const unlinked = [] // tx

      result.forEach((tx, i) => {
        const debtId = linkedDebts[i]
        if (debtId) linked.push({ tx, debtId })
        else        unlinked.push(tx)
      })

      // Process linked: use /debts/:id/pay — creates transaction + updates debt
      for (const { tx, debtId } of linked) {
        await apiFetch(`/debts/${debtId}/pay`, token, {
          method: 'POST',
          body: { amount: tx.amount, account: tx.source || undefined },
        })
      }

      // Process unlinked: batch save
      if (unlinked.length > 0) {
        await apiFetch('/transactions/batch', token, { method: 'POST', body: { transactions: unlinked } })
      }

      // Build success message
      const msgs = []
      if (linked.length > 0) {
        const closedCount = linked.filter(({ tx, debtId }) => {
          const debt = openDebts.find(d => d.id === debtId)
          return debt && tx.amount >= Number(debt.amount)
        }).length
        const partialCount = linked.length - closedCount
        if (closedCount > 0) msgs.push(`${closedCount} item${closedCount > 1 ? 's' : ''} closed`)
        if (partialCount > 0) msgs.push(`${partialCount} partial payment${partialCount > 1 ? 's' : ''} recorded`)
      }
      if (unlinked.length > 0) msgs.push(`${unlinked.length} transaction${unlinked.length > 1 ? 's' : ''} saved`)

      setSaveMsg(msgs.join(' · ') || 'Saved successfully!')
      setSaved(true)
      setResult(null)
      setText('')
      setLinkedDebts({})
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
      setSaveMsg('Saved successfully!')
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
      setSaveMsg('Saved successfully!')
      setReminder({ title: '', due_date: '', meta: '' })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputSt = {
    width: '100%', padding: '12px 14px', borderRadius: 12,
    border: '0.5px solid var(--border-2)', fontSize: 'var(--text-base)',
    background: 'var(--bg-2)', color: 'var(--text)',
    boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none', minHeight: 46,
  }
  const selectStyle = {
    ...inputSt, cursor: 'pointer',
  }
  const labelSt = {
    display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 6,
  }

  return (
    <div className="page">
      <div className="topbar" style={{ padding: '20px 20px 14px' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: -0.3 }}>Add</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginTop: 3 }}>Log transactions, debts, reminders</div>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 18px' }}>
        {[
          { key: 'tx', label: '💳 Transaction' },
          { key: 'debt', label: '📋 Debt' },
          { key: 'reminder', label: '🔔 Reminder' },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSaved(false); setError(''); setSaveMsg('') }} style={{
            padding: '9px 16px', borderRadius: 20, fontSize: 'var(--text-sm)', border: '0.5px solid var(--border-2)',
            background: tab === t.key ? 'var(--text)' : 'none',
            color: tab === t.key ? '#fff' : 'var(--text-2)', fontWeight: tab === t.key ? 600 : 400,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'background .12s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Success */}
      {saved && (
        <div style={{ margin: '0 16px 16px', background: 'var(--green-light)', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(2,122,72,.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--green-dark)', fontWeight: 600 }}>{saveMsg || 'Saved successfully!'}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
            <button onClick={() => navigate('/transactions')} style={{ fontSize: 'var(--text-sm)', color: 'var(--green-dark)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
              View transactions →
            </button>
            {Object.values(linkedDebts).some(Boolean) && (
              <>
                <button onClick={() => navigate('/receivables')} style={{ fontSize: 'var(--text-sm)', color: 'var(--green-dark)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
                  Receivables →
                </button>
                <button onClick={() => navigate('/payables')} style={{ fontSize: 'var(--text-sm)', color: 'var(--green-dark)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
                  Payables →
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ margin: '0 16px 16px', background: 'var(--red-light)', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(180,35,24,.12)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--red-dark)' }}>{error}</span>
        </div>
      )}

      {/* TRANSACTION TAB */}
      {tab === 'tx' && (
        <div style={{ padding: '0 16px' }}>
          <label style={labelSt}>What happened?</label>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false); setResult(null) }}
            placeholder={'Заплатил 300к за бензин в Убуде\nПолучил 5М с клиента за проект\nКофе 35000 наличными'}
            style={{ ...inputSt, minHeight: 110, resize: 'none', lineHeight: 1.6, marginBottom: 10 }}
          />

          {/* Quick chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {QUICK.map(q => (
              <button key={q.label} onClick={() => setText(p => p + (p ? '\n' : '') + q.emoji + ' ')} style={{
                padding: '7px 14px', borderRadius: 20, fontSize: 'var(--text-sm)', border: '0.5px solid var(--border)',
                background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit',
              }}>{q.emoji} {q.label}</button>
            ))}
          </div>

          <button onClick={parse} disabled={!text.trim() || loading} style={{
            width: '100%', marginBottom: 4, padding: '15px 24px', borderRadius: 14,
            background: text.trim() ? 'var(--brand)' : 'var(--bg-3)',
            color: text.trim() ? '#fff' : 'var(--text-4)', border: 'none',
            fontSize: 'var(--text-base)', fontWeight: 700, cursor: text.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', letterSpacing: 0.1, transition: 'background .12s',
            boxShadow: text.trim() ? '0 2px 8px rgba(21,94,239,.2)' : 'none',
          }}>
            {loading ? '🤔 Analyzing with AI...' : '✦ Parse & preview →'}
          </button>

          {/* Parsed result */}
          {result && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginBottom: 12 }}>
                Found <strong style={{ color: 'var(--text)' }}>{result.length}</strong> transaction{result.length !== 1 ? 's' : ''}:
              </div>

              {result.map((t, i) => {
                const relevantDebts = t.type === 'income' ? openReceivables : openPayables
                const linkedId      = linkedDebts[i] || ''

                return (
                  <div key={i} style={{ background: 'var(--bg-2)', borderRadius: 14, padding: '14px 16px', marginBottom: 10, border: '0.5px solid var(--border)' }}>
                    {/* Transaction info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: relevantDebts.length > 0 ? 10 : 0 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text)' }}>{t.description}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
                          {t.source && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>💳 {t.source}</span>}
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
                            {t.scope === 'business' ? '💼 Business' : '👤 Personal'}
                          </span>
                          {t.project && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--brand)' }}>{t.project}</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: t.type === 'income' ? 'var(--green-dark)' : 'var(--red-dark)', flexShrink: 0, marginLeft: 14 }}>
                        {t.type === 'income' ? '+' : '−'}{fmt(t.amount)} {t.currency}
                      </div>
                    </div>

                    {/* Debt link */}
                    {relevantDebts.length > 0 && (
                      <div style={{ paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
                        <label style={{ ...labelSt, marginBottom: 6 }}>
                          Link to open {t.type === 'income' ? 'receivable' : 'payable'} (optional)
                        </label>
                        <select
                          value={linkedId}
                          onChange={e => setLinkedDebts(prev => ({ ...prev, [i]: e.target.value }))}
                          style={selectStyle}
                        >
                          <option value="">— No link, save as standalone —</option>
                          {relevantDebts.map(d => (
                            <option key={d.id} value={d.id}>{debtLabel(d)}</option>
                          ))}
                        </select>

                        {linkedId && (() => {
                          const d = openDebts.find(x => x.id === linkedId)
                          if (!d) return null
                          const isPartial = t.amount < Number(d.amount)
                          return (
                            <div style={{
                              marginTop: 8, fontSize: 'var(--text-xs)',
                              color: isPartial ? 'var(--amber-dark)' : 'var(--green-dark)',
                              display: 'flex', alignItems: 'center', gap: 6,
                              background: isPartial ? 'var(--amber-light)' : 'var(--green-light)',
                              borderRadius: 8, padding: '7px 10px',
                            }}>
                              {isPartial
                                ? `⚡ Partial — ${fmt(Number(d.amount) - t.amount)} IDR remains open`
                                : `✅ Full payment — this item will be closed`}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}

              <button onClick={save} disabled={saving} style={{
                width: '100%', padding: '15px 24px', borderRadius: 14, background: 'var(--brand)',
                color: '#fff', border: 'none', fontSize: 'var(--text-base)', fontWeight: 700, marginTop: 4,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(21,94,239,.2)',
              }}>
                {saving ? 'Saving...' : `✅ Save ${result.length} transaction${result.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => setResult(null)} style={{
                width: '100%', padding: '12px 24px', borderRadius: 14, background: 'none',
                color: 'var(--text-3)', border: '0.5px solid var(--border)',
                fontSize: 'var(--text-sm)', fontWeight: 500, marginTop: 8,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* DEBT TAB */}
      {tab === 'debt' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {[
              { key: 'receivable', label: '💚 They owe me' },
              { key: 'payable', label: '❤️ I owe them' },
            ].map(t => (
              <button key={t.key} onClick={() => setDebt(p => ({ ...p, type: t.key }))} style={{
                flex: 1, padding: '12px', borderRadius: 12, fontSize: 'var(--text-sm)',
                border: '0.5px solid var(--border-2)',
                background: debt.type === t.key ? 'var(--text)' : 'none',
                color: debt.type === t.key ? '#fff' : 'var(--text-2)',
                fontWeight: debt.type === t.key ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{t.label}</button>
            ))}
          </div>

          {[
            { key: 'counterparty', label: debt.type === 'receivable' ? 'Who owes you?' : 'Who do you owe?', placeholder: 'e.g. Client Ivan, Spa Factory Bali' },
            { key: 'description', label: 'Description', placeholder: 'e.g. Invoice #004, disinfectant order' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label style={labelSt}>{f.label}</label>
              <input value={debt[f.key]} onChange={e => setDebt(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={inputSt} />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            <div>
              <label style={labelSt}>Amount (IDR)</label>
              <input type="number" value={debt.amount} onChange={e => setDebt(p => ({ ...p, amount: e.target.value }))}
                placeholder="5000000" style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>Due date</label>
              <input type="date" value={debt.due_date} onChange={e => setDebt(p => ({ ...p, due_date: e.target.value }))}
                style={inputSt} />
            </div>
          </div>

          <button onClick={saveDebt} disabled={!debt.counterparty || !debt.amount || saving} style={{
            width: '100%', padding: '15px 24px', borderRadius: 14,
            background: debt.counterparty && debt.amount ? 'var(--brand)' : 'var(--bg-3)',
            color: debt.counterparty && debt.amount ? '#fff' : 'var(--text-4)',
            border: 'none', fontSize: 'var(--text-base)', fontWeight: 700,
            cursor: debt.counterparty && debt.amount ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}>
            {saving ? 'Saving...' : `Add ${debt.type === 'receivable' ? 'receivable' : 'payable'}`}
          </button>
        </div>
      )}

      {/* REMINDER TAB */}
      {tab === 'reminder' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>What to remind?</label>
            <input value={reminder.title} onChange={e => setReminder(p => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Check Gojek settlement" style={inputSt} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Note (optional)</label>
            <input value={reminder.meta} onChange={e => setReminder(p => ({ ...p, meta: e.target.value }))}
              placeholder="e.g. every 2 weeks, IDR 2,500,000" style={inputSt} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelSt}>Due date</label>
            <input type="date" value={reminder.due_date} onChange={e => setReminder(p => ({ ...p, due_date: e.target.value }))}
              style={inputSt} />
          </div>
          <button onClick={saveReminder} disabled={!reminder.title || saving} style={{
            width: '100%', padding: '15px 24px', borderRadius: 14,
            background: reminder.title ? 'var(--brand)' : 'var(--bg-3)',
            color: reminder.title ? '#fff' : 'var(--text-4)',
            border: 'none', fontSize: 'var(--text-base)', fontWeight: 700,
            cursor: reminder.title ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          }}>
            {saving ? 'Saving...' : 'Set reminder'}
          </button>
        </div>
      )}
    </div>
  )
}
