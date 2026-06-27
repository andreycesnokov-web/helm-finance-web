import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import TelegramLoginWidget from '../components/TelegramLoginWidget'

// Email is the PRIMARY login when enabled. Telegram becomes legacy access (a small
// secondary link → /login/telegram). When the flag is OFF, /login keeps the old
// Telegram-widget-first behavior. Telegram auth flow itself is unchanged.
const EMAIL_AUTH_UI = import.meta.env.VITE_EMAIL_AUTH_ENABLED === 'true'

export default function Login() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Already signed in → home (covers the email-first branch which doesn't mount the widget).
  useEffect(() => { if (user) navigate('/') }, [user]) // eslint-disable-line

  const panel = {
    flex: 1, width: '100%', minHeight: '100dvh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '32px 20px', boxSizing: 'border-box',
  }
  const inner = { width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }
  const primaryBtn = { width: '100%', maxWidth: 280, padding: '13px', borderRadius: 10, border: 'none', background: 'var(--brand, #3399FF)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const linkBtn = { marginTop: 16, background: 'none', border: 'none', color: 'var(--text-3, #777)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }

  return (
    <div style={panel}>
      <div style={inner}>
        <img src="/brand/logo_main_navy_transparent_2400.png" alt="CFO AI — Financial OS"
          style={{ height: 56, width: 'auto', maxWidth: '70vw', objectFit: 'contain', marginBottom: 14 }} />
        <div style={{ fontSize: 14, color: 'var(--text-2, #6B7E92)', lineHeight: 1.5, marginBottom: 28 }}>
          Financial clarity for entrepreneurs
        </div>

        {EMAIL_AUTH_UI ? (
          <>
            {/* PRIMARY: email / magic link */}
            <button style={primaryBtn} onClick={() => navigate('/login/email')}>Sign in with email</button>
            <div style={{ fontSize: 12, color: 'var(--text-3, #999)', marginTop: 8 }}>We'll email you a secure sign-in link.</div>
            {/* SECONDARY: legacy Telegram */}
            <button style={linkBtn} onClick={() => navigate('/login/telegram')}>
              Existing Telegram user? Use legacy Telegram login
            </button>
          </>
        ) : (
          /* Flag OFF → old behavior: Telegram widget is primary */
          <TelegramLoginWidget />
        )}

        <div style={{ marginTop: 28, display: 'flex', gap: 8 }}>
          {['EN', 'RU', 'ID'].map(l => (
            <button key={l} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
