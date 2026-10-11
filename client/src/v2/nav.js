// Design v2 information architecture (designs/Sidebar.dc.html, MobileMore.dc.html).
//
// Plain data so the shell, the More screen and the tests read one model. `match`
// lists every path that lights the item up, so e.g. /business/receivables and a bill
// detail page both keep "Bills & invoices" active.
export const BASE = '/business'

export const NAV_GROUPS = [
  { key: 'overview', labelKey: 'nav.group.overview', items: [
    { key: 'pulse', labelKey: 'nav.pulse', to: '/business/pulse', icon: 'pulse' },
    { key: 'radar', labelKey: 'nav.radar', to: '/business/radar', icon: 'radar' },
    { key: 'performance', labelKey: 'nav.performance', to: '/business/performance', icon: 'performance',
      match: ['/business/performance'] },
    { key: 'cfo', labelKey: 'nav.cfo', to: '/business/ai-cfo', icon: 'cfo' },
  ] },
  { key: 'money', labelKey: 'nav.group.money', items: [
    { key: 'accounts', labelKey: 'nav.accounts', to: '/business/accounts', icon: 'accounts' },
    { key: 'transactions', labelKey: 'nav.transactions', to: '/business/transactions', icon: 'transactions',
      badge: 'needsCategory', match: ['/business/transactions', '/business/bank-import'] },
    { key: 'funding', labelKey: 'nav.funding', to: '/business/funding-investors', icon: 'funding',
      match: ['/business/funding-investors', '/business/intercompany'] },
    { key: 'assets', labelKey: 'nav.assets', to: '/business/assets', icon: 'assets', match: ['/business/assets'] },
  ] },
  { key: 'obligations', labelKey: 'nav.group.obligations', items: [
    { key: 'bills', labelKey: 'nav.bills', to: '/business/payables', icon: 'bills', badge: 'late',
      match: ['/business/payables', '/business/receivables', '/business/invoices', '/business/incoming-payments'] },
    { key: 'payroll', labelKey: 'nav.payroll', to: '/business/payroll', icon: 'payroll' },
    { key: 'approvals', labelKey: 'nav.approvals', to: '/business/approvals', icon: 'approvals', badge: 'approvals' },
    { key: 'counterparties', labelKey: 'nav.counterparties', to: '/business/counterparties', icon: 'counterparties',
      match: ['/business/counterparties'] },
  ] },
  { key: 'accounting', labelKey: 'nav.group.accounting', items: [
    { key: 'documents', labelKey: 'nav.documents', to: '/business/documents', icon: 'documents' },
    { key: 'accountant', labelKey: 'nav.accountant', to: '/business/accountant', icon: 'accountant',
      match: ['/business/accountant'] },
  ] },
]

export const SETTINGS_ITEM = {
  key: 'settings', labelKey: 'nav.settings', to: '/business/settings', icon: 'settings',
  match: ['/business/settings', '/business/team', '/business/payment-connections', '/business/onboarding', '/business/new'],
}

// Phone bottom tab bar: Pulse · Radar · + Add · AI CFO · More (DESIGN_SPEC §2).
export const TABS = [
  { key: 'pulse', labelKey: 'nav.pulse', to: '/business/pulse', icon: 'pulse' },
  { key: 'radar', labelKey: 'nav.radar', to: '/business/radar', icon: 'radar' },
  // "+ Add" opens the v2 Add page (pages/AddEntry.jsx): business scope always, never the
  // legacy page that defaulted to 'personal' (review 8.2 #3).
  { key: 'add', labelKey: 'nav.add', to: '/business/add', icon: 'plus', primary: true },
  { key: 'cfo', labelKey: 'nav.cfo', to: '/business/ai-cfo', icon: 'cfo' },
  { key: 'more', labelKey: 'nav.more', to: '/business/more', icon: 'menu' },
]

const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM]

const under = (path, prefix) => path === prefix || path.startsWith(prefix + '/')

/** The sidebar item a pathname belongs to, or null. */
export function activeNavKey(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '')
  let best = null, bestLen = -1
  for (const it of ALL_ITEMS) {
    for (const m of [it.to, ...(it.match || [])]) {
      if (under(p, m) && m.length > bestLen) { best = it.key; bestLen = m.length }
    }
  }
  return best
}

/** The bottom tab a pathname belongs to: one of the four destinations, else More. */
export function activeTabKey(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '')
  if (under(p, '/business/add')) return 'add'
  const k = activeNavKey(p)
  if (k === 'pulse' || k === 'radar' || k === 'cfo') return k
  return 'more'
}

export function allNavItems() { return ALL_ITEMS }
