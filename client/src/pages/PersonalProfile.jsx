// Personal Account profile SHELL (Phase 1). Identity only — display name, locale,
// timezone, avatar URL. NO wallets, NO transactions, NO personal finance. Uses
// GET/PATCH /api/me/profile. Behind VITE_EMAIL_AUTH_ENABLED (route gating in App.jsx).
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const COMMON_TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Singapore', 'Asia/Bangkok', 'Europe/Moscow', 'UTC']
const LOCALES = ['en', 'ru', 'id']

export default function PersonalProfile() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ display_name: '', locale: '', timezone: '', avatar_url: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { navigate('/login/email'); return }
    fetch('/api/me/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        const p = d.profile || {}
        setForm({ display_name: p.display_name || '', locale: p.locale || '', timezone: p.timezone || '', avatar_url: p.avatar_url || '' })
      }).catch(() => setError('Could not load your profile.')).finally(() => setLoading(false))
  }, [token])

  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setMsg(''); setError('') }

  const save = async (e) => {
    e?.preventDefault?.()
    setSaving(true); setMsg(''); setError('')
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error === 'nothing_to_update' ? 'Nothing to update.' : 'Could not save.'); return }
      setMsg('Saved.')
    } catch { setError('Network error.') } finally { setSaving(false) }
  }

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'var(--bg,#fff)', color: 'var(--text,#111)', fontSize: 14, fontFamily: 'inherit' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-2,#555)', margin: '12px 0 6px', display: 'block' }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3,#777)' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '32px 20px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Personal Account</h1>
      <p style={{ fontSize: 13, color: 'var(--text-3,#777)', marginBottom: 20 }}>
        Your human account. Create or join businesses from here. (No personal wallets or transactions — that comes later.)
      </p>

      <form onSubmit={save}>
        <label style={lbl}>DISPLAY NAME</label>
        <input style={inp} value={form.display_name} onChange={set('display_name')} placeholder="Your name" />

        <label style={lbl}>LANGUAGE</label>
        <select style={inp} value={form.locale} onChange={set('locale')}>
          <option value="">—</option>
          {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        <label style={lbl}>TIMEZONE</label>
        <input style={inp} value={form.timezone} onChange={set('timezone')} list="profile-tz" placeholder="Asia/Jakarta" autoComplete="off" />
        <datalist id="profile-tz">{COMMON_TZ.map(tz => <option key={tz} value={tz} />)}</datalist>

        <label style={lbl}>AVATAR URL</label>
        <input style={inp} value={form.avatar_url} onChange={set('avatar_url')} placeholder="https://…" />

        <button type="submit" disabled={saving}
          style={{ width: '100%', marginTop: 18, padding: 12, borderRadius: 10, border: 'none', background: 'var(--brand,#3399FF)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {msg && <div style={{ marginTop: 12, color: 'var(--green-dark,#1a7f37)', fontSize: 13 }}>{msg}</div>}
      {error && <div style={{ marginTop: 12, color: 'var(--red-dark,#b3261e)', fontSize: 13 }}>{error}</div>}

      <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
        <button onClick={() => navigate('/business/new')} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'none', color: 'var(--text,#111)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>+ Create business</button>
        <button onClick={() => { logout(); navigate('/login') }} style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid var(--red,#d33)', background: 'none', color: 'var(--red,#d33)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Sign out</button>
      </div>

      {user?.id != null && <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-4,#999)' }}>Account id: {String(user.id)}</div>}
    </div>
  )
}
