import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('hf_token'))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (token) {
      // Verify the same CFO token through the existing balance-free workspace
      // endpoint. Authentication must not fetch default-company finances before a
      // bookmarked company has been selected, nor require a finance-viewing role.
      // Only 401 means the token is bad; offline/server errors keep the session.
      fetch('/api/workspaces', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (r.status === 401) throw new Error('unauthorized') }, () => { /* offline: keep the session */ })
        .then(() => {
          const payload = JSON.parse(atob(token.split('.')[1]))
          setUser({ id: payload.userId, firstName: payload.firstName })
        })
        .catch(() => { localStorage.removeItem('hf_token'); setToken(null) })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const loginWithTelegram = async (telegramData) => {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramData)
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    localStorage.setItem('hf_token', data.token)
    setToken(data.token)
    setUser(data.user)
    return data.user
  }

  // Store a JWT obtained by any auth method (email OTP, etc.) the same way Telegram does.
  const loginWithToken = (jwt, userFromApi = null) => {
    localStorage.setItem('hf_token', jwt)
    setToken(jwt)
    let u = userFromApi
    if (!u) { try { const p = JSON.parse(atob(jwt.split('.')[1])); u = { id: p.userId, firstName: p.firstName } } catch { u = null } }
    setUser(u)
    return u
  }

  // { server: false } = the server already ended the session (e.g. a password reset revoked them all): clear locally only.
  const logout = ({ server = true } = {}) => {
    // A password session also lives on the server: end it there (best effort; the token is dropped here anyway).
    const current = localStorage.getItem('hf_token')
    try {
      if (server && current && JSON.parse(atob(current.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sid)
        fetch('/api/auth/logout', { method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${current}`, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    } catch { /* not a JWT: nothing to end on the server */ }
    localStorage.removeItem('hf_token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, loginWithTelegram, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
