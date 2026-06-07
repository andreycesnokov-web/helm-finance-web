import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Pulse from './pages/Pulse'

const NAV = [
  { path: '/', label: 'Pulse', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { path: '/add', label: 'Add', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
  { path: '/radar', label: 'Radar', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="18.9" y1="5.1" x2="16" y2="8"/></svg> },
  { path: '/accounts', label: 'Accounts', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
]

function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <nav className="nav">
      {NAV.map(item => (
        <button key={item.path} className={`nav-btn${location.pathname === item.path ? ' active' : ''}`} onClick={() => navigate(item.path)}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return (
    <>
      {children}
      <BottomNav />
    </>
  )
}

// Placeholder pages
const ComingSoon = ({ title }) => (
  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)' }}>
    <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
    <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
    <div style={{ fontSize: 13 }}>Coming in next sprint</div>
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Pulse /></ProtectedRoute>} />
          <Route path="/add" element={<ProtectedRoute><ComingSoon title="Add transaction" /></ProtectedRoute>} />
          <Route path="/radar" element={<ProtectedRoute><ComingSoon title="Radar · Cash forecast" /></ProtectedRoute>} />
          <Route path="/accounts" element={<ProtectedRoute><ComingSoon title="Accounts" /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
