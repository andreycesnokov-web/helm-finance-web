// Personal Account home (Phase 1). The human account's starting point: create a
// business, join one by invite link, or open a connected business. Identity/profile is
// secondary (collapsible). NO personal wallets/transactions/finance and NO
// businesses.type='personal'. Uses GET/PATCH /api/me/profile + GET /api/workspaces.
// "Join" reuses the existing /invite/:code page (auto-accepts for a logged-in user).
// Behind VITE_EMAIL_AUTH_ENABLED.
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { setActiveBusinessId } from '../lib/api'
import PersonalDashboard from './PersonalDashboard'

// Personal Account v1 dashboard (personal finance) is gated separately from email
// auth. When ON, /account leads with personal finance and demotes the business block.
const PERSONAL_V1 = import.meta.env.VITE_PERSONAL_ACCOUNT_V1_ENABLED === 'true'

const COMMON_TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Singapore', 'Asia/Bangkok', 'Europe/Moscow', 'UTC']
const LOCALES = ['en', 'ru', 'id']

// Pull an invite code out of whatever the user pastes: a full invite URL
// (…/invite/ABC123), a bare code, or a code with surrounding whitespace.
function parseInviteCode(raw) {
  const s = (raw || '').trim()
  if (!s) return ''
  const m = s.match(/\/invite\/([A-Za-z0-9_-]+)/)
  if (m) return m[1].toUpperCase()
  // Otherwise take the last path-ish segment and strip query/hash + stray chars.
  const last = s.split(/[/?#]/).filter(Boolean).pop() || s
  return last.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase()
}

export default function PersonalProfile() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ display_name: '', locale: '', timezone: '', avatar_url: '' })
  const [businesses, setBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showProfile, setShowProfile] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [inviteInput, setInviteInput] = useState('')
  const [joinError, setJoinError] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const fileRef = useRef(null)

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

  // Avatar: upload immediately on file select (cleaner than a separate save step).
  // Owner-only is enforced server-side; the path is namespaced by the user's id.
  const onPickAvatar = async (e) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = '' // allow re-picking the same file
    if (!file) return
    if (!file.type.startsWith('image/')) { setAvatarError('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { setAvatarError('Image must be 5 MB or smaller.'); return }
    setAvatarBusy(true); setAvatarError(''); setMsg('')
    try {
      const fd = new FormData()
      fd.append('avatar', file)
      const res = await fetch('/api/me/avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setAvatarError(data.message || 'Could not upload the image.'); return }
      setForm(f => ({ ...f, avatar_url: data.avatar_url }))
    } catch { setAvatarError('Network error during upload.') } finally { setAvatarBusy(false) }
  }

  const removeAvatar = async () => {
    setAvatarBusy(true); setAvatarError(''); setMsg('')
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ avatar_url: '' }),
      })
      if (!res.ok) { setAvatarError('Could not remove the photo.'); return }
      setForm(f => ({ ...f, avatar_url: '' }))
    } catch { setAvatarError('Network error.') } finally { setAvatarBusy(false) }
  }

  // Join: parse the pasted link/code and hand off to the existing /invite/:code page,
  // which auto-accepts the invite for an already-signed-in user.
  const joinByInvite = (e) => {
    e?.preventDefault?.()
    const code = parseInviteCode(inviteInput)
    if (!code) { setJoinError('Paste the full invite link or its code.'); return }
    setJoinError('')
    navigate(`/invite/${code}`)
  }

  const openBusiness = (b) => {
    try { setActiveBusinessId(b.id); localStorage.setItem('activeWorkspaceId', b.id) } catch { /* */ }
    navigate('/business/pulse')
  }

  const greeting = form.display_name || (user?.firstName) || 'there'
  const initials = (form.display_name || user?.firstName || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  const card = { border: '1px solid var(--border-2,#e3e8ee)', borderRadius: 14, padding: 18, background: 'var(--bg,#fff)' }
  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'var(--bg,#fff)', color: 'var(--text,#111)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-2,#555)', margin: '12px 0 6px', display: 'block' }
  const primary = { padding: '12px 16px', borderRadius: 10, border: 'none', background: 'var(--brand,#3399FF)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const ghost = { padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-2,#ccc)', background: 'none', color: 'var(--text,#111)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3,#777)' }}>Loading…</div>

  // Reusable "Join business with invite link" block (toggle → input + helper text).
  const joinBlock = (
    <div style={{ marginTop: 12 }}>
      {!showJoin ? (
        <button style={{ ...ghost, width: '100%' }} onClick={() => { setShowJoin(true); setJoinError('') }}>
          Join business with invite link
        </button>
      ) : (
        <form onSubmit={joinByInvite} style={{ textAlign: 'left' }}>
          <label style={lbl}>INVITE LINK OR CODE</label>
          <input style={inp} value={inviteInput} autoFocus
            onChange={(e) => { setInviteInput(e.target.value); setJoinError('') }}
            placeholder="https://…/invite/ABC123  or  ABC123" />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="submit" style={{ ...primary, flex: 1 }}>Continue</button>
            <button type="button" style={ghost} onClick={() => { setShowJoin(false); setInviteInput(''); setJoinError('') }}>Cancel</button>
          </div>
          {joinError && <div style={{ marginTop: 8, color: 'var(--red-dark,#b3261e)', fontSize: 13 }}>{joinError}</div>}
          <div style={{ fontSize: 12, color: 'var(--text-4,#999)', marginTop: 10 }}>
            Don't have a code? Open the invite link from your email.
          </div>
        </form>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 18px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Personal Account</h1>
        <button onClick={() => { logout(); navigate('/login') }}
          style={{ background: 'none', border: 'none', color: 'var(--red,#d33)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Sign out</button>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-2,#6B7E92)', marginTop: 0, marginBottom: 22, lineHeight: 1.5 }}>
        {PERSONAL_V1
          ? 'Your personal financial workspace. Business workspaces are optional — create or join one below.'
          : 'Your personal login for CFO AI. Create a business or join one from an invitation.'}
      </p>

      {/* Personal finance (Phase 2) leads when enabled */}
      {PERSONAL_V1 && <PersonalDashboard token={token} />}

      {/* Business workspaces — demoted to a secondary block when personal finance is on */}
      {PERSONAL_V1 && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2,#6B7E92)', margin: '4px 0 8px' }}>Business workspaces</div>}

      {/* Onboarding / workspaces */}
      {businesses.length === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Create your first business workspace</div>
          <div style={{ fontSize: 14, color: 'var(--text-3,#777)', marginBottom: 18, lineHeight: 1.5 }}>
            Hi, {greeting}. Start a business to invite your team and track finances — or join a business you've been invited to.
          </div>
          <button style={{ ...primary, width: '100%', maxWidth: 320 }} onClick={() => navigate('/business/new')}>+ Create new business</button>
          <div style={{ maxWidth: 320, margin: '0 auto' }}>{joinBlock}</div>
        </div>
      ) : (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Your businesses</div>
            <button style={ghost} onClick={() => navigate('/business/new')}>+ Create another</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {businesses.map(b => (
              <div key={b.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-2,#e3e8ee)', background: 'var(--bg-2,#f7f9fb)' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text,#111)', fontSize: 14 }}>{b.name}</span>
                  <span style={{ display: 'block', color: 'var(--text-3,#888)', fontSize: 12, marginTop: 2 }}>
                    {b.business_code ? `Code ${b.business_code}` : ''}{b.business_code && b.role ? ' · ' : ''}{b.role || ''}
                  </span>
                </span>
                <button style={{ ...primary, padding: '8px 16px' }} onClick={() => openBusiness(b)}>Open</button>
              </div>
            ))}
          </div>
          {joinBlock}
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
            {/* Avatar: preview + upload (no manual URL). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="Your avatar"
                  style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-2,#e3e8ee)', background: 'var(--bg-2,#f7f9fb)' }} />
              ) : (
                <div aria-label="No avatar" style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brand,#3399FF)', color: '#fff', fontSize: 22, fontWeight: 700 }}>{initials}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickAvatar} style={{ display: 'none' }} />
                <button type="button" disabled={avatarBusy} style={{ ...ghost, padding: '8px 14px' }} onClick={() => fileRef.current?.click()}>
                  {avatarBusy ? 'Uploading…' : 'Upload photo'}
                </button>
                {form.avatar_url && !avatarBusy && (
                  <button type="button" style={{ background: 'none', border: 'none', color: 'var(--red,#d33)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0 }} onClick={removeAvatar}>Remove photo</button>
                )}
              </div>
            </div>
            {avatarError && <div style={{ marginTop: 8, color: 'var(--red-dark,#b3261e)', fontSize: 13 }}>{avatarError}</div>}
            <label style={lbl}>DISPLAY NAME</label>
            <input style={inp} value={form.display_name} onChange={set('display_name')} placeholder="Your name" />
            <label style={lbl}>LANGUAGE</label>
            <select style={inp} value={form.locale} onChange={set('locale')}>
              <option value="">—</option>{LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <label style={lbl}>TIMEZONE</label>
            <input style={inp} value={form.timezone} onChange={set('timezone')} list="profile-tz" placeholder="Asia/Jakarta" autoComplete="off" />
            <datalist id="profile-tz">{COMMON_TZ.map(tz => <option key={tz} value={tz} />)}</datalist>
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
