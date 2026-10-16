# CFO AI V2 — Billing: Existing System Audit (Phase A)

| | |
|---|---|
| Branch | `feat/v2-email-password-auth` (local), base candidate `1f51422` |
| Audited against | the code and a freshly installed database on the disposable local Supabase stack |
| Scope | Business, Platform/admin |

**Conclusion.** Billing V2 already provides most of what the brief asks for:
- a versioned catalog;
- Plan Management;
- overrides;
- server enforcement;
- an atomic trial.

The work is **extension, not a rewrite**:
1. new metered limit keys;
2. a strict publication contract;
3. Super-Admin-only catalog writes;
4. a public catalog endpoint;
5. a defined behaviour when the flag is OFF.

---

## 1. Component inventory

Status codes:
- **EXISTING/REUSE** — works, used as is;
- **MODIFY** — extended in this batch;
- **MISSING** — built in this batch.

### Database

| Component | Status | What it does today |
|---|---|---|
| `plan_limits` (plan head) | EXISTING/REUSE | Stable plan code, `current_version_id`, `draft_version_id`, `catalog_version` (CAS), display order, recommended, visible (`commercial_available`), archive |
| `plan_versions` | EXISTING/REUSE | Immutable versions (trigger). Fields: price (minor), annual price, currency, `billing_interval` (month), **`trial_hours` per version**, features, limits, `limit_policies` (hard/soft), `terms_version`, `approval_status` (draft/staging_fixture/approved), `effective_at` |
| `billing_catalog_items` | MODIFY | Registry of features (18) and limits (9): i18n label, `module_status` (released/beta/not_released), `enforcement` (server/none/always), counter, reset period. **Missing:** keys for accounts, statement rows, MCP, AI Accountant and AI extraction; public unit and definition text |
| `billing_accounts` | EXISTING/REUSE | Per company: `selected_plan_version_id` (**subscription snapshot**), scheduled plan change (`scheduled_plan_version_id`/`scheduled_at`), trial window, `trial_hours` copied at activation, version (CAS) |
| `billing_overrides` | EXISTING/REUSE | Per-company limit/feature/discount exceptions: `starts_at`/`ends_at`, revoke, reason (5–2000 chars), approver, audit id. Limit value: integer, or `null` = unlimited |
| `billing_grants` | EXISTING/REUSE | Admin-granted plan for a window (support, expired trial) |
| `billing_service_periods` | EXISTING (payments Phase 2) | Paid periods. Admitted only with a verified payment; none exist (no provider) |
| `billing_quota_reservations` | MODIFY | Reserve → commit/release metering per request key; monthly (UTC) or current-state resources. Resource list fixed in `rpc_billing_quota`. **Missing:** the new resources |
| `billing_admin_commands`, `billing_events` | EXISTING/REUSE | Audit: actor, time, request key, intent, result. A catalog command stores `previous` and `terms` (old and new) and the subscriber count |
| `billing_effective_version()` | EXISTING/REUSE | Admin grant → verified paid period → trial window (selected or scheduled version) |
| `billing_effective_terms()` | EXISTING/REUSE | Version features (+ catalog defaults) and limits, then active overrides in time order |
| `billing_usage()` | MODIFY | Monthly: documents, ai, imports, transactions. Current state: users, storage_mb, integrations. **Missing:** new keys |
| `rpc_billing_quota()` | MODIFY | Row-locks the company account (concurrency-safe), checks feature + limit, idempotent per key, revives released keys. **Contract gap:** an absent limit key → `NULL` → **unlimited** |
| `billing_terms_error()` / `billing_terms_complete()` | MODIFY | Publication requires only 8 features + 5 limits. Other metered limits may be absent, which makes them unlimited without anyone deciding so |
| `rpc_billing_catalog_command()` | EXISTING/REUSE | draft / publish (`confirm_publish`) / archive / unarchive / presentation; CAS; dry run; audited. No role check in SQL (service_role only; checked at the route) |
| `rpc_billing_admin_command()` | EXISTING/REUSE | assign / schedule / grant / revoke / extend / override / revoke_override; audited |
| `rpc_billing_trial_command()` | EXISTING/REUSE | Atomic select_plan / activate_trial. One trial per company. `trial_ends_at = clock + plan_versions.trial_hours` |

### Server

| Component | Status | What it does today |
|---|---|---|
| `server/lib/commercialBilling.js` customer routes | EXISTING/REUSE | `GET /api/billing`; `POST /api/billing/plan` and `/trial`; command, quota and release reads |
| `server/lib/commercialBilling.js` admin routes | MODIFY | Catalog list / write / preview (diff + subscriber count); companies, subscriptions, overrides, audit, settings. **Catalog writes use `requireAdmin` (any platform admin).** The brief requires Super Admin. **Missing:** the list of affected companies in preview |
| `server/lib/billingRoutes.js` | MODIFY | Declarative policy for every route (coverage test). Metering: transactions (batch rows, transfers, payments, import-confirm rows), imports (statement parse), documents (+storage), ai (CFO AI, AI Accountant, identify, parse), users (invites), integrations. **Missing:** meters for accounts, statement rows (batch upload), MCP and the AI split |
| `server/lib/commercialAdmission.js` | EXISTING/REUSE | Admission middleware (flag ON); replay-safe after `9750a51` |
| MCP gate (`mcpGate`) | MODIFY | Feature `api` + the tool feature; only `analyze_invoice` metered (as `ai`). **Missing:** per-call MCP metering |
| Legacy access path (`getBusinessAccess` / `getCurrentAccess`) | MODIFY | With the flag **OFF**, a `commercial_v2` company is evaluated as legacy, gets plan `free`, and is limited by `plan_limits`: 1 wallet, 30 tx/month, no export (COMM-01 part 2) |
| Public plan catalog endpoint | **MISSING** | None. The website hardcodes prices and limits |

### Client and website

| Component | Status | What it does today |
|---|---|---|
| Platform Admin → Billing Center (`client/src/v2/admin/billing/*`) | MODIFY | 8 sections. Plans editor: price, annual price, currency, trial hours, features, limits per catalog item (number / unlimited / unavailable), hard/soft, terms version, preview diff + subscribers, confirmed publish, version history, presentation. Iterates catalog items, so **new limit keys appear automatically**. **Missing:** trial in days, affected-company list, Super-Admin gating in UI |
| Billing Center overrides and subscriptions | EXISTING/REUSE | Per-company exceptions with reason and expiry, grants, extend, schedule |
| Customer Billing / Trial page (`client/src/v2/pages/Billing.jsx`, `/business/trial`) | EXISTING/REUSE | Reads the company's catalog from `GET /api/billing`, select plan → trial, usage meters |
| Public website pricing (`website-design/pricing-page.html`) | MISSING integration | Untracked static design files in the main checkout (branch `feat/cfo-ai-website-v3-rc`, under active parallel work), with values hardcoded. **Not edited by this batch** (one writer per area): the integration is delivered as a public endpoint plus a drop-in loader with a documented markup contract |

### Flags and tests

| Component | Status | What it does today |
|---|---|---|
| `COMMERCIAL_BILLING_ENABLED` | MODIFY (OFF semantics) | ON: commercial admission. OFF: no admission, and commercial companies fall to legacy Free |
| `COMMERCIAL_BILLING_FIXTURES` + `CFO_DEPLOYMENT_ENV=staging` | EXISTING/REUSE | Staging-only fixture plans |
| Billing tests | EXISTING + MODIFY | `billingEnforcementHttp` (9), `billingManagementCenterHttp` (6), `commercialBillingHttp` (9), `billingRouteCoverage` (5) |

---

## 2. Open P1s from `V2_CLEAN_INSTALL_REHEARSAL_REPORT.md` (section 14)

| ID | Root cause | Depends on |
|---|---|---|
| **COMM-01** | (a) Starter/Control/Pro are seeded as drafts with `features:{}` and `limits:{}`, so `billing_terms_incomplete` and no trial on a clean install. (b) With the flag OFF a commercial company falls to legacy Free (1 wallet, 30 tx/month, no export). (c) Absent limit = unlimited (contract gap found in this audit). | Owner: numeric values marked PENDING APPROVAL. Engineering: contract, migration, flag OFF semantics. |
| **INST-01** | No approved clean-install artifacts or procedure (baseline was a test fixture, reference data in legacy migrations, manual bucket, runbook silent) | Engineering only. Implemented in this batch: `install/000`, `install/001`, `scripts/install-v2.mjs`, runbook. |
| **AUTH-CFG-01** | Hosted Supabase Auth settings unverified. All GoTrue calls come from the backend IP, so the per-IP limits (30 sign-ups/sign-ins and 150 token requests per 5 min by default) apply to everyone together. | Engineering: `Sb-Forwarded-For` forwarding plus checklist. **Owner:** a non-production Supabase project to verify. |
| **REVIEW-01** | Auth change (backend auth, migration 074) needs Codex review and a MiMo audit per `AGENTS.md` | Tools found locally: `codex-cli 0.160.0` (`codex exec --sandbox read-only`) and `@mimo-ai/cli 0.1.13` (`mimo run --agent plan`). Run on the final code. |

**Additional defects found during this audit (fixed in this batch):**
- `migrate-v2` hashed raw text. A Windows checkout (CRLF) and a Linux deploy (LF) of the same commit produced different ledger checksums, so a later run would stop with CHANGED. Line endings are now normalized.
- Migration 002's reference INSERTs use `ON CONFLICT` on a key with `user_id NULL`, which never fires. A re-run duplicated system categories. The installer's "re-run adds nothing" check found this; the seed now guards those tables.

---

## 3. Resolution order (verified in code)

```
effective plan version = active admin grant  →  verified paid period  →  trial window (selected or scheduled version)
effective terms        = that version's features (+ catalog defaults) and limits
                         → active company overrides (limit / feature), in start order
admission              = feature check + metered limit (rpc_billing_quota, row-locked per company)
```

The brief's order "Active subscription snapshot → permitted company override → effective entitlement" is this model:
- the snapshot is the pinned version;
- grants are an admin-assigned snapshot;
- overrides come next.

There is one source of truth. **No new source is added.**

Existing subscriptions are **pinned** to their `plan_version_id`. Publishing a new version never changes them, so there is no retroactive worsening. Moving a company to a new version is an explicit, dated admin action (`assign` / `schedule`).
