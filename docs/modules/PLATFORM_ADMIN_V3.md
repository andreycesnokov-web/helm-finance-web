# Platform Admin V3 — Business Registry, Codes & Access Overrides

**Status:** Shipped to production (PR1–PR3). This document is the PR4 completion report.
**Date:** 2026-06-18
**Migration:** `030_business_registry.sql` (applied to production)

---

## 1. What this module does

A per-business registry and access-management layer for the platform owner:

- **Business registry** — every business gets a human-readable code (`HF-BIZ-000001`) plus a `type` (`business` | `personal`).
- **Per-business access** — plan, trial, subscription and admin override all belong to a `business_id`, not to a user globally. Two businesses owned by different accounts are managed from one admin panel.
- **Effective access resolver** — a single, unit-tested function decides the real plan from a strict priority order.
- **Admin overrides** — the platform owner can grant any plan to any business by hand (no payment), fully audited, removable any time.
- **Append-only audit** — every access change is recorded in `access_audit`.

CFO AI Core remains a single ledger; this is a control-plane layer only — no billing logic, no cash movement.

---

## 2. Effective access resolver

`server/lib/businessAccess.js` → `computeBusinessAccess(business, now)` (pure, no I/O).

Priority (highest wins):

1. **`admin_override`** — `admin_override_plan` set, window `[override_started_at, override_ends_at)` active.
2. **`subscription`** — `subscription_status === 'active'` and `plan !== 'free'`.
3. **`trial`** — active **by `trial_ends_at` date** (→ effective `founder`).
4. **`free`** — fallback.

Key correctness points:

- Trial is judged by **`trial_ends_at`**, never by the stored `trial_status` string (which can go stale). The resolver reports `trial_status_stored` vs `trial_status_effective` separately.
- `getCurrentAccess(userId, businessId=null)` is **deterministic**: a known `businessId` resolves that business (membership-checked); otherwise it sorts memberships by role priority (owner first) then `created_at`. This replaced an arbitrary `.limit(1)` pick.
- Back-compat shape: `getAccessState(business)` returns exactly `{ isTrialActive, daysLeft, effectivePlan }` — the only fields existing consumers read.

---

## 3. Database (migration 030)

Wrapped in `BEGIN/COMMIT`, idempotent, additive.

- `business_code_seq` sequence + backfill `'HF-BIZ-' || LPAD(nextval, 6, '0')`, unique index.
- `fn_business_code_default` — BEFORE INSERT trigger assigns the next code.
- `fn_business_code_immutable` — UPDATE guard blocking changes to `business_code` / `id`.
- `type` column with CHECK (`business` | `personal`).
- Override fields: `admin_override_plan`, `override_started_at`, `override_ends_at`, `override_reason`, `override_created_by_user_id` (BIGINT → `users(id)` ON DELETE SET NULL), `override_created_at`.
- `access_audit` table + `fn_access_audit_no_mutate` append-only trigger (no UPDATE/DELETE).

Applied to production: 3 businesses received `HF-BIZ-000001..3`.

---

## 4. API surface

**Read (PR1):**
- `GET /api/admin/businesses` — filters `search` / `plan` / `type` / `trial`, pagination.
- `GET /api/admin/businesses/:id`, `/:id/members`, `/:id/usage`, `/:id/access`.

**Write (PR2):** every write inserts an `access_audit` row via `applyAccessChange`.
- `POST /api/admin/businesses/:id/trial` — activate (7-day) / extend (7|14|30).
- `PATCH /api/admin/businesses/:id/access` — grant override (reason required, optional future `expires_at`). Override plans: `starter|business|founder|enterprise`.
- `DELETE /api/admin/businesses/:id/override` — return to natural access.
- `GET /api/admin/access-audit` — global / per-business log.

All admin endpoints require `requireAdmin` (`ADMIN_TELEGRAM_IDS` / `isAdminUser`).

---

## 5. Frontend (PR3)

- `client/src/pages/AdminBusinesses.jsx` — registry table, filters, plan badges, copy ID/code.
- `client/src/pages/AdminBusinessDetail.jsx` — identity / access / usage / members / audit + Manage Access actions.
- `client/src/pages/AdminAccessAudit.jsx` — global access-change log.
- `Admin.jsx` tab bar (Users / Businesses / Audit Log); routes in `App.jsx`.
- i18n EN / RU / ID.

---

## 6. Regression verification (PR4)

Resolver changes are additive and backward-compatible. Verified statically + by tests.

**Contract:** `getAccessState` returns the same 3 fields as before; all 13 call-sites read only those (+ unchanged `access.limits.*`, `access.membership`).

| Module | Gate | Affected by resolver? |
|---|---|---|
| AI CFO / Pulse (`/access/status`) | `getAccessState` fields | ✅ compatible |
| Invoice / Transaction / Wallet / AI-Q limits | `access.limits.*` + `effectivePlan` | ✅ compatible |
| Payroll | `canManagePayroll(role)` — role | ⛔️ independent |
| Bank Import | `auth` + `requireBusiness` — role | ⛔️ independent |
| Telegram (approve/reject/webhook) | webhook-secret + role | ⛔️ independent |

**Tests (all green):**
- `tests/businessAccess.test.js` — 18/18 (priority, multi-business, stale-trial)
- `tests/taxGate.test.js` — 23/23
- `tests/dueDate.test.js` — 16/16
- `tests/migrations/ci_030.js` (PGlite) — 12/12 (stable codes, immutable/append-only/dup/type guards)
- `node --check server/index.js` — OK
- frontend `npm run build` — OK

**Conclusion:** no regressions. Bonus — `getCurrentAccess` is now deterministic (arbitrary `.limit(1)` business pick fixed).

---

## 7. Files

- `migrations/030_business_registry.sql`, `migrations/_preflight_postflight_030.sql`
- `server/lib/businessAccess.js`
- `server/index.js` (resolver delegation, admin read/write endpoints)
- `client/src/pages/Admin{Businesses,BusinessDetail,AccessAudit}.jsx`, `Admin.jsx`, `App.jsx`
- `tests/businessAccess.test.js`, `tests/migrations/ci_030.js`
