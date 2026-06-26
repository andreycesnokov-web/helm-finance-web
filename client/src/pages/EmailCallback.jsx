// Magic-link callback (Phase 1). Reads ?token= from the URL, verifies it with the
// backend, stores the JWT via the existing hf_token flow, and redirects to /account.
// Behind VITE_EMAIL_AUTH_ENABLED (route gating in App.jsx).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function EmailCallback() {
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) { setError('Missing sign-in token.'); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/email/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !data.token) {
          setError(String(data.error || '').includes('invalid_or_expired') ? 'This sign-in link is invalid or has expired. Please request a new one.' : 'Sign-in failed.')
          return
        }
        loginWithToken(data.token, data.user ? { id: data.user.id, firstName: data.user.display_name } : null)
        navigate('/account')
      } catch { if (!cancelled) setError('Network error. Please try again.') }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line

  return (
    <div style={{ maxWidth: 380, margin: '0 auto', padding: '64px 20px', textAlign: 'center' }}>
      {!error ? (
        <div style={{ color: 'var(--text-3, #777)', fontSize: 15 }}>Signing you in…</div>
      ) : (
        <div>
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--red-light, #fdecea)', color: 'var(--red-dark, #b3261e)', fontSize: 14, marginBottom: 16 }}>{error}</div>
          <button onClick={() => navigate('/login/email')}
            style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--brand, #3399FF)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Back to sign in
          </button>
        </div>
      )}
    </div>
  )
}
