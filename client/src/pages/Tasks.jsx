import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, daysUntil } from '../lib/api'

function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d ago`
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Build task items from Pulse data sources
function buildTasks(d) {
  const tasks = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // From todayFocus
  for (const f of (d.todayFocus || [])) {
    const days = f.due_date ? daysUntil(f.due_date) : 0
    tasks.push({
      id:     `focus-${f.id}`,
      title:  f.description || f.counterparty || 'Action required',
      sub:    f.amount ? `${fmt(f.amount)} IDR · ${fmtDate(f.due_date)}` : fmtDate(f.due_date),
      type:   f.entityType || f.type || 'task',
      days,
      urgent: days <= 0,
      source: 'focus',
    })
  }

  // From reminders
  for (const r of (d.reminders || [])) {
    const days = r.remind_at ? daysUntil(r.remind_at) : 0
    if (days > 30) continue  // skip far-future
    tasks.push({
      id:     `reminder-${r.id}`,
      title:  r.title || r.description || 'Reminder',
      sub:    fmtDate(r.remind_at),
      type:   'reminder',
      days,
      urgent: days <= 0,
      source: 'reminder',
    })
  }

  // From overdue debts
  for (const debt of (d.debts || []).filter(x => !x.is_settled && daysUntil(x.due_date) <= 0)) {
    tasks.push({
      id:     `debt-${debt.id}`,
      title:  debt.type === 'receivable' ? `Collect from ${debt.counterparty}` : `Pay ${debt.counterparty}`,
      sub:    `${fmt(debt.amount)} IDR · ${Math.abs(daysUntil(debt.due_date))}d overdue`,
      type:   debt.type,
      days:   daysUntil(debt.due_date),
      urgent: true,
      source: 'debt',
    })
  }

  // From due-soon debts (next 7 days)
  for (const debt of (d.debts || []).filter(x => !x.is_settled && daysUntil(x.due_date) > 0 && daysUntil(x.due_date) <= 7)) {
    tasks.push({
      id:     `upcoming-${debt.id}`,
      title:  debt.type === 'receivable' ? `Follow up with ${debt.counterparty}` : `Prepare payment: ${debt.counterparty}`,
      sub:    `${fmt(debt.amount)} IDR · ${fmtDate(debt.due_date)}`,
      type:   debt.type,
      days:   daysUntil(debt.due_date),
      urgent: false,
      source: 'debt',
    })
  }

  return tasks
}

const TYPE_ICON = {
  receivable: '↓',
  payable:    '↑',
  reminder:   '🔔',
  task:       '✓',
  payroll:    '💼',
}

const TYPE_COLOR = {
  receivable: { bg: 'var(--green-light)', color: 'var(--green-dark)' },
  payable:    { bg: 'var(--red-light)',   color: 'var(--red-dark)'   },
  reminder:   { bg: 'var(--amber-light)', color: 'var(--amber-dark)' },
  task:       { bg: 'var(--blue-light)',  color: 'var(--blue-dark)'  },
  payroll:    { bg: 'var(--bg-3)',        color: 'var(--text-3)'     },
}

export default function Tasks() {
  const { token } = useAuth()
  const navigate  = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [done, setDone]       = useState({})

  useEffect(() => {
    apiFetch('/pulse', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading && !data) return <div className="page-loading">Loading tasks…</div>

  const d     = data || {}
  const tasks = buildTasks(d).filter(t => !done[t.id])

  const todayTasks    = tasks.filter(t => t.days <= 0 && t.urgent)
  const upcomingTasks = tasks.filter(t => t.days > 0)

  return (
    <div className="page">

      {/* ── Header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Tasks</div>
          <div className="page-header-sub">Today's operational and financial focus</div>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      {tasks.length === 0 && Object.keys(done).length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-title">No tasks yet</div>
          <div className="empty-state-sub">AI CFO will create tasks when financial actions need your attention — overdue items, upcoming payments, and follow-ups appear here automatically.</div>
          <button className="empty-state-cta" onClick={() => navigate('/')}>Back to Pulse</button>
        </div>
      ) : (
        <>
          {/* Today / Urgent */}
          {todayTasks.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="section-title" style={{ color: 'var(--red-dark)' }}>Today · {todayTasks.length} urgent</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {todayTasks.map(task => {
                  const tc = TYPE_COLOR[task.type] || TYPE_COLOR.task
                  return (
                    <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface-card)', border: '1px solid rgba(240,68,56,.15)', borderRadius: 12, padding: '12px 14px', boxShadow: 'var(--shadow-xs)' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: tc.bg, color: tc.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                        {TYPE_ICON[task.type] || '!'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--red)' }}>{task.sub}</div>
                      </div>
                      <button onClick={() => setDone(p => ({ ...p, [task.id]: true }))}
                        style={{ padding: '5px 12px', borderRadius: 8, background: 'none', border: '1px solid var(--border-2)', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0 }}>
                        Done
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Upcoming */}
          {upcomingTasks.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="section-title">Upcoming · {upcomingTasks.length}</div>
              <div className="item-list-card">
                {upcomingTasks.map(task => {
                  const tc = TYPE_COLOR[task.type] || TYPE_COLOR.task
                  return (
                    <div key={task.id} className="item-row">
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: tc.bg, color: tc.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {TYPE_ICON[task.type] || '→'}
                      </div>
                      <div className="item-row-left">
                        <div className="item-row-name">{task.title}</div>
                        <div className="item-row-sub">{task.sub}</div>
                      </div>
                      <button onClick={() => setDone(p => ({ ...p, [task.id]: true }))}
                        style={{ padding: '4px 10px', borderRadius: 7, background: 'none', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text-4)', cursor: 'pointer', flexShrink: 0 }}>
                        Done
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Completed this session */}
          {Object.keys(done).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="section-title" style={{ color: 'var(--green-dark)' }}>Completed this session · {Object.keys(done).length}</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '8px 0' }}>Tasks are marked done for this session. They will reappear if still outstanding on next load.</div>
            </div>
          )}
        </>
      )}

      <div style={{ textAlign: 'center', paddingBottom: 12 }}>
        <button className="link-btn" onClick={() => navigate('/')}>View Pulse dashboard →</button>
      </div>

    </div>
  )
}
