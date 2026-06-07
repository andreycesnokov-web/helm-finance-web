import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { loginWithTelegram, user } = useAuth()
  const navigate = useNavigate()
  const tgRef = useRef(null)

  useEffect(() => {
    if (user) { navigate('/'); return }

    // Telegram Login Widget
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
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="14" fill="#1a1a1a"/>
            <path d="M14 26l6 6 14-14" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Helm Finance</div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>Financial clarity for entrepreneurs</div>
      </div>

      <div ref={tgRef} style={{ marginBottom: 20 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 280, margin: '12px 0' }}>
        <div style={{ flex: 1, height: 0.5, background: 'var(--border-2)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>or</span>
        <div style={{ flex: 1, height: 0.5, background: 'var(--border-2)' }} />
      </div>

      <button
        style={{ width: 280, padding: '12px', borderRadius: 10, border: '0.5px solid var(--border-2)', background: 'none', fontSize: 14, color: 'var(--text-2)' }}
        onClick={() => alert('Email login coming soon')}
      >
        Sign in with email
      </button>

      <div style={{ marginTop: 32, display: 'flex', gap: 8 }}>
        {['EN', 'RU', 'ID'].map(l => (
          <button key={l} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text-2)' }}>{l}</button>
        ))}
      </div>
    </div>
  )
}
