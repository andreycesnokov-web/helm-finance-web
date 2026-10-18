# CFO AI Platform V3: Technical Workflow Audit & Marketing Mapping

**Audit Date:** October 18, 2026  
**Auditor:** CFO AI Engineering Agent  
**Repository:** `andreycesnokov-web/helm-finance-web`  
**Branch:** `feat/cfo-ai-website-cms-hub`  
**Working Commit:** `9c1da74`  
**Target Page:** `/platform` (EN, ID, RU)  
**Governance Principle:** "AI suggests. User confirms." — Complete technical truthfulness, zero unverified automation claims.

---

## 1. Executive Summary

This audit evaluates the codebase reality for the three cross-functional business workflows introduced on the CFO AI Platform page (`/platform`). CFO AI is presented not merely as a collection of disjointed financial tools, but as a unified Financial Operating System connecting everyday activities (receipts, invoices, bank feeds) with founder decision-making and statutory tax compliance.

To maintain strict commercial and regulatory integrity under Indonesian law (UU PDP No. 27/2022, UU KUP, PMK 81/2024 CoreTax), every workflow step is classified into:
- **VERIFIED:** Fully implemented and operational in application code (`server/` and `client/src/v2/`).
- **PARTIAL:** Implemented with specific operational boundaries (e.g., internal task alerts rather than autonomous external messaging).
- **PLANNED:** Architected in roadmap but intentionally requiring human-in-the-loop execution.
- **BLOCKED:** Dependent on external infrastructure or unapproved cutover.

---

## 2. Row-by-Row Technical Audit Table

| Workflow & Step | Feature / Step Description | Application Code & Endpoints | Verification Status | Operational Boundary & Technical Reality | Marketing Presentation Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **WF 01: Step 1** | **Receipt & Voucher Intake**<br>Staff or vendor uploads receipt/invoice via web or mobile | `server/lib/documentAccess.js`<br>`server/lib/documentValidation.js`<br>`client/src/v2/pages/Documents.jsx` | **VERIFIED** | Enforces RBAC (`UPLOAD_ROLES` includes employee, manager, admin, owner). Supports PDF, JPG, PNG, WEBP (up to 15MB). Scoped to tenant. | Highlight multi-format receipt intake with secure role-based upload. |
| **WF 01: Step 2** | **AI Data Extraction**<br>Extracts vendor, date, currency, amounts, tax (PPN 11%, PPh) | `server/lib/documentExtraction.js`<br>`server/lib/documentOcr.js`<br>`server/lib/documentIntakeOrchestrator.js` | **VERIFIED** | Embedded PDF text parser and Kwitansi regex extraction. Optional Claude Sonnet 4.5 Vision fallback. **Crucial rule:** "AI suggests. User confirms." Intake workbench requires human approval. | Market as "AI Extraction with Human Confirmation". Do not claim 100% autonomous blind posting. |
| **WF 01: Step 3** | **Disbursement Approval**<br>Policy routing based on expense threshold and authorization | `client/src/v2/pages/Approvals.jsx`<br>`client/src/v2/lib/decisions.js`<br>`server/index.js` | **VERIFIED** | Configurable approval limits. Segregation of duties enforced: self-approval is blocked unless user is Owner/CEO. Waiting vs. Decided audit trail. | Showcase structured management approval queue with clear threshold enforcement. |
| **WF 01: Step 4** | **Ledger & Audit Package**<br>Voucher posted to GL, tax schedule updated, audit-ready export | `server/lib/billChecklist.js`<br>`client/src/v2/lib/accounting.js`<br>`server/lib/exportAccountantPackage.js` | **VERIFIED** | 4-point compliance checklist: invoice attachment, payment proof, Bukti Potong P-05 slip, and accountant review flag. One-click ZIP package export. | Emphasize automatic GL voucher creation and one-click accountant/auditor export package. |
| **WF 02: Step 1** | **Sales Invoice Generation**<br>Issue multi-currency invoice with Indonesian tax details | `client/src/v2/pages/AddEntry.jsx`<br>`client/src/v2/pages/Bills.jsx` (`kind: receivable`) | **VERIFIED** | Multi-currency with mandatory Indonesian Rupiah (IDR) statutory equivalent. Handles DPP, PPN 11%, customer terms, and notes. | Present as clean multi-currency invoice issuance with statutory IDR compliance. |
| **WF 02: Step 2** | **Receivables & Aging Radar**<br>Live tracking of due dates, open balances, and aging buckets | `client/src/v2/lib/obligations.js`<br>`client/src/v2/pages/Bills.jsx` | **VERIFIED** | Real-time classification into `due_soon`, `overdue`, and `paid`. Tracks remaining balance and partial payments. | Highlight automated aging tracking and real-time debtor portfolio visibility. |
| **WF 02: Step 3** | **Payment Follow-Up Alerts**<br>Internal alerts and tasks when invoices become due or overdue | `server/index.js` (lines 13214–13232)<br>`server/lib/reminderScope.js` | **PARTIAL** | **Reality:** System generates internal operational follow-up tasks (`action_type: 'receivable_followup'`) for the finance team. **Limitation:** Outbound automated customer dunning (sending automated WhatsApp/email bots to debtors) is NOT implemented. | **Accurate Copy:** "Smart Follow-Up Alerts" for internal finance teams. Do not claim automated external debtor dunning. |
| **WF 02: Step 4** | **Bank Matching & Settlement**<br>Match incoming bank deposits to invoices and record settlement | `server/lib/incomingPaymentMatching.js`<br>`server/lib/invoiceSettlement.js`<br>`client/src/v2/components/UnreconciledTxDrawer.jsx` | **VERIFIED** | Multi-signal deterministic scoring (amount: 0.5, date: 0.2, reference: 0.2, currency: 0.1). Handles partial settlement and payment gateway gross vs. net fees. | Showcase automated deposit matching with one-click reconciliation workbench. |
| **WF 03: Step 1** | **Verified Financial Foundation**<br>Clean reconciled accounts and cash floats feed intelligence | `server/index.js` (`/api/ai-cfo/context`)<br>`server/lib/radarSeries.js` | **VERIFIED** | Strict tenant isolation (`requireBusiness`). Explicitly separates reconciled transactions from pending/unreconciled items. Clean data boundary. | State that AI insights are grounded strictly in reconciled ledger facts, not guesswork. |
| **WF 03: Step 2** | **AI CFO Intelligence**<br>Conversational executive queries and financial synthesis | `server/index.js` (`buildAiCfoContext`)<br>`client/src/v2/pages/AICFO.jsx` | **VERIFIED** | Natural language queries with exact voucher citations. Weekly brief synthesis. 5 CFO Health score factors: Burn, Runway, Tax Buffer, AP/AR Balance, Margin. | Emphasize conversational CFO queries with verified voucher citations and executive briefing. |
| **WF 03: Step 3** | **Predictive Risk Radar**<br>30/60/90-day forward cash flow modeling and tax obligations | `server/lib/burnRunway.js`<br>`client/src/v2/pages/Radar.jsx` | **VERIFIED** | 30/60/90-day trajectory modeling. Automated threshold alerts for runway < 30 days and < 60 days. "Can I Hire?" runway impact simulator. | Highlight forward-looking cash flow radar with interactive scenario modeling. |
| **WF 03: Step 4** | **Founder Decision Execution**<br>Actionable recommendations linking directly to workflows | `client/src/v2/pages/AICFO.jsx` (`d.to`)<br>`client/src/v2/pages/Approvals.jsx` | **VERIFIED** | Human-in-the-loop governance: AI generates actionable recommendations linking directly to operational views (e.g. `/business/approvals`, `/business/radar`). Founder executes. | Market as "Decision to Action" — AI suggests clear strategic actions, founder retains complete control. |

---

## 3. Module 14: Multi-Entity Audit

**Screenshot Asset:** `/assets/screens/MultiEntity.png`  
**Code Reference:** `server/lib/businessResolver.js`, `client/src/v2/pages/BusinessSettings.jsx`  
**Technical Reality:**  
- Multi-company workspace switching is fully implemented. Users can switch between separate company entities (e.g. PT PMA operational entity and local PT holding/partner).
- Each business entity has isolated database rows, separate chart of accounts, isolated bank accounts, and distinct role assignments.
- Automated multi-entity consolidated balance sheets with automated intercompany transaction elimination are an Enterprise / bespoke capability.
**Marketing Copy Recommendation:**  
Preserve the verified positioning: "Multi-Entity Workspace Switching: Switch seamlessly between separate company entities with isolated relational ledgers, independent bank accounts, and dedicated permissions." Do not claim automated consolidated elimination on standard tiers.

---

## 4. UI Architecture & Design System Consistency

1. **Section Placement:** Position "How CFO AI Works" immediately following the Platform Hero and preceding the 14 Module Showcases.
2. **Visual Palette:**
   - Background: `bg-ice-light` (`#F4F8FC`) and `bg-ice-primary` (`#EBF3FA`)
   - Card container: `bento-card` with clean `border-[#CBD5E1]` and `bg-white`
   - Primary text / headers: `#06366B` (Deep Navy)
   - Accent elements: `#1768C9` (Luminous Blue) and subtle status badges (`bg-blue-50 text-[#1768C9]`, `bg-emerald-50 text-emerald-800 border-emerald-200`)
3. **Responsive Step Connectors:**
   - 4-column desktop layout (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`)
   - Sequential numbered pills (`01`, `02`, `03`, `04`) with directional arrows connecting steps on desktop
   - Fully stacked, highly readable cards on mobile (`390px`) and tablet (`768px`)
4. **Bottom Conversion CTA:**
   - Replace the legacy plain button on `/platform` with the approved Floating CTA Banner (`max-w-[1200px]`, `rounded-[20px]`, 30px Ice Blue separation from footer) to maintain 100% consistency across Home, Pricing, and Platform pages.
