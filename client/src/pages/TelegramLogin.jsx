// Legacy Telegram login (/login/telegram). For EXISTING Telegram users only — Telegram
// is no longer the primary signup. Renders the same Telegram widget (unchanged auth flow)
// via the shared component. Registered only when VITE_EMAIL_AUTH_ENABLED=true (when off,
// /login itself already shows the widget).
import { useNavigate } from 'react-router-dom'
import TelegramLoginWidget from '../components/TelegramLoginWidget'

export default function TelegramLogin() {
  const navigate = useNavigate()
  return (
    <div style={{ flex: 1, width: '100%', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <img src="/brand/logo_main_navy_transparent_2400.png" alt="CFO AI — Financial OS"
          style={{ height: 48, width: 'auto', maxWidth: '64vw', objectFit: 'contain', marginBottom: 18 }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text, #111)', marginBottom: 4 }}>Legacy Telegram login</div>
        <div style={{ fontSize: 13, color: 'var(--text-3, #777)', marginBottom: 22 }}>For existing Telegram users only.</div>

        <TelegramLoginWidget />

        <button onClick={() => navigate('/login')}
          style={{ marginTop: 22, background: 'none', border: 'none', color: 'var(--brand, #3399FF)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          ← Back to email sign-in
        </button>
      </div>
    </div>
  )
}
