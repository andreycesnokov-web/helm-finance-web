import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Pulse from './pages/Pulse'
import Accounts from './pages/Accounts'
import Add from './pages/Add'
import Radar from './pages/Radar'
import Settings from './pages/Settings'
import Transactions from './pages/Transactions'

// ── Mobile bottom nav — only existing pages ───────────────────────────────────
const NAV = [
  { path: '/',         label: 'Pulse',    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { path: '/add',      label: 'Add',      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
  { path: '/radar',    label: 'Radar',    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> },
  { path: '/accounts', label: 'Accounts', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  { path: '/settings', label: 'Settings', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
]

// ── Desktop sidebar nav groups ────────────────────────────────────────────────
// active: true  → page exists, link is clickable
// active: false → coming soon, rendered as disabled (no navigation, no crash)
const SIDEBAR_GROUPS = [
  {
    title: 'OVERVIEW',
    items: [
      { path: '/',      label: 'Pulse',  active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
      { path: '/radar', label: 'Radar',  active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> },
      { path: '/cfo',   label: 'AI CFO', active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      { path: '/transactions', label: 'Transactions', active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="2.5"/><line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="2.5"/><line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="2.5"/></svg> },
      { path: '/accounts',    label: 'Accounts',     active: true,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
      { path: '/invoices',    label: 'Invoices',     active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
      { path: '/receivables', label: 'Receivables',  active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
      { path: '/payables',    label: 'Payables',     active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg> },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { path: '/payroll',   label: 'Payroll',   active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
      { path: '/tasks',     label: 'Tasks',     active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
      { path: '/approvals', label: 'Approvals', active: false,
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    ],
  },
]

const fmtShort = (n) => {
  const abs = Math.abs(Number(n))
  if (abs >= 1000000) return (abs / 1000000).toFixed(1) + 'M'
  if (abs >= 1000) return (abs / 1000).toFixed(0) + 'K'
  return abs.toLocaleString()
}

// ── Settings icon (reused in sidebar user block) ──────────────────────────────
const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

// ── Desktop Sidebar V2 ────────────────────────────────────────────────────────
function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()

  const initials = (user?.firstName?.[0] || user?.first_name?.[0] || 'A').toUpperCase()
  const displayName = user?.firstName || user?.first_name || 'Account'

  return (
    <div className="sidebar">

      {/* ── Business block ─── */}
      <div className="sidebar-business-block">
        <div className="sidebar-business-logo">💰</div>
        <div>
          <div className="sidebar-business-name">Helm Finance</div>
          <div className="sidebar-business-sub">My Business</div>
        </div>
      </div>

      {/* ── Nav groups ─── */}
      <div className="sidebar-nav-scroll">
        {SIDEBAR_GROUPS.map(group => (
          <div key={group.title} className="sidebar-section">
            <div className="sidebar-section-title">{group.title}</div>
            {group.items.map(item => {
              const isActive = location.pathname === item.path

              if (!item.active) {
                // Disabled / coming soon — not clickable, no route crash
                return (
                  <div key={item.path} className="sidebar-nav-item disabled">
                    <span className="sidebar-nav-item-icon">{item.icon}</span>
                    <span className="sidebar-nav-item-label">{item.label}</span>
                    <span className="coming-soon-badge">Soon</span>
                  </div>
                )
              }

              return (
                <button
                  key={item.path}
                  className={`sidebar-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  <span className="sidebar-nav-item-icon">{item.icon}</span>
                  <span className="sidebar-nav-item-label">{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── User block ─── */}
      <div className="sidebar-user-block">
        <div className="sidebar-user-info">
          <div className="sidebar-user-avatar">{initials}</div>
          <div className="sidebar-user-details">
            <div className="sidebar-user-name">{displayName}</div>
            <span className="sidebar-plan-badge">Free Plan</span>
          </div>
        </div>
        <button className="sidebar-settings-btn" onClick={() => navigate('/settings')} title="Settings">
          <SettingsIcon />
        </button>
      </div>

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
          <Route path="/accounts"      element={<Layout><Accounts /></Layout>} />
          <Route path="/transactions"  element={<Layout><Transactions /></Layout>} />
          <Route path="/settings"      element={<Layout><Settings /></Layout>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}