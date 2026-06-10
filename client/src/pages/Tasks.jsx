import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, daysUntil } from '../lib/api'
import DebtPaymentModal from '../components/DebtPaymentModal'

// ── Date formatter ────────────────────────────────────────────────────────────
function fmtDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Build task list from pulse data.
 *
 * Each task:
 *   id          — unique string key for React
 *   sourceId    — real debt.id or reminder.id (used for API calls)
 *   sourceType  — 'debt' | 'reminder'
 *   debtType    — 'payable' | 'receivable' | null
 *   debtObj     — full debt object (passed to DebtPaymentModal)
 *   actionType  — 'pay' | 'receive' | 'reminder_done' | 'view_only'
 *   title, sub, type, days, urgent
 *
 * Rules:
 *   - A debt is shown at most ONCE (tracked via debtIdsAdded)
 *   - Tasks with empty title are skipped
 *   - Reminders from todayFocus are NOT duplicated (handled via reminder loop)
 *   - todayFocus debt items with due date 8–14 days are included only if not already added
 */
function buildTasks(d) {
  const tasks = []
  const debtIdsAdded = new Set()

  // ── 1. Overdue debts (urgent) ─────────────────────────────────────────────
  for (const debt of (d.debts || []).filter(x => !x.is_settled && daysUntil(x.due_date) <= 0)) {
    debtIdsAdded.add(debt.id)
    tasks.push({
      id: `debt-overdue-${debt.id}`,
      sourceId: debt.id,
      sourceType: 'debt',
      debtType: debt.type,
      debtObj: debt,
      actionType: debt.type === 'payable' ? 'pay' : 'receive',
      title: debt.type === 'receivable'
        ? `Collect from ${debt.counterparty}`
        : `Pay ${debt.counterparty}`,
      sub: `${fmt(debt.amount)} IDR · ${Math.abs(daysUntil(debt.due_date))}d overdue`,
      type: debt.type,
      days: daysUntil(debt.due_date),
      urgent: true,
    })
  }

  // ── 2. Upcoming debts (1–7 days) ──────────────────────────────────────────
  for (const debt of (d.debts || []).filter(x =>
    !x.is_settled && daysUntil(x.due_date) > 0 && daysUntil(x.due_date) <= 7
  )) {
    debtIdsAdded.add(debt.id)
    tasks.push({
      id: `debt-upcoming-${debt.id}`,
      sourceId: debt.id,
      sourceType: 'debt',
      debtType: debt.type,
      debtObj: debt,
      actionType: debt.type === 'payable' ? 'pay' : 'receive',
      title: debt.type === 'receivable'
        ? `Follow up with ${debt.counterparty}`
        : `Prepare payment: ${debt.counterparty}`,
      sub: `${fmt(debt.amount)} IDR · due ${fmtDate(debt.due_date)}`,
      type: debt.type,
      days: daysUntil(debt.due_date),
      urgent: false,
    })
  }

  // ── 3. Reminders (not done, ≤30 days out) ────────────────────────────────
  for (const r of (d.reminders || [])) {
    if (r.is_done) continue
    const days = r.remind_at ? daysUntil(r.remind_at) : 0
    if (days > 30) continue
    const title = r.title || r.description
    if (!title) continue // guard: skip empty-title reminders
    tasks.push({
      id: `reminder-${r.id}`,
      sourceId: r.id,
      sourceType: 'reminder',
      debtType: null,
      debtObj: null,
      actionType: 'reminder_done',
      title,
      sub: r.remind_at ? fmtDate(r.remind_at) : (r.meta || ''),
      type: 'reminder',
      days,
      urgent: days <= 0,
    })
  }

  // ── 4. todayFocus debt items not yet added (8–14 days window) ────────────
  for (const f of (d.todayFocus || [])) {
    if (f.type === 'reminder') continue        // already handled above
    if (!f.id) continue
    if (debtIdsAdded.has(f.id)) continue       // already shown — no duplicate
    const title = f.title || f.description
    if (!title) continue                       // guard: skip empty title
    // Look up the full debt object in the debts array
    const debtObj = (d.debts || []).find(x => x.id === f.id) || null
    if (!debtObj) continue                     // no source debt found — skip safely
    debtIdsAdded.add(f.id)
    const days = debtObj.due_date ? daysUntil(debtObj.due_date) : 0
    tasks.push({
      id: `focus-${f.id}`,
      sourceId: f.id,
      sourceType: 'debt',
      debtType: debtObj.type,
      debtObj,
      actionType: debtObj.type === 'payable' ? 'pay' : 'receive',
      title,
      sub: debtObj.amount
        ? `${fmt(debtObj.amount)} IDR · ${fmtDate(debtObj.due_date)}`
        : fmtDate(debtObj.due_date),
      type: debtObj.type,
      days,
      urgent: days <= 0,
    })
  }

  return tasks
}

// ── Visual config per task type ───────────────────────────────────────────────
const TYPE_CFG = {
  receivable: { icon: '↓', bg: 'var(--green-light)',  color: 'var(--green-dark)'  },
  payable:    { icon: '↑', bg: 'var(--red-light)',    color: 'var(--red-dark)'    },
  reminder:   { icon: '🔔', bg: 'var(--amber-light)',  color: 'var(--amber-dark)'  },
  task:       { icon: '✓', bg: 'var(--brand-light)',  color: 'var(--brand-dark)'  },
}

// ── Source badge ──────────────────────────────────────────────────────────────
function SourceBadge({ sourceType, debtType }) {
  if (sourceType === 'debt') {
    return debtType === 'payable'
      ? <span className="hf-badge hf-badge-red" style={{ fontSize: 11 }}>Payable</span>
      : <span className="hf-badge hf-badge-green" style={{ fontSize: 11 }}>Receivable</span>
  }
  if (sourceType === 'reminder') {
    return <span className="hf-badge hf-badge-amber" style={{ fontSize: 11 }}>Reminder</span>
  }
  return null
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, accounts, onPayOpen, onReminderDone, onReminderSnooze, acting }) {
  const tc = TYPE_CFG[task.type] || TYPE_CFG.task
  const isActing = acting[task.id]

  return (
    <div className={`task-card${task.urgent ? ' task-card-urgent' : ''}`}>
      {/* Type icon */}
      <div className="task-card-icon" style={{ background: tc.bg, color: tc.color }}>
        {tc.icon}
      </div>

      {/* Body */}
      <div className="task-card-body" style={{ flex: 1, minWidth: 0 }}>
        <div className="task-card-title">{task.title}</div>
        <div className="task-card-sub" style={{ color: task.urgent ? 'var(--red-dark)' : undefined }}>
          {task.sub}
        </div>
      </div>

      {/* Source badge */}
      <SourceBadge sourceType={task.sourceType} debtType={task.debtType} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {task.actionType === 'pay' && (
          <button
            className="task-card-btn"
            style={{ background: 'var(--red-light)', color: 'var(--red-dark)', border: '1px solid rgba(180,35,24,.15)', fontWeight: 700 }}
            onClick={() => onPayOpen(task)}
            disabled={isActing}
          >
            Pay now
          </button>
        )}

        {task.actionType === 'receive' && (
          <button
            className="task-card-btn"
            style={{ background: 'var(--green-light)', color: 'var(--green-dark)', border: '1px solid rgba(2,122,72,.15)', fontWeight: 700 }}
            onClick={() => onPayOpen(task)}
            disabled={isActing}
          >
            Mark received
          </button>
        )}

        {task.actionType === 'reminder_done' && (
          <>
            <button
              className="task-card-btn"
              style={{ fontSize: 12 }}
              onClick={() => onReminderSnooze(task)}
              disabled={isActing}
            >
              {isActing ? '…' : 'Snooze 1d'}
            </button>
            <button
              className="task-card-btn"
              style={{ background: 'var(--green-light)', color: 'var(--green-dark)', border: '1px solid rgba(2,122,72,.15)', fontWeight: 700 }}
              onClick={() => onReminderDone(task)}
              disabled={isActing}
            >
              {isActing ? '…' : 'Done'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({ label, labelColor, tasks, accounts, onPayOpen, onReminderDone, onReminderSnooze, acting }) {
  if (!tasks.length) return null
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="hf-section-title" style={labelColor ? { color: labelColor } : undefined}>
        {label} · {tasks.length}
      </div>
      {tasks.map(t => (
        <TaskCard
          key={t.id}
          task={t}
          accounts={accounts}
          onPayOpen={onPayOpen}
          onReminderDone={onReminderDone}
          onReminderSnooze={onReminderSnooze}
          acting={acting}
        />
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Tasks() {
  const { token } = useAuth()
  const navigate  = useNavigate()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // Modal state — which task is open for payment
  const [payTask, setPayTask]   = useState(null) // task object
  const [payError, setPayError] = useState('')

  // Per-task acting state (spinner while API call in progress)
  const [acting, setActing] = useState({}) // { [taskId]: true }

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    apiFetch('/pulse', token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  // ── Open payment modal ────────────────────────────────────────────────────
  const handlePayOpen = (task) => {
    setPayError('')
    setPayTask(task)
  }

  // ── Payment modal success ─────────────────────────────────────────────────
  const handlePaySuccess = () => {
    setPayTask(null)
    load() // reload pulse → debt now settled or reduced → task disappears
  }

  // ── Reminder: mark done (persistent via API) ──────────────────────────────
  const handleReminderDone = async (task) => {
    setActing(p => ({ ...p, [task.id]: true }))
    try {
      await apiFetch(`/reminders/${task.sourceId}/done`, token, { method: 'PATCH' })
      load() // reload pulse → reminder now is_done=true → disappears from list
    } catch (e) {
      setError(`Could not complete reminder: ${e.message}`)
    } finally {
      setActing(p => ({ ...p, [task.id]: false }))
    }
  }

  // ── Reminder: snooze 1 day (persistent via API) ───────────────────────────
  const handleReminderSnooze = async (task) => {
    setActing(p => ({ ...p, [task.id]: true }))
    try {
      await apiFetch(`/reminders/${task.sourceId}/snooze`, token, {
        method: 'PATCH',
        body: { days: 1 },
      })
      load() // reload pulse → remind_at moved forward → disappears from ≤30d window
    } catch (e) {
      setError(`Could not snooze reminder: ${e.message}`)
    } finally {
      setActing(p => ({ ...p, [task.id]: false }))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading && !data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'tx-spin 0.7s linear infinite' }} />
    </div>
  )

  const d        = data || {}
  const accounts = d.accounts || []
  const tasks    = buildTasks(d)

  const urgentTasks   = tasks.filter(t => t.urgent)
  const todayTasks    = tasks.filter(t => !t.urgent && t.days === 0)
  const upcomingTasks = tasks.filter(t => !t.urgent && t.days > 0)

  const sectionProps = { accounts, onPayOpen: handlePayOpen, onReminderDone: handleReminderDone, onReminderSnooze: handleReminderSnooze, acting }

  return (
    <div className="hf-page">

      {/* ── Page header ─── */}
      <div className="hf-page-header">
        <div>
          <div className="hf-page-title">Tasks</div>
          <div className="hf-page-subtitle">Financial actions sourced from live data — resolves when the underlying item is settled</div>
        </div>
        {tasks.length > 0 && (
          <div className="hf-badge hf-badge-blue" style={{ fontSize: 13, padding: '6px 14px' }}>
            {tasks.length} open
          </div>
        )}
      </div>

      {/* ── Error ─── */}
      {error && (
        <div style={{ background: 'var(--red-light)', color: 'var(--red-dark)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, border: '1px solid rgba(180,35,24,.15)', fontSize: 'var(--text-sm)' }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red-dark)', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* ── Empty state ─── */}
      {tasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-title">All clear</div>
          <div className="empty-state-sub">
            Tasks appear here automatically when financial actions need attention — overdue debts, upcoming payments, and pending reminders.
            <br /><br />
            Tasks disappear only when the underlying source is fully resolved.
          </div>
          <button className="empty-state-cta" onClick={() => navigate('/')}>Back to Pulse</button>
        </div>
      )}

      {/* ── Task sections ─── */}
      {tasks.length > 0 && (
        <>
          <Section label="🔴 Urgent" labelColor="var(--red-dark)"  tasks={urgentTasks}   {...sectionProps} />
          <Section label="Today"                                    tasks={todayTasks}    {...sectionProps} />
          <Section label="Upcoming"                                 tasks={upcomingTasks} {...sectionProps} />

          {/* Persistence note */}
          <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', lineHeight: 1.7 }}>
              ℹ️ <strong>Tasks are source-based.</strong> A task disappears only when the underlying debt is paid or receivable is marked received. Reminder tasks resolve when you mark them done or snooze. No fake completion.
            </div>
          </div>
        </>
      )}

      {/* ── Navigation ─── */}
      <div style={{ textAlign: 'center', paddingTop: 20, paddingBottom: 8 }}>
        <button className="link-btn" onClick={() => navigate('/')}>View Pulse dashboard →</button>
      </div>

      {/* ── Payment modal ─── */}
      {payTask && (
        <DebtPaymentModal
          debt={payTask.debtObj}
          accounts={accounts}
          token={token}
          onClose={() => setPayTask(null)}
          onSuccess={handlePaySuccess}
        />
      )}
    </div>
  )
}
