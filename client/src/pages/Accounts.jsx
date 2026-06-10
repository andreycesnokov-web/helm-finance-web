import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull } from '../lib/api'

// ── Wallet type config ────────────────────────────────────────────────────────
const WALLET_TYPES = [
  { value: 'bank',            label: 'Bank account' },
  { value: 'cash',            label: 'Cash' },
  { value: 'ewallet',         label: 'E-Wallet' },
  { value: 'payment_gateway', label: 'Payment gateway' },
  { value: 'other',           label: 'Other' },
]

const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'THB']

const TYPE_ICON = {
  bank: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  ),
  cash: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M6 12h.01M18 12h.01"/>
    </svg>
  ),
  ewallet: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <line x1="12" y1="18" x2="12.01" y2="18"/>
    </svg>
  ),
  payment_gateway: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  other: (color) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
}

const CURRENCY_STYLE = {
  IDR: { bg: '#E1F5EE', color: '#085041' },
  USD: { bg: '#EEF2FF', color: '#3730a3' },
  EUR: { bg: '#FEF3C7', color: '#92400E' },
  SGD: { bg: '#FDE8FF', color: '#7E22CE' },
  MYR: { bg: '#FFF1F2', color: '#9F1239' },
  THB: { bg: '#F0F9FF', color: '#0369A1' },
}

const getCurrencyStyle = (currency) => CURRENCY_STYLE[currency] || { bg: '#F1F5F9', color: '#475569' }
const getTypeIcon      = (type, color) => (TYPE_ICON[type] || TYPE_ICON.other)(color)

// ── Default form state ────────────────────────────────────────────────────────
const EMPTY_FORM = { name: '', currency: 'IDR', type: '', entity_name: '', opening_balance: '', sort_order: 0 }

export default function Accounts() {
  const { token } = useAuth()

  const [wallets,      setWallets]      = useState([])
  const [legacySources,setLegacySources]= useState([]) // source-based accounts not yet in wallets
  const [loading,      setLoading]      = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [editWallet,   setEditWallet]   = useState(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)
  const [backfilling,  setBackfilling]  = useState(false)
  const [backfillDone, setBackfillDone] = useState(false)

  // ── Admin ─────────────────────────────────────────────────────────────────
  const [isAdmin,      setIsAdmin]      = useState(false)
  const [adjustWallet, setAdjustWallet] = useState(null) // wallet being adjusted
  const today = new Date().toISOString().slice(0, 10)
  const [adjustForm,   setAdjustForm]   = useState({ target_balance: '', reason: '', transaction_date: today })
  const [adjusting,    setAdjusting]    = useState(false)

  // ── Load wallets + legacy sources ─────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    try {
      const [wData, pData] = await Promise.all([
        apiFetch('/wallets', token),
        apiFetch('/pulse?scope=all', token),
      ])

      const loaded = wData.wallets || []
      setWallets(loaded)

      // Legacy: source-based virtual accounts not yet migrated to wallets
      const walletNames = new Set(loaded.map(w => w.name))
      const legacy = (pData.accounts || []).filter(a => !walletNames.has(a.name))
      setLegacySources(legacy)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Load admin status silently — non-blocking, never errors visibly
    apiFetch('/admin/status', token)
      .then(d => { setIsAdmin(d.is_admin === true); console.log('[admin/status]', d) })
      .catch(e => console.warn('[admin/status] failed:', e.message))
  }, [])

  // ── Computed totals ───────────────────────────────────────────────────────
  const totalBalance = wallets.reduce((s, w) => s + (w.balance || 0), 0)

  // ── Backfill handler ──────────────────────────────────────────────────────
  const handleBackfill = async () => {
    if (!window.confirm('Import your existing account names as wallets? You can edit them afterwards.')) return
    setBackfilling(true)
    try {
      const r = await apiFetch('/wallets/backfill', token, { method: 'POST', body: {} })
      setBackfillDone(true)
      await load()
      if (r.created === 0) alert('All existing accounts are already in your wallet list.')
    } catch (e) {
      alert(e.message)
    } finally {
      setBackfilling(false)
    }
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditWallet(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (w) => {
    setEditWallet(w)
    setForm({ name: w.name, currency: w.currency || 'IDR', type: w.type || '', entity_name: w.entity_name || '', opening_balance: '', sort_order: w.sort_order || 0 })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editWallet) {
        await apiFetch(`/wallets/${editWallet.id}`, token, {
          method: 'PUT',
          body: { name: form.name, currency: form.currency, type: form.type || null, entity_name: form.entity_name || null },
        })
      } else {
        await apiFetch('/wallets', token, {
          method: 'POST',
          body: {
            name:            form.name,
            currency:        form.currency,
            type:            form.type        || null,
            entity_name:     form.entity_name || null,
            opening_balance: Number(form.opening_balance) || 0,
            sort_order:      wallets.length,
          },
        })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Adjust balance (admin only) ───────────────────────────────────────────
  const openAdjust = (w) => {
    setAdjustWallet(w)
    setAdjustForm({ target_balance: '', reason: '', transaction_date: today })
  }

  const handleAdjust = async () => {
    if (!adjustWallet) return
    const targetNum = Number(adjustForm.target_balance)
    if (isNaN(targetNum) || adjustForm.target_balance === '') return
    if (!adjustForm.reason.trim()) return
    setAdjusting(true)
    try {
      const r = await apiFetch(`/admin/wallets/${adjustWallet.id}/adjust-balance`, token, {
        method: 'POST',
        body: {
          target_balance:   targetNum,
          reason:           adjustForm.reason.trim(),
          transaction_date: adjustForm.transaction_date || undefined,
        },
      })
      if (r.delta === 0) {
        alert('Balance is already at target — no correction needed.')
      } else {
        const sign = r.delta > 0 ? '+' : ''
        alert(`Done. Delta: ${sign}${r.delta.toLocaleString('id')} ${adjustWallet.currency}.\nTransaction ID: ${r.transaction_id}`)
      }
      setAdjustWallet(null)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setAdjusting(false)
    }
  }

  const handleDelete = async () => {
    if (!editWallet) return
    if (!window.confirm(`Archive "${editWallet.name}"? The wallet will be hidden. Transactions are not deleted.`)) return
    setSaving(true)
    try {
      await apiFetch(`/wallets/${editWallet.id}`, token, { method: 'DELETE' })
      setShowForm(false)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="hf-page">

      {/* Page header */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">Wallets & Accounts</div>
          <div className="hf-page-subtitle">Manage your bank accounts, cash, and payment wallets</div>
        </div>
        <div className="hf-page-actions">
          <button onClick={openAdd} className="btn btn-primary btn-md">+ Add wallet</button>
        </div>
      </div>

      {/* Total balance hero */}
      {wallets.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)', borderRadius: 20, padding: '24px 26px 20px', boxShadow: '0 8px 32px rgba(15,23,42,.22)', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0.03, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 28px, #fff 28px, #fff 29px), repeating-linear-gradient(90deg, transparent, transparent 28px, #fff 28px, #fff 29px)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>Total balance · all wallets</div>
            <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: '#fff', letterSpacing: -1, lineHeight: 1 }}>
              {fmtFull(totalBalance)}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>IDR · {wallets.length} wallet{wallets.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--text-sm)' }}>Loading wallets…</div>
      )}

      {/* Backfill banner — only when legacy accounts exist and no wallets yet */}
      {!loading && wallets.length === 0 && legacySources.length > 0 && !backfillDone && (
        <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 14, padding: '16px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>💡</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#3730a3', marginBottom: 4 }}>
              You have {legacySources.length} existing account{legacySources.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: '#4338ca', lineHeight: 1.5, marginBottom: 12 }}>
              Import them as wallets to manage currencies, types, and entities.
              You can edit or delete them after importing.
            </div>
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              style={{ padding: '8px 16px', borderRadius: 8, background: '#4338ca', color: '#fff', border: 'none', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {backfilling ? 'Importing…' : `Import ${legacySources.length} account${legacySources.length !== 1 ? 's' : ''} as wallets`}
            </button>
          </div>
        </div>
      )}

      {/* Empty state — no wallets and no legacy */}
      {!loading && wallets.length === 0 && legacySources.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <div className="empty-state-title">No wallets yet</div>
          <div className="empty-state-sub">
            Create wallets for each bank account, cash box, payment gateway,
            or company account you use.
          </div>
          <button className="empty-state-cta" onClick={openAdd}>+ Add first wallet</button>
        </div>
      )}

      {/* Wallet cards */}
      {wallets.length > 0 && (
        <div className="hf-card-grid hf-card-grid-2" style={{ marginBottom: 16 }}>
          {wallets.map((w) => {
            const cs    = getCurrencyStyle(w.currency)
            const isNeg = (w.balance || 0) < 0
            const pct   = totalBalance > 0 ? Math.round(((w.balance || 0) / totalBalance) * 100) : 0
            const typeLabel = WALLET_TYPES.find(t => t.value === w.type)?.label || null

            return (
              <div key={w.id} className="hf-card" style={{ cursor: 'default' }}>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: cs.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {getTypeIcon(w.type, cs.color)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 5 }}>{w.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: cs.bg, color: cs.color, fontWeight: 700 }}>{w.currency}</span>
                      {typeLabel && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-2)', color: 'var(--text-2)', fontWeight: 600 }}>{typeLabel}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {isAdmin && (
                      <button
                        onClick={() => openAdjust(w)}
                        title="Adjust balance (admin)"
                        style={{ height: 34, padding: '0 10px', borderRadius: 10, background: '#FEF3C7', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#92400E', fontFamily: 'inherit' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Adjust
                      </button>
                    )}
                    <button onClick={() => openEdit(w)} style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Entity name */}
                {w.entity_name && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginBottom: 12, paddingLeft: 62 }}>{w.entity_name}</div>
                )}

                {/* Balance */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 4 }}>Balance</div>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: isNeg ? 'var(--red-dark)' : 'var(--text)', letterSpacing: -0.3 }}>
                    {isNeg ? '−' : ''}{fmt(Math.abs(w.balance || 0))}
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-3)', marginLeft: 4 }}>{w.currency}</span>
                  </div>
                </div>

                {/* Share bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Share of total</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>{Math.abs(pct)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: isNeg ? 'var(--red)' : cs.color, width: `${Math.max(2, Math.min(100, Math.abs(pct)))}%`, transition: 'width .3s' }} />
                  </div>
                </div>
              </div>
            )
          })}

          {/* Add wallet card */}
          <div
            className="hf-card"
            onClick={openAdd}
            style={{ border: '1.5px dashed var(--border-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140, flexDirection: 'column', gap: 12 }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', fontWeight: 500 }}>Add wallet</div>
          </div>
        </div>
      )}

      {/* Legacy unmatched sources */}
      {!loading && wallets.length > 0 && legacySources.length > 0 && (
        <div className="hf-card" style={{ marginBottom: 16, background: 'var(--bg-2)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 10 }}>Legacy accounts not yet linked</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
            These transaction sources don't match any wallet name. Import them or rename your wallets to match.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {legacySources.map(a => (
              <span key={a.id} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-3)', color: 'var(--text-2)', fontWeight: 600 }}>{a.name}</span>
            ))}
          </div>
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--text)', color: 'var(--bg)', border: 'none', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {backfilling ? 'Importing…' : 'Import as wallets'}
          </button>
        </div>
      )}

      {/* Info card */}
      <div className="hf-card" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 8 }}>About wallets</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6 }}>
          Create wallets for each bank account, cash box, payment gateway, or company account you use.
          Balances are calculated from your transactions automatically.
        </div>
      </div>

      {/* ── Adjust Balance modal (admin only) ──────────────────────────────── */}
      {adjustWallet && createPortal(
        <div className="modal-overlay" onClick={() => setAdjustWallet(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <button className="modal-close-btn" onClick={() => setAdjustWallet(null)}>✕</button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>Adjust Balance</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>{adjustWallet.name}</div>
              </div>
            </div>

            {/* Admin badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 20, padding: '3px 10px', marginBottom: 18 }}>
              ⚡ Super Admin · creates a correction transaction
            </div>

            {/* Current balance */}
            <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 4 }}>Current balance</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
                {fmtFull(adjustWallet.balance || 0)}
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-3)', marginLeft: 6 }}>{adjustWallet.currency}</span>
              </div>
            </div>

            {/* Target balance */}
            <label className="modal-label">Target balance ({adjustWallet.currency})</label>
            <input
              type="number"
              className="modal-input"
              value={adjustForm.target_balance}
              onChange={e => setAdjustForm(p => ({ ...p, target_balance: e.target.value }))}
              placeholder="Enter target balance"
              style={{ marginBottom: 8 }}
              autoFocus
            />

            {/* Delta preview */}
            {adjustForm.target_balance !== '' && !isNaN(Number(adjustForm.target_balance)) && (() => {
              const delta = Number(adjustForm.target_balance) - (adjustWallet.balance || 0)
              if (delta === 0) return (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginBottom: 12 }}>No change needed — balance already at target.</div>
              )
              const isPos = delta > 0
              return (
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: isPos ? '#085041' : '#991B1B', background: isPos ? '#E1F5EE' : '#FEE2E2', borderRadius: 8, padding: '6px 12px', marginBottom: 12 }}>
                  Correction: {isPos ? '+' : ''}{delta.toLocaleString('id')} {adjustWallet.currency}
                </div>
              )
            })()}

            {/* Reason */}
            <label className="modal-label">Reason <span style={{ color: 'var(--red)', fontWeight: 700 }}>*</span></label>
            <input
              className="modal-input"
              value={adjustForm.reason}
              onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="e.g. Bank reconciliation, Opening balance fix"
              style={{ marginBottom: 14 }}
            />

            {/* Date */}
            <label className="modal-label">Transaction date</label>
            <input
              type="date"
              className="modal-input"
              value={adjustForm.transaction_date}
              onChange={e => setAdjustForm(p => ({ ...p, transaction_date: e.target.value }))}
              style={{ marginBottom: 20 }}
            />

            <button
              disabled={
                adjusting ||
                adjustForm.target_balance === '' ||
                isNaN(Number(adjustForm.target_balance)) ||
                !adjustForm.reason.trim()
              }
              onClick={handleAdjust}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 8, background: '#92400E', borderColor: '#92400E' }}
            >
              {adjusting ? 'Creating correction…' : 'Create correction transaction'}
            </button>
            <button onClick={() => setAdjustWallet(null)} className="btn btn-ghost btn-block btn-lg">
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Add / Edit modal */}
      {showForm && createPortal(
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <button className="modal-close-btn" onClick={() => setShowForm(false)}>✕</button>

            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 18 }}>
              {editWallet ? `Edit · ${editWallet.name}` : 'Add wallet'}
            </div>

            {/* Name */}
            <label className="modal-label">Wallet name</label>
            <input
              className="modal-input"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. BCA IDR, Cash Office, Wise USD"
              style={{ marginBottom: 14 }}
              autoFocus
            />

            {/* Currency */}
            <label className="modal-label">Currency</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {CURRENCIES.map(c => {
                const cs = getCurrencyStyle(c)
                return (
                  <button key={c} onClick={() => setForm(p => ({ ...p, currency: c }))} style={{
                    padding: '8px 14px', borderRadius: 10, fontSize: 'var(--text-sm)',
                    border: '0.5px solid var(--border-2)', fontFamily: 'inherit', fontWeight: 700,
                    background: form.currency === c ? cs.bg : 'none',
                    color:      form.currency === c ? cs.color : 'var(--text-3)',
                    cursor: 'pointer', transition: 'all .1s',
                  }}>{c}</button>
                )
              })}
            </div>

            {/* Type */}
            <label className="modal-label">Type <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
            <select
              className="modal-input"
              value={form.type}
              onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
              style={{ marginBottom: 14 }}
            >
              <option value="">— Select type —</option>
              {WALLET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            {/* Entity name */}
            <label className="modal-label">Company / Entity <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
            <input
              className="modal-input"
              value={form.entity_name}
              onChange={e => setForm(p => ({ ...p, entity_name: e.target.value }))}
              placeholder="e.g. PT Siberian BG, Personal"
              style={{ marginBottom: 14 }}
            />

            {/* Opening balance — only for new wallets */}
            {!editWallet && (
              <>
                <label className="modal-label">Opening balance <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                <input
                  type="number"
                  className="modal-input"
                  value={form.opening_balance}
                  onChange={e => setForm(p => ({ ...p, opening_balance: e.target.value }))}
                  placeholder="0"
                  style={{ marginBottom: 18 }}
                />
              </>
            )}

            {editWallet && <div style={{ marginBottom: 18 }} />}

            <button
              disabled={!form.name.trim() || saving}
              onClick={handleSave}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 8 }}
            >
              {saving ? 'Saving…' : editWallet ? 'Save changes' : 'Add wallet'}
            </button>

            <button onClick={() => setShowForm(false)} className="btn btn-ghost btn-block btn-lg" style={{ marginBottom: editWallet ? 8 : 0 }}>
              Cancel
            </button>

            {editWallet && isAdmin && (
              <button
                onClick={() => { setShowForm(false); openAdjust(editWallet) }}
                disabled={saving}
                className="btn btn-block btn-lg"
                style={{ marginBottom: 8, background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', fontWeight: 700 }}
              >
                ⚡ Adjust Balance (admin)
              </button>
            )}

            {editWallet && (
              <button onClick={handleDelete} disabled={saving} className="btn btn-danger btn-block btn-lg">
                Archive / Delete wallet
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
