// AI CFO page (design v2) over GET /api/ai-cfo/context. Pure; tested in v2CfoModel.test.mjs.
// Every figure — CFO score and its five factors, next actions, runway, receivables — is
// computed server-side (calculateCfoScore, buildNextActionsV2). This module only orders,
// maps legacy routes to v2 routes, and assembles the weekly-brief sentences from those
// figures. Personal fields in the context (wallets_summary.personal_cash) are never read.

export const FACTORS = ['cash_health', 'runway', 'receivables', 'payables', 'expense_control']

// Legacy app routes in next_actions → v2 business routes.
const ROUTE_MAP = {
  '/receivables': '/business/receivables', '/payables': '/business/payables', '/radar': '/business/radar',
  '/transactions': '/business/transactions', '/payroll': '/business/payroll', '/accounts': '/business/accounts',
  '/approvals': '/business/approvals', '/accountant': '/business/accountant', '/accountant/calendar': '/business/accountant?tab=taxes',
  '/accountant/tax-profile': '/business/accountant/tax-profile', '/documents': '/business/documents', '/cfo': '/business/ai-cfo',
  '/': '/business/pulse', '/team': '/business/team', '/settings': '/business/settings', '/bank-import': '/business/bank-import',
}
export function mapRoute(route) {
  if (!route) return null
  if (route.startsWith('/business/')) return route
  return ROUTE_MAP[route] || null
}

const PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 }
/** Top recommended decisions, most urgent first. */
export function topDecisions(ctx, n = 3) {
  const list = Array.isArray(ctx?.next_actions) ? ctx.next_actions : []
  return [...list].sort((a, b) => (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9)).slice(0, n)
    .map((a) => ({ ...a, to: mapRoute(a.route) }))
}

export function scoreTone(status) { return status === 'healthy' ? 'good' : status === 'warning' ? 'warn' : status === 'critical' ? 'crit' : 'neutral' }

/** Weekly brief as keyed sentences (copy lives in i18n). */
export function briefParts(ctx) {
  if (!ctx) return []
  const out = []
  const m = ctx.current_month || {}
  const recv = ctx.receivables || {}
  const runway = ctx.runway_days
  if (Number(m.expenses) > 0 || Number(m.income) > 0) {
    out.push(Number(m.net_flow) < 0 ? { key: 'cfo.brief.loss', v: { v: -Number(m.net_flow) } } : { key: 'cfo.brief.gain', v: { v: Number(m.net_flow) } })
  }
  if (runway != null) out.push({ key: 'cfo.brief.runway', v: { n: runway } })
  if (Number(recv.total_remaining) > 0) out.push({ key: 'cfo.brief.owed', v: { v: Number(recv.total_remaining) } })
  if (Number(recv.overdue_total) > 0) out.push({ key: 'cfo.brief.late', v: { v: Number(recv.overdue_total), n: recv.overdue_count } })
  if (ctx.pending_submissions?.count > 0) out.push({ key: 'cfo.brief.pending', v: { n: ctx.pending_submissions.count } })
  return out
}

export function questionsLeft(ctx) {
  const u = ctx?.usage || {}
  const max = u.max_ai_questions_per_month
  if (max == null) return null
  const rem = u.remaining_ai_questions ?? max
  return { left: rem, max }
}
