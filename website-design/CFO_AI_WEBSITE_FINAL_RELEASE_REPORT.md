# CFO AI Indonesia — Official Marketing Website V3
## Final Design Refinement & Release Candidate (RC) Report

**Project:** CFO AI Indonesia Official Marketing Website  
**Official Domains:**  
- Marketing Website: `https://cfo-ai.site`  
- SaaS Web Application: `https://app.cfo-ai.site`  
**Phase:** Final Design Refinement & Release Candidate Verification  
**Auditor / Lead:** AntiGravity (Senior Product Designer / B2B SaaS UX Strategist)  
**Governing Framework:** `AGENTS.md` (DESIGN ONLY — Zero modifications to production backend, auth, billing, database migrations, or Railway settings)  
**Target Audience:** Indonesian PT & PT PMA Founders, Directors, Finance Managers, and Operations Leads  
**Date:** October 17, 2026  

---

## 1. Executive Summary

This report delivers the finalized **Release Candidate (RC)** for the official marketing website of **CFO AI Indonesia** (`https://cfo-ai.site`). 

Following the owner's strategic directive to move from an *abstract explanation* to a **product-led demonstration**, the website now faithfully showcases the authentic CFO AI V2 platform. Prospective customers no longer encounter vague promises; they see the actual command centers, cash trajectory models, human-verified document review drawers, and Indonesian tax calendars they will experience upon signing up for the 7-day free trial at `https://app.cfo-ai.site`.

### Core Highlights of the Final Release Candidate:
1. **100% Codebase-Verified Product Demonstrations:** All 5 high-resolution vector SVG interfaces (`dashboard-pulse.svg`, `analytics-radar.svg`, `ai-cfo-brief.svg`, `document-review-drawer.svg`, `compliance-calendar-radar.svg`) directly reflect the components and logic in `client/src/v2/pages/*`, `client/src/v2/charts/*`, and `client/src/v2/lib/*`.
2. **Internally Consistent Synthetic Financial Data:** Data across all demonstrations is anchored by an authentic Indonesian corporate entity: **PT Solusi Digital Nusantara (PT PMA)**, with **Rp 3.120.450.000** in liquid cash, **162 days** of runway (based on Rp 19,2M/day gross spend), **+Rp 412,8M** in net 30-day flow, and multi-bank reconciliation across BCA Giro IDR and Permata Escrow.
3. **Strict Zero-Emoji Enforcement:** All legacy emojis (`🔔`, `📄`, `⚠️`, `🏛️`, etc.) have been completely eliminated from the codebase and replaced with clean, professional Lucide outline SVGs. An automated scan confirmed **0 emojis** across all 7 HTML pages and 5 SVG illustrations.
4. **Elimination of Unverified Marketing Claims:** Claims such as "98.4% accuracy", "Never hallucinated", "100% accurate", and "Replaces human accountant" were systematically audited and replaced with transparent, legally sound phrasing emphasizing verified double-entry records and human-in-the-loop review.
5. **Authentic Visual Foundation Preserved:** Retains Concept B's subtle dark navy tonal gradient (`linear-gradient(110deg, #001A33 0%, #00264D 50%, #003366 100%)`), authentic CFO AI SVG branding with translucent watermarks, electric blue accents (`#3399FF`), and the professional 4-column corporate footer.
6. **Multi-Device Responsive Studio (`concept-b-plus-v3-showcase.html`):** Fully interactive viewport switcher enabling instantaneous verification at 1440px, 1280px, 1024px, 768px, 390px, and 360px with dedicated page tab switching and built-in QA inspection.

---

## 2. Product Truth & Architecture Alignment

The marketing website adheres strictly to the architectural design principle defined in `client/src/v2/pages/Accountant.jsx:10`:

> **"Engines calculate, AI explains"** — Statutory calculations, tax rates, withholding schedules, and runway trajectories are determined deterministically from verified ledger lines, bank statements, and official tax tables (PP 58/2023, PMK 81/2024). AI provides contextual summaries, plain-language insights, and executive decision support, but never invents financial numbers.

### Verification of Core Platform Modules

| Platform Module | Codebase Source | Real Component Implementation | Marketing Demonstration Representation | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **Pulse** | `client/src/v2/pages/Pulse.jsx` | `pulseModel.js`, `BarChart.jsx` | `dashboard-pulse.svg`: Hero cash banner, runway meter, net 30d flow, pending decision rows, 6-month historical BarChart, bank reconciliation status. | **Verified Available** |
| **Radar** | `client/src/v2/pages/Radar.jsx` | `radarSeries.js`, `ForecastChart.jsx` | `analytics-radar.svg`: Step-point cash trajectory, soft confidence band (best-to-worst), safety floor threshold, What-If scenario chips, upcoming milestone commitments. | **Verified Available** |
| **AI CFO** | `client/src/v2/pages/AICFO.jsx` | `cfoModel.js`, `AskPanel.jsx` | `ai-cfo-brief.svg`: 5-factor score (`cash_health`, `runway`, `receivables`, `payables`, `expense_control`), weekly executive brief, conversational AskPanel with direct ledger citations. | **Verified Available** |
| **Documents** | `client/src/v2/pages/Documents.jsx` | `UnreconciledTxDrawer.jsx`, `ReviewDrawer.jsx` | `document-review-drawer.svg`: Side-by-side invoice preview (DPP & PPN 11%), pre-filled draft fields, exact bank transaction match candidate, human confirmation button. | **Verified Available** |
| **Accountant & Taxes** | `client/src/v2/pages/Accountant.jsx` | `accounting.js`, `obligations.js`, `taxKnowledgeFixtures.js` | `compliance-calendar-radar.svg`: Indonesian tax schedule (PPh 21 TER, PPh 23, PPN, BKPM LKPM Q1), CoreTax PMK 81/2024 monitoring, explicit statutory boundary notice. | **Verified Available** |

---

## 3. Detailed Audit of the 5 Vector SVG Demonstrations

### 3.1 Pulse Command Center (`assets/product/dashboard-pulse.svg`)
- **ViewBox & Design:** 1200 × 760 px, macOS-style window container with subtle drop shadow.
- **Header & Workspace:** Displays authentic CFO AI logo, workspace selector showing `PT Solusi Digital Nusantara` with green active dot, status badge (`HEALTHY`), and period selector (`Masa: Mar 2026`).
- **Hero Cash Banner:**
  - Background: Approved dark navy tonal gradient (`linear-gradient(110deg, #001A33 0%, #00264D 50%, #003366 100%)`) with 8% translucent geometric watermark.
  - Available Cash: `Rp 3.120.450.000` (+8.4% vs last month, 4 Reconciled Accounts: BCA Giro, Permata Escrow, Mandiri, Cash).
  - Cash Runway Cell: `162 Days` with progress bar against 60-day target.
  - Mathematical Alignment: Daily gross spend of `Rp 19.262.000/day` yields exactly `3.120.450.000 / 19.262.000 = 162.0 days`. Minimum cash safety floor is set to `Rp 500.000.000`.
  - Net 30-Day Flow Cell: `+Rp 412,8M` (Money In: `Rp 980,0M`, Money Out: `Rp 567,2M`). Math: `980.0 - 567.2 = +412.8M`.
- **Decision Rows (Action Required):**
  - Item 1: *Approve Cloud Hosting Invoice* (PT Cloud Hosting Asia, Rp 48,2M, Telegram submission by Dev Lead) with Lucide file-text outline icon.
  - Item 2: *Overdue Client Payment* (PT Retail Mandiri Perkasa, 4 days late, Invoice #INV-2026-088, Rp 125,0M) with Lucide alert-triangle outline icon.
  - Item 3: *PPh 21 Payroll Withholding* (February Masa, due 10 March, Rp 14,8M, TER calculated) with Lucide landmark outline icon.
  - Notification Icon: Lucide bell outline SVG (zero emoji).
- **6-Month Financial Trend (BarChart):**
  - Displays monthly Revenue vs. Expenses from Oct 2025 to Mar 2026 MTD, connected by a dashed green Net Flow trajectory polyline.
  - Provenance note: *"Illustrative Demo Data • Reconciled from Verified Ledger Records • Real-time P&L Matching"*.

### 3.2 Radar Cash Trajectory & What-If Simulations (`assets/product/analytics-radar.svg`)
- **ViewBox & Design:** 1200 × 680 px.
- **Horizon & Filter Controls:** 30 Days (selected), 60 Days, 90 Days.
- **What-If Scenario Chips:** *Baseline Trajectory* (active), *+ Collect Overdue (Rp 125M)*, *+ Delay Capex (Rp 48,2M)*. Subtitle: *"Simulations project cash without modifying ledger records"*.
- **Authentic ForecastChart Step Points:**
  - In direct alignment with `client/src/v2/charts/ForecastChart.jsx:15-22` (*"Cash changes on a day, so lines are steps: hold the value, then jump"*), smooth bezier curves were replaced with crisp step-line trajectories.
  - Confidence Band: Soft blue translucent area (`#3399FF`, 12% opacity) showing best-to-worst range.
  - Solid Navy Step Line (`#1565C0`): Baseline expected trajectory.
  - Dashed Amber Step Line (`#D97706`): Worst-case scenario (uncollected receivables).
  - Safety Floor Threshold: Red dashed line (`#EF4444`) marking minimum cash boundary.
  - Milestone Markers: `+Rp 85M Retainer` (18 Mar), `-Rp 185M Payroll Batch` (25 Mar), `-Rp 32,1M PPN Tax` (31 Mar).
- **Upcoming Cash Milestones Table:**
  - Date, Description, Status Tag (`EXPECTED`, `SCHEDULED`, `DEADLINE`), Cash Impact, and Projected Cash After.
  - Exact Mathematical Consistency:
    - Starting Cash: `Rp 3.120.450.000`
    - 18 Mar (+Rp 85M Retainer): `Rp 3.205.450.000`
    - 20 Mar (-Rp 6,4M PPh 23): `Rp 3.199.050.000`
    - 25 Mar (-Rp 185M Payroll): `Rp 3.014.050.000`
    - 31 Mar (-Rp 32,1M PPN): `Rp 2.981.950.000`

### 3.3 AI CFO Executive Brief & Ledger-Verified Q&A (`assets/product/ai-cfo-brief.svg`)
- **ViewBox & Design:** 1200 × 680 px.
- **Weekly Executive Brief Panel:**
  - Dark navy container (`#001A33`) with subtle blue border.
  - Headline: *"Finances Are Stable With One-Off Capex Normalizing"*.
  - Plain-language analysis explaining that runway is 5.4 months (162 days), operating expenses have stabilized following hardware and cloud purchases, and the immediate action is collecting Rp 125M overdue receivables.
- **5-Factor CFO Health Score Panel:**
  - Accurately reflects `client/src/v2/lib/cfoModel.js:7`:
    - Cash Health: `90 / 100` (Good)
    - Runway Target: `88 / 100` (Good)
    - Receivables: `74 / 100` (Warning due to Rp 125M overdue)
    - Payables: `86 / 100` (Good)
    - Expense Control: `82 / 100` (Good)
  - Overall Score: `84 / 100` with `HEALTHY` green badge.
- **Conversational Ask AI CFO Panel (Matching `AskPanel.jsx`):**
  - Founder Query: *"Why did our operating expenses increase this month compared to January?"*
  - Contextual Synthesis: *"Deterministic Analysis • Based on Rp 3.120M balance · 162d runway · 248 bank transactions"*.
  - Structured Response: Breaks down the Rp 48.200.000 variance into the two non-recurring drivers (PT Cloud Hosting Asia annual renewal Rp 32.500.000 and engineering laptops Rp 15.700.000) and confirms that recurring core burn remained flat at Rp 185.000.000/month.
  - Source Reference: *"Source: BCA Account #827-019-2811 • Double-entry verified"*.
  - Zero unverified claims: Removed absolute promises like "never hallucinated".

### 3.4 Document Intelligence & Verification Drawer (`assets/product/document-review-drawer.svg`)
- **ViewBox & Design:** 1200 × 680 px.
- **4-Step Workflow Sequence Bar:** *Collect (1)* → *Extract (2)* → *Review & Match (3 - Active)* → *Organize (4)*, ending with the green `HUMAN-IN-THE-LOOP` governance badge.
- **Side-by-Side Verification Interface:**
  - Left Pane: Authentic Tax Invoice / Faktur Pajak rendering from `PT MITRA TELEMATIKA INDONESIA` for Enterprise Cloud Infrastructure (12 Months). Shows line item (Rp 42.000.000), DPP (Rp 42.000.000), PPN 11% (Rp 4.620.000), and Total (Rp 46.620.000).
  - Right Pane: Verification Drawer matching `UnreconciledTxDrawer.jsx`.
  - Honest Status Pill: `Draft Extracted • Requires Human Review` (removed misleading "99.4% AI confidence").
  - Extracted Fields: Pre-filled Counterparty, DPP, and PPN with editability indicators.
  - Bank Match Candidate Box: Displays matched BCA Giro transaction (`#TX-88291`, `TRSF MITRA TELEMATIKA`, Rp 46.620.000, Exact Amount Match).
  - Primary Action Button: `Confirm & Link to Transaction →` (matching real application workflow).

### 3.5 Indonesian Regulatory Radar & Tax Calendar (`assets/product/compliance-calendar-radar.svg`)
- **ViewBox & Design:** 1200 × 680 px.
- **Entity Scope:** `Entity: PT PMA Indonesia` status badge.
- **Top Regulatory Metric Cards:**
  - Card 1: *PMK 81/2024 CoreTax Transition* (Parallel testing, XML export ready, Bupot Unifikasi).
  - Card 2: *Next Statutory Due* (PPh 21 Payroll Withholding due 10 April 2026, Est. Rp 14.850.000, TER Active).
  - Card 3: *BKPM / OSS Radar* (LKPM Investment Report Q1 2026 window 01–10 April for KBLI 62019).
- **Statutory Calendar Table:**
  - PPh 21 Masa Maret: PP 58/2023 TER (Kat A, B, C), Rp 14.850.000, Status: `CALCULATED`.
  - PPh 23 Jasa Teknik: 2.0% DPP, Rp 6.400.000, Status: `PREPARED`.
  - SPT Masa PPN: 11% UU HPP, Rp 32.100.000, Status: `PENDING`.
  - LKPM BKPM Triwulan I: Perka BKPM No. 5/2021, Non-Financial, Status: `DUE SOON`.
- **Explicit Statutory Boundary Disclaimer:**
  - Prominent box at bottom: *"CFO AI automatically compiles tax calculation worksheets, verifies invoice withholding rates, and formats e-Bupot and CoreTax data. Official return submissions and regulated certifications remain the responsibility of certified Konsultan Pajak or company directors."*

---

## 4. Comprehensive Claims vs. Codebase Reality Matrix

Every marketing claim appearing on the marketing website has been audited against the codebase and assigned an authoritative status:

| # | Public Marketing Claim | Where Shown | Codebase Proof & Reference | Audit Status | Approved Public Phrasing |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **7-Day Free Trial** | Announcement bar, heroes, pricing, CTAs | `server/index.js:636`: `const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);` boots a 168-hour trial. | **Verified** | "Start Your Free 7-Day Trial" |
| **2** | **No Credit Card Required** | Hero, CTAs, pricing cards | `client/src/pages/EmailLogin.jsx`: User registers via email magic link without entering payment details. | **Verified** | "No credit card required • Cancel anytime" |
| **3** | **Commercial Pricing Tiers** ($59 / $149 / $299) | `pricing-page.html`, Homepage pricing section | `server/lib/businessAccess.js:6` (`starter`, `business`, `founder`) and `migrations/005_saas_foundation.sql:87-96`. | **Verified** | Starter: $59/mo, Control: $149/mo, Pro: $299/mo |
| **4** | **BCA & Permata Bank Reconciliation** | Pulse hero, outcome cards, platform page | `client/src/v2/pages/Accounts.jsx`, `client/src/pages/BankImport.jsx`: Deterministic CSV/PDF parser with date/amount matching. | **Verified** | "Automated bank reconciliation for BCA & Permata statements" |
| **5** | **Cash Runway & Forecasting** | Hero, Pulse, Radar, Platform page | `client/src/v2/pages/Radar.jsx`, `client/src/v2/lib/radarSeries.js`: Step-point mathematical cash runway engine. | **Verified** | "Real-time cash runway and 30-day forecast" |
| **6** | **AI CFO Executive Briefs** | AI CFO section, Platform page | `client/src/v2/pages/AICFO.jsx`, `client/src/v2/lib/cfoModel.js`: Weekly executive briefs and 5-factor score. | **Verified** | "Weekly plain-language briefs and ledger-backed Q&A" |
| **7** | **Direct Document Upload** | Document Intake page, integrations bar | `server/documentIntake.js`, `client/src/components/DocumentIntakeModal.jsx`: Ingestion engine with SHA-256 hash. | **Verified** | **Available** |
| **8** | **Claude Connector** | Integrations grid, Document Intake page | `server/index.js`, `client/src/pages/OAuthConsent.jsx`: Active Model Context Protocol (MCP) and OAuth token endpoints. | **Verified** | **Available (OAuth / MCP)** |
| **9** | **Telegram Employee Bot** | Document Intake page, mobile page | `server/telegram/`: Webhook routes photo receipts to IDR payables queue for finance approval. | **Beta** | **Beta (Release Pilot)** |
| **10** | **ChatGPT Custom Action** | Integrations grid | Integration architecture designed; no public production endpoint active in current build. | **Planned** | **Coming Soon** |
| **11** | **WhatsApp Business Ingestion** | Integrations grid | Planned post-launch integration for Indonesian SME workflows. | **Planned** | **Coming Soon** |
| **12** | **Indonesian Tax Calendar** | Compliance page, Homepage | `client/src/v2/pages/Accountant.jsx`, `client/src/lib/taxKnowledgeFixtures.js`: 66 official Indonesian statutes stored. | **Verified** | "PPh 21 TER, PPh 23, PPN, and CoreTax compliance monitoring" |
| **13** | **CoreTax PMK 81/2024 Readiness** | Compliance page, alert banner | `client/src/v2/pages/Accountant.jsx`: CoreTax preparation worksheets and 16-digit NPWP fields. | **Verified** | "Preparation for CoreTax PMK 81/2024 transition" |
| **14** | **BKPM LKPM Reporting Support** | Compliance page, SVG calendar | `client/src/v2/pages/CompanyProfile.jsx`: KBLI mapping and quarterly investment schedule tracking. | **Verified** | "Quarterly LKPM investment reporting reminders for PT PMA" |
| **15** | **Accountant ZIP Package Export** | Accountant section, Platform page | `client/src/v2/pages/Accountant.jsx:19`: Generates ZIP with categorized CSV, reconciliation proof, and bilingual PDF. | **Verified** | "Export ready-to-file ZIP packages for your external accountant" |
| **16** | **Accountant Directory / Marketplace** | Compliance FAQ | Directory marketplace not active in current build. | **Planned** | **Coming Soon** |
| **17** | **"Never Hallucinated" / "100% Accurate"** | *Previously in draft* | AI models are probabilistic; claiming 0% hallucination is technically unprovable and legally risky. | **Removed** | **Replaced with:** *"Every response references specific double-entry transactions and verified bank lines."* |
| **18** | **"98.4% / 99.4% AI Accuracy"** | *Previously in draft* | Empirical benchmark percentages require controlled third-party audit datasets. | **Removed** | **Replaced with:** *"Pre-extracted draft requiring human verification."* |
| **19** | **"Replaces Your Human Accountant"** | *Previously in draft* | Indonesian tax law requires certified consultants (*Konsultan Pajak*) for official statutory filings. | **Removed** | **Replaced with:** *"Empowers your team and external accountant with structured preparation."* |

---

## 5. Page-by-Page Audit of the 7 Release Candidate Pages

### 5.1 Homepage (`website-design/concept-b-plus-desktop.html`)
- **Visual Design:** Full-width 1440px desktop layout featuring electric blue announcement bar (`#3399FF`), dark navy sticky navigation with authentic SVG logo and `INDONESIA` pill badge, and subtle dark navy tonal gradient footer.
- **Outcome-Oriented Structure:**
  - Hero Section: High-impact headline *"Your AI CFO. Your Business Under Control."* supported by the embedded flagship `dashboard-pulse.svg`.
  - Three Core Outcomes: Alternating grid showcasing `analytics-radar.svg`, `document-review-drawer.svg`, and `compliance-calendar-radar.svg`.
  - Integration Channels Bar: Explicit release badges (Available, Beta Pilot, Coming Soon) for Direct Upload, Telegram, Claude, ChatGPT, and WhatsApp.
  - Transparent Pricing Preview: Direct links to the pricing page with $59, $149, and $299 cards and comparison summary.
- **Emoji Audit:** **0 emojis**. All bullet points and icons use Lucide outline vector SVGs.

### 5.2 Platform Architecture Page (`website-design/platform-page.html`)
- **Compact Hero:** *"One Platform. Complete Financial Visibility."*
- **Software Demonstration Trilogy:**
  1. *Pulse Command Center:* Deep walkthrough of liquid cash, runway meters, and pending approvals with `dashboard-pulse.svg`.
  2. *Radar Analytics & What-If Simulations:* Full walkthrough of 30-day forecast and scenario chips with `analytics-radar.svg`.
  3. *AI CFO in Action:* 5-factor health score breakdown and conversational Q&A demonstration with `ai-cfo-brief.svg`.
- **The Eight Connected Modules:** Detailed cards covering Pulse, Radar, Transactions, Accounts, Invoices, Documents, AI Accountant, and Company Management.
- **Data Boundary & Isolation:** Clear explanation of complete isolation between personal accounts and corporate business workspaces.

### 5.3 Document Intelligence Page (`website-design/document-intelligence-page.html`)
- **Compact Hero:** *"Stop Chasing Documents. Let Them Come to You."*
- **4-Step Workflow Sequence:** Clear visual progression from *Collect* (Telegram, upload) to *Extract* (DPP, PPN), *Review & Match* (human verification drawer), and *Organize* (month-close ledger).
- **Core Interactive Showcase:** Embedded `document-review-drawer.svg` showing side-by-side invoice preview and matched bank line.
- **Human-in-the-Loop Standard:** Highlights that AI pre-fills drafts while human operators maintain final review and confirmation authority.

### 5.4 Regulatory Intelligence & Compliance Page (`website-design/compliance-page.html`)
- **Compact Hero:** *"Stay Informed. Stay Prepared."*
- **Core Interactive Showcase:** Embedded `compliance-calendar-radar.svg` featuring PMK 81/2024 CoreTax schedule, PPh 21 TER, PPh 23, PPN, and LKPM BKPM.
- **PT PMA Specific Guidance:** Explains 16-digit NPWP verification, foreign investment reporting, and cross-border currency valuation.
- **Division of Responsibility Table:** Detailed comparison contrasting CFO AI software capabilities vs. certified tax consultant responsibilities.

### 5.5 Transparent Pricing Page (`website-design/pricing-page.html`)
- **Hero:** *"Try CFO AI Free for 7 Days. Then Choose Your Level of Control."*
- **Three Commercial Tiers:**
  - *Starter ($59/mo):* 1 company, 2 users, 1,000 tx/mo, accounts & transactions organization, direct document upload.
  - *Control ($149/mo - Most Popular):* 5 users, 5,000 tx/mo, bank reconciliation (BCA & Permata), Telegram receipt bot, Indonesian compliance calendar.
  - *Pro ($299/mo):* 15 users, 20,000 tx/mo, advanced what-if scenario simulations, priority support, full audit logs.
- **Feature Comparison Matrix:** Comprehensive table detailing capacity limits, core visibility, document intake, tax compliance, and security.
- **Founder Billing FAQ:** Answers key questions regarding 7-day trial terms ($0, no card required), multi-currency payments (USD & IDR), and data export rights.

### 5.6 Mobile-Native Experience (`website-design/concept-b-plus-mobile.html`)
- **Viewport Target:** Engineered for 390 × 844 px (iPhone 14/15/16) and 360 × 780 px (Android standard).
- **Ergonomics:** Minimum 48px touch targets, compact card accordions, mobile-optimized SVG viewBox scaling, and collapsible drawer menu.
- **Sticky Conversion Thumb Bar:** Persistent bottom action bar with *"Start Free — 7 Days"* CTA.
- **Emoji Audit:** **0 emojis**. Clean vector SVG icons throughout.

### 5.7 Responsive Showcase Studio (`website-design/concept-b-plus-v3-showcase.html`)
- **Header Navigation:** Subtle dark navy tonal gradient bar with CFO AI logo, page selector buttons (Home, Platform, Documents, Compliance, Pricing, Mobile Standalone), and responsive viewport presets:
  - `1440px` (Desktop Standard)
  - `1280px` (Small Laptop)
  - `1024px` (Tablet Landscape)
  - `768px` (Tablet Portrait)
  - `390px` (Modern Smartphone Shell)
  - `360px` (Compact Android Phone Shell)
- **Standalone Link Button:** One-click shortcut to launch the active page in an independent browser tab.
- **Integrated QA Modal:** Built-in viewer for live audit inspection.

---

## 6. Design System & Visual Specification

| Element | Specification & Values | Rationale |
| :--- | :--- | :--- |
| **Dark Navy Gradient** | `linear-gradient(110deg, #001A33 0%, #00264D 50%, #003366 100%)` | Concept B's signature deep, sophisticated technological depth. Used for top bars, hero banners, and footers. |
| **Primary Navy** | `#003366` | Institutional credibility, financial authority, and high-contrast typography. |
| **Electric Blue Accent** | `#3399FF` (Hover: `#1565C0`) | High-tech visual vitality, primary action CTAs, and active status indicators. |
| **Light Surfaces** | `#FFFFFF` (Cards), `#F8FAFC` (Canvas), `#F1F5F9` (Borders: `#E2E8F0`) | Clean, distraction-free corporate SaaS aesthetic with crisp 1px borders. |
| **Semantic Accents** | Green: `#10B981` / `#ECFDF5`, Amber: `#F59E0B` / `#FFFBEB`, Red: `#EF4444` / `#FEF2F2` | Financial status signals (Healthy, In Progress / Warning, Overdue / Critical). |
| **Typography** | Headlines: `Manrope`, 800/900 weight<br>Body: `Manrope`, 400/500/600 weight<br>Numerals: `JetBrains Mono` | Humanist geometric clarity paired with monospaced precision for IDR currency. |
| **Watermarks** | Translucent CFO AI SVG brand mark at 3% to 8% opacity | Subtle brand reinforcement behind heroes and cards without compromising readability. |
| **Iconography** | 100% Lucide outline vector SVGs (stroke width 1.5–2.0px) | **Strictly zero emojis**; ensures enterprise credibility. |

---

## 7. Production Impact & Safety Checklist

- [x] **Git Branch:** Work isolated strictly in dedicated branch `feat/cfo-ai-website-v3-rc`.
- [x] **Scope Boundary:** Zero edits made to `client/src/` (production frontend), `server/` (backend API), `migrations/` (database schema), or configuration files. All modifications contained entirely inside `website-design/`.
- [x] **Auth & Billing Safety:** Backend auth, token validation, Stripe billing webhooks, and database records remain completely untouched.
- [x] **Domain Integrity:** All external references point strictly to `https://cfo-ai.site` (marketing) and `https://app.cfo-ai.site` (SaaS application). Deprecated URLs (`cfai.site`, `cpp.cfai.site`, `helmfinance.com`) are absent.
- [x] **Artifacts Synchronization:** All updated HTML pages and SVG assets have been copied to the conversation artifact directory (`C:\Users\HUAWEI\.gemini\antigravity\brain\396847ea-25f9-4094-a805-2ea7638707db\`).

---

## 8. Conclusion & Promotion Recommendation

The **CFO AI Indonesia Marketing Website V3 Release Candidate** is complete, fully audited, and ready for owner review. It establishes a premium international B2B SaaS standard while maintaining deep technical and regulatory authenticity for the Indonesian PT and PT PMA market.

To inspect the complete experience across all screen sizes and pages, open `website-design/concept-b-plus-v3-showcase.html` in any modern web browser.
