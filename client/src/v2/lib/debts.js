// Bills & invoices helpers — pure, tested in tests/design/v2/obligations.test.mjs.
// Status comes from the server (computeDebtStatus: open/partial/overdue/paid/
// cancelled) and approval_status; nothing is recomputed here except grouping.
import { remainingOf } from './counts.js'

export const isLive = (d) => !['paid', 'cancelled'].includes(d.status) && d.approval_status !== 'rejected'
export const isPending = (d) => d.approval_status === 'pending_approval' && isLive(d)

/** { key, tone } — key is an i18n key under bills.st.* */
export function debtStatus(d) {
  if (d.approval_status === 'rejected') return { key: 'rejected', tone: 'neutral' }
  if (d.status === 'cancelled') return { key: 'cancelled', tone: 'neutral' }
  if (d.status === 'paid') return { key: 'paid', tone: 'good' }
  if (d.approval_status === 'pending_approval') return { key: 'pending', tone: 'info' }
  if (d.status === 'overdue') return { key: d.type === 'receivable' ? 'late' : 'overdue', tone: 'critical' }
  if (d.status === 'partial') return { key: 'partial', tone: 'warning' }
  return { key: d.type === 'receivable' ? 'open' : 'approved', tone: d.type === 'receivable' ? 'neutral' : 'good' }
}

export function summarize(debts, now = new Date()) {
  const list = Array.isArray(debts) ? debts : []
  const in14 = new Date(now.getTime() + 14 * 86400000)
  const side = (type) => {
    const live = list.filter((d) => d.type === type && isLive(d))
    const approved = live.filter((d) => !isPending(d))
    const sum = (a) => a.reduce((s, d) => s + remainingOf(d), 0)
    const late = approved.filter((d) => d.status === 'overdue')
    return {
      count: approved.length,
      total: sum(approved),
      late: sum(late), lateCount: late.length,
      pending: sum(live.filter(isPending)), pendingCount: live.filter(isPending).length,
      due14: sum(approved.filter((d) => d.status !== 'overdue' && d.due_date && new Date(d.due_date) <= in14)),
    }
  }
  return { in: side('receivable'), out: side('payable') }
}

/** Rows for a tab: type + 'open' (live) or 'paid'. Late first, then by due date. */
export function rowsFor(debts, type, which = 'open') {
  const list = (Array.isArray(debts) ? debts : []).filter((d) => d.type === type)
  const rows = which === 'paid' ? list.filter((d) => d.status === 'paid') : list.filter(isLive)
  const rank = (d) => (d.status === 'overdue' ? 0 : isPending(d) ? 1 : 2)
  return rows.sort((a, b) => rank(a) - rank(b) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
}

/** Recently decided approvals (approved or rejected), newest first. */
export function recentlyDecided(debts, limit = 5) {
  return (Array.isArray(debts) ? debts : [])
    .filter((d) => d.approved_at && ['approved', 'rejected'].includes(d.approval_status))
    .sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at)))
    .slice(0, limit)
}

export const asList = (data) => (Array.isArray(data) ? data : Array.isArray(data?.debts) ? data.debts : [])
