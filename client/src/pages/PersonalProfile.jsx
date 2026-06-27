// Personal Account home (Phase 1). The human account's starting point: create or join a
// business, or go to an existing workspace. Identity/profile is secondary (collapsible).
// NO personal wallets/transactions/finance and NO businesses.type='personal'. Uses
// GET/PATCH /api/me/profile + GET /api/workspaces. Behind VITE_EMAIL_AUTH_ENABLED.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { setActiveBusinessId } from '../lib/api'

const COMMON_TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Singapore', 'Asia/Bangkok', 'Europe/Moscow', 'UTC']
const LOCALES = ['en', 'ru', 'id']

export default function PersonalProfile() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ display_name: '', locale: '', timezone: '', avatar_url: '' })
  const [businesses, setBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showProfile, setShowProfile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { navigate('/login/email'); return }
    const h = { headers: { Authorization: `Bearer ${token}` } }
    Promise.all([
      fetch('/api/me/profile', h).then(r => r.json()).catch(() => ({})),
      fetch('/api/workspaces', h).then(r => r.json()).catch(() => ({})),
    ]).then(([prof, ws]) => {
      const p = prof.profile || {}
      setForm({ display_name: p.display_name || '', locale: p.locale || '', timezone: p.timezone || '', avatar_url: p.avatar_url || '' })
      setBusinesses(Array.isArray(ws.business) ? ws.business : [])
    }).catch(() => setError('Could not load your account.')).finally(() => setLoading(false))
  }, [token]) // eslint-disable-line

  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setMsg(''); setError('') }

  const save = async (e) => {
    e?.preventDefault?.()
    setSaving(true); setMsg(''); setError('')
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error === 'nothing_to_update' ? 'Nothing to update.' : 'Could not save.'); return }
      setMsg('Saved.')
    } catch { setError('Network error.') } finally { setSaving(false) }
  }

  const openBusiness = (b) => {
    try { setActiveBusinessId(b.id); localStorage.setItem('activeWorkspaceId', b.id) } catch { /* */ }
    navigate('/business/pulse')
  }

  const greeting = form.display_name || (user?.firstName) || 'there'
  const card = { border: '1px solid var(--border-2,#e3e8ee)', borderRadius: 14, padding: 18, background: 'var(--bg,#fff)' }
  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'var(--bg,#fff)', color: 'var(--text,#111)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-2,#555)', margin: '12px 0 6px', display: 'block' }
  const primary = { padding: '12px 16px', borderRadius: 10, border: 'none', background: 'var(--brand,#3399FF)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const ghost = { padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'none', color: 'var(--text,#111)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3,#777)' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 18px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Personal Account</h1>
        <button onClick={() => { logout(); navigate('/login') }}
          style={{ background: 'none', border: 'none', color: 'var(--red,#d33)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Sign out</button>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-2,#6B7E92)', marginTop: 0, marginBottom: 22 }}>
        Hi, {greeting}. This is your human account — create or open a business below.
      </p>

      {/* Onboarding / workspaces */}
      {businesses.length === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Create your first business workspace</div>
          <div style={{ fontSize: 14, color: 'var(--text-3,#777)', marginBottom: 18, lineHeight: 1.5 }}>
            Invite your team and start tracking business finances.
          </div>
          <button style={{ ...primary, width: '100%', maxWidth: 280 }} onClick={() => navigate('/business/new')}>+ Create business</button>
          <div style={{ fontSize: 12, color: 'var(--text-4,#999)', marginTop: 14 }}>
            Joining a team? Open the invite link from your email.
          </div>
        </div>
      ) : (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Your businesses</div>
            <button style={ghost} onClick={() => navigate('/business/new')}>+ Create</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {businesses.map(b => (
              <button key={b.id} onClick={() => openBusiness(b)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-2,#e3e8ee)', background: 'var(--bg-2,#f7f9fb)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <span>
                  <span style={{ fontWeight: 600, color: 'var(--text,#111)', fontSize: 14 }}>{b.name}</span>
                  <span style={{ color: 'var(--text-3,#888)', fontSize: 12, marginLeft: 8 }}>{b.business_code || ''}{b.role ? ` · ${b.role}` : ''}</span>
                </span>
                <span style={{ color: 'var(--brand,#3399FF)', fontSize: 13, fontWeight: 600 }}>Open →</span>
              </button>
            ))}
          </div>
          <button style={{ ...primary, width: '100%', marginTop: 14 }} onClick={() => openBusiness(businesses[0])}>Go to workspace</button>
        </div>
      )}

      {/* Profile settings (secondary, collapsible) */}
      <div style={{ ...card, marginTop: 16 }}>
        <button onClick={() => setShowProfile(v => !v)}
          style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text,#111)' }}>Profile settings</span>
          <span style={{ color: 'var(--text-3,#888)', fontSize: 13 }}>{showProfile ? 'Hide' : 'Edit'}</span>
        </button>
        {showProfile && (
          <form onSubmit={save} style={{ marginTop: 8 }}>
            <label style={lbl}>DISPLAY NAME</label>
            <input style={inp} value={form.display_name} onChange={set('display_name')} placeholder="Your name" />
            <label style={lbl}>LANGUAGE</label>
            <select style={inp} value={form.locale} onChange={set('locale')}>
              <option value="">—</option>{LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <label style={lbl}>TIMEZONE</label>
            <input style={inp} value={form.timezone} onChange={set('timezone')} list="profile-tz" placeholder="Asia/Jakarta" autoComplete="off" />
            <datalist id="profile-tz">{COMMON_TZ.map(tz => <option key={tz} value={tz} />)}</datalist>
            <label style={lbl}>AVATAR URL</label>
            <input style={inp} value={form.avatar_url} onChange={set('avatar_url')} placeholder="https://…" />
            <button type="submit" disabled={saving} style={{ ...primary, width: '100%', marginTop: 16 }}>{saving ? 'Saving…' : 'Save profile'}</button>
            {msg && <div style={{ marginTop: 10, color: 'var(--green-dark,#1a7f37)', fontSize: 13 }}>{msg}</div>}
            {error && <div style={{ marginTop: 10, color: 'var(--red-dark,#b3261e)', fontSize: 13 }}>{error}</div>}
          </form>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-3,#999)', textAlign: 'center', lineHeight: 1.5 }}>
        No personal wallets or transactions yet — personal finance comes later.
      </div>
      {user?.id != null && <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-4,#bbb)', textAlign: 'center' }}>id {String(user.id)}</div>}
    </div>
  )
}
