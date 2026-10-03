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
  BusinessLayout, BusinessTransactions, BusinessPayables, BusinessReceivables,
  BusinessInvoices, BusinessIncomingPayments, BusinessPaymentConnections, BusinessFunding,
  BusinessNew, BusinessIntercompany, BusinessDocuments,
} from '../pages/business'
import { BusinessAccountantHub } from '../pages/business/AccountantPremium'
import BusinessOnboarding from '../pages/business/Onboarding'
import TaxSplit from '../pages/business/TaxSplit'
import InvoiceSettlement from '../pages/business/InvoiceSettlement'
import Counterparties from '../pages/business/Counterparties'
import Accounts from '../pages/Accounts'
import AICFO from '../pages/AICFO'
import Payroll from '../pages/Payroll'
import Approvals from '../pages/Approvals'
import Team from '../pages/Team'
import Settings from '../pages/Settings'
import BankImport from '../pages/BankImport'
import Add from '../pages/Add'
import V2Shell from './shell/V2Shell'
import { V2DataProvider } from './data'
import { useT } from './i18n'
import { Skeleton, ErrorBox } from './ui'
import More from './pages/More'
import V2Pulse from './pages/Pulse'
import V2Radar from './pages/Radar'
import Placeholder from './pages/Placeholder'

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
      <V2Shell><Outlet /></V2Shell>
    </V2DataProvider>
  )
}

export default function BusinessApp() {
  return (
    <Routes>
      <Route element={<BusinessLayout />}>
        <Route element={<V2Frame />}>
          {/* Overview */}
          <Route path="pulse" element={<V2Pulse />} />
          <Route path="radar" element={<V2Radar />} />
          <Route path="performance" element={<Placeholder titleKey="screen.performance" icon="performance" />} />
          <Route path="performance/cash" element={<Placeholder titleKey="screen.performanceCash" icon="performance" />} />
          <Route path="performance/forecast" element={<Placeholder titleKey="screen.performanceForecast" icon="radar" current="/business/radar" />} />
          <Route path="ai-cfo" element={<AICFO />} />
          {/* Money */}
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<BusinessTransactions />} />
          <Route path="funding-investors" element={<BusinessFunding />} />
          <Route path="assets" element={<Placeholder titleKey="screen.assets" icon="assets" />} />
          <Route path="assets/new" element={<Placeholder titleKey="screen.addAsset" icon="assets" />} />
          <Route path="bank-import" element={<BankImport />} />
          <Route path="incoming-payments" element={<BusinessIncomingPayments />} />
          <Route path="intercompany" element={<BusinessIntercompany />} />
          {/* Obligations */}
          <Route path="payables" element={<BusinessPayables />} />
          <Route path="payables/:id" element={<Placeholder titleKey="screen.billDetail" icon="bills" current="/business/payables" />} />
          <Route path="receivables" element={<BusinessReceivables />} />
          <Route path="invoices" element={<BusinessInvoices />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="counterparties" element={<Counterparties />} />
          <Route path="counterparties/new" element={<Placeholder titleKey="screen.addCounterparty" icon="counterparties" current="/business/counterparties" />} />
          {/* Accounting */}
          <Route path="documents" element={<BusinessDocuments />} />
          <Route path="accountant" element={<BusinessAccountantHub />} />
          <Route path="accountant/tax-profile" element={<Placeholder titleKey="screen.companyProfile" icon="accountant" current="/business/accountant" />} />
          <Route path="accountant/tax-split" element={<TaxSplit />} />
          <Route path="accountant/settlement" element={<InvoiceSettlement />} />
          {/* Settings and workspace */}
          <Route path="settings" element={<Settings />} />
          <Route path="team" element={<Team />} />
          <Route path="payment-connections" element={<BusinessPaymentConnections />} />
          <Route path="onboarding" element={<BusinessOnboarding />} />
          <Route path="new" element={<BusinessNew />} />
          {/* Phone navigation */}
          <Route path="more" element={<More />} />
          <Route path="add" element={<Add />} />
          <Route index element={<Navigate to="pulse" replace />} />
          <Route path="*" element={<Navigate to="/business/pulse" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
