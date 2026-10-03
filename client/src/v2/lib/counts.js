// Nav badge counts, derived from the GET /api/pulse?scope=business payload the
// shell already loads. Pure — tested in tests/design/v2/counts.test.mjs.
//
// - needsCategory: pulse.needs_review_count (transactions the classifier could
//   not place; the server's own figure, not recomputed).
// - lateBills: open, approved debts whose server-derived status is 'overdue'.
// - approvals: debts still waiting for approval (approval_status pending_approval,
//   not paid/cancelled) — the same rule Pulse uses for pendingDebts.
export function shellCounts(pulse) {
  if (!pulse || typeof pulse !== 'object') return { needsCategory: 0, lateBills: 0, approvals: 0 }
  const debts = Array.isArray(pulse.debts) ? pulse.debts : []
  const live = debts.filter((d) => !['paid', 'cancelled'].includes(d.status))
  const approved = live.filter((d) => d.approval_status === 'approved' || !d.approval_status)
  return {
    needsCategory: Number(pulse.needs_review_count || 0),
    lateBills: approved.filter((d) => d.status === 'overdue').length,
    approvals: live.filter((d) => d.approval_status === 'pending_approval').length,
  }
}

/** Open debts in the same sense as the server's openDebts (pulse endpoint). */
export function openApprovedDebts(debts) {
  return (Array.isArray(debts) ? debts : []).filter((d) =>
    !['paid', 'cancelled'].includes(d.status) && (d.approval_status === 'approved' || !d.approval_status))
}

export function pendingDebts(debts) {
  return (Array.isArray(debts) ? debts : []).filter((d) =>
    d.approval_status === 'pending_approval' && !['paid', 'cancelled'].includes(d.status))
}

/** Same expression the pulse endpoint uses for receivables/payables totals. */
export const remainingOf = (d) => Number(d.remaining_amount || d.amount || 0)
