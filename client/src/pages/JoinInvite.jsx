import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

const ROLE_LABELS = {
  owner: 'Owner', admin: 'Admin', cfo: 'CFO', manager: 'Manager', employee: 'Employee',
}

export default function JoinInvite() {
  const { code }                     = useParams()
  const { user, token, loginWithTelegram } = useAuth()
  const navigate                     = useNavigate()
  const tgRef                        = useRef(null)

  const [invite,  setInvite]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [joining, setJoining] = useState(false)
  const [joined,  setJoined]  = useState(false)

  // Load invite info (public — no auth needed)
  useEffect(() => {
    fetch(`/api/invite/${code.toUpperCase()}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setInvite(d)
      })
      .catch(() => setError('Could not load invite'))
      .finally(() => setLoading(false))
  }, [code])

  // Once user is authenticated, accept the invite automatically
  useEffect(() => {
    if (!user || !token || !invite || joined) return
    acceptInvite()
  }, [user, token, invite])

  const acceptInvite = async () => {
    if (joining || joined) return
    setJoining(true)
    try {
      await apiFetch(`/invite/${code.toUpperCase()}/accept`, token, { method: 'POST' })
      setJoined(true)
      setTimeout(() => navigate('/'), 2000)
    } catch (e) {
      setError(e.message)
    }
    setJoining(false)
  }

  // Mount Telegram Login Widget (only shown when not yet logged in)
  useEffect(() => {
    if (user || !tgRef.current || !invite) return

    window.onTelegramAuth = async (data) => {
      try {
        await loginWithTelegram(data)
        // acceptInvite() will be triggered by the useEffect above
      } catch (e) {
        setError('Auth error: ' + e.message)
      }
    }

    // Clear previous script
    tgRef.current.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', import.meta.env.VITE_BOT_USERNAME || 'YourBot')
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '10')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgRef.current.appendChild(script)

    return () => { delete window.onTelegramAuth }
  }, [user, invite])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', background: 'var(--bg)' }}>

      {/* Logo */}
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 12 }}>
          <rect width="48" height="48" rx="14" fill="#1a1a1a"/>
          <rect x="8" y="26" width="6" height="12" rx="1.5" fill="rgba(255,255,255,0.45)"/>
          <rect x="18" y="20" width="6" height="18" rx="1.5" fill="rgba(255,255,255,0.7)"/>
          <rect x="28" y="13" width="6" height="25" rx="1.5" fill="#fff"/>
          <path d="M34.5 13L36 11" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="36.5" cy="10.5" r="1" fill="rgba(255,255,255,0.4)"/>
        </svg>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>CFO AI</div>
      </div>

      {loading && (
        <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Loading invite…</div>
      )}

      {!loading && error && (
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Invite not available</div>
          <div style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>{error}</div>
          <button onClick={() => navigate('/')}
            style={{ padding: '12px 28px', borderRadius: 12, background: 'var(--text)', color: 'var(--bg)', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            Go to Home
          </button>
        </div>
      )}

      {!loading && !error && invite && (
        <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>

          {/* Invite card */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px', marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              You're invited to join
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>
              {invite.business_name}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E3F2FD', padding: '5px 14px', borderRadius: 20 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1565C0' }}>
                Role: {ROLE_LABELS[invite.role] || invite.role}
              </span>
            </div>
            {invite.label && (
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>{invite.label}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 10 }}>
              Expires {new Date(invite.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {invite.uses_left !== undefined && ` · ${invite.uses_left} use${invite.uses_left !== 1 ? 's' : ''} remaining`}
            </div>
          </div>

          {/* Joined state */}
          {joined && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>You've joined {invite.business_name}!</div>
              <div style={{ fontSize: 14, color: 'var(--text-3)' }}>Redirecting to dashboard…</div>
            </div>
          )}

          {/* Accepting invite */}
          {!joined && joining && (
            <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Joining team…</div>
          )}

          {/* Already logged in, not yet joined */}
          {!joined && !joining && user && (
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
                Logged in as <b>{user.firstName || user.first_name}</b>
              </div>
              <button onClick={acceptInvite}
                style={{ width: '100%', padding: '14px', borderRadius: 12, background: 'var(--text)', color: 'var(--bg)', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                Join {invite.business_name}
              </button>
            </div>
          )}

          {/* Not logged in — show Telegram widget */}
          {!joined && !user && (
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 16 }}>
                Sign in with Telegram to join the team
              </div>
              <div ref={tgRef} style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }} />
              <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 8 }}>
                You'll automatically join <b>{invite.business_name}</b> after signing in
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
