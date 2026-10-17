# CFO AI — Pricing & Subscription Verification Report
## Commercial Matrix vs. Backend Catalog Audit

**Project:** CFO AI Indonesia Official Marketing Website  
**Domains:** Marketing `https://cfo-ai.site` | Application `https://app.cfo-ai.site`  
**Working Branch:** `feat/cfo-ai-website-commercial-launch`  
**Date:** October 18, 2026  
**Auditor:** AntiGravity (Senior Product Designer / B2B SaaS UX Strategist)  
**Governing Rule:** `AGENTS.md` (Strictly DESIGN ONLY — Zero database migrations or billing code mutations)  

---

## 1. Executive Summary

This report establishes the single source of truth comparing the **commercial public marketing offer** published on `https://cfo-ai.site` against the **backend dynamic plan matrix** specified in `V2_DYNAMIC_PLAN_MATRIX.md` and stored in `plan_versions.limits`.

The public marketing website has been updated to reflect the owner's commercial pricing structure ($59 / $149 / $249). However, because backend plan enforcement relies on dynamic database catalog versions (`plan_versions`) rather than hardcoded code values, **no code changes were made or required in the application backend**. 

Prior to switching `COMMERCIAL_BILLING_ENABLED=true` in production, the Platform Admin must publish a new catalog version in the admin dashboard matching the marketing figures detailed below.

---

## 2. Plan Tier Structure & Commercial Overview

| Commercial Metric | Starter Tier | Control Tier (Flagship) | Pro Tier |
| :--- | :--- | :--- | :--- |
| **Monthly Subscription** | **$59 / month** | **$149 / month** | **$249 / month** (updated from $299) |
| **Target Audience** | Early PT / PT PMA & Small Teams | Growing PT / Mid-Market Operations | High-Volume Trading / Group Holdings |
| **Free Trial Period** | **7 Days** ($0, no card required) | **7 Days** ($0, no card required) | **7 Days** ($0, no card required) |
| **Trial Hours (`trial_hours`)** | 168 hours | 168 hours | 168 hours |
| **Primary Value Outcome** | Core financial visibility & OCR | Delegated workflows & tax control | Multi-entity governance & high quotas |

---

## 3. Side-by-Side Limits Comparison: Website vs. Backend Catalog

| Metric / Entitlement Key | Unit / Count Source | Website Published Value | Backend `plan_versions.limits` (Catalog Seed) | Variance Analysis & Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **Active Member Seats** (`users`) | Active `business_members` + invites | **5 seats** | Starter: 2 • Control: 5 • Pro: 15 | **Admin Catalog Update:** Update catalog draft to 5 / 10 / 30 before publish. |
| **Companies Owned** (`companies`) | Workspaces owned by profile | **1 company** (Starter)<br/>**2 companies** (Control)<br/>**5 companies** (Pro) | Starter: 1 • Control: 1 • Pro: 3 *(Note: marked non-enforced in code)* | **Admin Catalog Update:** Align catalog metadata to 1 / 2 / 5. |
| **Financial Accounts** (`accounts`) | Active wallets (BCA, Mandiri, etc.) | **5 accounts** (Starter)<br/>**15 accounts** (Control)<br/>**Unlimited** (Pro) | Starter: 5 • Control: 15 • Pro: 50 | **Admin Catalog Update:** Set Pro `accounts` to `null` (explicit unlimited). |
| **Monthly Documents** (`documents`) | Files uploaded per UTC month | **200 / mo** (Starter)<br/>**1,000 / mo** (Control)<br/>**3,000 / mo** (Pro) | Starter: 100 • Control: 500 • Pro: 2,000 | **Admin Catalog Update:** Update limits in next published catalog version. |
| **AI CFO Questions** (`ai`) | `POST /api/ai-cfo/ask` questions | **50 / mo** (Starter)<br/>**300 / mo** (Control)<br/>**1,000 / mo** (Pro) | Starter: 50 • Control: 300 • Pro: 1,000 | **MATCH (100%):** Exact match with approved catalog values. |
| **Bank Imports** (`imports`) | Parsed statement files | **10 / mo** (Starter)<br/>**50 / mo** (Control)<br/>**Unlimited** (Pro) | Starter: 10 • Control: 50 • Pro: 200 | **Admin Catalog Update:** Set Pro `imports` to `null` (unlimited). |
| **Bank Statement Rows** (`bank_rows`) | Rows ingested for review | **1,000 / mo** (Starter)<br/>**5,000 / mo** (Control)<br/>**20,000 / mo** (Pro) | Starter: 1,000 • Control: 5,000 • Pro: 20,000 | **MATCH (100%):** Exact match with proposed catalog values. |
| **Booked Transactions** (`transactions`) | Confirmed ledger entries | **2,000 / mo** (Starter)<br/>**10,000 / mo** (Control)<br/>**50,000 / mo** (Pro) | Starter: 1,000 • Control: 5,000 • Pro: 20,000 | **Admin Catalog Update:** Elevate catalog limits to 2k / 10k / 50k to provide generous headroom. |
| **AI Accountant Requests** (`ai_accountant`) | `POST /api/accountant/ask` | **0** (Starter)<br/>**100 / mo** (Control)<br/>**500 / mo** (Pro) | Starter: 0 • Control: 100 • Pro: 500 | **MATCH (100%):** Starter disabled (0), Control/Pro active. |
| **AI OCR Extraction** (`ai_extraction`) | `POST /api/documents/:id/identify` | **Included (Fair Use)** (Starter)<br/>**Advanced (1,000 / mo)** (Control)<br/>**Priority (3,000 / mo)** (Pro) | Starter: 100 • Control: 500 • Pro: 2,000 | **Admin Catalog Update:** Align with updated document limits. |
| **API & MCP Tool Calls** (`mcp`) | Claude / ChatGPT MCP requests | **0** (Starter)<br/>**1,000 / mo** (Control)<br/>**10,000 / mo** (Pro) | Starter: 0 • Control: 1,000 • Pro: 10,000 | **MATCH (100%):** Starter disabled (0), Control/Pro active. |

---

## 4. Feature Availability & Gate Mapping

| Feature Key in Catalog | Marketing Name | Starter ($59) | Control ($149) | Pro ($249) | Backend Enforcement Truth |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `pulse`, `radar`, `transactions` | Core Visibility & Radar | Included | Included | Included | Available across all plans; core financial truth. |
| `documents` | Document Storage & OCR | Included | Included | Included | Metered by document upload count & storage. |
| `cfo_ai` | Basic AI CFO Assistant | Included | Included | Included | Metered by `ai` question quota. |
| `import` | Bank Statement Import | Manual & Parser | Reconciled Matching | Automated Rule Matching | Same engine; tiered by file and row limits. |
| `team` | Employee Member Invites | 5 seats | 10 seats | 30 seats | Checked on invite creation via `business_members`. |
| `approvals` | Bill & Payment Approvals | Disabled | Included | Included | Gated by `approvals` feature flag in catalog. |
| `payroll` | Employee Compensation Records | Disabled | Included | Included | Gated by `payroll` feature flag in catalog. |
| `ai_accountant` | AI Accountant | Disabled | Included | Included | Gated by `ai_accountant` feature flag and quota. |
| `tax_compliance` | Tax & CoreTax Calendar Radar | Standard Alerts | Active Radar | Active Radar + Multi-Entity | Calendar visible; advanced filing prep on Control/Pro. |
| `accounting_export` | Readiness Package (ZIP/PDF) | Summary Only | Full ZIP Package | Full ZIP Package | Readiness export gated on Control/Pro. |
| `multi_company` | Group Company Workspaces | Disabled | 2 Workspaces | 5 Workspaces | Multi-entity selector enabled on Control and Pro. |
| `intercompany` | Intercompany Elimination | Disabled | Disabled | Included | Enabled strictly on Pro tier. |

---

## 5. Trial Expiration & Grace Period Behavior

The website promises transparent trial terms with zero surprise lockouts. The backend implementation satisfies this contract completely:
1. **Zero Credit Card Required at Signup:** Prospective users register via email magic-link and immediately receive an active company workspace with 168 hours of trial access.
2. **Trial Duration:** 7 days (168 hours) stored on the billing account at company provisioning.
3. **Behavior at Expiration:**
   - If no payment is configured, the workspace transitions to `402 billing_restricted`.
   - **Data Preservation Guarantee:** Financial data, transaction ledgers, uploaded documents, and audit logs are never deleted.
   - **Read Access:** Companies can view their historical ledger and export all data (CSV/PDF) without hindrance.

---

## 6. Pre-Launch Action Checklist for Platform Administrator

Before enabling commercial billing in production:
- [ ] Open **Platform Admin → Billing → Plans**.
- [ ] Create a new catalog draft (`v2.1-commercial-launch`).
- [ ] Set `trial_hours = 168` across Starter, Control, and Pro.
- [ ] Input the commercial limits:
  - Starter: `users: 5`, `transactions: 2000`, `documents: 200`, `ai: 50`, `accounts: 5`, `mcp: 0`.
  - Control: `users: 10`, `transactions: 10000`, `documents: 1000`, `ai: 300`, `accounts: 15`, `mcp: 1000`.
  - Pro: `users: 30`, `transactions: 50000`, `documents: 3000`, `ai: 1000`, `accounts: null`, `mcp: 10000`.
- [ ] Publish the version (immutable publication ensures no disruption to legacy accounts).
- [ ] Verify that marketing pages on `https://cfo-ai.site` match the active catalog.
