# CFO AI — Authoritative Pricing Specification & Source of Truth

**Authoritative URL:** `https://cfo-ai.site/en/pricing/`  
**Underlying Data Source:** `cms/data/pricing.json`  
**Locales Verified:** English (`en`), Indonesian (`id`), Russian (`ru`)  
**Status:** Approved by Founder as Commercial Specification (October 18, 2026)

---

## 1. Plan Overview & Core Economics

| Attribute | Starter | Control (Recommended) | Pro |
| :--- | :--- | :--- | :--- |
| **Monthly Price (USD)** | **$59** | **$149** | **$249** |
| **Price in Minor Units** | `5900` | `14900` | `24900` |
| **Billing Interval** | `month` | `month` | `month` |
| **Trial Duration** | 7 Days (168 Hours) | 7 Days (168 Hours) | 7 Days (168 Hours) |
| **Credit Card at Trial** | None Required | None Required | None Required |
| **Expired Trial State** | Read & Export Only | Read & Export Only | Read & Export Only |
| **Owned Company Workspaces** | **1 Company** | **2 Companies** | **5 Companies** |
| **Active Member Seats** | **5 Seats** | **10 Seats** | **30 Seats** |

---

## 2. Technical Quotas & Usage Limits (Per UTC Month)

| Resource Metric | Key | Starter ($59) | Control ($149) | Pro ($249) | Enforcement Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Owned Companies** | `companies` | **1** | **2** | **5** | Hard (Owner scope) |
| **User Seats (Active Members + Invites)** | `users` | **5** | **10** | **30** | Hard (Always Hard) |
| **Financial Accounts (Wallets)** | `accounts` | **5** | **15** | **50** | Hard (Active Wallets) |
| **Booked Transactions / Month** | `transactions` | **2,000** | **10,000** | **50,000** | Hard (Monthly UTC) |
| **Document Uploads / Month** | `documents` | **200** | **1,000** | **3,000** | Hard (Monthly UTC) |
| **File Storage Capacity (MB)** | `storage_mb` | **2,048 MB** (2 GB) | **10,240 MB** (10 GB) | **51,200 MB** (50 GB) | Hard (Total Stored) |
| **Bank Statement Imports / Month** | `imports` | **5** | **20** | **100** | Hard (Monthly UTC) |
| **Bank Statement Rows / Month** | `bank_rows` | **1,000** | **10,000** | **50,000** | Hard (Monthly UTC) |
| **AI Assistant (CFO AI) Questions / Month** | `ai` | **50** | **300** | **1,000** | Hard (Monthly UTC) |
| **AI Document OCR Readings / Month** | `ai_extraction` | **100** | **500** | **1,500** | Hard (Monthly UTC) |
| **AI Accountant Requests / Month** | `ai_accountant` | **0** (Disabled) | **50** | **200** | Hard (Monthly UTC) |
| **MCP / API Requests / Month** | `mcp` | **500** | **3,000** | **15,000** | Hard (Monthly UTC) |

---

## 3. Feature Matrix & Entitlements

| Feature Description | Catalog Feature Key | Starter ($59) | Control ($149) | Pro ($249) |
| :--- | :--- | :--- | :--- | :--- |
| Real-Time Cash Cockpit (Pulse & Radar) | `pulse` | **Included** | **Included** | **Included** |
| Digital Archive, Invoices, Bills & Receipts | `documents` | **Included** | **Included** | **Included** |
| Basic Conversational AI CFO Assistant | `cfo_ai` | **Included** | **Included** | **Included** |
| Universal Bank Statement Import | `import` | **Included** | **Included** | **Included** |
| Team Member Invitations & Role Isolation | `team` | **Included** | **Included** | **Included** |
| Raw Data Export (GL CSV, Transactions, P&L) | `export` | **Included** | **Included** | **Included** |
| Indonesian Statutory Tax Calendar | `tax_calendar` | **Included** | **Included** | **Included** |
| Spend Approvals & Spend Authorization Workflows | `approvals` | **Excluded** | **Included** | **Included** |
| Staff Compensation & Monthly Payroll Workflows | `payroll` | **Excluded** | **Included** | **Included** |
| AI Accountant Month-End Close Assistant | `ai_accountant` | **Excluded** | **Included** | **Included** |
| Bank Reconciliation Engine (BCA / Mandiri / Permata) | `reconciliation` | **Excluded** | **Included** | **Included** |
| Auditor-Ready General Ledger ZIP Export | `accounting_export` | **Excluded** | **Included** | **Included** |
| Full Tax Compliance (PPh 21 TER / PMK 81 CoreTax) | `tax_compliance` | **Excluded (Basic preview)** | **Included** | **Included** |
| Group Company Management (Up to 5 Entities) | `multi_company` | **Excluded** | **Excluded** | **Included** |
| Multi-Entity Workspace Switching | `workspace_switching` | **Excluded** | **Excluded** | **Included** |
| Programmatic API & Model Context Protocol | `api` | **Included (500 calls)** | **Included (3k calls)** | **Included (15k calls)** |
| Comprehensive Immutable Audit Trail & Priority Queue | `audit_priority` | **Excluded** | **Excluded** | **Included** |

---

## 4. Ambiguous Promises & Product Decisions

1. **Company Workspace Quotas (`companies`):**  
   - *Marketing:* Starter = 1, Control = 2, Pro = 5.  
   - *Resolution:* Company count is evaluated at the User/Owner level. An owner with Starter may create only 1 company. If an owner attempts to create a 2nd company (`POST /api/business`), the creation is gated by checking the owner's active plan limit.
2. **AI Accountant on Starter:**  
   - *Marketing:* Listed as "Not Included" in features, and `0` in technical quotas.  
   - *Resolution:* `ai_accountant` feature is `false` and limit is `0` for Starter. Calls to `/api/accountant/ask` return `402 billing_feature_denied`.
3. **Data Access Post-Trial Expiry:**  
   - *Marketing:* Read-only access preserved with zero data deletion.  
   - *Resolution:* Matches server behavior. Access status becomes `restricted`, write mutations are refused (402), while `GET` requests, CSV exports, and document downloads remain 100% accessible.
