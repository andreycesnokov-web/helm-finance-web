// "Sign in with CFO AI" — consent screen for AI clients (Claude Connectors, ChatGPT,
// Claude Code). Reached from the MCP authorization server's /authorize redirect:
//   /oauth/consent?request=<id>
// The user signs in with the EXISTING CFO login (post_login_redirect brings them back here),
// sees which client asks for what, and Allows or Denies. The server then returns a one-time
// code to the client's registered callback. Nothing here creates or changes financial data.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const EMAIL_AUTH_UI = import.meta.env.VITE_EMAIL_AUTH_ENABLED === 'true'

const TEXT = {
  ru: {
    title: 'Подключение к CFO AI',
    asks: (c) => `${c} запрашивает доступ к вашему аккаунту CFO AI`,
    willRead: 'Что будет доступно:',
    read: 'Читать: компании, финансовая сводка, недостающие документы и разбор инвойсов.',
    drafts: 'Создавать черновики счетов к оплате из инвойсов, которые вы отправите. Черновик ждёт вашего подтверждения в CFO AI: ничего не оплачивается, а деньги, долги и runway не меняются, пока вы его не подтвердите.',
    readOnlyNote: 'Ничего нельзя создать, изменить или удалить.',
    noDeleteNote: 'Ничего нельзя оплатить, изменить или удалить.',
    returnTo: (h) => `После решения вы вернётесь на ${h}.`,
    signedIn: (n) => (n ? `Вы вошли как ${n}.` : 'Вы вошли в CFO AI.'),
    notYou: 'Это не вы? Выйти',
    allow: 'Разрешить',
    deny: 'Отклонить',
    working: 'Подождите…',
    loading: 'Загрузка…',
    invalid: 'Ссылка на подключение неверная.',
    expired: 'Запрос на подключение устарел или уже использован. Начните подключение заново в приложении.',
    failed: 'Не удалось загрузить запрос. Попробуйте ещё раз.',
    revokeHint: 'Отключить доступ можно в любой момент в настройках коннекторов вашего ИИ-клиента.',
  },
  en: {
    title: 'Connect to CFO AI',
    asks: (c) => `${c} wants to access your CFO AI account`,
    willRead: 'It will be able to:',
    read: 'Read your companies, financial summary, missing documents and invoice analyses.',
    drafts: 'Create payable drafts from invoices you send. A draft waits for your approval in CFO AI: nothing is paid, and your cash, payables and runway do not change until you approve it.',
    readOnlyNote: 'Nothing can be created, changed or deleted.',
    noDeleteNote: 'Nothing can be paid, changed or deleted.',
    returnTo: (h) => `After you decide, you will return to ${h}.`,
    signedIn: (n) => (n ? `Signed in as ${n}.` : 'You are signed in to CFO AI.'),
    notYou: 'Not you? Sign out',
    allow: 'Allow',
    deny: 'Deny',
    working: 'Please wait…',
    loading: 'Loading…',
    invalid: 'This connection link is not valid.',
    expired: 'This connection request has expired or was already used. Start connecting again from the app.',
    failed: 'Could not load the request. Please try again.',
    revokeHint: 'You can disconnect at any time in your AI client\'s connector settings.',
  },
}
const lang = () => (typeof navigator !== 'undefined' && /^ru/i.test(navigator.language || '') ? 'ru' : 'en')

export default function OAuthConsent() {
  const t = TEXT[lang()]
  const { user, token, loading, logout } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestId = params.get('request') || ''
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const goSignIn = () => {
    try { localStorage.setItem('post_login_redirect', `/oauth/consent?request=${encodeURIComponent(requestId)}`) } catch { /* private mode */ }
    navigate(EMAIL_AUTH_UI ? '/login/email' : '/login', { replace: true })
  }

  useEffect(() => {
    if (loading) return
    if (!requestId) { setError(t.invalid); return }
    if (!user || !token) { goSignIn(); return }
    let cancelled = false
    fetch(`/api/mcp-oauth/requests/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.status === 401) { logout(); goSignIn(); return }
        if (r.status === 410) { setError(t.expired); return }
        if (!r.ok) { setError(t.failed); return }
        setInfo(d)
      })
      .catch(() => { if (!cancelled) setError(t.failed) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token, requestId])

  const decide = async (approve) => {
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/mcp-oauth/requests/${encodeURIComponent(requestId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approve }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 410) { setError(t.expired); setBusy(false); return }
      if (!r.ok || !d.redirect_to) { setError(t.failed); setBusy(false); return }
      window.location.assign(d.redirect_to) // back to the AI client's registered callback
    } catch { setError(t.failed); setBusy(false) }
  }

  const btn = (primary, enabled) => ({
    flex: 1, padding: 13, borderRadius: 10, fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
    cursor: enabled ? 'pointer' : 'default',
    border: primary ? 'none' : '1px solid var(--border-2, #ccc)',
    background: primary ? (enabled ? 'var(--brand, #3399FF)' : 'var(--bg-3, #ddd)') : 'var(--bg, #fff)',
    color: primary ? (enabled ? '#fff' : 'var(--text-4, #999)') : 'var(--text, #111)',
  })
  const muted = { fontSize: 13, color: 'var(--text-3, #777)' }
  // What the server will actually grant (it drops cfo:drafts while write tools are off).
  const canDraft = !!(info && Array.isArray(info.scopes) && info.scopes.some((s) => s.scope === 'cfo:drafts'))

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 20px' }}>
      <img src="/brand/logo_main_navy_transparent_2400.png" alt="CFO AI — Financial OS"
        style={{ height: 48, width: 'auto', maxWidth: '70vw', objectFit: 'contain', display: 'block', marginBottom: 24 }} />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>{t.title}</h1>

      {!info && !error && <p style={muted}>{t.loading}</p>}

      {info && (
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>{t.asks(info.client_name)}</p>
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-2, #f4f6f8)', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2, #555)', marginBottom: 6 }}>{t.willRead}</div>
            <ul style={{ fontSize: 14, color: 'var(--text-2, #555)', margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 4 }}>{t.read}</li>
              {canDraft && <li style={{ marginBottom: 4 }}>{t.drafts}</li>}
            </ul>
            <div style={{ fontSize: 13, color: 'var(--text-3, #777)', marginTop: 8 }}>{canDraft ? t.noDeleteNote : t.readOnlyNote}</div>
          </div>
          <p style={{ ...muted, marginBottom: 6 }}>{t.returnTo(info.redirect_host)}</p>
          <p style={{ ...muted, marginBottom: 18 }}>
            {t.signedIn(user?.firstName)}{' '}
            <button onClick={() => { logout(); goSignIn() }}
              style={{ background: 'none', border: 'none', color: 'var(--brand, #3399FF)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
              {t.notYou}
            </button>
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btn(false, !busy)} disabled={busy} onClick={() => decide(false)}>{t.deny}</button>
            <button style={btn(true, !busy)} disabled={busy} onClick={() => decide(true)}>{busy ? t.working : t.allow}</button>
          </div>
          <p style={{ ...muted, fontSize: 12, marginTop: 16 }}>{t.revokeHint}</p>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '9px 13px', borderRadius: 8, background: 'var(--red-light, #fdecea)', color: 'var(--red-dark, #b3261e)', fontSize: 13 }}>{error}</div>
      )}
    </div>
  )
}
