# CFO AI V2 — Dynamic Plan Matrix (Phase B contract)

**Rules for this document**
- Every number below is **catalog data**, edited in Platform Admin → Billing → Plans and published as a new immutable version. No commercial number lives in application code.
- **APPROVED**: values given by the owner on 2026-10-17.
- **PENDING APPROVAL**: engineering proposals. They are **not** set in the seeded versions and cannot be published until the owner decides.

---

## 1. Value contract (one rule for every limit)

| Stored value in `plan_versions.limits` | Meaning | Enforcement |
|---|---|---|
| integer `n ≥ 1` | **limited** to n | Admission refuses the request that would exceed n: `402 billing_quota_reached`. A soft limit (per plan, per key) allows and warns via the `X-Billing-Quota-Warning` header. Seats and `0` are always hard. |
| `0` | **disabled** | Always refused (hard) |
| `null` | **unlimited**, an explicit decision | Never refused for quota; still counted and shown |
| key absent | **not decided** | A version with a missing server-metered key **cannot be published** (`billing_terms_incomplete`). Drafts may have gaps. Versions published before this contract keep their old behaviour (absent = unlimited), so nothing gets worse for an existing subscriber. |

Overrides use the same values: an integer, or `null` = unlimited for that company.

**Not plan values (technical safety limits, code constants):**
- one request may reserve at most 5,000 units;
- a statement import holds at most 2,000 rows;
- file upload maximum (`docV.validateUpload`);
- per-IP and per-account Auth throttles.

---

## 2. Metered limits

Every row: unit, server source of consumption, reset, behaviour at the limit.

**Concurrency.** Every reservation row-locks the company's billing account (`rpc_billing_quota … FOR UPDATE`). Parallel requests are serialized, so no two requests can both take the last unit.

**Idempotency.** The same request key is a replay and is never counted twice. A failed request releases its units.

| Key | Unit | Counted from (server) | Reset | Starter | Control | Pro |
|---|---|---|---|---:|---:|---:|
| `users` | active member seat, incl. open invitations | `business_members` (active) + unused invite uses + in-flight invites | none | **2** APPROVED | **5** APPROVED | **15** APPROVED |
| `transactions` | one booked money movement | reservations on: transaction batch (rows), transfer, balance correction, bill payment, payroll payment, **confirmed statement rows** | month (UTC) | **1,000** APPROVED | **5,000** APPROVED | **20,000** APPROVED |
| `documents` | one uploaded file (upload completed) | reservation at upload-init, committed at upload-complete | month (UTC) | **100** APPROVED | **500** APPROVED | **2,000** APPROVED |
| `ai` | one **AI Assistant** (CFO AI) question | `POST /api/ai-cfo/ask` (request key; a replay is free) | month (UTC) | **50** APPROVED | **300** APPROVED | **1,000** APPROVED |
| `ai_accountant` | one AI Accountant request | `POST /api/accountant/ask`, `POST /api/accountant/profile/from-documents` | month (UTC) | 0 PENDING | 100 PENDING | 500 PENDING |
| `ai_extraction` | one AI document reading | `POST /api/documents/:id/identify`, `POST /api/parse`, MCP `analyze_invoice` | month (UTC) | 100 PENDING | 500 PENDING | 2,000 PENDING |
| `mcp` | one MCP tool call (Claude / ChatGPT connector) | every MCP tool call (reads and writes) | month (UTC) | 0 PENDING | 1,000 PENDING | 10,000 PENDING |
| `imports` | one bank statement read (file parsed) | `POST /api/bank-import/read` and parse/upload/extract routes | month (UTC) | 10 PENDING | 50 PENDING | 200 PENDING |
| `bank_rows` | one statement row submitted for review | `POST /api/bank-import/batches` (rows in the file) | month (UTC) | 1,000 PENDING | 5,000 PENDING | 20,000 PENDING |
| `accounts` | one active financial account (wallet) | `wallets` (active) + in-flight creations | none | 5 PENDING | 15 PENDING | 50 PENDING |
| `storage_mb` | MB of stored files | `document_files.file_size` + in-flight uploads | none | 2,048 PENDING (2 GB) | 10,240 PENDING (10 GB) | 51,200 PENDING (50 GB) |
| `integrations` | connected payment provider | `payment_provider_connections` (not disabled) | none | 0 PENDING | 1 PENDING | 5 PENDING |
| `companies` | company owned | — (**not enforced**, owner decision 6) | none | 1 PENDING | 1 PENDING | 3 PENDING |

**Why the statement model has two limits.** One large file cannot bypass the plan:
- `imports` counts files;
- `bank_rows` counts the rows submitted for review;
- confirmed rows are also `transactions`.

**Documents.** Upload count (`documents`) and stored size (`storage_mb`) are separate limits. Lowering a quota never deletes a file: it only refuses new uploads.

**AI cost.** The commercial quotas (`ai`, `ai_accountant`, `ai_extraction`) are separate from internal cost protection, which stays in code and is not a plan value.

---

## 3. Features

The full list comes from `billing_catalog_items`:
- **Always included**, cannot be removed: Pulse, data export.
- **Required in every published version:** documents, AI, statement import, payroll, team, approvals, export, integrations.
- **Optional:** radar, transactions, accounts, bills, CFO AI, AI Accountant, tax & compliance, accounting export, API/MCP. When absent they are allowed (catalog `absent_allows`).

### Feature matrix — PENDING APPROVAL

The proposal is derived from the approved limits and the website text.

| Feature (`key`) | Status | Starter | Control | Pro |
|---|---|:-:|:-:|:-:|
| Transactions, accounts, bills/invoices (`transactions`, `accounts`, `bills`) | released | ✓ | ✓ | ✓ |
| Documents (`documents`) | released | ✓ | ✓ | ✓ |
| Bank statement import (`import`) | released | ✓ | ✓ | ✓ |
| Team (`team`) | released | ✓ (2 seats need an invite) | ✓ | ✓ |
| AI Assistant (`cfo_ai` + `ai`) | released | ✓ | ✓ | ✓ |
| Approvals (`approvals`) | released | — | ✓ | ✓ |
| Payroll (`payroll`) | released | — | ✓ | ✓ |
| Radar / advanced insights (`radar`) | released | ✓ | ✓ | ✓ |
| Tax & compliance automation (`tax_compliance`) | beta | — | ✓ | ✓ |
| AI Accountant (`ai_accountant`) | beta | — | ✓ | ✓ |
| Accounting export (`accounting_export`) | beta | — | ✓ | ✓ |
| API / MCP connector (`api`) | released | — | ✓ | ✓ |
| Payment integrations (`integrations`) | beta | — | — | ✓ |

---

## 4. Website claims that the product does not back

These must be decided by the owner **before** the public page goes live, because the page must not promise what does not work.

| Website text (`pricing-page.html`) | Reality in V2 | Proposal |
|---|---|---|
| "Bank Statement Import: Manual (Starter) vs ✓ Reconciled (Control/Pro)" | One `import` feature, the same import and reconciliation on every plan | Show "✓" on all plans, or decide and build a tier |
| "Telegram Employee Channel (Beta): Control/Pro" | The Telegram channel refuses `commercial_v2` companies (`telegramPaidGate`); Telegram is a future paid add-on | Mark "Coming soon" or remove |
| "Audit Logs: Standard / 30 days / Unlimited" | No audit retention tiering exists | Remove the tiering or mark "Coming soon" |
| "Priority support" (Pro) | Not a system feature | Keep as a service promise only if staffed |
| Trial "7-day / 168 hours" | Comes from `plan_versions.trial_hours` (catalog). It becomes 14 days only when a new version is published. | Pricing loader shows the catalog value |

---

## 5. Subscription change policy (implemented by the existing model)

| Change | Rule |
|---|---|
| A new catalog version is published | **New** selections use it. **Existing** companies stay pinned to their `plan_version_id`: no retroactive price increase or quota decrease. |
| Admin moves a company to the new version | Explicit admin action: `assign` now, or `schedule` with a date. Audited. |
| Quota increase for one company now | Company override (limit, optional expiry, reason). Audited; the catalog is unchanged. |
| Customer changes plan during the trial | `select_plan` applies to the running trial. **The trial end is unchanged.** A downgrade never deletes data: new writes above the lower limit are refused. |
| Trial length | Taken from the selected version at activation and stored on the account (`trial_hours`). 7 days = 168 h, 14 days = 336 h. A running trial keeps its window. One trial per company, atomic. |
| Trial expiry | Writes → 402 `billing_restricted`. Own data and export stay available. |
| Paid periods | Phase 2 (payments not connected). The model is ready: `billing_service_periods` with verified payments. |

---

## 6. Flag OFF (`COMMERCIAL_BILLING_ENABLED=false`) — defined behaviour

The flag is an **operational kill switch**, not a commercial state.

| Company | Behaviour with the flag OFF |
|---|---|
| Legacy companies (`billing_policy` ≠ `commercial_v2`) | Unchanged legacy behaviour (today's production) |
| `commercial_v2` companies | **"Billing paused."** Legacy Free limits **never** apply. The company keeps the **features of its selected/effective plan version** (core financial features if it never chose a plan). Quotas are not counted. Expiry does not restrict. **AI, AI Accountant, MCP/API and payment integrations are refused** (external cost cannot run unmetered). Billing and trial routes are 404. Tenant isolation unchanged. |

---

## 7. Questions for the owner

1. Approve or replace every **PENDING** value in section 2. Publication is blocked until each server-metered key is set.
2. Approve or replace the feature matrix in section 3.
3. Decide the four website claims in section 4.
4. Should the API/MCP connector be on Starter (proposal: no)?
