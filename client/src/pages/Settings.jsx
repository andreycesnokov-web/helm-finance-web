import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const LANGUAGES = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
]

const TIMEZONES = [
  { value: 'Asia/Makassar', label: 'Bali (WITA, UTC+8)' },
  { value: 'Asia/Jakarta', label: 'Jakarta (WIB, UTC+7)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK, UTC+3)' },
  { value: 'UTC', label: 'UTC' },
]

export default function Settings() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [lang, setLang] = useState(localStorage.getItem('hf_lang') || 'ru')
  const [timezone, setTimezone] = useState(localStorage.getItem('hf_tz') || 'Asia/Makassar')
  const [notifications, setNotifications] = useState(localStorage.getItem('hf_notif') !== 'false')
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const handleLang = (code) => { setLang(code); localStorage.setItem('hf_lang', code) }
  const handleTz = (val) => { setTimezone(val); localStorage.setItem('hf_tz', val) }
  const handleNotif = () => { const n = !notifications; setNotifications(n); localStorage.setItem('hf_notif', String(n)) }
  const handleLogout = () => { logout(); navigate('/login') }

  const initials = user?.first_name?.[0] || 'A'
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ')

  return (
    <div className="page">
      <div className="topbar">
        <button onClick={() => navigate(-1)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-2)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Settings</div>
        <div style={{ width: 32 }} />
      </div>

      {/* Profile */}
      <div style={{ margin: '4px 16px 20px', background: 'var(--text)', borderRadius: 16, padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
        {user?.photo_url
          ? <img src={user.photo_url} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover' }} />
          : <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#B5D4F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 600, color: '#0C447C', flexShrink: 0 }}>{initials}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{fullName || 'User'}</div>
          {user?.username && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>@{user.username}</div>}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '3px 10px' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>✓ Telegram connected</span>
          </div>
        </div>
      </div>

      {/* Language */}
      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Language</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12, overflow: 'hidden' }}>
        {LANGUAGES.map((l, i) => (
          <div key={l.code} onClick={() => handleLang(l.code)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: i < LANGUAGES.length - 1 ? '0.5px solid var(--border)' : 'none', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{l.flag}</span>
              <span style={{ fontSize: 14, color: 'var(--text)' }}>{l.label}</span>
            </div>
            {lang === l.code && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
          </div>
        ))}
      </div>

      {/* Timezone */}
      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Timezone</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12, overflow: 'hidden' }}>
        {TIMEZONES.map((tz, i) => (
          <div key={tz.value} onClick={() => handleTz(tz.value)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: i < TIMEZONES.length - 1 ? '0.5px solid var(--border)' : 'none', cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>{tz.label}</span>
            {timezone === tz.value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
          </div>
        ))}
      </div>

      {/* Notifications */}
      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Notifications</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12 }}>
        <div onClick={handleNotif} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', cursor: 'pointer' }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 2 }}>Push notifications</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Reminders and debt alerts</div>
          </div>
          <div style={{ width: 44, height: 26, borderRadius: 13, background: notifications ? 'var(--text)' : 'var(--border-2)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 3, left: notifications ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
        </div>
      </div>

      {/* Telegram bot */}
      <div style={{ margin: '0 16px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Telegram Bot</div>
      <div style={{ margin: '0 16px 16px', background: 'var(--bg-2)', borderRadius: 12 }}>
        <a href="https://t.me/HCfinance_Bot" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#229ED9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.008 9.457c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.871.764z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 1 }}>Open @HCfinance_Bot</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Add transactions via chat</div>
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 0 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>

      {/* Logout */}
      <div style={{ margin: '0 16px 16px' }}>
        <button onClick={() => setShowLogoutConfirm(true)} style={{ width: '100%', padding: 13, borderRadius: 12, background: 'none', color: 'var(--red)', border: '0.5px solid var(--red)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>

      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', paddingBottom: 32 }}>Helm Finance · v1.0</div>

      {showLogoutConfirm && (
        <div onClick={() => setShowLogoutConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', maxWidth: 430, margin: '0 auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%' }}>
            <div style={{ width: 36, height: 3, background: 'var(--border-2)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Sign out?</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>You'll need to log in via Telegram again.</div>
            <button onClick={handleLogout} style={{ width: '100%', padding: 13, borderRadius: 10, background: 'var(--red)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Sign out</button>
            <button onClick={() => setShowLogoutConfirm(false)} style={{ width: '100%', padding: 11, borderRadius: 10, background: 'none', color: 'var(--text-3)', border: '0.5px solid var(--border)', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}