// Design v2 — the one table of screens, paths and navigation (DESIGN_SPEC §3).
//
// Plain JS (no JSX) so tests/design/v2 can import it directly and check that
// every screen in the spec has a route and every nav item points at one.
// Paths are the existing /business/* routes; new screens are additive.

export const P = {
  pulse: '/business/pulse',
  radar: '/business/radar',
  performance: '/business/performance',
  performanceCash: '/business/performance/cash',
  performanceForecast: '/business/performance/forecast',
  aiCfo: '/business/ai-cfo',
  accounts: '/business/accounts',
  transactions: '/business/transactions',
  funding: '/business/funding-investors',
  assets: '/business/assets',
  assetNew: '/business/assets/new',
  bills: '/business/payables',          // Bills & invoices: one page, three entry routes
  payables: '/business/payables',
  receivables: '/business/receivables',
  invoices: '/business/invoices',
  billDetail: (id) => `/business/payables/${encodeURIComponent(id)}`,
  invoiceDetail: (id) => `/business/receivables/${encodeURIComponent(id)}`,
  payroll: '/business/payroll',
  approvals: '/business/approvals',
  counterparties: '/business/counterparties',
  counterpartyNew: '/business/counterparties/new',
  documents: '/business/documents',
  accountant: '/business/accountant',
  accountantPackages: '/business/accountant/packages',
  accountantTaxes: '/business/accountant/taxes',
  companyProfile: '/business/accountant/tax-profile',
  settings: '/business/settings',
  team: '/business/team',
  onboarding: '/business/onboarding',
  add: '/business/add',
  more: '/business/more',
  newBusiness: '/business/new',
  personal: '/account',
  adminOverview: '/admin/dashboard',
  adminCompanies: '/admin/businesses',
  adminCompany: (id) => `/admin/businesses/${encodeURIComponent(id)}`,
  adminSystem: '/admin/system',
}

// Desktop sidebar / phone More groups. `badge` names a count from shellCounts().
export const NAV_GROUPS = [
  { key: 'overview', labelKey: 'nav.group.overview', items: [
    { key: 'pulse', labelKey: 'nav.pulse', to: P.pulse, icon: 'pulse' },
    { key: 'radar', labelKey: 'nav.radar', to: P.radar, icon: 'radar' },
    { key: 'performance', labelKey: 'nav.performance', to: P.performance, icon: 'performance',
      match: [P.performanceCash, P.performanceForecast] },
    { key: 'cfo', labelKey: 'nav.cfo', to: P.aiCfo, icon: 'spark' },
  ] },
  { key: 'money', labelKey: 'nav.group.money', items: [
    { key: 'accounts', labelKey: 'nav.accounts', to: P.accounts, icon: 'wallet' },
    { key: 'transactions', labelKey: 'nav.transactions', to: P.transactions, icon: 'list', badge: 'needsCategory' },
    { key: 'funding', labelKey: 'nav.funding', to: P.funding, icon: 'dollar' },
    { key: 'assets', labelKey: 'nav.assets', to: P.assets, icon: 'building', match: [P.assetNew] },
  ] },
  { key: 'obligations', labelKey: 'nav.group.obligations', items: [
    { key: 'bills', labelKey: 'nav.bills', to: P.bills, icon: 'receipt', badge: 'lateBills',
      match: [P.receivables, P.invoices, '/business/payables/', '/business/receivables/'] },
    { key: 'payroll', labelKey: 'nav.payroll', to: P.payroll, icon: 'userPlus' },
    { key: 'approvals', labelKey: 'nav.approvals', to: P.approvals, icon: 'checkCircle', badge: 'approvals' },
    { key: 'counterparties', labelKey: 'nav.counterparties', to: P.counterparties, icon: 'users',
      match: [P.counterpartyNew] },
  ] },
  { key: 'accounting', labelKey: 'nav.group.accounting', items: [
    { key: 'documents', labelKey: 'nav.documents', to: P.documents, icon: 'doc' },
    { key: 'accountant', labelKey: 'nav.accountant', to: P.accountant, icon: 'book',
      match: ['/business/accountant/'] },
  ] },
]

// Phone tab bar, in design order. `add` is the raised centre button.
export const TABS = [
  { key: 'pulse', labelKey: 'nav.pulse', to: P.pulse, icon: 'pulse' },
  { key: 'radar', labelKey: 'nav.radar', to: P.radar, icon: 'radar' },
  { key: 'add', labelKey: 'nav.add', to: P.add, icon: 'plus', primary: true },
  { key: 'cfo', labelKey: 'nav.cfo', to: P.aiCfo, icon: 'spark' },
  { key: 'more', labelKey: 'nav.more', to: P.more, icon: 'menu' },
]

/** Which nav item a pathname belongs to. Longest match wins. */
export function activeNavKey(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/'
  let best = null; let bestLen = -1
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const cands = [it.to, ...(it.match || [])]
      for (const c of cands) {
        const hit = c.endsWith('/') ? path.startsWith(c) : (path === c || path.startsWith(c + '/'))
        if (hit && c.length > bestLen) { best = it.key; bestLen = c.length }
      }
    }
  }
  if (path === P.settings || path === P.team) return 'settings'
  return best
}

/** Which phone tab is lit. Anything outside the four tab screens lights More. */
export function activeTabKey(pathname) {
  const k = activeNavKey(pathname)
  if (k === 'pulse' || k === 'radar' || k === 'cfo') return k
  if (String(pathname).startsWith(P.add)) return 'add'
  return 'more'
}

// Every screen from DESIGN_SPEC §3 that has a route of its own (overlays — the
// AI CFO panel — have none). Used by the route-coverage test.
export const SPEC_SCREENS = {
  Main: P.pulse, PulseMobile: P.pulse, Radar: P.radar, RadarMobile: P.radar,
  AICFO: P.aiCfo, AICFOMobile: P.aiCfo,
  Performance: P.performance, PerformanceCash: P.performanceCash,
  PerformanceForecast: P.performanceForecast, PerformanceMobile: P.performance,
  PerformanceApril: P.performance,
  Accounts: P.accounts, Transactions: P.transactions, Funding: P.funding,
  Assets: P.assets, AddAsset: P.assetNew,
  Bills: P.payables, MobileBills: P.payables, BillDetail: '/business/payables/:id',
  Payroll: P.payroll, Approvals: P.approvals, MobileApprovals: P.approvals,
  Counterparties: P.counterparties, AddCounterparty: P.counterpartyNew,
  Documents: P.documents,
  Accountant: P.accountant, AccountantPackages: P.accountantPackages,
  AccountantTaxes: P.accountantTaxes, CompanyProfile: P.companyProfile,
  Settings: P.settings, FirstDay: P.onboarding,
  MobileAdd: P.add, MobileMore: P.more,
  AdminOverview: P.adminOverview, AdminCompanies: P.adminCompanies, AdminSystem: P.adminSystem,
}
