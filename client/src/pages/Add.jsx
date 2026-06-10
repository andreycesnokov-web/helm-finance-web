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

const TX_TYPES = ['income', 'expense', 'payroll', 'transfer']

function debtLabel(d) {
  const days = daysUntil(d.due_date)
  const tag  = days < 0 ? `${Math.abs(days)}d overdue` : `due in ${days}d`
  return `${d.counterparty} · ${fmt(d.amount)} IDR · ${tag}`
}

// Badge config per type
function typeBadge(type) {
  switch (type) {
    case 'income':   return { label: 'Income',   bg: '#E1F5EE', color: '#085041' }
    case 'expense':  return { label: 'Expense',  bg: '#FEE2E2', color: '#991B1B' }
    case 'payroll':  return { label: 'Payroll',  bg: '#FEF3C7', color: '#92400E' }
    case 'transfer': return { label: 'Transfer', bg: '#E8EDFB', color: '#1e3a6e' }
    default:         return { label: type || 'Unknown', bg: '#F1F5F9', color: '#475569' }
  }
}

// Amount display per type
function amountDisplay(type, amount, currency) {
  const n = fmt(Number(amount) || 0)
  const cur = currency || 'IDR'
  switch (type) {
    case 'income':   return { sign: '+', value: `+${n} ${cur}`, color: '#085041' }
    case 'expense':  return { sign: '-', value: `−${n} ${cur}`, color: '#991B1B' }
    case 'payroll':  return { sign: '-', value: `−${n} ${cur}`, color: '#92400E' }
    case 'transfer': return { sign: '',  value: `${n} ${cur}`,  color: '#1e3a6e' }
    default:         return { sign: '',  value: `${n} ${cur}`,  color: 'var(--text)' }
  }
}

export default function Add() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const [text, setText]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)   // raw parsed transactions
  const [editedTxs, setEditedTxs] = useState([]) // mutable copies for editing
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Debt / Reminder form
  const [tab, setTab]           = useState('tx')
  const [debt, setDebt]         = useState({ type: 'receivable', counterparty: '', amount: '', due_date: '', description: '' })
  const [reminder, setReminder] = useState({ title: '', due_date: '', meta: '' })
  const [saving, setSaving]     = useState(false)

  // Open debts for linking + accounts for source picker
  const [openDebts, setOpenDebts]   = useState([])
  const [accounts, setAccounts]     = useState([])
  const [linkedDebts, setLinkedDebts] = useState({})

  useEffect(() => {
    if (!token) return
    apiFetch('/pulse', token)
      .then(d => {
        const debts = (d.debts || []).filter(x => !x.is_settled)
        setOpenDebts(debts)
        // accounts come from pulse as virtual source list
        const accs = (d.accounts || []).map(a => a.name).filter(Boolean)
        setAccounts(accs)
      })
      .catch(() => {})
  }, [token])

  const openReceivables = openDebts.filter(d => d.type === 'receivable')
  const openPayables    = openDebts.filter(d => d.type === 'payable')

  // Update a single field of a single edited transaction
  const updateTx = (i, field, value) => {
    setEditedTxs(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  const parse = async () => {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    setEditedTxs([])
    setSaved(false)
    setSaveMsg('')
    setLinkedDebts({})
    try {
      const data = await apiFetch('/parse', token, { method: 'POST', body: { text } })
      const txs = data.transactions || []
      setResult(txs)
      // Deep-copy for editing; apply default category for payroll
      setEditedTxs(txs.map(t => ({
        ...t,
        category: t.category || (t.type === 'payroll' ? 'Payroll' : ''),
      })))
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
      const linked   = []
      const unlinked = []

      editedTxs.forEach((tx, i) => {
        const debtId = linkedDebts[i]
        // transfer cannot link to debt
        if (debtId && tx.type !== 'transfer') linked.push({ tx, debtId })
        else                                  unlinked.push(tx)
      })

      // Linked: debt pay endpoint (creates tx + settles debt)
      for (const { tx, debtId } of linked) {
        await apiFetch(`/debts/${debtId}/pay`, token, {
          method: 'POST',
          body: { amount: tx.amount, account: tx.source || undefined },
        })
      }

      // Unlinked: batch save with all edited fields
      if (unlinked.length > 0) {
        const payload = unlinked.map(tx => ({
          type:        tx.type,
          amount:      Number(tx.amount) || 0,
          currency:    tx.currency || 'IDR',
          description: tx.description || '',
          source:      tx.source || null,
          scope:       tx.scope || 'personal',
          project:     tx.project || null,
          category:    tx.category || null,
        }))
        await apiFetch('/transactions/batch', token, { method: 'POST', body: { transactions: payload } })
      }

      // Build success message
      const msgs = []
      if (linked.length > 0) {
        const closedCount = linked.filter(({ tx, debtId }) => {
          const d = openDebts.find(x => x.id === debtId)
          return d && tx.amount >= Number(d.amount)
        }).length
        const partialCount = linked.length - closedCount
        if (closedCount > 0)  msgs.push(`${closedCount} debt${closedCount > 1 ? 's' : ''} closed`)
        if (partialCount > 0) msgs.push(`${partialCount} partial payment${partialCount > 1 ? 's' : ''} recorded`)
      }
      if (unlinked.length > 0) msgs.push(`${unlinked.length} transaction${unlinked.length > 1 ? 's' : ''} saved`)

      setSaveMsg(msgs.join(' · ') || 'Saved successfully!')
      setSaved(true)
      setResult(null)
      setEditedTxs([])
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
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: '0.5px solid var(--border-2)', fontSize: 'var(--text-sm)',
    background: 'var(--bg-3)', color: 'var(--text)',
    boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none', minHeight: 40,
  }
  const selectStyle = { ...inputSt, cursor: 'pointer' }
  const labelSt = {
    display: 'block', fontSize: 11, color: 'var(--text-3)',
    textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 5,
  }
  const mainLabelSt = {
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
          <label style={mainLabelSt}>What happened?</label>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false); setResult(null); setEditedTxs([]) }}
            placeholder={'Заплатил 300к за бензин в Убуде\nПолучил 5М с клиента за проект\nКофе 35000 наличными'}
            style={{ ...inputSt, minHeight: 110, resize: 'none', lineHeight: 1.6, marginBottom: 10, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }}
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

          {/* ── Parsed preview ── */}
          {result && editedTxs.length > 0 && (
            <div style={{ marginTop: 18 }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}>
                  Found <strong style={{ color: 'var(--text)' }}>{result.length}</strong> transaction{result.length !== 1 ? 's' : ''}
                </div>
                <div style={{
                  fontSize: 11, color: '#1e40af', background: '#EFF6FF',
                  padding: '3px 10px', borderRadius: 20, fontWeight: 600, letterSpacing: 0.1
                }}>
                  ✦ AI parsed · Review before saving
                </div>
              </div>

              {editedTxs.map((t, i) => {
                const badge  = typeBadge(t.type)
                const amtDisp = amountDisplay(t.type, t.amount, t.currency)
                const isTransfer = t.type === 'transfer'
                const sourceMissing = !t.source || !t.source.trim()

                // Debt options: transfer has none
                const relevantDebts = isTransfer ? []
                  : t.type === 'income' ? openReceivables : openPayables
                const linkedId = linkedDebts[i] || ''

                return (
                  <div key={i} style={{
                    background: 'var(--bg-2)', borderRadius: 16,
                    border: `1px solid ${isTransfer ? '#c7d2fe' : 'var(--border)'}`,
                    marginBottom: 14, overflow: 'hidden',
                  }}>

                    {/* ── Card header: badge + amount ── */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px 12px', borderBottom: '0.5px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                          background: badge.bg, color: badge.color, letterSpacing: 0.2
                        }}>
                          {badge.label}
                        </span>
                        {sourceMissing && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                            background: '#FEF3C7', color: '#92400E',
                          }}>
                            ⚠ No source
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--text-md)', fontWeight: 800, color: amtDisp.color, letterSpacing: -0.3 }}>
                        {amtDisp.value}
                      </div>
                    </div>

                    {/* ── Transfer helper text ── */}
                    {isTransfer && (
                      <div style={{ background: '#EEF2FF', padding: '9px 16px', borderBottom: '0.5px solid #c7d2fe' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: '#3730a3' }}>
                          ↔ Transfers do not change total cash until account-to-account transfer support is implemented.
                        </span>
                      </div>
                    )}

                    {/* ── Editable fields ── */}
                    <div style={{ padding: '14px 16px' }}>

                      {/* Row 1: Type + Scope */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div>
                          <label style={labelSt}>Type</label>
                          <select value={t.type} onChange={e => updateTx(i, 'type', e.target.value)} style={selectStyle}>
                            {TX_TYPES.map(ty => (
                              <option key={ty} value={ty}>{ty.charAt(0).toUpperCase() + ty.slice(1)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelSt}>Scope</label>
                          <select value={t.scope || 'personal'} onChange={e => updateTx(i, 'scope', e.target.value)} style={selectStyle}>
                            <option value="personal">👤 Personal</option>
                            <option value="business">💼 Business</option>
                          </select>
                        </div>
                      </div>

                      {/* Row 2: Amount + Currency */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div>
                          <label style={labelSt}>Amount</label>
                          <input
                            type="number"
                            min="0"
                            value={t.amount}
                            onChange={e => updateTx(i, 'amount', e.target.value)}
                            style={inputSt}
                          />
                        </div>
                        <div>
                          <label style={labelSt}>Currency</label>
                          <select value={t.currency || 'IDR'} onChange={e => updateTx(i, 'currency', e.target.value)} style={selectStyle}>
                            <option value="IDR">IDR</option>
                            <option value="USD">USD</option>
                            <option value="SGD">SGD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </div>
                      </div>

                      {/* Row 3: Description */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelSt}>Description</label>
                        <input
                          type="text"
                          value={t.description || ''}
                          onChange={e => updateTx(i, 'description', e.target.value)}
                          placeholder="What was this for?"
                          style={inputSt}
                        />
                      </div>

                      {/* Row 4: Source / Account */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelSt}>
                          {isTransfer ? 'Source account (optional)' : 'Account / Source'}
                          {sourceMissing && !isTransfer && (
                            <span style={{ color: '#D97706', marginLeft: 6, textTransform: 'none', fontStyle: 'italic' }}>
                              — please select before saving
                            </span>
                          )}
                        </label>
                        {accounts.length > 0 ? (
                          <select
                            value={t.source || ''}
                            onChange={e => updateTx(i, 'source', e.target.value)}
                            style={{
                              ...selectStyle,
                              borderColor: sourceMissing && !isTransfer ? '#F59E0B' : undefined,
                              background: sourceMissing && !isTransfer ? '#FFFBEB' : undefined,
                            }}
                          >
                            <option value="">— Select account —</option>
                            {accounts.map(a => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={t.source || ''}
                            onChange={e => updateTx(i, 'source', e.target.value)}
                            placeholder="e.g. Permata, Cash, BCA"
                            style={{
                              ...inputSt,
                              borderColor: sourceMissing && !isTransfer ? '#F59E0B' : undefined,
                              background: sourceMissing && !isTransfer ? '#FFFBEB' : undefined,
                            }}
                          />
                        )}
                        {sourceMissing && !isTransfer && (
                          <div style={{ fontSize: 11, color: '#D97706', marginTop: 4 }}>
                            ⚠ No source selected — transaction will be saved without account link
                          </div>
                        )}
                      </div>

                      {/* Row 5: Category */}
                      <div>
                        <label style={labelSt}>Category</label>
                        <input
                          type="text"
                          value={t.category || ''}
                          onChange={e => updateTx(i, 'category', e.target.value)}
                          placeholder={t.type === 'payroll' ? 'Payroll' : t.type === 'transfer' ? 'Transfer' : 'e.g. Food, Transport, Revenue…'}
                          style={inputSt}
                        />
                      </div>
                    </div>

                    {/* ── Debt linking (not for transfer) ── */}
                    {!isTransfer && relevantDebts.length > 0 && (
                      <div style={{ padding: '12px 16px 14px', borderTop: '0.5px solid var(--border)' }}>
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
                          const isPartial = Number(t.amount) < Number(d.amount)
                          return (
                            <div style={{
                              marginTop: 8, fontSize: 'var(--text-xs)',
                              color: isPartial ? 'var(--amber-dark)' : 'var(--green-dark)',
                              display: 'flex', alignItems: 'center', gap: 6,
                              background: isPartial ? 'var(--amber-light)' : 'var(--green-light)',
                              borderRadius: 8, padding: '7px 10px',
                            }}>
                              {isPartial
                                ? `⚡ Partial — ${fmt(Number(d.amount) - Number(t.amount))} IDR remains open`
                                : `✅ Full payment — this item will be closed`}
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    {/* Transfer: no debt link message */}
                    {isTransfer && (
                      <div style={{ padding: '10px 16px 12px', borderTop: '0.5px solid #c7d2fe' }}>
                        <span style={{ fontSize: 11, color: '#6366f1', fontStyle: 'italic' }}>
                          ↔ Transfers cannot be linked to receivables or payables
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}

              <button onClick={save} disabled={saving} style={{
                width: '100%', padding: '15px 24px', borderRadius: 14, background: 'var(--brand)',
                color: '#fff', border: 'none', fontSize: 'var(--text-base)', fontWeight: 700, marginTop: 4,
                cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(21,94,239,.2)',
              }}>
                {saving ? 'Saving...' : `✅ Save ${editedTxs.length} transaction${editedTxs.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => { setResult(null); setEditedTxs([]) }} style={{
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
              <label style={mainLabelSt}>{f.label}</label>
              <input value={debt[f.key]} onChange={e => setDebt(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            <div>
              <label style={mainLabelSt}>Amount (IDR)</label>
              <input type="number" value={debt.amount} onChange={e => setDebt(p => ({ ...p, amount: e.target.value }))}
                placeholder="5000000" style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
            </div>
            <div>
              <label style={mainLabelSt}>Due date</label>
              <input type="date" value={debt.due_date} onChange={e => setDebt(p => ({ ...p, due_date: e.target.value }))}
                style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
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
            <label style={mainLabelSt}>What to remind?</label>
            <input value={reminder.title} onChange={e => setReminder(p => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Check Gojek settlement" style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={mainLabelSt}>Note (optional)</label>
            <input value={reminder.meta} onChange={e => setReminder(p => ({ ...p, meta: e.target.value }))}
              placeholder="e.g. every 2 weeks, IDR 2,500,000" style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={mainLabelSt}>Due date</label>
            <input type="date" value={reminder.due_date} onChange={e => setReminder(p => ({ ...p, due_date: e.target.value }))}
              style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
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
