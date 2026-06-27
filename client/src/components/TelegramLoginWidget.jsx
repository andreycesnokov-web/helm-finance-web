// Telegram Login Widget — the EXACT current auth flow, extracted so it can be reused by
// the legacy /login/telegram page and the flag-OFF /login. Auth logic unchanged:
// loginWithTelegram(data) → navigate home. Bot username from VITE_BOT_USERNAME.
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function TelegramLoginWidget() {
  const { loginWithTelegram, user } = useAuth()
  const navigate = useNavigate()
  const tgRef = useRef(null)

  useEffect(() => {
    if (user) { navigate('/'); return }

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

  return <div ref={tgRef} style={{ minHeight: 48, display: 'flex', justifyContent: 'center' }} />
}
