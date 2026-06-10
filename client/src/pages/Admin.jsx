import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtRelative(str) {
  if (!str) return '—'
  const diff = Date.now() - new Date(str).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30)  return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}yr ago`
}

function userStatus(u) {
  if (!u.last_activity_date) return { label: 'New', color: '#1e40af', bg: '#EFF6FF' }
  const days = Math.floor((Date.now() - new Date(u.last_activity_date).getTime()) / 86400000)
  if (days <= 30) return { label: 'Active',   color: '#085041', bg: '#E1F5EE' }
  if (days <= 90) return { label: 'Inactive', color: '#92400E', bg: '#FEF3C7' }
  return { label: 'Dormant', color: '#6B7280', bg: '#F3F4F6' }
}

function Initials({ name }) {
  const letter = (name || '?')[0].toUpperCase()
  const colors = [
    ['#1e3a6e','#EFF6FF'], ['#085041','#E1F5EE'], ['#7C3AED','#F5F3FF'],
    ['#92400E','#FEF3C7'], ['#991B1B','#FEE2E2'],
  ]
  const [fg, bg] = colors[letter.charCodeAt(0) % colors.length]
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 10, background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: 14, flexShrink: 0,
    }}>
      {letter}
    </div>
  )
}

// ── Summary Card ──────────────────────────────────────────────────────────────
function AdminCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--bg-2)', borderRadius: 16, padding: '18px 20px',
      border: '1px solid var(--border)',
      borderTop: `3px solid ${accent || 'var(--brand)'}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.5, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Admin() {
  const { token } = useAuth()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [search, setSearch]   = useState('')
  const [sortBy, setSortBy]   = useState('created_at') // created_at | last_activity_date | transaction_count

  useEffect(() => {
    if (!token) return
    apiFetch('/admin/users', token)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e); setLoading(false) })
  }, [token])

  // ── Access denied ─────────────────────────────────────────────────────────
  if (!loading && error) {
    const is403 = error.message?.includes('Admin access')
    const is401 = error.message?.includes('Unauthorized') || error.message?.includes('token')
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{is403 ? '🔒' : '⚠️'}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            {is403 ? 'Admin access required' : is401 ? 'Please log in' : 'Error'}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>
            {is403
              ? 'Your account does not have platform admin privileges. This page is for CFO AI platform owners only.'
              : is401
                ? 'Your session has expired. Please log in again.'
                : error.message}
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading admin data…</div>
        </div>
      </div>
    )
  }

  const { summary, users } = data

  // Filter + sort
  const filtered = (users || [])
    .filter(u => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return (
        (u.first_name || '').toLowerCase().includes(q) ||
        (u.last_name  || '').toLowerCase().includes(q) ||
        (u.username   || '').toLowerCase().includes(q) ||
        String(u.id).includes(q)
      )
    })
    .sort((a, b) => {
      if (sortBy === 'transaction_count') return b.transaction_count - a.transaction_count
      if (sortBy === 'last_activity_date') {
        return (b.last_activity_date || '') > (a.last_activity_date || '') ? 1 : -1
      }
      // created_at (default)
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1
    })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 0 }}>

      {/* ── Admin header ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
        padding: '28px 32px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#6366f1', letterSpacing: '0.12em', textTransform: 'uppercase', background: 'rgba(99,102,241,0.15)', padding: '3px 10px', borderRadius: 20 }}>
                Platform Admin
              </span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: -0.5, marginBottom: 4 }}>
              User Management
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              Internal CFO AI platform overview · owner access only
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            🔒 Restricted · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1200 }}>

        {/* ── Summary cards ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
          <AdminCard label="Total Users"          value={summary.totalUsers}            sub="registered accounts"     accent="#6366f1" />
          <AdminCard label="Active (30d)"         value={summary.activeLast30Days}      sub="had activity last 30 days" accent="#12B76A" />
          <AdminCard label="With Transactions"    value={summary.usersWithTransactions} sub="logged ≥1 transaction"   accent="#2563EB" />
          <AdminCard label="With Debts"           value={summary.usersWithDebts}        sub="open receivables/payables" accent="#F79009" />
          <AdminCard label="With Reminders"       value={summary.usersWithReminders}    sub="active reminders"        accent="#7C3AED" />
        </div>

        {/* ── Filter bar ─── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, username, Telegram ID…"
              style={{
                width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
                border: '1px solid var(--border-2)', fontSize: 13, background: 'var(--bg-2)',
                color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <svg style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-2)', fontSize: 13, background: 'var(--bg-2)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <option value="created_at">Sort: Newest first</option>
            <option value="last_activity_date">Sort: Most recent activity</option>
            <option value="transaction_count">Sort: Most transactions</option>
          </select>
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 0', whiteSpace: 'nowrap' }}>
            {filtered.length} of {users.length} users
          </div>
        </div>

        {/* ── User table — desktop ─── */}
        <div style={{ background: 'var(--bg-2)', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden', display: 'none' }} className="admin-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)' }}>
                {['User', 'Telegram ID', 'Joined', 'Transactions', 'Debts', 'Reminders', 'Last Activity', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => {
                const status = userStatus(u)
                const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ') || `User ${u.id}`
                return (
                  <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? '0.5px solid var(--border)' : 'none' }}>

                    {/* User cell */}
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Initials name={u.first_name || u.username || String(u.id)} />
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{displayName}</div>
                          {u.username && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>@{u.username}</div>}
                        </div>
                      </div>
                    </td>

                    {/* Telegram ID */}
                    <td style={{ padding: '13px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-2)' }}>
                      {u.id}
                      <div style={{ fontSize: 10, color: 'var(--green-dark)', fontFamily: 'inherit', marginTop: 2 }}>✓ Connected</div>
                    </td>

                    {/* Joined */}
                    <td style={{ padding: '13px 16px', color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {fmtDate(u.created_at)}
                    </td>

                    {/* Tx count */}
                    <td style={{ padding: '13px 16px', textAlign: 'center' }}>
                      <span style={{
                        fontWeight: 700, fontSize: 14,
                        color: u.transaction_count > 0 ? 'var(--text)' : 'var(--text-4)',
                      }}>
                        {u.transaction_count}
                      </span>
                    </td>

                    {/* Debt count */}
                    <td style={{ padding: '13px 16px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: u.debt_count > 0 ? 'var(--text)' : 'var(--text-4)' }}>
                        {u.debt_count}
                      </span>
                    </td>

                    {/* Reminder count */}
                    <td style={{ padding: '13px 16px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: u.reminder_count > 0 ? 'var(--text)' : 'var(--text-4)' }}>
                        {u.reminder_count}
                      </span>
                    </td>

                    {/* Last activity */}
                    <td style={{ padding: '13px 16px', color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {fmtRelative(u.last_activity_date)}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        background: status.bg, color: status.color,
                      }}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── User cards — mobile & always-visible fallback ─── */}
        <div className="admin-card-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(u => {
            const status = userStatus(u)
            const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ') || `User ${u.id}`
            return (
              <div key={u.id} style={{
                background: 'var(--bg-2)', borderRadius: 14, border: '1px solid var(--border)',
                padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                  <Initials name={u.first_name || u.username || String(u.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{displayName}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: status.bg, color: status.color }}>
                        {status.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      {u.username && (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>@{u.username}</span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace' }}>ID: {u.id}</span>
                      <span style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 600 }}>✓ Telegram</span>
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {[
                    { label: 'Joined',    value: fmtDate(u.created_at) },
                    { label: 'Txs',       value: u.transaction_count },
                    { label: 'Debts',     value: u.debt_count },
                    { label: 'Last seen', value: fmtRelative(u.last_activity_date) },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg-3)', borderRadius: 10, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-3)', fontSize: 14 }}>
              No users match your search.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
