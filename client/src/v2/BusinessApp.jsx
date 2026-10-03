// Design v2 — Business workspace routes (/business/*).
//
// Loaded only through the VITE_DESIGN_V2 guard in App.jsx, so with the flag OFF
// none of this (nor v2.css, nor the v2 dictionaries) is in the bundle.
//
// Every existing /business/* route is still here. Screens v2 has redrawn render
// their v2 page; the rest render their EXISTING component inside the v2 shell,
// unchanged. New screens from DESIGN_SPEC §3 that are not built yet show a
// designed placeholder.
import { Routes, Route, Navigate } from 'react-router-dom'
import './v2.css'
import V2Shell from './shell/V2Shell'
import { V2DataProvider } from './lib/data'
import Placeholder from './pages/Placeholder'
import More from './pages/More'
import Pulse from './pages/Pulse'
import Radar from './pages/Radar'
import Bills from './pages/Bills'
import BillDetail from './pages/BillDetail'
import ApprovalsV2 from './pages/Approvals'
import CounterpartiesV2 from './pages/Counterparties'
import AddCounterparty from './pages/AddCounterparty'
import AccountsV2 from './pages/Accounts'
import TransactionsV2 from './pages/Transactions'
import PayrollV2 from './pages/Payroll'
import FundingV2 from './pages/Funding'

// Existing pages, reused verbatim.
import {
  BusinessIncomingPayments, BusinessPaymentConnections, BusinessNew,
  BusinessIntercompany, BusinessDocuments,
} from '../pages/business'
import { BusinessAccountantHub } from '../pages/business/AccountantPremium'
import BusinessOnboarding from '../pages/business/Onboarding'
import TaxSplit from '../pages/business/TaxSplit'
import InvoiceSettlement from '../pages/business/InvoiceSettlement'
import AICFO from '../pages/AICFO'
import Team from '../pages/Team'
import Settings from '../pages/Settings'
import BankImport from '../pages/BankImport'
import Add from '../pages/Add'

/** An existing page inside the v2 frame, with the legacy page spacing kept. */
const Legacy = ({ children }) => <div className="v2-legacy">{children}</div>

export default function BusinessApp() {
  return (
    <V2DataProvider>
      <V2Shell>
        <Routes>
          {/* Overview */}
          <Route path="pulse" element={<Pulse />} />
          <Route path="radar" element={<Radar />} />
          <Route path="performance" element={<Placeholder titleKey="nav.performance" icon="performance" />} />
          <Route path="performance/cash" element={<Placeholder titleKey="nav.performance" icon="performance" />} />
          <Route path="performance/forecast" element={<Placeholder titleKey="nav.performance" icon="performance" />} />
          <Route path="ai-cfo" element={<Legacy><AICFO /></Legacy>} />

          {/* Money */}
          <Route path="accounts" element={<AccountsV2 />} />
          <Route path="transactions" element={<TransactionsV2 />} />
          <Route path="funding-investors" element={<FundingV2 />} />
          <Route path="assets" element={<Placeholder titleKey="nav.assets" icon="building" />} />
          <Route path="assets/new" element={<Placeholder titleKey="screen.addAsset" icon="building" />} />

          {/* Obligations */}
          <Route path="payables" element={<Bills />} />
          <Route path="payables/:id" element={<BillDetail />} />
          <Route path="receivables" element={<Bills />} />
          <Route path="receivables/:id" element={<BillDetail />} />
          <Route path="invoices" element={<Bills />} />
          <Route path="payroll" element={<PayrollV2 />} />
          <Route path="approvals" element={<ApprovalsV2 />} />
          <Route path="counterparties" element={<CounterpartiesV2 />} />
          <Route path="counterparties/new" element={<AddCounterparty />} />

          {/* Accounting */}
          <Route path="documents" element={<Legacy><BusinessDocuments /></Legacy>} />
          <Route path="accountant" element={<Legacy><BusinessAccountantHub /></Legacy>} />
          <Route path="accountant/packages" element={<Placeholder titleKey="screen.accountantPackages" icon="book" />} />
          <Route path="accountant/taxes" element={<Placeholder titleKey="screen.accountantTaxes" icon="calendar" />} />
          <Route path="accountant/tax-profile" element={<Placeholder titleKey="screen.companyProfile" icon="building" />} />
          <Route path="accountant/tax-split" element={<Legacy><TaxSplit /></Legacy>} />
          <Route path="accountant/settlement" element={<Legacy><InvoiceSettlement /></Legacy>} />

          {/* Settings & setup */}
          <Route path="settings" element={<Legacy><Settings /></Legacy>} />
          <Route path="team" element={<Legacy><Team /></Legacy>} />
          <Route path="onboarding" element={<Legacy><BusinessOnboarding /></Legacy>} />

          {/* Phone */}
          <Route path="add" element={<Legacy><Add /></Legacy>} />
          <Route path="more" element={<More />} />

          {/* Existing modules outside the v2 information architecture — unchanged. */}
          <Route path="bank-import" element={<Legacy><BankImport /></Legacy>} />
          <Route path="incoming-payments" element={<Legacy><BusinessIncomingPayments /></Legacy>} />
          <Route path="payment-connections" element={<Legacy><BusinessPaymentConnections /></Legacy>} />
          <Route path="intercompany" element={<Legacy><BusinessIntercompany /></Legacy>} />
          <Route path="new" element={<Legacy><BusinessNew /></Legacy>} />

          <Route path="*" element={<Navigate to="/business/pulse" replace />} />
        </Routes>
      </V2Shell>
    </V2DataProvider>
  )
}
