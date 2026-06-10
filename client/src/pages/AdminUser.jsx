import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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

function fmtMonth(str) {
  // "2026-06" → "Jun 2026"
  if (!str) return '—'
  const [y, m] = str.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
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
      width: 56, height: 56, borderRadius: 16, background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: 22, flexShrink: 0,
    }}>
      {letter}
    </div>
  )
}

const ACTIVITY_TYPE_CONFIG = {
  transaction: { icon: '💳', label: 'Transaction', color: '#1e3a6e', bg: '#EFF6FF' },
  debt:        { icon: '📋', label: 'Debt',        color: '#7C3AED', bg: '#F5F3FF' },
  reminder:    { icon: '🔔', label: 'Reminder',    color: '#92400E', bg: '#FEF3C7' },
}

// ── Simple bar chart using divs ───────────────────────────────────────────────
function ActivityChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
        No activity recorded yet.
      </div>
    )
  }

  const maxVal = Math.max(1, ...data.map(m => m.transactions + m.debts + m.reminders))

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minWidth: data.length * 52, paddingBottom: 8 }}>
        {data.map(m => {
          const total = m.transactions + m.debts + m.reminders
          const pct   = Math.round((total / maxVal) * 100)
          return (
            <div key={m.month} style={{ flex: '0 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {/* Bar stack */}
              <div style={{ width: '100%', height: 80, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2 }}>
                {m.transactions > 0 && (
                  <div title={`Txs: ${m.transactions}`} style={{
                    width: '100%',
                    height: `${Math.max(4, Math.round((m.transactions / maxVal) * 80))}px`,
                    background: '#2563EB', borderRadius: 3,
                  }} />
                )}
                {m.debts > 0 && (
                  <div title={`Debts: ${m.debts}`} style={{
                    width: '100%',
                    height: `${Math.max(4, Math.round((m.debts / maxVal) * 80))}px`,
                    background: '#7C3AED', borderRadius: 3,
                  }} />
                )}
                {m.reminders > 0 && (
                  <div title={`Reminders: ${m.reminders}`} style={{
                    width: '100%',
                    height: `${Math.max(4, Math.round((m.reminders / maxVal) * 80))}px`,
                    background: '#F59E0B', borderRadius: 3,
                  }} />
                )}
                {total === 0 && (
                  <div style={{ width: '100%', height: 4, background: 'var(--border-2)', borderRadius: 3 }} />
                )}
              </div>
              {/* Total count */}
              <div style={{ fontSize: 10, fontWeight: 700, color: total > 0 ? 'var(--text-2)' : 'var(--text-4)' }}>
                {total || ''}
              </div>
              {/* Month label */}
              <div style={{ fontSize: 9, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                {fmtMonth(m.month).split(' ')[0]}<br />{fmtMonth(m.month).split(' ')[1]}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        {[['#2563EB', 'Transactions'], ['#7C3AED', 'Debts'], ['#F59E0B', 'Reminders']].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--bg-2)', borderRadius: 14, padding: '14px 16px',
      border: '1px solid var(--border)',
      borderTop: `3px solid ${accent || 'var(--brand)'}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: -0.3, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Profile row ───────────────────────────────────────────────────────────────
function ProfileRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '11px 16px', borderBottom: '0.5px solid var(--border)', gap: 16 }}>
      <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500, flexShrink: 0, minWidth: 130 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' }}>
        {value || <span style={{ color: 'var(--text-4)', fontStyle: 'italic', fontWeight: 400 }}>Not set</span>}
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AdminUser() {
  const { id } = useParams()
  const { token } = useAuth()
  const navigate = useNavigate()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!token || !id) return
    apiFetch(`/admin/users/${id}`, token)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e); setLoading(false) })
  }, [token, id])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading user details…</div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    const is403 = error.message?.includes('Admin access')
    const is404 = error.message?.includes('not found')
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{is403 ? '🔒' : is404 ? '👤' : '⚠️'}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            {is403 ? 'Admin access required' : is404 ? 'User not found' : 'Error'}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 20 }}>
            {is403 ? 'This page is for CFO AI platform owners only.' : is404 ? `No user with ID ${id} exists.` : error.message}
          </div>
          <button onClick={() => navigate('/admin')} style={{
            padding: '10px 24px', borderRadius: 10, background: 'var(--brand)', color: '#fff',
            border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            ← Back to Admin
          </button>
        </div>
      </div>
    )
  }

  const { user, summary, monthly_activity, recent_activity } = data
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || `User ${user.id}`

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Dark header ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1e293b 100%)',
        padding: '24px 28px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Back link */}
        <button
          onClick={() => navigate('/admin')}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          Platform Admin
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Initials name={user.first_name || user.username || String(user.id)} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.4 }}>{displayName}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 5 }}>
              {user.username && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>@{user.username}</span>
              )}
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>ID: {user.id}</span>
              <span style={{ fontSize: 11, color: '#12B76A', fontWeight: 600 }}>✓ Telegram connected</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 900 }}>

        {/* ── Privacy notice ─── */}
        <div style={{
          background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12,
          padding: '10px 14px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🔒</span>
          <span style={{ fontSize: 12, color: '#1e40af', lineHeight: 1.5 }}>
            <strong>Admin view:</strong> This page shows usage metadata only. Financial amounts are hidden for client privacy.
          </span>
        </div>

        {/* ── Usage summary cards ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="Transactions"  value={summary.transaction_count} sub="total recorded"           accent="#2563EB" />
          <StatCard label="Debts"         value={summary.debt_count}        sub="receivables + payables"   accent="#7C3AED" />
          <StatCard label="Reminders"     value={summary.reminder_count}    sub="all reminders"            accent="#F59E0B" />
          <StatCard label="Active Days"   value={summary.active_days_count} sub="days with any activity"   accent="#12B76A" />
          <StatCard label="Last Active"   value={fmtRelative(summary.last_activity_at)} sub={fmtDate(summary.last_activity_at)} accent="#6366f1" />
        </div>

        {/* ── Profile info ─── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>User Profile</div>
          <div style={{ background: 'var(--bg-2)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <ProfileRow label="Full name"    value={displayName} />
            <ProfileRow label="Username"     value={user.username ? `@${user.username}` : null} />
            <ProfileRow label="Telegram ID"  value={String(user.id)} />
            <ProfileRow label="Language"     value={user.language} />
            <ProfileRow label="Timezone"     value={user.timezone} />
            <ProfileRow label="Joined"       value={fmtDateTime(user.created_at)} />
            <ProfileRow label="First activity" value={fmtDateTime(summary.first_activity_at)} />
            <ProfileRow label="Last activity"  value={fmtDateTime(summary.last_activity_at)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', gap: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>Telegram</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#E1F5EE', color: '#085041' }}>✓ Connected</span>
            </div>
          </div>
        </div>

        {/* ── Monthly activity chart ─── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Monthly Activity</div>
          <div style={{ background: 'var(--bg-2)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px' }}>
            <ActivityChart data={monthly_activity} />

            {/* Monthly detail table */}
            {monthly_activity.length > 0 && (
              <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Month', 'Transactions', 'Debts', 'Reminders', 'Total'].map(h => (
                          <th key={h} style={{ padding: '6px 12px', textAlign: h === 'Month' ? 'left' : 'center', fontWeight: 700, color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...monthly_activity].reverse().map((m, i) => (
                        <tr key={m.month} style={{ borderBottom: i < monthly_activity.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text)' }}>{fmtMonth(m.month)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: m.transactions > 0 ? '#2563EB' : 'var(--text-4)', fontWeight: 600 }}>{m.transactions || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: m.debts > 0 ? '#7C3AED' : 'var(--text-4)', fontWeight: 600 }}>{m.debts || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', color: m.reminders > 0 ? '#F59E0B' : 'var(--text-4)', fontWeight: 600 }}>{m.reminders || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--text)' }}>
                            {m.transactions + m.debts + m.reminders}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Recent activity ─── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Recent Activity
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-4)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
              (last {recent_activity.length} actions · no amounts)
            </span>
          </div>

          {recent_activity.length === 0 ? (
            <div style={{ background: 'var(--bg-2)', borderRadius: 14, border: '1px solid var(--border)', padding: '28px 20px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
              No activity recorded yet.
            </div>
          ) : (
            <div style={{ background: 'var(--bg-2)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {recent_activity.map((a, i) => {
                const cfg = ACTIVITY_TYPE_CONFIG[a.type] || ACTIVITY_TYPE_CONFIG.transaction
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 16px', borderBottom: i < recent_activity.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    {/* Icon dot */}
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                      {cfg.icon}
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.title}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg, padding: '1px 7px', borderRadius: 20 }}>{cfg.label}</span>
                        {a.meta && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{a.meta}</span>}
                      </div>
                    </div>
                    {/* Date */}
                    <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>
                      {fmtRelative(a.date)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
