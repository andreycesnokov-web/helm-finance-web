// Design v2 — Business workspace app. Loaded lazily by App.jsx ONLY when
// VITE_DESIGN_V2=true; with the flag off this module is not in the bundle.
//
// Every path the legacy /business tree registered still resolves here (DESIGN_SPEC §3:
// "nothing is removed or renamed"). A screen not yet redesigned renders the existing
// page inside the new shell; a NEW route whose screen is not built yet renders a
// designed placeholder that links to the existing page covering the same ground.
//
// Workspace: Business only. BusinessLayout (auth + WorkspaceProvider) is the existing
// one; V2Frame redirects a personal active workspace to the first business exactly as
// the legacy BusinessShell does.
import { useEffect, useRef } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import './v2.css'
import { useWorkspace } from '../shell/WorkspaceProvider'
import {
  BusinessLayout,
} from '../pages/business'
import BankImport from './pages/BankImport'
import AddEntry from './pages/AddEntry'
import V2Shell from './shell/V2Shell'
import { V2DataProvider } from './data'
import { useT } from './i18n'
import { Skeleton, ErrorBox, Btn } from './ui'
import More from './pages/More'
import V2Pulse from './pages/Pulse'
import V2Radar from './pages/Radar'
import Bills from './pages/Bills'
import BillDetail from './pages/BillDetail'
import V2Approvals from './pages/Approvals'
import V2Counterparties from './pages/Counterparties'
import AddCounterparty from './pages/AddCounterparty'
import ProfitGroups from './pages/ProfitGroups'
import V2Accounts from './pages/Accounts'
import V2Transactions from './pages/Transactions'
import V2Payroll from './pages/Payroll'
import V2Funding from './pages/Funding'
import V2Accountant from './pages/Accountant'
import CompanyProfile from './pages/CompanyProfile'
import CompanyProfileEdit from './pages/CompanyProfileEdit'
import V2Documents from './pages/Documents'
import V2Settings from './pages/Settings'
import FirstDay from './pages/FirstDay'
import V2AICFO from './pages/AICFO'
import Performance from './pages/Performance'
import Assets from './pages/Assets'
import AddAsset from './pages/AddAsset'
import { AskProvider } from './ai/AskContext'
import { SetupFrame, SetupAbout, SetupStep } from './setup/Setup'
import MemberHome from './pages/MemberHome'
import AccountHistory from './pages/AccountHistory'
import InvoiceReview from './pages/InvoiceReview'
import Billing,{BillingBanner} from './pages/Billing'
import LegacyRedirect from './components/LegacyRedirect'
import { requestedBusiness, businessSwitchDestination } from '../lib/routeIntent'

// Manager / employee do not see company finances (the server refuses them): their pages.
export const MEMBER_ROLES = ['manager', 'employee']
const MEMBER_PATHS = ['/business/home', '/business/settings']

function V2Frame() {
  const t = useT()
  const loc = useLocation()
  const { workspaces, active, scopeKey, loading, error, applyActive, refresh } = useWorkspace()
  const requested = requestedBusiness(loc.search, workspaces)
  const resolvedLink = useRef(null)
  const mismatch = requested.status === 'available' && String(requested.business.id) !== String(active?.id)
  const switchedAfterLink = mismatch && resolvedLink.current === loc.key
  useEffect(() => {
    if (loading || error) return
    if (requested.status === 'available' && !mismatch) resolvedLink.current = loc.key
    if (requested.status === 'available' && mismatch && !switchedAfterLink) applyActive(requested.business)
    else if (requested.status === 'unspecified' && active?.type === 'personal' && workspaces.business?.[0]) applyActive(workspaces.business[0])
  }, [loading, error, requested.status, requested.business?.id, mismatch, switchedAfterLink, loc.key, active, workspaces, applyActive])
  // Hold children until membership is known and URL scope has been selected. No finance
  // request can be issued for the previously active company while resolving a deep link.
  if (loading) return <div className="v2-root v2-boot"><Skeleton rows={4} /></div>
  if (error) return <div className="v2-root v2-boot"><ErrorBox error={t('shell.loadError')} onRetry={refresh} /></div>
  if (requested.status === 'invalid' || requested.status === 'unavailable') return <div className="v2-root v2-boot"><ErrorBox error={t('route.companyUnavailable')} /><Btn to="/account">{t('shell.companies')}</Btn></div>
  if (switchedAfterLink) return <Navigate to={businessSwitchDestination(loc.pathname)} replace />
  if (!workspaces.business?.length) return <Navigate to="/account" replace />
  if (mismatch || active?.type === 'personal') return <div className="v2-root v2-boot"><Skeleton rows={4} /></div>
  if (!active) return null
  const member = MEMBER_ROLES.includes(active.role)
  if (member && !MEMBER_PATHS.some((p) => loc.pathname === p || loc.pathname.startsWith(p + '/'))) return <Navigate to="/business/home" replace />
  return (
    <V2DataProvider key={`${active.id}:${scopeKey}`}>
      <AskProvider>
        <V2Shell member={member}>{!member&&<BillingBanner/>}<Outlet /></V2Shell>
      </AskProvider>
    </V2DataProvider>
  )
}

export default function BusinessApp() {
  return (
    <Routes>
      <Route element={<BusinessLayout />}>
        {/* Company setup (reg/R4–R7): its own frame, no sidebar — the company may not exist yet. */}
        <Route element={<SetupFrame />}>
          <Route path="new" element={<SetupAbout />} />
          <Route path="setup/:step" element={<SetupStep />} />
        </Route>
        <Route element={<V2Frame />}>
          <Route path="home" element={<MemberHome />} />
          <Route path="billing" element={<Billing />} />
          <Route path="trial" element={<Billing />} />
          {/* Overview */}
          <Route path="pulse" element={<V2Pulse />} />
          <Route path="radar" element={<V2Radar />} />
          <Route path="performance" element={<Performance />} />
          <Route path="performance/cash" element={<Performance />} />
          <Route path="performance/forecast" element={<Performance />} />
          <Route path="performance/groups" element={<ProfitGroups />} />
          <Route path="ai-cfo" element={<V2AICFO />} />
          <Route path="ai-cfo/classic" element={<Navigate to="/business/ai-cfo" replace />} />
          {/* Money */}
          <Route path="accounts" element={<V2Accounts />} />
          <Route path="accounts/:id" element={<AccountHistory />} />
          <Route path="accounts/manage" element={<Navigate to="/business/accounts" replace />} />
          <Route path="transactions" element={<V2Transactions />} />
          <Route path="transactions/classic" element={<Navigate to="/business/transactions" replace />} />
          <Route path="funding-investors" element={<V2Funding />} />
          <Route path="assets" element={<Assets />} />
          <Route path="assets/new" element={<AddAsset />} />
          <Route path="bank-import" element={<BankImport />} />
          <Route path="incoming-payments" element={<Navigate to="/business/funding-investors" replace />} />
          <Route path="intercompany" element={<Navigate to="/business/funding-investors" replace />} />
          {/* Obligations */}
          <Route path="payables" element={<Bills key="pay" />} />
          <Route path="payables/classic" element={<Navigate to="/business/payables" replace />} />
          <Route path="payables/:id" element={<BillDetail kind="payable" />} />
          <Route path="receivables" element={<Bills key="collect" />} />
          <Route path="receivables/classic" element={<Navigate to="/business/receivables" replace />} />
          <Route path="receivables/:id" element={<BillDetail kind="receivable" />} />
          <Route path="invoices" element={<Bills key="all" />} />
          <Route path="invoices/:id" element={<BillDetail />} />
          <Route path="invoice-review/:mode" element={<InvoiceReview />} />
          <Route path="invoices/classic" element={<Navigate to="/business/invoices" replace />} />
          <Route path="payroll" element={<V2Payroll />} />
          <Route path="payroll/manage" element={<Navigate to="/business/payroll" replace />} />
          <Route path="approvals" element={<V2Approvals />} />
          <Route path="counterparties" element={<V2Counterparties />} />
          <Route path="counterparties/manage" element={<Navigate to="/business/counterparties" replace />} />
          <Route path="counterparties/new" element={<AddCounterparty />} />
          <Route path="counterparties/:id/edit" element={<AddCounterparty />} />
          {/* Accounting */}
          <Route path="documents" element={<V2Documents />} />
          <Route path="documents/classic" element={<Navigate to="/business/documents" replace />} />
          <Route path="accountant" element={<V2Accountant />} />
          <Route path="accountant/classic" element={<Navigate to="/business/accountant" replace />} />
          <Route path="accountant/calendar" element={<Navigate to="/business/accountant?tab=taxes" replace />} />
          <Route path="accountant/tax-profile" element={<CompanyProfile />} />
          <Route path="accountant/tax-profile/edit" element={<CompanyProfileEdit />} />
          <Route path="accountant/tax-split" element={<LegacyRedirect to="/business/invoice-review/tax-split" />} />
          <Route path="accountant/settlement" element={<LegacyRedirect to="/business/invoice-review/settlement" />} />
          {/* Settings and workspace */}
          <Route path="settings" element={<V2Settings />} />
          <Route path="settings/classic" element={<Navigate to="/business/settings" replace />} />
          <Route path="team" element={<LegacyRedirect to="/business/settings?tab=team" />} />
          <Route path="payment-connections" element={<LegacyRedirect to="/business/settings?tab=connections" />} />
          <Route path="onboarding" element={<FirstDay />} />
          <Route path="onboarding/classic" element={<Navigate to="/business/onboarding" replace />} />
          {/* Phone navigation */}
          <Route path="more" element={<More />} />
          <Route path="add" element={<AddEntry />} />
          <Route index element={<Navigate to="pulse" replace />} />
          <Route path="*" element={<Navigate to="/business/pulse" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
