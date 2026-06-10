import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull } from '../lib/api'

export default function Accounts() {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editAccount, setEditAccount] = useState(null) // account being edited
  const [form, setForm] = useState({ name: '', type: 'personal', balance: '', newBalance: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch('/pulse?scope=all', token)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const totalBalance = data?.totalBalance || 0
  const accounts = data?.accounts || []

  const typeColor = (type) => type === 'business'
    ? { bg: '#E1F5EE', color: '#085041' }
    : { bg: '#E6F1FB', color: '#185FA5' }

  const openEdit = (acc) => {
    setEditAccount(acc)
    setForm({ name: acc.name, type: acc.type, balance: acc.balance, newBalance: acc.balance })
    setShowAdd(true)
  }

  const openAdd = () => {
    setEditAccount(null)
    setForm({ name: '', type: 'personal', balance: '' })
    setShowAdd(true)
  }

  const handleDelete = async () => {
    if (!editAccount) return
    if (!window.confirm(`Delete "${editAccount.name}"? All transactions from this source will have their source cleared.`)) return
    setSaving(true)
    try {
      await apiFetch('/accounts/delete', token, {
        method: 'POST',
        body: { name: editAccount.name }
      })
      setShowAdd(false)
      setEditAccount(null)
      load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editAccount) {
        await apiFetch('/accounts/rename', token, {
          method: 'POST',
          body: { oldName: editAccount.name, newName: form.name, type: form.type }
        })
        const diff = Number(form.newBalance) - Number(form.balance)
        if (diff !== 0) {
          await apiFetch('/accounts/adjust', token, {
            method: 'POST',
            body: { name: form.name, diff, type: form.type }
          })
        }
      } else {
        await apiFetch('/accounts', token, {
          method: 'POST',
          body: { name: form.name, type: form.type, balance: Number(form.balance) || 0 }
        })
      }
      setShowAdd(false)
      setEditAccount(null)
      load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="hf-page">

      {/* ── Page header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">Accounts</div>
          <div className="hf-page-subtitle">All financial sources and balances</div>
        </div>
        <div className="hf-page-actions">
          <button onClick={openAdd} className="btn btn-primary btn-md">+ Add Account</button>
        </div>
      </div>

      {/* ── Total balance hero ─── */}
      <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)', borderRadius: 20, padding: '24px 26px 20px', boxShadow: '0 8px 32px rgba(15,23,42,.22)', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.03, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 28px, #fff 28px, #fff 29px), repeating-linear-gradient(90deg, transparent, transparent 28px, #fff 28px, #fff 29px)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>Total balance · all accounts</div>
          <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: '#fff', letterSpacing: -1, lineHeight: 1 }}>
            {fmtFull(totalBalance)}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>IDR · {accounts.length} account{accounts.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--text-sm)' }}>Loading accounts…</div>}

      {!loading && accounts.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">💳</div>
          <div className="empty-state-title">No accounts yet</div>
          <div className="empty-state-sub">Accounts are created automatically when you add transactions with a source. You can also add them manually.</div>
          <button className="empty-state-cta" onClick={openAdd}>+ Add Account</button>
        </div>
      )}

      {/* ── Accounts grid ─── */}
      {accounts.length > 0 && (
        <div className="hf-card-grid hf-card-grid-2" style={{ marginBottom: 16 }}>
          {accounts.map((acc, i) => {
            const colors = typeColor(acc.type)
            const pct = totalBalance > 0 ? Math.round((acc.balance / totalBalance) * 100) : 0
            const isNeg = acc.balance < 0

            return (
              <div key={acc.id || i} className="hf-card" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
                  {/* Icon */}
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={colors.color} strokeWidth="1.8" strokeLinecap="round">
                      {acc.type === 'business'
                        ? <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></>
                        : <><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>
                      }
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>{acc.name}</div>
                    <span style={{ fontSize: 12, padding: '2px 9px', borderRadius: 20, background: colors.bg, color: colors.color, fontWeight: 700 }}>
                      {acc.type === 'business' ? 'Business' : 'Personal'}
                    </span>
                  </div>
                  {/* Edit button */}
                  <button onClick={() => openEdit(acc)} style={{
                    width: 34, height: 34, borderRadius: 10, background: 'var(--bg-2)',
                    border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0, cursor: 'pointer'
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                </div>

                {/* Balance */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 4 }}>Balance</div>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: isNeg ? 'var(--red-dark)' : 'var(--text)', letterSpacing: -0.3 }}>
                    {isNeg ? '−' : ''}{fmt(Math.abs(acc.balance))}
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-3)', marginLeft: 4 }}>IDR</span>
                  </div>
                </div>

                {/* Share bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Share of total</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>{Math.abs(pct)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: isNeg ? 'var(--red)' : colors.color, width: `${Math.max(2, Math.min(100, Math.abs(pct)))}%`, transition: 'width .3s' }} />
                  </div>
                </div>
              </div>
            )
          })}

          {/* ── Add account card ─── */}
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
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', fontWeight: 500 }}>Add account manually</div>
          </div>
        </div>
      )}

      {/* ── Tip card ─── */}
      <div className="hf-card" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 8 }}>Auto-detection</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6 }}>
          Accounts are auto-created from transaction sources via AI parsing.<br/>
          <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>Example: "received 5M from Gojek to Permata card"</span>
        </div>
      </div>

      {/* Add / Edit modal */}
      {showAdd && createPortal(
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-drag-handle" />
            <button className="modal-close-btn" onClick={() => setShowAdd(false)}>✕</button>

            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)', marginBottom: 18 }}>
              {editAccount ? `Edit · ${editAccount.name}` : 'Add account'}
            </div>

            <label className="modal-label">Account name</label>
            <input
              className="modal-input"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Permata Personal"
              style={{ marginBottom: 14 }}
              autoFocus
            />

            <label className="modal-label">Type</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {['personal', 'business'].map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))} style={{
                  flex: 1, padding: '10px', borderRadius: 10, fontSize: 'var(--text-sm)',
                  border: '0.5px solid var(--border-2)', fontFamily: 'inherit',
                  background: form.type === t ? 'var(--text)' : 'none',
                  color: form.type === t ? '#fff' : 'var(--text-2)',
                  cursor: 'pointer', transition: 'background .12s',
                }}>{t === 'personal' ? '👤 Personal' : '💼 Business'}</button>
              ))}
            </div>

            {!editAccount && (
              <>
                <label className="modal-label">Opening balance (IDR)</label>
                <input
                  type="number"
                  className="modal-input"
                  value={form.balance}
                  onChange={e => setForm(p => ({ ...p, balance: e.target.value }))}
                  placeholder="0"
                  style={{ marginBottom: 18 }}
                />
              </>
            )}

            {editAccount && (
              <>
                <label className="modal-label">
                  Set new balance (IDR) — current: {fmtFull(form.balance)}
                </label>
                <input
                  type="number"
                  className="modal-input"
                  value={form.newBalance}
                  onChange={e => setForm(p => ({ ...p, newBalance: e.target.value }))}
                  placeholder={String(form.balance)}
                  style={{ marginBottom: 6 }}
                />
                {Number(form.newBalance) !== Number(form.balance) && (
                  <div style={{ fontSize: 'var(--text-sm)', color: Number(form.newBalance) > Number(form.balance) ? 'var(--green-dark)' : 'var(--red-dark)', marginBottom: 8 }}>
                    Adjustment: {Number(form.newBalance) > Number(form.balance) ? '+' : ''}{fmtFull(Number(form.newBalance) - Number(form.balance))} IDR
                  </div>
                )}
                <div style={{ marginBottom: 18, background: 'var(--bg-2)', borderRadius: 10, padding: '10px 13px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', lineHeight: 1.5 }}>
                    ℹ️ Renaming will update all transactions linked to this account source.
                  </div>
                </div>
              </>
            )}

            <button
              disabled={!form.name || saving}
              onClick={handleSave}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 8 }}
            >
              {saving ? 'Saving…' : editAccount ? 'Save changes' : 'Add account'}
            </button>

            <button
              onClick={() => setShowAdd(false)}
              className="btn btn-ghost btn-block btn-lg"
              style={{ marginBottom: editAccount ? 8 : 0 }}
            >
              Cancel
            </button>

            {editAccount && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="btn btn-danger btn-block btn-lg"
              >
                🗑 Delete account
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

