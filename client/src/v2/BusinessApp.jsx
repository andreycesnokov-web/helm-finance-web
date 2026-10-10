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
import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import './v2.css'
import { useWorkspace } from '../shell/WorkspaceProvider'
import {
  BusinessLayout, BusinessIncomingPayments, BusinessIntercompany,
} from '../pages/business'
import TaxSplit from '../pages/business/TaxSplit'
import InvoiceSettlement from '../pages/business/InvoiceSettlement'
import Counterparties from '../pages/business/Counterparties'
import Payroll from '../pages/Payroll'
import BankImport from './pages/BankImport'
import AddEntry from './pages/AddEntry'
import V2Shell from './shell/V2Shell'
import { V2DataProvider } from './data'
import { useT } from './i18n'
import { Skeleton, ErrorBox } from './ui'
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

function V2Frame() {
  const t = useT()
  const { workspaces, active, loading, error, applyActive, refresh } = useWorkspace()
  useEffect(() => {
    if (!loading && active && active.type === 'personal' && workspaces.business?.[0]) applyActive(workspaces.business[0])
  }, [loading, active, workspaces, applyActive])
  if (loading && !active) return <div className="v2-root v2-boot"><Skeleton rows={4} /></div>
  if (error && !active) return <div className="v2-root v2-boot"><ErrorBox error={t('shell.loadError')} onRetry={refresh} /></div>
  if (!active) return null
  return (
    <V2DataProvider>
      <AskProvider>
        <V2Shell><Outlet /></V2Shell>
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
          <Route path="accounts/manage" element={<Navigate to="/business/accounts" replace />} />
          <Route path="transactions" element={<V2Transactions />} />
          <Route path="transactions/classic" element={<Navigate to="/business/transactions" replace />} />
          <Route path="funding-investors" element={<V2Funding />} />
          <Route path="assets" element={<Assets />} />
          <Route path="assets/new" element={<AddAsset />} />
          <Route path="bank-import" element={<BankImport />} />
          <Route path="incoming-payments" element={<BusinessIncomingPayments />} />
          <Route path="intercompany" element={<BusinessIntercompany />} />
          {/* Obligations */}
          <Route path="payables" element={<Bills key="pay" />} />
          <Route path="payables/classic" element={<Navigate to="/business/payables" replace />} />
          <Route path="payables/:id" element={<BillDetail kind="payable" />} />
          <Route path="receivables" element={<Bills key="collect" />} />
          <Route path="receivables/classic" element={<Navigate to="/business/receivables" replace />} />
          <Route path="receivables/:id" element={<BillDetail kind="receivable" />} />
          <Route path="invoices" element={<Bills key="all" />} />
          <Route path="invoices/classic" element={<Navigate to="/business/invoices" replace />} />
          <Route path="payroll" element={<V2Payroll />} />
          <Route path="payroll/manage" element={<Payroll />} />
          <Route path="approvals" element={<V2Approvals />} />
          <Route path="counterparties" element={<V2Counterparties />} />
          <Route path="counterparties/manage" element={<Counterparties />} />
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
          <Route path="accountant/tax-split" element={<TaxSplit />} />
          <Route path="accountant/settlement" element={<InvoiceSettlement />} />
          {/* Settings and workspace */}
          <Route path="settings" element={<V2Settings />} />
          <Route path="settings/classic" element={<Navigate to="/business/settings" replace />} />
          <Route path="team" element={<Navigate to="/business/settings?tab=team" replace />} />
          <Route path="payment-connections" element={<Navigate to="/business/settings?tab=connections" replace />} />
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
