# CFO AI — Product Truth & Pricing Verification Report
## Release Candidate Feature Audit & Marketing Claims Reconciliation

**Audit Mode:** Read-Only Codebase Inspection  
**Branch:** `fix/accountant-may-audit-and-batch-selection` (HEAD: `dac9b1d`)  
**Scope:** Verification of all marketing claims, integration labels, trial mechanisms, and commercial pricing.

---

### 1. Executive Summary of Audit Findings

| Category | Marketing Claim on Website | Codebase Reality & Evidence | Approved Website Label |
| :--- | :--- | :--- | :--- |
| **Free Trial Duration** | 7 Days / 168 Hours | `server/index.js:636`: `const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);` bootstraps active 7-day trial. | **Verified Truth** |
| **Payment Requirement** | No Credit Card Required | `client/src/pages/EmailLogin.jsx`: Magic-link authentication provisions workspace without payment step; Stripe checkout only triggered upon post-trial upgrade. | **Verified Truth** |
| **Direct Web Upload** | Drag & drop PDF/image intake | `server/index.js`, `documentIntake.js`: Multi-format document ingestion active with hashing and OCR extraction. | **Available** |
| **Telegram Bot** | Employee receipt submission | `server/telegram/`: Telegram bot receives receipt images and routes to IDR payables queue for finance approval. | **Beta (Release Pilot)** |
| **Claude Connector** | Connect Claude AI workflows | `server/index.js`: Model Context Protocol (MCP) endpoints and OAuth token scopes implemented. | **Available** |
| **ChatGPT Action** | Custom GPT Action intake | No active production endpoints exposed in current schema; architecture in design phase. | **Coming Soon** |
| **WhatsApp Business** | WhatsApp receipt ingestion | Not implemented in current release candidate; planned for post-launch roadmap. | **Coming Soon** |
| **Bank Reconciliation** | BCA CSV & Permata PDF | `server/index.js`, bank-import acceptance suite: Deterministic reconciliation engine with strict date/amount matching. | **Available** |
| **AI CFO Insights** | Cash runway & anomaly radar | Rule-based deterministic financial indicators active; external LLM egress closed in pilot. Multi-turn Q&A presented as concept preview. | **Limited / Beta (Concept Preview)** |
| **Regulatory Radar** | Indonesian tax & CoreTax updates | 66 official Indonesian statutes stored, PMK 81/2024 CoreTax transition tracked, compliance calendar for PPh 21/23/PPN active. | **Available (General Updates)** |
| **KBLI Alerts** | Company-specific KBLI push alerts | KBLI code stored in business profile; automated real-time statutory alert engine planned for future release. | **Coming Soon (Company Alerts)** |
| **Accountant Prep** | Monthly package exports | `server/index.js`: Reconciled trial balance exports, CSV summaries, and PDF summary packages implemented. | **Available (Preparation Only)** |
| **Accountant Marketplace** | Direct CPA directory & portal | Marketplace portal not implemented in current release candidate. | **Coming Soon** |

---

### 2. Commercial Pricing & Billing Verification

#### Trial Onboarding Flow:
- When a new user registers via `https://app.cfo-ai.site`, `server/index.js` bootstraps a business entity with:
  ```javascript
  const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  patch = {
    trial_status: 'active',
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
    subscription_status: 'trialing'
  };
  ```
- **Billing Entitlement:** The user receives founder-level access across all platform modules for the entire 168 hours.
- **Credit Card Gate:** Zero credit card collection occurs during onboarding. The claim *"7-day free trial · No credit card required"* is strictly verified.

#### Subscription Tiers:
- **Starter:** $59/month (USD). 1 company, 2 users, Pulse dashboard, 1,000 transactions, 100 uploads, 50 AI questions.
- **Control:** $149/month (USD) — **Most Popular**. 5 users, Pulse & Radar, bank statement reconciliation, Telegram bot, PMK 81/2024 tax calendar, 5,000 transactions, 500 uploads, 300 AI questions.
- **Pro:** $299/month (USD). 15 users, all modules, accountant collaboration workspace, full audit history, 20,000 transactions, 2,000 uploads, 1,000 AI questions.
- **Rules Enforced:** No unlimited AI claims, no fabricated annual discounts, and no claims that statutory accounting services are bundled.

---

### 3. Legal & Professional Boundaries

- **Not an Accounting Firm:** Explicit disclosures placed across the Hero, AI Accountant section, Regulatory section, Pricing footer, and FAQ stating:
  > *"CFO AI provides financial workflows and management tools. Regulated accounting filings and tax declarations remain the responsibility of certified professionals."*
- **No Unsubstantiated Security Badges:** Removed generic ISO 27001 or SOC 2 claims. Replaced with verified architectural facts: tenant data isolation, role-based staff access, and cryptographic document hashing.

---

### 4. Official Domains Standard

- **Marketing Website:** `https://cfo-ai.site` (used for all external promotional links and branding).
- **Application Portal:** `https://app.cfo-ai.site` (used for login and trial registration CTAs).
- **Deprecated / Prohibited Domains:** `cfai.site`, `app.cpp.cfai.site`, and `cfo.helmfinance.com` have been completely excluded.
