# CFO AI — Commercial Launch Audit & Inventory (Phase 1)
## Public Marketing Website Readiness Assessment

**Project:** CFO AI Indonesia Official Marketing Website  
**Live Marketing Domain:** `https://cfo-ai.site`  
**Live Application Domain:** `https://app.cfo-ai.site`  
**Working Branch:** `feat/cfo-ai-website-commercial-launch`  
**Auditor / Technical Lead:** AntiGravity (Senior Product Designer / B2B SaaS UX Strategist)  
**Governing Rule:** `AGENTS.md` (Strictly DESIGN ONLY — Zero production backend, auth, database, or billing code changes)  
**Date:** October 18, 2026  

---

## 1. Hosting, Deployment & Infrastructure Audit

### Application Infrastructure (`https://app.cfo-ai.site`)
- **Hosting Service:** Railway PaaS (service `helm-finance-web`).
- **Deployment Pipeline:** Automated deployment from GitHub repository `andreycesnokov-web/helm-finance-web`, branch `main`.
- **Runtime:** Node.js 20+ Express server (`server/index.js`) serving static React SPA (`client/dist`) on root, and REST API on `/api/*`.
- **Database:** Supabase PostgreSQL instance.
- **Authentication Service:** Email magic-link authentication via Resend (`auth.cfo-ai.site` sending domain, `EMAIL_FROM=CFO AI <login@auth.cfo-ai.site>`).
- **Active Auth Routes:**
  - `GET /login`: Main login entry point (loads `client/src/pages/Login.jsx`).
  - `GET /login/email`: Email input for magic-link dispatch (`client/src/pages/EmailLogin.jsx`).
  - `GET /login/email/callback`: Token verification callback (`client/src/pages/EmailCallback.jsx`).
  - `GET /login/telegram`: Secondary legacy Telegram login.
  - **CRITICAL AUDIT FINDING:** There is **NO `/signup` or `/register` route** in `client/src/App.jsx`. Account creation in CFO AI is unified and idempotent via `/login` or `/login/email`. Sending prospective customers to `https://app.cfo-ai.site/signup` risks a 404 or unhandled redirect. All marketing CTAs must point to `https://app.cfo-ai.site/login` or `https://app.cfo-ai.site/login?plan=<plan>`.

### Public Marketing Website Infrastructure (`https://cfo-ai.site`)
- **Source Code Directory:** `website-design/` in the repository root.
- **Serving Architecture:** Static HTML/CSS/SVG bundle.
- **Key Static Assets:**
  - `concept-b-plus-desktop.html`: Desktop flagship experience.
  - `concept-b-plus-mobile.html`: Mobile 390px experience.
  - `platform-page.html`: Platform architecture and deep feature tour.
  - `document-intelligence-page.html`: Ingestion and human verification drawer.
  - `compliance-page.html`: Indonesian tax radar and CoreTax PMK 81/2024 calendar.
  - `pricing-page.html`: Dedicated pricing and plan comparison.
  - `concept-b-plus-v3-showcase.html`: Multi-viewport responsive studio.
  - `assets/product/`: High-resolution vector SVG software interfaces.
- **Entrypoint Requirement:** A standard `index.html` at the website root must serve the refined homepage so static hosting platforms (Cloudflare Pages, Vercel, Netlify, Railway static) immediately route apex `https://cfo-ai.site` to the correct file.

---

## 2. Existing / Reuse / Modify / Missing Inventory

### Existing Assets
1. **Design Tokens & Palette:**
   - Deep Navy (`#003366`), Midnight Navy (`#001A33`), Electric Blue (`#3399FF`), Electric Blue Ink (`#1565C0`), Slate Gray (`#334155`, `#64748B`), Border Gray (`#E2E8F0`).
   - Approved Ice-Blue Tint palette: `#E5F1FD` to `#F5F9FE`.
2. **Branding Assets:**
   - Authentic CFO AI vector SVG logo (`<svg viewBox="0 0 200 200">...`).
   - Low-opacity geometric brand watermarks.
3. **Product Demonstration SVGs:**
   - `dashboard-pulse.svg`: Pulse Command Center.
   - `analytics-radar.svg`: Radar Forecast & Trajectory.
   - `ai-cfo-brief.svg`: Executive Brief & Conversational Q&A.
   - `document-review-drawer.svg`: Side-by-side Invoice Preview & Bank Match Drawer.
   - `compliance-calendar-radar.svg`: Indonesian Tax & CoreTax Calendar.
4. **Zero-Emoji Iconography:** Complete suite of crisp Lucide outline SVGs.

### Reuse
1. The 5 verified product SVGs: Fully aligned with V2 codebase logic and mathematical consistency.
2. The 4-step Document Intelligence workflow (*Collect → Extract → Review → Organize*).
3. The Indonesian Tax Compliance specification (PPh 21 TER, PPh 23, PPN 11%, CoreTax PMK 81/2024, BKPM LKPM).
4. The responsive viewport testing container in `concept-b-plus-v3-showcase.html`.

### Modify
1. **Hero Background Visual Treatment:**
   - Replace the dark navy hero background with the owner-approved **subtle ice-blue gradient** (`#E5F1FD` to `#F5F9FE`).
   - Preserve dark navy typography (`#003366`) and electric blue accents (`#3399FF`).
2. **Product Positioning & Messaging:**
   - Anchor the homepage on the primary message: **"Know your numbers. Control your business."**
   - Retain the approved supporting headline: **"Your AI CFO. Your Business Under Control."**
   - Emphasize the comprehensive proposition: financial operations, expenses, receivables, payables, documents, approvals, reporting, and AI financial insights in one workspace.
3. **Pricing Tier Harmonization:**
   - Update the commercial pricing structure across all pages and tables to the owner's finalized specification:
     - **Starter:** **$59 / month** • 5 users • 1 company
     - **Control (Flagship / Recommended):** **$149 / month** • 10 users • 2 companies
     - **Pro:** **$249 / month** (updated from $299) • 30 users • 5 companies
   - Highlight **Control** as the most popular / recommended plan.
   - Clarify 7-day free trial on all plans ($0, no card required at signup).
4. **Header Navigation & Alignment:**
   - Fix navigation item spacing, ensure no text wrapping at 1440px/1280px, and prevent CTA clipping.
   - Integrate responsive hamburger mobile menu.
5. **Call-to-Action Link Destination:**
   - Update all signup links to `https://app.cfo-ai.site/login` or `https://app.cfo-ai.site/login?plan=<plan>`, replacing legacy `/signup` paths.

### Missing (To Create for Launch Readiness)
1. **`website-design/index.html`:** Root entrypoint file for static web hosting.
2. **Interactive Expandable Pricing Matrix:** Categorized accordion/table with feature groups (Core Financial Visibility, Invoicing & Receivables, Bills & Payables, Document Intelligence & Integrations, AI & Forecasting, Indonesian Tax & Compliance, Enterprise Security & Collaboration).
3. **5-Step Onboarding Journey Section ("Day One to Full Clarity"):** Clear onboarding journey explaining that companies can start immediately on Day One, while historical bank migrations are handled cleanly in Phase 5.
4. **Owner-Employee Collaboration & Governance Section:** Demonstrates how founders, finance managers, and employees collaborate with strict permissions (approvals vs. actual bank execution).
5. **Technical & Legal Accountability Section:** Explicit statements regarding data privacy, tenant isolation, and statutory boundaries (*"Engines calculate, AI explains — not a replacement for licensed Konsultan Pajak"*).
6. **SEO & Launch Metadata:** Complete Open Graph tags, Twitter Card tags, canonical tags, `robots.txt`, and `sitemap.xml`.

---

## 3. Verified V2 Application Feature Matrix

| Feature Module | Codebase Component | Current Implementation Reality | Marketing Presentation Standard |
| :--- | :--- | :--- | :--- |
| **Pulse Command Center** | `client/src/v2/pages/Pulse.jsx` | Liquid cash, runway meter, net 30d flow, pending approvals, 6-month historical BarChart, multi-account status. | **Available Now** |
| **Radar Cash Trajectory** | `client/src/v2/pages/Radar.jsx` | 30/60/90-day step-point forecast, confidence band, safety floor, what-if scenario simulations, upcoming debt/tax milestones. | **Available Now** |
| **AI CFO Natural Language** | `client/src/v2/pages/AICFO.jsx` | 5-factor score (`cash_health`, `runway`, `receivables`, `payables`, `expense_control`), weekly executive brief, conversational ledger citations. | **Available Now** |
| **Transactions & Accounts** | `client/src/v2/pages/Transactions.jsx` | Multi-currency cash/bank accounts, categorized transaction ledger, manual & batch entries. | **Available Now** |
| **Bank Reconciliation** | `client/src/pages/BankImport.jsx` | BCA Giro CSV and Permata PDF statement parsers; deterministic date/amount/reference matching. | **Available Now (BCA & Permata)** |
| **Invoices & Receivables** | `client/src/pages/Receivables.jsx` | Client invoice creation, payment status tracking, overdue tracking, reminder drafts. | **Available Now** |
| **Bills & Payables** | `client/src/v2/pages/Bills.jsx` | Vendor bill logging, payment terms, due dates, attachment linking. | **Available Now** |
| **Approval Workflows** | `client/src/v2/pages/Approvals.jsx` | Role-based bill and payment approval queue before settlement. | **Available Now** |
| **Document Intelligence** | `client/src/v2/pages/Documents.jsx` | Direct web upload, OCR extraction of DPP and PPN 11%, side-by-side verification drawer, transaction matching. | **Available Now** |
| **AI Accountant & Package** | `client/src/v2/pages/Accountant.jsx` | Indonesian tax calendar, PMK 81/2024 CoreTax transition, PPh 21 TER, PPh 23, PPN, ready-to-file ZIP export (CSV + PDF summary). | **Available Now** |
| **Telegram Receipt Bot** | `server/telegram/` | Staff photo submission of receipts routed to IDR payables queue for approval. | **Beta (Release Pilot)** |
| **Claude Connector** | `server/index.js` (OAuth/MCP) | Remote MCP endpoints for read tools and invoice submission drafts. | **Available (OAuth / MCP)** |
| **ChatGPT Action** | `_specs/mcp-server-audit-and-plan.md` | Connector architecture planned; not active on production API. | **Coming Soon** |
| **WhatsApp Ingestion** | `_specs/saas-identity-architecture.md` | Integration planned for post-launch SME workflows. | **Coming Soon** |
| **Multi-Company Management** | `client/src/v2/pages/CompanyProfile.jsx` | Multiple company workspaces switchable under one user profile. | **Available (Pro Tier)** |
| **Intercompany Workflows** | `client/src/pages/business/BusinessIntercompany.jsx` | Intercompany transaction tagging and consolidated views. | **Available (Pro Tier)** |
| **Statutory Tax Filing** | *Statutory Boundary* | Software prepares calculation worksheets and e-Bupot/CoreTax XML; does NOT file directly to DJP. | **Preparation Only (Certified Accountant Required)** |
