import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull } from '../lib/api'

export default function Accounts() {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editAccount, setEditAccount] = useState(null)
  const [form, setForm] = useState({ name: '', type: 'personal', balance: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch('/pulse?scope=all', token)
      .then(setData).catch(console.error).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const totalBalance = data?.totalBalance || 0
  const accounts = data?.accounts || []

  const typeColor = (type) => type === 'business'
    ? { bg: '#E1F5EE', color: '#085041' }
    : { bg: '#E6F1FB', color: '#185FA5' }

  const openEdit = (acc) => {
    setEditAccount(acc)
    setForm({ name: acc.name, type: acc.type, balance: acc.balance })
    setShowAdd(true)
  }

  const openAdd = () => {
    setEditAccount(null)
    setForm({ name: '', type: 'personal', balance: '' })
    setShowAdd(true)
  }

  const handleDelete = async () => {
    if (!editAccount) return
    if (!window.confirm(`Delete "${editAccount.name}"? Transactions will remain but source will be cleared.`)) return
    setSaving(true)
    try {
      await apiFetch('/accounts/delete', token, { method: 'POST', body: { name: editAccount.name } })
      setShowAdd(false)
      setEditAccount(null)
      load()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editAccount) {
        await apiFetch('/accounts/rename', token, {
          method: 'POST',
          body: { oldName: editAccount.name, newName: form.name, type: form.type }
        })
      } else {
        await apiFetch('/accounts', token, {
          method: 'POST',
          body: { name: form.name, type: form.type, balance: Number(form.balance) || 0 }
        })
      }
      setShowAdd(false)
      setEditAccount(null)
      load()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Accounts</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>All sources</div>
        </div>
        <button onClick={openAdd} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--text)', color: '#fff', border: 'none', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      </div>

      <div style={{ margin: '4px 16px 16px', background: 'var(--text)', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Total across all accounts</div>
        <div style={{ fontSize: 28, fontWeight: 600, color: '#fff', letterSpacing: -0.5 }}>{fmtFull(totalBalance)}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>IDR</div>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Loading...</div>}

      {accounts.map((acc, i) => {
        const colors = typeColor(acc.type)
        const pct = totalBalance > 0 ? Math.round((acc.balance / totalBalance) * 100) : 0
        const isNeg = acc.balance < 0
        return (
          <div key={i} className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.color} strokeWidth="1.8" strokeLinecap="round">
                  {acc.type === 'business'
                    ? <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></>
                    : <><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>}
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: colors.bg, color: colors.color }}>{acc.type === 'business' ? 'Business' : 'Personal'}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{Math.abs(pct)}% of total</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: isNeg ? 'var(--red)' : 'var(--text)' }}>{isNeg ? '-' : ''}{fmt(Math.abs(acc.balance))}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>IDR</div>
              </div>
              <button onClick={() => openEdit(acc)} style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-2)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
            <div style={{ height: 3, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden', marginTop: 12 }}>
              <div style={{ height: '100%', borderRadius: 2, background: isNeg ? 'var(--red)' : colors.color, width: `${Math.max(2, Math.min(100, Math.abs(pct)))}%` }} />
            </div>
          </div>
        )
      })}

      <div className="card" style={{ border: '0.5px dashed var(--border-2)', cursor: 'pointer', marginTop: 4 }} onClick={openAdd}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Add account manually</div>
        </div>
      </div>

      <div style={{ margin: '12px 16px 0', background: 'var(--bg-2)', borderRadius: 10, padding: '10px 13px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
          💡 Accounts are auto-created from transaction sources.<br/>
          <span style={{ color: 'var(--text-2)', fontStyle: 'italic' }}>"получил 5М с Gojek на карту Permata"</span>
        </div>
      </div>

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', maxWidth: 430, margin: '0 auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{editAccount ? `Edit · ${editAccount.name}` : 'Add account'}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Account name</div>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Permata Personal" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
            </div>

            <div style={{ marginBottom: editAccount ? 12 : 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Type</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['personal', 'business'].map(t => (
                  <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))} style={{ flex: 1, padding: '9px', borderRadius: 10, fontSize: 13, border: '0.5px solid var(--border-2)', background: form.type === t ? 'var(--text)' : 'none', color: form.type === t ? '#fff' : 'var(--text-2)' }}>
                    {t === 'personal' ? '👤 Personal' : '💼 Business'}
                  </button>
                ))}
              </div>
            </div>

            {!editAccount && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Opening balance (IDR)</div>
                <input type="number" value={form.balance} onChange={e => setForm(p => ({ ...p, balance: e.target.value }))}
                  placeholder="0" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border-2)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }} />
              </div>
            )}

            {editAccount && (
              <div style={{ marginBottom: 12, background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>ℹ️ Renaming updates all transactions linked to this source.</div>
              </div>
            )}

            <button disabled={!form.name || saving} onClick={handleSave} style={{ width: '100%', padding: 13, borderRadius: 10, background: form.name ? 'var(--text)' : 'var(--bg-2)', color: form.name ? '#fff' : 'var(--text-3)', border: 'none', fontSize: 14, fontWeight: 500 }}>
              {saving ? 'Saving...' : editAccount ? 'Save changes' : 'Add account'}
            </button>

            <button onClick={() => setShowAdd(false)} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13, marginTop: 8 }}>Cancel</button>

            {editAccount && (
              <button onClick={handleDelete} disabled={saving} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--red)', border: '0.5px solid var(--red)', fontSize: 13, marginTop: 8 }}>
                🗑 Delete account
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}