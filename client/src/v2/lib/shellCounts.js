// Sidebar / More badges, derived from the existing GET /api/pulse?scope=business
// response. Pure and tested (tests/design/v2ShellCounts.test.mjs). Counts only —
// no amounts — and every count follows the server's own definitions:
//   late          debts the server marks status 'overdue' (enrichDebts), excluding
//                 drafts still waiting for approval and rejected ones
//   approvals     debts with approval_status 'pending_approval' that are still open
//   needsCategory the server's needs_review_count for the month
// A missing response yields nulls, and a null badge is not rendered.

const OPEN = (d) => !['paid', 'cancelled'].includes(d?.status)

export function shellCounts(pulse) {
  if (!pulse || typeof pulse !== 'object') return { late: null, approvals: null, needsCategory: null }
  const debts = Array.isArray(pulse.debts) ? pulse.debts : []
  const confirmed = (d) => d.approval_status === 'approved' || !d.approval_status
  const late = debts.filter((d) => d.status === 'overdue' && confirmed(d)).length
  const approvals = debts.filter((d) => d.approval_status === 'pending_approval' && OPEN(d)).length
  const n = Number(pulse.needs_review_count)
  return { late, approvals, needsCategory: Number.isFinite(n) ? n : null }
}

export default shellCounts
