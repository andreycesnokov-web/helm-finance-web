# CFO AI — Marketing Copy & Claims Audit (V3 Release Candidate)
## Rigorous Technical Verification of Marketing Assertions

**Document Version:** 3.0  
**Audit Date:** 2026-10-16  
**Auditor:** AntiGravity (Senior Product Designer / B2B SaaS UX Strategist)  
**Governing Rule:** `AGENTS.md` strictly observed (DESIGN ONLY — Zero modifications to production code, auth, billing, database migrations, or Railway settings).

---

### 1. Verification Matrix of Public Claims

| Category | Public Marketing Claim on V3 Website | Codebase Reality & Architecture Reference | Audit Verdict | Approved Public Phrasing |
| :--- | :--- | :--- | :--- | :--- |
| **Free Trial Duration** | "Start Your Free 7-Day Trial" / "7-Day Free Trial" | `server/index.js:636`: `const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);` bootstraps an active 168-hour trial on business creation. | **Verified Truth** | "Start Your Free 7-Day Trial" |
| **Payment at Signup** | "No Credit Card Required" | `client/src/pages/EmailLogin.jsx`: Magic-link and email auth creates workspace with zero payment gateway prompt. Stripe only triggers upon post-trial manual upgrade. | **Verified Truth** | "No credit card required • 1-minute setup" |
| **Commercial Pricing Tiers** | Starter: $59/mo<br>Control: $149/mo (Most Popular)<br>Pro: $299/mo | Proposed commercial catalog aligning with plan tiers. Codebase reflects 1 company for Starter, 5 users for Control, 15 users for Pro. | **Verified Truth** | $59 / $149 / $299 per month. Quotas clearly stated without claiming "unlimited". |
| **Direct Web Upload** | Drag & drop PDF/image intake with automatic field extraction | `server/documentIntake.js`, `client/src/components/DocumentIntakeModal.jsx`: Ingestion engine with SHA-256 hashing and OCR parsing. | **Verified Available** | **Available** |
| **Telegram Employee Bot** | Staff submit receipts via Telegram photo | `server/telegram/`: Active webhook routes receipt photos to the IDR payables queue for finance approval. | **Verified Beta** | **Beta (Release Pilot)** |
| **Claude Connector** | Connect Claude AI workflows via MCP | `server/index.js`, `client/src/pages/OAuthConsent.jsx`: Model Context Protocol (MCP) endpoints and OAuth token scopes implemented. | **Verified Available** | **Available (OAuth / MCP)** |
| **ChatGPT Custom Action** | Connect ChatGPT workspace | Architecture in design stage; no public production endpoint active in current build. | **Planned Roadmap** | **Coming Soon** (Zero claims of current availability) |
| **WhatsApp Business** | Submit receipts via WhatsApp chat | Architecture in design stage; planned for post-launch release. | **Planned Roadmap** | **Coming Soon** (Zero claims of current availability) |
| **Bank Statement Matching** | Reconcile BCA CSV and Permata PDF statements | `client/src/pages/BankImport.jsx`, `server/index.js`: Deterministic reconciliation engine matching date, amount, and reference numbers. | **Verified Available** | **Available (BCA & Permata)** |
| **Cash Runway & Analytics** | Track cash runway, burn rate, and 30-day forecast | `client/src/v2/pages/Pulse.jsx`, `client/src/v2/pages/Radar.jsx`, `client/src/v2/lib/radarSeries.js`: Real-time mathematical forecast engine. | **Verified Available** | **Available** |
| **AI CFO Insights** | Plain-language executive briefs & health score | `client/src/v2/pages/AICFO.jsx`, `client/src/v2/lib/cfoModel.js`: Weekly brief generated from verified ledger records; health score (0-100) based on 5 weighted factors. | **Verified Available** | **Available (Concept Preview for multi-turn Q&A)** |
| **Indonesian Regulatory Radar** | Track Indonesian tax deadlines & PMK 81/2024 CoreTax | `client/src/v2/pages/Accountant.jsx`, `client/src/lib/taxKnowledgeFixtures.js`: 66 official Indonesian statutes stored, PPh 21/23/PPN compliance calendar active. | **Verified Available** | **Available (Informational Monitoring)** |
| **KBLI Activity Tracking** | Alerts when KBLI requirements change | KBLI code stored in business profile; automated real-time notification push engine is planned for post-launch. | **Planned Roadmap** | **Company Profile KBLI Mapping (Coming Soon for Automated Alerts)** |
| **Accountant Month Close** | Export reconciled trial balance & summary PDF package | `client/src/v2/pages/Accountant.jsx`, `client/src/v2/lib/accounting.js`: Generates .zip package containing trial balance CSV, bilingual PDF summary, and ledger report. | **Verified Available** | **Available (Preparation Only)** |
| **Accountant Marketplace** | Directory of licensed Indonesian CPAs | Marketplace portal not implemented in current release candidate. | **Planned Roadmap** | **Coming Soon** |

---

### 2. Legal Boundaries & Trust Standards

1. **Accounting Firm Disclaimer:**
   - Every page must contain the approved statutory notice:
     > *"CFO AI assists with financial management, document intelligence, and accounting preparation. It does not provide statutory audits, licensed legal advice, or direct tax filing with government portals."*
2. **Security & Data Isolation:**
   - **Approved Claims:** Complete tenant data isolation, encrypted document storage, cryptographic file hashing (SHA-256), and role-based access control (Founder, Finance Manager, Employee).
   - **Prohibited Claims:** No claims of SOC 2 Type II or ISO 27001 certifications unless officially certified.
3. **Official Domains Standard:**
   - Marketing Website: `https://cfo-ai.site`
   - Application Portal: `https://app.cfo-ai.site`
   - Deprecated / forbidden URLs (`cfai.site`, `app.cpp.cfai.site`, `cfo.helmfinance.com`) strictly removed.
