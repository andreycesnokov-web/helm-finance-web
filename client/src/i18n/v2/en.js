// Design v2 strings — EN is the final wording from _specs/design-v2/designs.
// Flat keys; {name} placeholders. Loaded only by client/src/v2 (VITE_DESIGN_V2).
const en = {
  // navigation
  'nav.group.overview': 'Overview',
  'nav.group.money': 'Money',
  'nav.group.obligations': 'Obligations',
  'nav.group.accounting': 'Accounting',
  'nav.pulse': 'Pulse',
  'nav.radar': 'Radar',
  'nav.performance': 'Performance',
  'nav.cfo': 'AI CFO',
  'nav.accounts': 'Accounts',
  'nav.transactions': 'Transactions',
  'nav.funding': 'Funding',
  'nav.assets': 'Assets & balance',
  'nav.bills': 'Bills & invoices',
  'nav.payroll': 'Payroll',
  'nav.approvals': 'Approvals',
  'nav.counterparties': 'Counterparties',
  'nav.documents': 'Documents',
  'nav.accountant': 'AI Accountant',
  'nav.settings': 'Settings',
  'nav.settingsLong': 'Settings, team and connections',
  'nav.admin': 'Platform admin',
  'nav.adminOnlyYou': 'Only you',
  'nav.switchPersonal': 'Switch to Personal',
  'nav.add': 'Add',
  'nav.addHint': 'text · voice · invoice',
  'nav.more': 'More',
  'nav.late': '{n} late',
  'nav.mainNav': 'Main navigation',
  'nav.tabBar': 'Primary',

  // shell
  'shell.companyRole': 'Company · {role}',
  'shell.company': 'Company',
  'shell.switchHint': 'Switch company or go to Personal',
  'shell.switchWorkspace': 'Switch workspace',
  'shell.personalWorkspace': 'Personal',
  'shell.newBusiness': 'Add a business',
  'shell.approvalsBell': 'Approvals waiting',
  'shell.openMore': 'Open the menu',
  'shell.loading': 'Loading…',
  'shell.loadFailed': 'Couldn’t load your workspaces',
  'shell.skip': 'Skip to content',
  'shell.retry': 'Try again',

  // placeholder / honest states
  'ph.title': 'This screen is on its way',
  'ph.body': '{screen} is part of the new design and arrives in a later update. Nothing here is lost — the rest of the app works as before.',
  'ph.back': 'Back to Pulse',
  'state.notYet': 'Not available yet',
  'state.notSetUp': 'Not set up yet',
  'state.comingSoon': 'Coming soon',
  'state.loadFailed': 'We couldn’t load this',
  'state.retry': 'Try again',
  'state.empty': 'Nothing here yet',

  // More
  'more.title': 'More',

  // screen names (placeholders, page titles)
  'screen.addAsset': 'Add asset',
  'screen.billDetail': 'Bill',
  'screen.invoiceDetail': 'Invoice',
  'screen.addCounterparty': 'Add counterparty',
  'screen.accountantPackages': 'Documents by transaction',
  'screen.accountantTaxes': 'Tax calendar',
  'screen.companyProfile': 'Company profile',
}
export default en
