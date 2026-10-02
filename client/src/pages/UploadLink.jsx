// Upload page for AI assistants that cannot pass file bytes through a tool call.
// Reached from the MCP upload_document tool:   /upload#t=<token>
// The token (15 minutes, one user, one company) sits in the URL FRAGMENT so it never reaches a
// server log. The page requires the user to be signed in to CFO AI as the same account; the
// upload itself uses the ordinary Document Center flow (upload-init → storage → upload-complete)
// with all of its role / plan / membership checks. Nothing here approves or pays anything.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { uploadDocument, MAX_FILE_BYTES } from '../lib/documents'

const EMAIL_AUTH_UI = import.meta.env.VITE_EMAIL_AUTH_ENABLED === 'true'

const TEXT = {
  ru: {
    title: 'Загрузка документа в CFO AI',
    into: (c) => `Файл попадёт в Document Center компании ${c}.`,
    drop: 'Перетащите файл сюда или нажмите, чтобы выбрать',
    types: 'PDF, JPG, PNG, CSV или Excel, до 20 МБ',
    expires: (m) => `Ссылка действует ещё ${m} мин.`,
    loading: 'Проверяем ссылку…',
    storing: 'Загружаем файл…',
    creating: 'Сохраняем и распознаём…',
    done: (n) => `Готово: «${n}» загружен.`,
    back: 'Вернитесь в чат с ИИ и напишите, что файл загружен.',
    another: 'Загрузить ещё один',
    duplicate: 'Этот файл уже есть в CFO AI — второй раз он не сохраняется. Вернитесь в чат.',
    expired: 'Ссылка устарела или неверна. Попросите ИИ-ассистента выдать новую.',
    other: 'Эта ссылка выдана для другого аккаунта CFO AI. Войдите тем аккаунтом, из которого вы общаетесь с ИИ.',
    tooBig: 'Файл больше 20 МБ.',
    failed: 'Не удалось загрузить файл. Попробуйте ещё раз.',
    notYou: 'Это не вы? Выйти',
    note: 'Загрузка только сохраняет документ. Ничего не подтверждается и не оплачивается.',
  },
  en: {
    title: 'Upload a document to CFO AI',
    into: (c) => `The file goes to the Document Center of ${c}.`,
    drop: 'Drop the file here or click to choose',
    types: 'PDF, JPG, PNG, CSV or Excel, up to 20 MB',
    expires: (m) => `This link works for ${m} more min.`,
    loading: 'Checking the link…',
    storing: 'Uploading the file…',
    creating: 'Saving and reading it…',
    done: (n) => `Done: "${n}" is uploaded.`,
    back: 'Go back to your AI chat and say the file is uploaded.',
    another: 'Upload another one',
    duplicate: 'This file is already in CFO AI, so it is not stored twice. Go back to the chat.',
    expired: 'This link has expired or is not valid. Ask your AI assistant for a new one.',
    other: 'This link was issued for a different CFO AI account. Sign in with the account you use with your AI assistant.',
    tooBig: 'The file is larger than 20 MB.',
    failed: 'The file could not be uploaded. Please try again.',
    notYou: 'Not you? Sign out',
    note: 'Uploading only stores the document. Nothing is approved or paid.',
  },
}
const lang = () => (typeof navigator !== 'undefined' && /^ru/i.test(navigator.language || '') ? 'ru' : 'en')
const tokenFromHash = () => {
  try { return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') || '' } catch { return '' }
}

export default function UploadLink() {
  const t = TEXT[lang()]
  const { user, token, loading, logout } = useAuth()
  const navigate = useNavigate()
  const [linkToken] = useState(tokenFromHash)
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [stage, setStage] = useState('')
  const [done, setDone] = useState(null)
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef(null)

  const goSignIn = () => {
    try { localStorage.setItem('post_login_redirect', `/upload#t=${linkToken}`) } catch { /* private mode */ }
    navigate(EMAIL_AUTH_UI ? '/login/email' : '/login', { replace: true })
  }

  // Ask the server what this link is for. Run again right before every upload so an expired
  // link stops working even if the page was left open.
  const checkSession = async () => {
    const r = await fetch('/api/upload-link/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: linkToken }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) { logout(); goSignIn(); return null }
    if (r.status === 410 || r.status === 404) { setError(t.expired); return null }
    if (r.status === 403 && d.error === 'link_for_another_account') { setError(t.other); return null }
    if (!r.ok) { setError(d.error && /enabled/i.test(d.error) ? d.error : t.failed); return null }
    setSession(d)
    return d
  }

  useEffect(() => {
    if (loading) return
    if (!linkToken) { setError(t.expired); return }
    if (!user || !token) { goSignIn(); return }
    checkSession().catch(() => setError(t.failed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token, linkToken])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  const onFile = async (file) => {
    if (!file || stage) return
    setError(''); setDone(null)
    if (file.size > MAX_FILE_BYTES) { setError(t.tooBig); return }
    try {
      const s = await checkSession()
      if (!s) return
      setStage('storing')
      const link = s.link ? { target_type: s.link.target_type, target_id: s.link.target_id } : null
      const r = await uploadDocument(token, file, { document_type: s.document_type || undefined, upload_source: 'ai_assistant' },
        link, (st) => setStage(st), { businessId: s.company.id })
      setDone({ name: file.name, id: r && r.document && r.document.id })
    } catch (e) {
      if (e && e.status === 409 && e.data && e.data.duplicate) setError(t.duplicate)
      else setError(t.failed)
    } finally {
      setStage('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const minutesLeft = session ? Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - now) / 60000)) : null
  const muted = { fontSize: 13, color: 'var(--text-3, #777)' }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '48px 20px' }}>
      <img src="/brand/logo_main_navy_transparent_2400.png" alt="CFO AI — Financial OS"
        style={{ height: 48, width: 'auto', maxWidth: '70vw', objectFit: 'contain', display: 'block', marginBottom: 24 }} />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 14 }}>{t.title}</h1>

      {!session && !error && <p style={muted}>{t.loading}</p>}

      {session && (
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{t.into(session.company.name || '—')}</p>
          <p style={{ ...muted, marginBottom: 16 }}>{minutesLeft > 0 ? t.expires(minutesLeft) : t.expired}</p>

          {!done && minutesLeft > 0 && (
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files && e.dataTransfer.files[0]) }}
              style={{ display: 'block', border: '2px dashed var(--border-strong, #C2CFDB)', borderRadius: 16, padding: '36px 18px',
                textAlign: 'center', cursor: stage ? 'default' : 'pointer', background: 'var(--surface-card, #fff)' }}>
              <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xls,.xlsx" style={{ display: 'none' }}
                disabled={!!stage} onChange={(e) => onFile(e.target.files && e.target.files[0])} />
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{stage ? t[stage] || t.storing : t.drop}</div>
              <div style={muted}>{t.types}</div>
            </label>
          )}

          {done && (
            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--success-soft, #E5F4EE)', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--success, #0F7A52)', marginBottom: 4 }}>{t.done(done.name)}</div>
              <div style={{ fontSize: 14 }}>{t.back}</div>
              {minutesLeft > 0 && (
                <button onClick={() => setDone(null)}
                  style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--text-link, #1565C0)', padding: 0, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
                  {t.another}
                </button>
              )}
            </div>
          )}

          <p style={{ ...muted, fontSize: 12, marginTop: 16 }}>{t.note}</p>
          <p style={{ ...muted, marginTop: 6 }}>
            {user?.firstName ? `${user.firstName} · ` : ''}
            <button onClick={() => { logout(); goSignIn() }}
              style={{ background: 'none', border: 'none', color: 'var(--text-link, #1565C0)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
              {t.notYou}
            </button>
          </p>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: '9px 13px', borderRadius: 8, background: 'var(--danger-soft, #FBEAEA)', color: 'var(--danger, #C62828)', fontSize: 13 }}>{error}</div>
      )}
    </div>
  )
}
