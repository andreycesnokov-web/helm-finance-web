import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Pulse from './pages/Pulse'
import Accounts from './pages/Accounts'
import Add from './pages/Add'
import Radar from './pages/Radar'
import Settings from './pages/Settings'

const NAV = [
  { path: '/', label: 'Pulse', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { path: '/add', label: 'Add', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
  { path: '/radar', label: 'Radar', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> },
  { path: '/accounts', label: 'Accounts', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  { path: '/settings', label: 'Settings', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
]

const fmtShort = (n) => {
  const abs = Math.abs(Number(n))
  if (abs >= 1000000) return (abs / 1000000).toFixed(1) + 'M'
  if (abs >= 1000) return (abs / 1000).toFixed(0) + 'K'
  return abs.toLocaleString()
}

function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <span style={{ fontSize: 18 }}>💰</span>
        <span>Helm Finance</span>
      </div>
      <div style={{ padding: '4px 8px', flex: 1 }}>
        {NAV.map(item => (
          <button key={item.path} className={`sidebar-nav-btn${location.pathname === item.path ? ' active' : ''}`} onClick={() => navigate(item.path)}>
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--border)', fontSize: 11, color: 'var(--text-3)' }}>v1.0</div>
    </div>
  )
}

function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <nav className="nav">
      {NAV.map(item => (
        <button key={item.path} className={`nav-btn${location.pathname === item.path ? ' active' : ''}`} onClick={() => navigate(item.path)}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

export function RightPanel({ data }) {
  const d = data || {}
  const upcoming = (d.debts || []).filter(x => !x.is_settled).slice(0, 5)
  return (
    <div className="desktop-right" style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>AI CFO</div>
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.aiStatus === 'critical' ? 'var(--red)' : d.aiStatus === 'attention' ? 'var(--amber)' : 'var(--green)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{d.aiStatus === 'critical' ? 'Critical' : d.aiStatus === 'attention' ? 'Attention' : 'Healthy'}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 10 }}>{d.aiText}</div>
          <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Recommendation</div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
              {/* Use AI-generated text when available; fall back to runway-based hint */}
              {d.aiText
                ? d.aiText
                : (d.runway || 0) < 7
                  ? 'Collect receivables immediately.'
                  : (d.runway || 0) < 14
                    ? 'Review upcoming payments.'
                    : 'Finances healthy. Grow income.'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Upcoming</div>
        {upcoming.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No upcoming events</div>
          : upcoming.map(debt => {
              const days = Math.round((new Date(debt.due_date) - new Date()) / 86400000)
              return (
                <div key={debt.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{debt.counterparty}</div>
                    <div style={{ fontSize: 10, color: days < 0 ? 'var(--red)' : 'var(--text-3)' }}>{days < 0 ? 'Overdue' : days === 0 ? 'Today' : `in ${days}d`}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: debt.type === 'receivable' ? 'var(--green)' : 'var(--red)' }}>
                    {debt.type === 'receivable' ? '+' : '-'}{fmtShort(debt.amount)}
                  </div>
                </div>
              )
            })
        }
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Quick Stats</div>
        {[
          { label: 'Runway', value: `${d.runway || 0}d`, color: (d.runway || 0) > 14 ? 'var(--green-dark)' : (d.runway || 0) > 7 ? 'var(--amber-dark)' : 'var(--red)' },
          { label: 'Burn rate', value: `${fmtShort(d.burnRate || 0)}/day` },
          { label: 'Net position', value: `${(d.netPosition || 0) >= 0 ? '+' : ''}${fmtShort(d.netPosition || 0)}`, color: (d.netPosition || 0) >= 0 ? 'var(--green-dark)' : 'var(--red)' },
          { label: 'Receivables', value: `+${fmtShort(d.receivables || 0)}`, color: 'var(--green-dark)' },
          { label: 'Payables', value: `-${fmtShort(d.payables || 0)}`, color: 'var(--red)' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{s.label}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: s.color || 'var(--text)' }}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Layout({ children, rightPanel }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return (
    <>
      <Sidebar />
      <div className="desktop-layout">
        <div className="desktop-main">{children}</div>
        {rightPanel}
      </div>
      <BottomNav />
    </>
  )
}

function PulseWrapper() {
  const [pulseData, setPulseData] = useState(null)
  return (
    <Layout rightPanel={<RightPanel data={pulseData} />}>
      <Pulse onDataLoad={setPulseData} />
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PulseWrapper />} />
          <Route path="/add" element={<Layout><Add /></Layout>} />
          <Route path="/radar" element={<Layout><Radar /></Layout>} />
          <Route path="/accounts" element={<Layout><Accounts /></Layout>} />
          <Route path="/settings" element={<Layout><Settings /></Layout>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}