import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Email sign-in is a SECONDARY option, shown only when the flag is on. Telegram stays
// primary and its auth flow is unchanged.
const EMAIL_AUTH_UI = import.meta.env.VITE_EMAIL_AUTH_ENABLED === 'true'

export default function Login() {
  const { loginWithTelegram, user } = useAuth()
  const navigate = useNavigate()
  const tgRef = useRef(null)

  useEffect(() => {
    if (user) { navigate('/'); return }

    // Telegram Login Widget (auth flow unchanged)
    window.onTelegramAuth = async (data) => {
      try {
        await loginWithTelegram(data)
        navigate('/')
      } catch (e) {
        alert('Auth error: ' + e.message)
      }
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', import.meta.env.VITE_BOT_USERNAME || 'YourBot')
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '10')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgRef.current?.appendChild(script)

    return () => { delete window.onTelegramAuth }
  }, [user])

  return (
    // Fill #root (which is display:flex) so the panel truly centers instead of
    // collapsing to content width in the lower-left corner.
    <div style={{ flex: 1, width: '100%', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <img src="/brand/logo_main_navy_transparent_2400.png" alt="CFO AI — Financial OS"
          style={{ height: 56, width: 'auto', maxWidth: '70vw', objectFit: 'contain', marginBottom: 14 }} />
        <div style={{ fontSize: 14, color: 'var(--text-2, #6B7E92)', lineHeight: 1.5, marginBottom: 28 }}>
          Financial clarity for entrepreneurs
        </div>

        {/* Telegram widget (primary) */}
        <div ref={tgRef} style={{ minHeight: 48, display: 'flex', justifyContent: 'center' }} />

        {/* Email sign-in (secondary) — only when VITE_EMAIL_AUTH_ENABLED=true */}
        {EMAIL_AUTH_UI && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 280, margin: '18px 0 14px' }}>
              <div style={{ flex: 1, height: 0.5, background: 'var(--border-2)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>or</span>
              <div style={{ flex: 1, height: 0.5, background: 'var(--border-2)' }} />
            </div>
            <button
              onClick={() => navigate('/login/email')}
              style={{ width: '100%', maxWidth: 280, padding: '12px', borderRadius: 10, border: '0.5px solid var(--border-2)', background: 'none', fontSize: 14, color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Sign in with email
            </button>
          </>
        )}

        {/* Language selector */}
        <div style={{ marginTop: 28, display: 'flex', gap: 8 }}>
          {['EN', 'RU', 'ID'].map(l => (
            <button key={l} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
