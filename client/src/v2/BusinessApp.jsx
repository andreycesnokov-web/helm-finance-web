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

// Existing pages, reused verbatim.
import {
  BusinessPulse, BusinessTransactions, BusinessPayables, BusinessReceivables, BusinessInvoices,
  BusinessIncomingPayments, BusinessPaymentConnections, BusinessFunding, BusinessNew,
  BusinessIntercompany, BusinessDocuments,
} from '../pages/business'
import { BusinessAccountantHub } from '../pages/business/AccountantPremium'
import BusinessOnboarding from '../pages/business/Onboarding'
import TaxSplit from '../pages/business/TaxSplit'
import InvoiceSettlement from '../pages/business/InvoiceSettlement'
import Counterparties from '../pages/business/Counterparties'
import Accounts from '../pages/Accounts'
import AICFO from '../pages/AICFO'
import Radar from '../pages/Radar'
import Payroll from '../pages/Payroll'
import Approvals from '../pages/Approvals'
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
          <Route path="pulse" element={<Legacy><BusinessPulse /></Legacy>} />
          <Route path="radar" element={<Legacy><Radar /></Legacy>} />
          <Route path="performance" element={<Placeholder titleKey="nav.performance" icon="performance" />} />
          <Route path="performance/cash" element={<Placeholder titleKey="nav.performance" icon="performance" />} />
          <Route path="performance/forecast" element={<Placeholder titleKey="nav.performance" icon="performance" />} />
          <Route path="ai-cfo" element={<Legacy><AICFO /></Legacy>} />

          {/* Money */}
          <Route path="accounts" element={<Legacy><Accounts /></Legacy>} />
          <Route path="transactions" element={<Legacy><BusinessTransactions /></Legacy>} />
          <Route path="funding-investors" element={<Legacy><BusinessFunding /></Legacy>} />
          <Route path="assets" element={<Placeholder titleKey="nav.assets" icon="building" />} />
          <Route path="assets/new" element={<Placeholder titleKey="screen.addAsset" icon="building" />} />

          {/* Obligations */}
          <Route path="payables" element={<Legacy><BusinessPayables /></Legacy>} />
          <Route path="payables/:id" element={<Placeholder titleKey="screen.billDetail" icon="receipt" />} />
          <Route path="receivables" element={<Legacy><BusinessReceivables /></Legacy>} />
          <Route path="receivables/:id" element={<Placeholder titleKey="screen.invoiceDetail" icon="receipt" />} />
          <Route path="invoices" element={<Legacy><BusinessInvoices /></Legacy>} />
          <Route path="payroll" element={<Legacy><Payroll /></Legacy>} />
          <Route path="approvals" element={<Legacy><Approvals /></Legacy>} />
          <Route path="counterparties" element={<Legacy><Counterparties /></Legacy>} />
          <Route path="counterparties/new" element={<Placeholder titleKey="screen.addCounterparty" icon="users" />} />

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
