// Platform admin (design v2) — pure helpers over GET /api/admin/dashboard and
// GET /api/admin/businesses. Counts and statuses only: no client balances, transactions
// or documents are read (DESIGN_SPEC rule 7). Tested in v2AdminModel.test.mjs.

const DAY = 86400000
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY)

/** Company status for the list. Order matters: the first match wins. */
export function companyStatus(b, now = new Date()) {
  if (b.status === 'archived') return 'archived'
  if (['past_due', 'unpaid'].includes(b.subscription_status)) return 'pastDue'
  if (b.trial_status_effective === 'active' && b.trial_ends_at && daysBetween(now, b.trial_ends_at) <= 7) return 'trialEnds'
  if ((b.wallet_count || 0) === 0 && b.created_at && daysBetween(b.created_at, now) > 14) return 'setupStuck'
  return 'healthy'
}
export const NEEDS_ATTENTION = new Set(['pastDue', 'trialEnds', 'setupStuck'])

/** Setup steps the list can see without opening client data: accounts, activity. */
export function setupScore(b) {
  return { done: ((b.wallet_count || 0) > 0 ? 1 : 0) + ((b.transactions_this_month || 0) > 0 ? 1 : 0), of: 2 }
}

export function isPaying(b) {
  return b.effective_access_source === 'subscription'
}

/** List filters: all | paying | trial | attention, plus a search over name/code. */
export function filterCompanies(list = [], { filter = 'all', q = '', now = new Date() } = {}) {
  const needle = q.trim().toLowerCase()
  return list
    .filter((b) => (b.type || 'business') !== 'personal')
    .filter((b) => filter === 'all'
      || (filter === 'paying' && isPaying(b))
      || (filter === 'trial' && b.trial_status_effective === 'active')
      || (filter === 'attention' && NEEDS_ATTENTION.has(companyStatus(b, now))))
    .filter((b) => !needle || [b.name, b.business_code, b.owner?.name].some((v) => String(v || '').toLowerCase().includes(needle)))
    .sort((a, b) => String(b.last_activity || '').localeCompare(String(a.last_activity || '')))
}

/** Overview aggregates from the business list. */
export function overview(list = [], now = new Date()) {
  const companies = list.filter((b) => (b.type || 'business') !== 'personal')
  const personal = list.filter((b) => b.type === 'personal')
  const plans = {}
  for (const b of companies) { const p = b.effective_plan || 'free'; plans[p] = (plans[p] || 0) + 1 }
  const trials = companies.filter((b) => b.trial_status_effective === 'active')
  const recent = companies.filter((b) => b.created_at && daysBetween(b.created_at, now) <= 30)
  return {
    companies: companies.length, personal: personal.length, plans,
    paying: companies.filter(isPaying).length,
    trials: trials.length,
    trialsEndingWeek: trials.filter((b) => b.trial_ends_at && daysBetween(now, b.trial_ends_at) <= 7).length,
    funnel: {
      signedUp: recent.length,
      accounts: recent.filter((b) => (b.wallet_count || 0) > 0).length,
      active: recent.filter((b) => (b.transactions_this_month || 0) > 0).length,
    },
    attention: companies.filter((b) => NEEDS_ATTENTION.has(companyStatus(b, now))).length,
  }
}

// The dashboard sends sanitized English warnings (server/index.js, /api/admin/dashboard).
// Two are static — they are sent on every load and say a metric is not built — so they are
// not "needs you" items. The rest map to i18n keys; anything unknown is shown as a generic
// warning with the server text as the detail.
const STATIC_WARNINGS = [/not computed \(requires per-business aggregation\)/i, /duplicate_email_conflicts: unavailable/i]
const WARNING_KEYS = [
  [/^(.+): unavailable \(database error\)$/i, 'dbError'],
  [/timed out/i, 'timeout'],
  [/safety cap/i, 'cap'],
  [/inconsistent counts/i, 'inconsistent'],
  [/truncated/i, 'cap'],
]
/** One dashboard warning → { key, what? } for i18n, or null for a static warning. */
export function warningItem(text) {
  const s = String(text || '')
  if (!s || STATIC_WARNINGS.some((re) => re.test(s))) return null
  for (const [re, key] of WARNING_KEYS) {
    const m = re.exec(s)
    if (m) return key === 'dbError' ? { key, what: m[1] } : { key }
  }
  return { key: 'other', detail: s }
}

/** Needs-you items from the dashboard response. */
export function needsYou(dash, ov) {
  const out = []
  if (dash?.system?.degraded || dash?.system?.db_reachable === false) out.push({ tone: 'crit', key: 'dbDegraded' })
  for (const w of dash?.warnings || []) {
    const it = warningItem(w)
    if (it) out.push({ tone: 'warn', key: `warn.${it.key}`, what: it.what, detail: it.detail })
  }
  if (ov?.trialsEndingWeek) out.push({ tone: 'warn', key: 'trialsEnding', n: ov.trialsEndingWeek })
  const r = dash?.identity_risks || {}
  if (r.users_without_login_identity) out.push({ tone: 'warn', key: 'noLogin', n: r.users_without_login_identity })
  if (!out.length) out.push({ tone: 'good', key: 'allGood' })
  return out
}
