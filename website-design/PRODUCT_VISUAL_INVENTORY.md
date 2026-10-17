# CFO AI — Product Visual Inventory & Interface Truth Audit
## Release Candidate UI Asset Inventory for Public Marketing (V3)

**Document Version:** 3.0  
**Audit Date:** 2026-10-16  
**Auditor:** AntiGravity (Senior Product Designer / B2B SaaS UX Strategist)  
**Codebase Branch:** `fix/accountant-may-audit-and-batch-selection` @ `dac9b1d`  
**Governing Rule:** `AGENTS.md` strictly observed (DESIGN ONLY — Zero modifications to production code, auth, billing, database migrations, or Railway settings).

---

### 1. Executive Summary & Classification Standard

Per the V3 Master Brief, marketing visuals must show **authentic CFO AI application UI** rather than abstract illustrations. To prevent misrepresentation, all candidate visual assets are classified under strict criteria:

- **VERIFIED AVAILABLE:** Active in the codebase, reachable via authenticated routes, supports synthetic company data, verified in current release candidate.
- **VERIFIED BETA:** Implemented in release candidate pilot, actively functional under controlled conditions.
- **IN DEVELOPMENT:** Under active engineering; functional components exist but requires feature flags or staging test harness.
- **PLANNED:** Architectural design stage or future roadmap; must be clearly labeled "Coming Soon".
- **UNVERIFIED:** Component exists in codebase but end-to-end functionality has not been verified in the local test suite.

---

### 2. Comprehensive Product Visual Inventory

| ID | Feature Name | Application Route | Source Component(s) | Working Status | Feature Flag | Paid Access Tier | Marketing Suitability | Synthetic Data Model | Visual Type | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **UI-01** | **Pulse Financial Command Center** | `/business/pulse` | `client/src/v2/pages/Pulse.jsx`, `client/src/pages/business/PulseBlocks.jsx` | Fully Functional | `VITE_DESIGN_V2=true` (Default fallback to legacy Pulse) | Starter ($59), Control ($149), Pro ($299) | **Flagship Marketing Hero Visual** | PT Nusantara Solusi Digital (Cash: Rp 3.120.000.000, 162d runway, 4 accounts) | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-02** | **Cash Flow Trend & 6-Month Comparison** | `/business/radar`, `/business/performance` | `client/src/v2/charts/BarChart.jsx`, `client/src/v2/charts/ForecastChart.jsx` | Fully Functional | `VITE_DESIGN_V2=true` | Starter ($59+), Advanced 90d on Control ($149+) | **Primary Chart Showcase** | Monthly Revenue vs Expenses (Oct 2025 - Mar 2026, IDR tabular nums) | Authentic SVG chart render (Labeled "Illustrative Demo Data") | **VERIFIED AVAILABLE** |
| **UI-03** | **Cash Runway & 30-Day Radar Forecast** | `/business/radar` | `client/src/v2/pages/Radar.jsx`, `client/src/v2/lib/radarSeries.js` | Fully Functional | `VITE_DESIGN_V2=true`, `advanced_radar_enabled` | 30d on Starter; 60d/90d on Control ($149+) | High (Financial Visibility section) | Daily forecast trajectory with worst-case floor & key date flags | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-04** | **AI CFO Weekly Brief & Health Score** | `/business/cfo` | `client/src/v2/pages/AICFO.jsx`, `client/src/v2/lib/cfoModel.js` | Fully Functional | `VITE_DESIGN_V2=true` | Quota: 50 ($59), 300 ($149), 1000 ($299) | High (AI CFO section) | Score: 84/100, Runway 88/100, Margin 76/100, Collection 82/100 | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-05** | **AI CFO Executive Q&A Interface** | `/business/cfo` (Ask Drawer) | `client/src/v2/ai/AskPanel.jsx`, `client/src/v2/pages/AICFO.jsx` | Fully Functional | `VITE_DESIGN_V2=true` | Included in query quotas | High (Founder Q&A Demonstration) | Inquiry: *"Why did operating expenses increase this month?"* with IDR breakdowns | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-06** | **Document Intake & Multi-Channel Center** | `/business/documents` | `client/src/v2/pages/Documents.jsx`, `client/src/components/DocumentIntakeModal.jsx` | Fully Functional | Core application | Quota: 100 ($59), 500 ($149), 2000 ($299) | High (Document Intelligence section) | Multi-format drop zone + incoming queue from Web & Telegram | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-07** | **Document Extraction & Field Identification** | `/business/documents`, `/business/invoices` | `client/src/pages/business/InvoiceReviewDrawer.jsx`, `server/documentIntake.js` | Fully Functional | Core application | Core | High (Step 2: Extract) | Supplier: PT Mitra Telematika, DPP: Rp 42.000.000, PPN 11%: Rp 4.620.000 | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-08** | **Human Verification & Ledger Match Drawer** | `/business/invoices`, `/business/transactions` | `client/src/pages/business/InvoiceReviewDrawer.jsx`, `client/src/v2/components/UnreconciledTxDrawer.jsx` | Fully Functional | Core application | Core | High (Step 3: Review / Human-in-the-loop) | Match candidate against BCA Corporate account payment proof | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-09** | **Bank Import & Automated Statement Match** | `/business/accounts`, `/bank-import` | `client/src/pages/BankImport.jsx`, `client/src/v2/pages/Accounts.jsx` | Fully Functional | Core application | Control ($149), Pro ($299) | High (Platform Command Center) | BCA Corporate (100% matched, 248 tx), Permata (Verified) | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-10** | **Indonesian Regulatory Radar & Tax Calendar** | `/business/accountant?tab=taxes`, `/radar` | `client/src/v2/pages/Accountant.jsx` (`TaxList`), `client/src/pages/ComplianceCalendar.jsx` | Fully Functional | Core application | Core | High (Compliance & Tax section) | PPh 21 (due 10th), PPh 23 (due 20th), PPN (end of month), PMK 81/2024 CoreTax | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-11** | **Tax Knowledge & Regulatory Rule Card** | `/business/accountant` | `client/src/components/TaxKnowledgeCard.jsx`, `client/src/lib/taxKnowledgeFixtures.js` | Fully Functional | Core application | Core | High (Indonesian Context) | PMK 81/2024 CoreTax schedule, TER PPh 21 rates, PPN transition rules | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-12** | **AI Accountant Month Close & ZIP Package Export** | `/business/accountant` | `client/src/v2/pages/Accountant.jsx`, `client/src/v2/lib/accounting.js` | Fully Functional | `VITE_DESIGN_V2=true` | Control ($149), Pro ($299) | High (Accounting Preparation workflow) | Export ZIP package: trial balance CSV, summary PDF (ID/EN), general ledger | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-13** | **Telegram Employee Submission Bot** | Integration / Telegram Webhook | `server/telegram/` | Beta Pilot | Integration release flag | Control ($149), Pro ($299) | High (Document Collection) | Receipt image submission via Telegram mobile app | Real smartphone screenshot mockup | **VERIFIED BETA** |
| **UI-14** | **Claude AI Assistant Connector (MCP / OAuth)** | `/oauth/consent`, `/upload` | `client/src/pages/OAuthConsent.jsx`, `server/index.js` (MCP routes) | Functional | Core MCP integration | Pro ($299) or Developer add-on | High (Document Collection) | "Sign in with CFO AI" consent dialog + MCP file analysis | Pixel-precise component render | **VERIFIED AVAILABLE** |
| **UI-15** | **ChatGPT Custom Action Integration** | API Action Endpoint | Planned Architecture | In Design | Architecture only | Future Roadmap | Moderate (Integration card only) | N/A | Labeled "Coming Soon" card | **PLANNED** |
| **UI-16** | **WhatsApp Business Integration** | Mobile messaging channel | Planned Architecture | In Design | Architecture only | Future Roadmap | Moderate (Integration card only) | N/A | Labeled "Coming Soon" card | **PLANNED** |
| **UI-17** | **Platform Admin Management Console** | `/admin/*`, `v2/AdminApp.jsx` | `client/src/v2/AdminApp.jsx`, `client/src/pages/AdminDashboard.jsx` | Functional | Internal Staff only | Superadmin / Internal | **EXCLUDED FROM PUBLIC MARKETING** | System tenant data | Internal only | **VERIFIED INTERNAL (EXCLUDED)** |

---

### 3. Public Marketing Asset Guidelines

1. **Synthetic Data Integrity:**
   - Company Name: **PT Solusi Digital Nusantara** (or **PT Nusantara Solusi Digital**)
   - Entity Type: Indonesian PT PMA / PT Lokal
   - Base Currency: **Indonesian Rupiah (IDR / Rp)**
   - Bank Accounts: **BCA Corporate Giro** (`IDR`), **Bank Permata Escrow** (`IDR`), **Bank Mandiri Operasional** (`IDR`)
   - All amounts rendered with strict Indonesian financial typography (`Rp 3.120.000.000` or abbreviated `Rp 3,12M / Rp 450Jt` with tabular figures).
2. **Zero Customer PII:**
   - Zero real NPWP numbers (sample uses structured placeholder `01.234.567.8-901.000`).
   - Zero real bank account numbers or personal names.
   - Zero live production API tokens or Railway endpoints.
3. **Explicit Labeling:**
   - Any financial simulation chart that projects future performance is transparently labeled:
     `Illustrative Demo Data • Reconciled from Verified Ledger Records`.
