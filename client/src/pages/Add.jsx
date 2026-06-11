import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
import { apiFetch, fmt, daysUntil } from '../lib/api'
import { getLang } from '../i18n/index'

const QUICK_LABELS = {
  en: [
    { label: 'Food', emoji: '🍜', type: 'expense', scope: 'personal' },
    { label: 'Transport', emoji: '⛽', type: 'expense', scope: 'personal' },
    { label: 'Helm Care', emoji: '🪖', type: 'expense', scope: 'business' },
    { label: 'Income', emoji: '💚', type: 'income', scope: 'personal' },
  ],
  ru: [
    { label: 'Еда', emoji: '🍜', type: 'expense', scope: 'personal' },
    { label: 'Транспорт', emoji: '⛽', type: 'expense', scope: 'personal' },
    { label: 'Helm Care', emoji: '🪖', type: 'expense', scope: 'business' },
    { label: 'Доход', emoji: '💚', type: 'income', scope: 'personal' },
  ],
  id: [
    { label: 'Makanan', emoji: '🍜', type: 'expense', scope: 'personal' },
    { label: 'Transportasi', emoji: '⛽', type: 'expense', scope: 'personal' },
    { label: 'Helm Care', emoji: '🪖', type: 'expense', scope: 'business' },
    { label: 'Pemasukan', emoji: '💚', type: 'income', scope: 'personal' },
  ],
}

const TX_TYPES = ['income', 'expense', 'payroll', 'transfer']

// Activity type code → colour
const ACTIVITY_COLORS = {
  operating:  { bg: '#E1F5EE', color: '#085041' },
  investing:  { bg: '#EEF2FF', color: '#3730a3' },
  financing:  { bg: '#FEF3C7', color: '#92400E' },
  technical:  { bg: '#F1F5F9', color: '#475569' },
}

function debtLabel(d) {
  const days = daysUntil(d.due_date)
  const tag  = days < 0 ? `${Math.abs(days)}d overdue` : `due in ${days}d`
  return `${d.counterparty} · ${fmt(d.amount)} IDR · ${tag}`
}

function typeBadge(type) {
  switch (type) {
    case 'income':   return { label: 'Income',   bg: '#E1F5EE', color: '#085041' }
    case 'expense':  return { label: 'Expense',  bg: '#FEE2E2', color: '#991B1B' }
    case 'payroll':  return { label: 'Payroll',  bg: '#FEF3C7', color: '#92400E' }
    case 'transfer': return { label: 'Transfer', bg: '#E8EDFB', color: '#1e3a6e' }
    default:         return { label: type || 'Unknown', bg: '#F1F5F9', color: '#475569' }
  }
}

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

// Group categories by activity_type for <optgroup> rendering
function groupCategories(categories, transactionType) {
  // Filter: inflow categories for income, outflow for expense/payroll, all for transfer
  const filtered = categories.filter(c => {
    if (transactionType === 'income')   return c.group_type === 'inflow'
    if (transactionType === 'expense')  return c.group_type === 'outflow'
    if (transactionType === 'payroll')  return c.group_type === 'outflow'
    return true // transfer — show all
  })

  const ORDER = ['operating', 'investing', 'financing', 'technical']
  const LABELS = {
    operating: 'Операционная',
    investing:  'Инвестиционная',
    financing:  'Финансовая',
    technical:  'Технические операции',
  }
  const groups = {}
  ORDER.forEach(k => { groups[k] = [] })
  filtered.forEach(c => {
    const key = c.activity_type || 'operating'
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  })
  return ORDER.filter(k => groups[k].length > 0).map(k => ({
    label: LABELS[k] || k,
    code:  k,
    items: groups[k],
  }))
}

// Counterparty autocomplete component
function CounterpartyInput({ value, onChange, suggestions, onCreateNew, inputSt }) {
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState(value || '')
  const wrapRef         = useRef(null)

  // Sync controlled value → local input
  useEffect(() => { setQ(value || '') }, [value])

  // Close on outside click
  useEffect(() => {
    const fn = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const filtered = q.trim()
    ? suggestions.filter(s => s.name.toLowerCase().includes(q.toLowerCase()))
    : suggestions.slice(0, 8)

  const handleChange = v => {
    setQ(v)
    onChange(v, null) // text value, no id yet
    setOpen(true)
  }

  const handleSelect = cp => {
    setQ(cp.name)
    onChange(cp.name, cp.id)
    setOpen(false)
  }

  const showCreate = q.trim() && !suggestions.find(s => s.name.toLowerCase() === q.toLowerCase())

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={q}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="e.g. Google, Indosat, Marina Linkova"
        style={inputSt}
      />
      {open && (filtered.length > 0 || showCreate) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg-2)', border: '1px solid var(--border)',
          borderRadius: 10, marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,.1)',
          maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.map(cp => (
            <div key={cp.id} onMouseDown={() => handleSelect(cp)} style={{
              padding: '9px 12px', cursor: 'pointer', fontSize: 'var(--text-sm)',
              color: 'var(--text)', borderBottom: '0.5px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>{cp.name}</span>
              {cp.type && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 10 }}>
                  {cp.type}
                </span>
              )}
            </div>
          ))}
          {showCreate && (
            <div onMouseDown={() => { onCreateNew(q); setOpen(false) }} style={{
              padding: '9px 12px', cursor: 'pointer', fontSize: 'var(--text-sm)',
              color: 'var(--brand)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>＋</span>
              <span>Save "{q}" as new counterparty</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Add() {
  const { token }  = useAuth()
  const navigate   = useNavigate()
  const { t: tr }  = useTranslation()
  const QUICK = QUICK_LABELS[getLang()] || QUICK_LABELS.en
  const [text, setText]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [editedTxs, setEditedTxs] = useState([])
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Debt / Reminder form
  const [tab, setTab]           = useState('tx')
  const [debt, setDebt]         = useState({ type: 'receivable', counterparty: '', amount: '', due_date: '', description: '' })
  const [reminder, setReminder] = useState({ title: '', due_date: '', meta: '' })
  const [saving, setSaving]     = useState(false)

  // Open debts + wallets
  const [openDebts, setOpenDebts]     = useState([])
  const [wallets, setWallets]         = useState([])   // real wallets from /api/wallets
  const [linkedDebts, setLinkedDebts] = useState({})

  // Reference data
  const [categories,   setCategories]   = useState([])
  const [counterparties, setCounterparties] = useState([])
  const [directions,   setDirections]   = useState([])
  const [activityTypes, setActivityTypes] = useState([])

  useEffect(() => {
    if (!token) return
    // Load pulse data (debts only)
    apiFetch('/pulse', token)
      .then(d => {
        setOpenDebts((d.debts || []).filter(x => !x.is_settled))
      })
      .catch(() => {})

    // Load real wallets (non-blocking)
    apiFetch('/wallets', token).then(d => setWallets(d.wallets || [])).catch(() => {})

    // Load reference data in parallel — all non-blocking
    apiFetch('/cashflow-categories', token).then(d => setCategories(d.categories || [])).catch(() => {})
    apiFetch('/counterparties', token).then(d => setCounterparties(d.counterparties || [])).catch(() => {})
    apiFetch('/business-directions', token).then(d => setDirections(d.directions || [])).catch(() => {})
    apiFetch('/activity-types', token).then(d => setActivityTypes(d.activityTypes || [])).catch(() => {})
  }, [token])

  const openReceivables = openDebts.filter(d => d.type === 'receivable')
  const openPayables    = openDebts.filter(d => d.type === 'payable')

  const updateTx = (i, field, value) => {
    setEditedTxs(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  // Quick-create counterparty inline and auto-select it on a card
  const createCounterparty = async (name, txIndex) => {
    try {
      const data = await apiFetch('/counterparties', token, { method: 'POST', body: { name } })
      const cp = data.counterparty
      setCounterparties(prev => [...prev, cp])
      updateTx(txIndex, 'counterparty_name', cp.name)
      updateTx(txIndex, 'counterparty_id', cp.id)
    } catch (_) {
      // Silently keep the text value — not critical
    }
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
      setEditedTxs(txs.map(t => ({
        ...t,
        category: t.category || (t.type === 'payroll' ? 'Payroll' : ''),
        // Reference fields — blank until user fills them
        cashflow_category_id:  null,
        counterparty_id:       null,
        counterparty_name:     '',
        business_direction_id: null,
        activity_type_id:      null,
        // Wallet
        wallet_id:             null,
        to_wallet_id:          null,   // transfer destination (UI only — no DB column yet)
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
        if (debtId && tx.type !== 'transfer') linked.push({ tx, debtId })
        else                                  unlinked.push(tx)
      })

      for (const { tx, debtId } of linked) {
        await apiFetch(`/debts/${debtId}/pay`, token, {
          method: 'POST',
          body: { amount: tx.amount, account: tx.source || undefined },
        })
      }

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
          // Reference fields (Phase 1 — all optional)
          cashflow_category_id:  tx.cashflow_category_id  || null,
          counterparty_id:       tx.counterparty_id        || null,
          counterparty_name:     tx.counterparty_name      || null,
          business_direction_id: tx.business_direction_id  || null,
          activity_type_id:      tx.activity_type_id       || null,
          // Wallet (TASK 29B)
          wallet_id:             tx.wallet_id              || null,
        }))
        await apiFetch('/transactions/batch', token, { method: 'POST', body: { transactions: payload } })
      }

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
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: -0.3 }}>{tr('add.title')}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', marginTop: 3 }}>{tr('add.subtitle')}</div>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 18px' }}>
        {[
          { key: 'tx',       label: tr('add.tabTransaction') },
          { key: 'debt',     label: tr('add.tabDebt') },
          { key: 'reminder', label: tr('add.tabReminder') },
        ].map(tb => (
          <button key={tb.key} onClick={() => { setTab(tb.key); setSaved(false); setError(''); setSaveMsg('') }} style={{
            padding: '9px 16px', borderRadius: 20, fontSize: 'var(--text-sm)', border: '0.5px solid var(--border-2)',
            background: tab === tb.key ? 'var(--text)' : 'none',
            color: tab === tb.key ? '#fff' : 'var(--text-2)', fontWeight: tab === tb.key ? 600 : 400,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'background .12s',
          }}>{tb.label}</button>
        ))}
      </div>

      {/* Success */}
      {saved && (
        <div style={{ margin: '0 16px 16px', background: 'var(--green-light)', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(2,122,72,.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--green-dark)', fontWeight: 600 }}>{saveMsg || tr('add.savedSuccess')}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
            <button onClick={() => navigate('/transactions')} style={{ fontSize: 'var(--text-sm)', color: 'var(--green-dark)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
              {tr('add.viewTransactions')}
            </button>
            {Object.values(linkedDebts).some(Boolean) && (
              <>
                <button onClick={() => navigate('/receivables')} style={{ fontSize: 'var(--text-sm)', color: 'var(--green-dark)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
                  {tr('add.receivablesLink')}
                </button>
                <button onClick={() => navigate('/payables')} style={{ fontSize: 'var(--text-sm)', color: 'var(--green-dark)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}>
                  {tr('add.payablesLink')}
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
          <label style={mainLabelSt}>{tr('add.whatHappened')}</label>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false); setResult(null); setEditedTxs([]) }}
            placeholder={getLang() === 'ru'
              ? 'Заплатил 300к за бензин в Убуде\nПолучил 5М с клиента за проект\nКофе 35000 наличными'
              : getLang() === 'id'
              ? 'Bayar 300k bensin di Ubud\nTerima 5M dari klien untuk proyek\nKopi 35000 tunai'
              : 'Paid 300k for petrol in Ubud\nReceived 5M from client for project\nCoffee 35000 cash'}
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
            {loading ? '🤔 ' + tr('add.aiParsing') : tr('add.parseBtn')}
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
                const badge   = typeBadge(t.type)
                const amtDisp = amountDisplay(t.type, t.amount, t.currency)
                const isTransfer    = t.type === 'transfer'
                const sourceMissing = !t.source || !t.source.trim()
                const relevantDebts = isTransfer ? []
                  : t.type === 'income' ? openReceivables : openPayables
                const linkedId      = linkedDebts[i] || ''

                // Category groups filtered to this transaction type
                const catGroups = groupCategories(categories, t.type)

                // Selected category object (for badge)
                const selectedCat = t.cashflow_category_id
                  ? categories.find(c => c.id === t.cashflow_category_id)
                  : null
                const actColor = selectedCat
                  ? ACTIVITY_COLORS[selectedCat.activity_type] || ACTIVITY_COLORS.operating
                  : null

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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                          background: badge.bg, color: badge.color, letterSpacing: 0.2
                        }}>
                          {badge.label}
                        </span>
                        {sourceMissing && (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#FEF3C7', color: '#92400E' }}>
                            ⚠ No source
                          </span>
                        )}
                        {selectedCat && (
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: actColor.bg, color: actColor.color }}>
                            {selectedCat.name}
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
                          <label style={labelSt}>{tr('add.type')}</label>
                          <select value={t.type} onChange={e => updateTx(i, 'type', e.target.value)} style={selectStyle}>
                            {TX_TYPES.map(ty => (
                              <option key={ty} value={ty}>{ty.charAt(0).toUpperCase() + ty.slice(1)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelSt}>{tr('add.scope')}</label>
                          <select value={t.scope || 'personal'} onChange={e => updateTx(i, 'scope', e.target.value)} style={selectStyle}>
                            <option value="personal">👤 Personal</option>
                            <option value="business">💼 Business</option>
                          </select>
                        </div>
                      </div>

                      {/* Row 2: Amount + Currency */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div>
                          <label style={labelSt}>{tr('add.amount')}</label>
                          <input type="number" min="0" value={t.amount}
                            onChange={e => updateTx(i, 'amount', e.target.value)} style={inputSt} />
                        </div>
                        <div>
                          <label style={labelSt}>{tr('add.currency')}</label>
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
                        <label style={labelSt}>{tr('add.description')}</label>
                        <input type="text" value={t.description || ''}
                          onChange={e => updateTx(i, 'description', e.target.value)}
                          placeholder="What was this for?" style={inputSt} />
                      </div>

                      {/* Row 4: Wallet / Account (From wallet for transfers) */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelSt}>
                          {isTransfer ? tr('add.fromWallet') : tr('add.walletAccount')}
                          {sourceMissing && !isTransfer && (
                            <span style={{ color: '#D97706', marginLeft: 6, textTransform: 'none', fontStyle: 'italic' }}>
                              — please select before saving
                            </span>
                          )}
                        </label>
                        {wallets.length > 0 ? (
                          <>
                            <select
                              value={t.wallet_id || ''}
                              onChange={e => {
                                const wId = e.target.value || null
                                const w   = wallets.find(x => x.id === wId)
                                updateTx(i, 'wallet_id', wId)
                                updateTx(i, 'source',    w ? w.name : '')
                                if (w && w.currency && w.currency !== 'IDR') updateTx(i, 'currency', w.currency)
                                // For transfers: rebuild description to include from/to
                                if (isTransfer && w) {
                                  const toW = t.to_wallet_id ? wallets.find(x => x.id === t.to_wallet_id) : null
                                  updateTx(i, 'description', `Transfer: ${w.name} → ${toW ? toW.name : '…'}`)
                                }
                              }}
                              style={{ ...selectStyle, borderColor: sourceMissing && !isTransfer ? '#F59E0B' : undefined, background: sourceMissing && !isTransfer ? '#FFFBEB' : undefined }}
                            >
                              <option value="">— Select wallet —</option>
                              {wallets.map(w => (
                                <option key={w.id} value={w.id}>
                                  {w.name}{w.currency && w.currency !== 'IDR' ? ` · ${w.currency}` : ''}
                                  {w.entity_name ? ` (${w.entity_name})` : ''}
                                  {` · ${(w.scope || 'business') === 'business' ? 'Business' : 'Personal'}`}
                                </option>
                              ))}
                            </select>
                            {/* Wallet metadata hint */}
                            {t.wallet_id && (() => {
                              const selW = wallets.find(x => x.id === t.wallet_id)
                              if (!selW) return null
                              return (
                                <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#E1F5EE', color: '#085041', fontWeight: 600 }}>
                                    {selW.currency || 'IDR'}
                                  </span>
                                  {selW.type && (
                                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-3)', color: 'var(--text-3)', fontWeight: 600 }}>
                                      {selW.type}
                                    </span>
                                  )}
                                  {selW.entity_name && (
                                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-3)', color: 'var(--text-3)' }}>
                                      {selW.entity_name}
                                    </span>
                                  )}
                                </div>
                              )
                            })()}
                          </>
                        ) : (
                          <>
                            <input type="text" value={t.source || ''} onChange={e => updateTx(i, 'source', e.target.value)}
                              placeholder="e.g. BCA, Cash, GoPay"
                              style={{ ...inputSt, borderColor: sourceMissing && !isTransfer ? '#F59E0B' : undefined, background: sourceMissing && !isTransfer ? '#FFFBEB' : undefined }} />
                            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                              No wallets yet — <button onClick={() => navigate('/accounts')} style={{ fontSize: 11, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>add wallets in Accounts →</button>
                            </div>
                          </>
                        )}
                        {sourceMissing && !isTransfer && (
                          <div style={{ fontSize: 11, color: '#D97706', marginTop: 4 }}>
                            ⚠ No wallet selected — transaction will be saved without account link
                          </div>
                        )}
                      </div>

                      {/* Row 4b: To wallet (transfers only) */}
                      {isTransfer && wallets.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <label style={labelSt}>{tr('add.toWallet')}</label>
                          <select
                            value={t.to_wallet_id || ''}
                            onChange={e => {
                              const wId = e.target.value || null
                              const w   = wallets.find(x => x.id === wId)
                              updateTx(i, 'to_wallet_id', wId)
                              // Rebuild description with both names
                              const fromW = t.wallet_id ? wallets.find(x => x.id === t.wallet_id) : null
                              updateTx(i, 'description', `Transfer: ${fromW ? fromW.name : '…'} → ${w ? w.name : '…'}`)
                            }}
                            style={selectStyle}
                          >
                            <option value="">— Select destination —</option>
                            {wallets.filter(w => w.id !== t.wallet_id).map(w => (
                              <option key={w.id} value={w.id}>
                                {w.name}{w.currency && w.currency !== 'IDR' ? ` · ${w.currency}` : ''}
                              </option>
                            ))}
                          </select>
                          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                            ℹ Destination wallet is saved in description. Full debit/credit model in TASK 30.
                          </div>
                        </div>
                      )}

                      {/* Row 5: Cashflow Category (grouped select) */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelSt}>
                          Cashflow Category
                          {categories.length === 0 && (
                            <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6, textTransform: 'none' }}>
                              (loading…)
                            </span>
                          )}
                        </label>
                        {categories.length > 0 ? (
                          <select
                            value={t.cashflow_category_id || ''}
                            onChange={e => {
                              const id = e.target.value || null
                              const cat = categories.find(c => c.id === id)
                              updateTx(i, 'cashflow_category_id', id)
                              // Also sync legacy category text field
                              if (cat) updateTx(i, 'category', cat.name)
                            }}
                            style={selectStyle}
                          >
                            <option value="">— Select category —</option>
                            {catGroups.map(g => (
                              <optgroup key={g.code} label={g.label}>
                                {g.items.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        ) : (
                          // Fallback: plain text if categories not loaded
                          <input type="text" value={t.category || ''}
                            onChange={e => updateTx(i, 'category', e.target.value)}
                            placeholder={t.type === 'payroll' ? 'Payroll' : t.type === 'transfer' ? 'Transfer' : 'e.g. Food, Transport, Revenue…'}
                            style={inputSt} />
                        )}
                        {/* Sub-description hint */}
                        {selectedCat?.sub_category && (
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>
                            {selectedCat.sub_category}
                          </div>
                        )}
                      </div>

                      {/* Row 6: Counterparty */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelSt}>{tr('add.counterpartyOpt')}</label>
                        <CounterpartyInput
                          value={t.counterparty_name || ''}
                          onChange={(name, id) => {
                            updateTx(i, 'counterparty_name', name)
                            updateTx(i, 'counterparty_id', id || null)
                          }}
                          suggestions={counterparties}
                          onCreateNew={name => createCounterparty(name, i)}
                          inputSt={inputSt}
                        />
                      </div>

                      {/* Row 7: Business Direction + Activity Type */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={labelSt}>{tr('add.direction')}</label>
                          <select
                            value={t.business_direction_id || ''}
                            onChange={e => updateTx(i, 'business_direction_id', e.target.value || null)}
                            style={selectStyle}
                          >
                            <option value="">— Any —</option>
                            {directions.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelSt}>{tr('add.activity')}</label>
                          <select
                            value={t.activity_type_id || ''}
                            onChange={e => updateTx(i, 'activity_type_id', e.target.value || null)}
                            style={selectStyle}
                          >
                            <option value="">— Any —</option>
                            {activityTypes.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
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
              }}>{tr('common.cancel')}</button>
            </div>
          )}
        </div>
      )}

      {/* DEBT TAB */}
      {tab === 'debt' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {[
              { key: 'receivable', label: getLang() === 'ru' ? '💚 Они должны мне' : getLang() === 'id' ? '💚 Mereka berutang' : '💚 They owe me' },
              { key: 'payable',    label: getLang() === 'ru' ? '❤️ Я должен им'   : getLang() === 'id' ? '❤️ Saya berutang'  : '❤️ I owe them' },
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
            {
              key: 'counterparty',
              label: debt.type === 'receivable'
                ? (getLang() === 'ru' ? 'Кто вам должен?' : getLang() === 'id' ? 'Siapa yang berutang?' : 'Who owes you?')
                : (getLang() === 'ru' ? 'Кому вы должны?' : getLang() === 'id' ? 'Kepada siapa Anda berutang?' : 'Who do you owe?'),
              placeholder: getLang() === 'id' ? 'mis. Klien Ivan, Spa Factory Bali' : 'e.g. Client Ivan, Spa Factory Bali',
            },
            {
              key: 'description',
              label: getLang() === 'ru' ? 'Описание' : getLang() === 'id' ? 'Deskripsi' : 'Description',
              placeholder: getLang() === 'id' ? 'mis. Invoice #004, pesanan disinfektan' : 'e.g. Invoice #004, disinfectant order',
            },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label style={mainLabelSt}>{f.label}</label>
              <input value={debt[f.key]} onChange={e => setDebt(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            <div>
              <label style={mainLabelSt}>{tr('pulse.amountIDR')}</label>
              <input type="number" value={debt.amount} onChange={e => setDebt(p => ({ ...p, amount: e.target.value }))}
                placeholder="5000000" style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
            </div>
            <div>
              <label style={mainLabelSt}>{tr('add.dueDate')}</label>
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
            {saving
              ? (getLang() === 'ru' ? 'Сохранение...' : getLang() === 'id' ? 'Menyimpan...' : 'Saving...')
              : getLang() === 'ru'
                ? (debt.type === 'receivable' ? 'Добавить дебиторку' : 'Добавить обязательство')
                : getLang() === 'id'
                ? (debt.type === 'receivable' ? 'Tambah piutang' : 'Tambah kewajiban')
                : (debt.type === 'receivable' ? 'Add receivable' : 'Add payable')
            }
          </button>
        </div>
      )}

      {/* REMINDER TAB */}
      {tab === 'reminder' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={mainLabelSt}>{tr('add.reminderTitle')}</label>
            <input value={reminder.title} onChange={e => setReminder(p => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Check Gojek settlement" style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={mainLabelSt}>{tr('add.notes')}</label>
            <input value={reminder.meta} onChange={e => setReminder(p => ({ ...p, meta: e.target.value }))}
              placeholder="e.g. every 2 weeks, IDR 2,500,000" style={{ ...inputSt, padding: '12px 14px', background: 'var(--bg-2)', fontSize: 'var(--text-base)' }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={mainLabelSt}>{tr('add.dueDate')}</label>
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
