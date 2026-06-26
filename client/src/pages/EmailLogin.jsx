// Email login / register — MAGIC-LINK FIRST (Phase 1). Behind VITE_EMAIL_AUTH_ENABLED;
// backend also gated by EMAIL_AUTH_ENABLED. Primary: "Send sign-in link" → user clicks
// the emailed link (/login/email/callback?token=…). Secondary: manual 6-digit code.
// In local dev (backend EMAIL_AUTH_DEV_RETURN_CODE) the link + code are shown for testing.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailLogin() {
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)       // 1 = email, 2 = link sent
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devLink, setDevLink] = useState('')  // local dev only
  const [devCode, setDevCode] = useState('')  // local dev only

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
      if (!res.ok) { setError(data.error === 'rate_limited' ? 'Too many requests. Try again later.' : 'Could not send the link.'); return }
      setEmail(em); setStep(2)
      if (data.magic_link) setDevLink(data.magic_link) // local/dev convenience only
      if (data.dev_code) setDevCode(data.dev_code)
    } catch { setError('Network error. Please try again.') }
    finally { setBusy(false) }
  }

  const verifyCode = async (e) => {
    e?.preventDefault?.()
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth/email/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) {
        setError(data.error?.includes('invalid_or_expired') ? 'Invalid or expired code.' : 'Verification failed.')
        return
      }
      loginWithToken(data.token, data.user ? { id: data.user.id, firstName: data.user.display_name } : null)
      navigate('/account')
    } catch { setError('Network error. Please try again.') }
    finally { setBusy(false) }
  }

  const inp = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-2, #ccc)', background: 'var(--bg, #fff)', color: 'var(--text, #111)', fontSize: 15, fontFamily: 'inherit' }
  const btn = (enabled) => ({ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: enabled ? 'var(--brand, #3399FF)' : 'var(--bg-3, #ddd)', color: enabled ? '#fff' : 'var(--text-4, #999)', fontSize: 15, fontWeight: 600, cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit' })
  const linkBtn = { background: 'none', border: 'none', color: 'var(--brand, #3399FF)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: 380, margin: '0 auto', padding: '48px 20px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Sign in with email</h1>
      <p style={{ fontSize: 14, color: 'var(--text-3, #777)', marginBottom: 24 }}>
        We'll email you a secure sign-in link. New here? Your Personal Account is created automatically.
      </p>

      {step === 1 && (
        <form onSubmit={start}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2, #555)' }}>EMAIL</label>
          <input style={{ ...inp, margin: '6px 0 14px' }} type="email" value={email} autoFocus
            onChange={e => { setEmail(e.target.value); setError('') }} placeholder="you@company.com" />
          <button type="submit" style={btn(!busy)} disabled={busy}>{busy ? 'Sending…' : 'Send sign-in link'}</button>
        </form>
      )}

      {step === 2 && (
        <div>
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-2, #f4f6f8)', fontSize: 14, color: 'var(--text-2, #555)', marginBottom: 16 }}>
            Check your email for a sign-in link.<br />
            <span style={{ color: 'var(--text-3, #777)' }}>Sent to <b>{email}</b>. Click the link on this device to finish signing in.</span>
          </div>

          {!showCode && (
            <button style={linkBtn} onClick={() => setShowCode(true)}>Enter a 6-digit code instead</button>
          )}

          {showCode && (
            <form onSubmit={verifyCode} style={{ marginTop: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2, #555)' }}>6-DIGIT CODE (fallback)</label>
              <input style={{ ...inp, margin: '6px 0 12px', letterSpacing: 4, textAlign: 'center', fontSize: 20 }}
                inputMode="numeric" maxLength={6} value={code} autoFocus
                onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} placeholder="••••••" />
              <button type="submit" style={btn(!busy)} disabled={busy}>{busy ? 'Verifying…' : 'Verify code'}</button>
            </form>
          )}

          <div style={{ marginTop: 14 }}>
            <button style={linkBtn} onClick={() => { setStep(1); setCode(''); setShowCode(false); setDevLink(''); setDevCode(''); setError('') }}>
              Use a different email
            </button>
          </div>

          {(devLink || devCode) && (
            <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 8, background: '#fff8e1', fontSize: 12, color: '#7a5d00' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Local dev only</div>
              {devLink && <div style={{ wordBreak: 'break-all' }}>Magic link: <a href={devLink}>{devLink}</a></div>}
              {devCode && <div>Code: <b>{devCode}</b></div>}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '9px 13px', borderRadius: 8, background: 'var(--red-light, #fdecea)', color: 'var(--red-dark, #b3261e)', fontSize: 13 }}>{error}</div>
      )}
    </div>
  )
}
