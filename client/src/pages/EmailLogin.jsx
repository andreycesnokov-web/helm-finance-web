// Email login / register (Phase 1 — OTP). Behind VITE_EMAIL_AUTH_ENABLED; the backend
// is also gated by EMAIL_AUTH_ENABLED. No personal finance here — identity only. On
// success stores the JWT exactly like Telegram login (useAuth.loginWithToken).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailLogin() {
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)       // 1 = email, 2 = code
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devCode, setDevCode] = useState('') // shown only if the backend returns dev_code

  const start = async (e) => {
    e?.preventDefault?.()
    const em = email.trim().toLowerCase()
    if (!EMAIL_RE.test(em)) { setError('Enter a valid email address.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth/email/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 404) { setError('Email sign-in is not available.'); return }
      if (!res.ok) { setError(data.error === 'rate_limited' ? 'Too many requests. Try again later.' : 'Could not send the code.'); return }
      setEmail(em); setStep(2)
      if (data.dev_code) setDevCode(data.dev_code) // local/dev convenience only
    } catch { setError('Network error. Please try again.') }
    finally { setBusy(false) }
  }

  const verify = async (e) => {
    e?.preventDefault?.()
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth/email/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) {
        setError(data.error === 'invalid_or_expired_code' ? 'Invalid or expired code.' : 'Verification failed.')
        return
      }
      loginWithToken(data.token, data.user ? { id: data.user.id, firstName: data.user.display_name } : null)
      navigate('/account')
    } catch { setError('Network error. Please try again.') }
    finally { setBusy(false) }
  }

  const inp = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-2, #ccc)', background: 'var(--bg, #fff)', color: 'var(--text, #111)', fontSize: 15, fontFamily: 'inherit' }
  const btn = (enabled) => ({ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: enabled ? 'var(--brand, #3399FF)' : 'var(--bg-3, #ddd)', color: enabled ? '#fff' : 'var(--text-4, #999)', fontSize: 15, fontWeight: 600, cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit' })

  return (
    <div style={{ maxWidth: 380, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Sign in with email</h1>
      <p style={{ fontSize: 14, color: 'var(--text-3, #777)', marginBottom: 24 }}>
        We'll email you a 6-digit code. New here? Your Personal Account is created automatically.
      </p>

      {step === 1 && (
        <form onSubmit={start}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2, #555)' }}>EMAIL</label>
          <input style={{ ...inp, margin: '6px 0 14px' }} type="email" value={email} autoFocus
            onChange={e => { setEmail(e.target.value); setError('') }} placeholder="you@company.com" />
          <button type="submit" style={btn(!busy)} disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={verify}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2, #555)' }}>6-DIGIT CODE</label>
          <input style={{ ...inp, margin: '6px 0 14px', letterSpacing: 4, textAlign: 'center', fontSize: 20 }}
            inputMode="numeric" maxLength={6} value={code} autoFocus
            onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} placeholder="••••••" />
          <button type="submit" style={btn(!busy)} disabled={busy}>{busy ? 'Verifying…' : 'Verify & sign in'}</button>
          <button type="button" onClick={() => { setStep(1); setCode(''); setError('') }}
            style={{ ...btn(true), background: 'none', color: 'var(--text-3, #777)', marginTop: 8, fontWeight: 500 }}>
            Use a different email
          </button>
          {devCode && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3,#777)' }}>Dev code: <b>{devCode}</b></div>}
        </form>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '9px 13px', borderRadius: 8, background: 'var(--red-light, #fdecea)', color: 'var(--red-dark, #b3261e)', fontSize: 13 }}>{error}</div>
      )}
    </div>
  )
}
