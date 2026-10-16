# CFO AI V2.0 — Production Runbook

**Target Branch:** `release/cfo-v2-rc1`  
**Target Domains:**  
- **Production (Main Domain):** `cfo.helmfinance.com`  
- **Staging:** `staging.cfo.helmfinance.com`  
**Release Tag:** `v2.0.0-rc1`  
**Document Author:** Codex (Autonomous Release Integration Agent)  
**Date:** 2026-10-16  

---

## 1. Release Commits & Provenance

The release candidate is compiled on branch `fix/v2-rc1-p1-hardening` (branched from `release/cfo-v2-rc1` @ `405827f`) with base `integration/pilot-rc1-main` (`dd9b569`).

Integrated commits:
1. `dd9b569` — Base integration: D4 dated opening anchors (`6f70adb`, `9b5c843`, `b741e21`), UI pilot readiness (`b3f55ab`, `2c1e173`), atomic business profile editor, bill modal.
2. `a7fee5b` — `fix(security): migrate platform admin to PostgreSQL RBAC and verified email auth` (AntiGravity).
3. `40baef6` — `fix(security): resolve stale role cache and serialize concurrent bootstrap` (Codex P1 Hardening).
4. `c617f54` — Merge branch `fix/platform-admin-auth-hardening` into `release/cfo-v2-rc1`.
5. `a8d5d4c` — `feat: billing management center - plan versioning, custom overrides, and admin control` (merged with unified routes in `client/src/App.jsx` and `client/src/v2/AdminApp.jsx`).
6. `e8ffc9f` — Merge branch `feat/billing-management-center` into `release/cfo-v2-rc1`.
7. `d714871` — `fix(security): fail closed on audit failure during admin bootstrap and align integration harnesses with platform_admins`.
8. `405827f` — `chore(release): CFO AI V2.0 Release Candidate 1 consolidated bundle`.
9. `P1 Hardening Batch` — SEC-P1-03 (canonical single `BIGINT` bootstrap RPC, fail-closed on RPC failure, eliminate insecure JS fallback), RUNBOOK-P1-01 (comprehensive migration chain audit), OPS-P1-02 (safe multi-tier rollback protocol).

---

## 2. Database Migrations & Order of Execution (RUNBOOK-P1-01)

The database migration chain requires strict execution across `migrations/` and `supabase/migrations/`. Operators must NOT skip intermediate migrations or assume prior states without running pre-flight verification.

### Pre-Flight Schema Assessment SQL:
Run this query before applying migrations to determine the database baseline:
```sql
SELECT
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_records') AS has_071,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets' AND column_name = 'opening_balance_date') AS has_d4_anchor,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'platform_admins') AS has_072_admin,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_subscriptions') AS has_billing_v1,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'billing_overrides') AS has_billing_center;
```

### Complete Unified Chronological Execution Chain:

#### Stage A: Intermediate Migrations (If Database is at Schema 068 / Pre-October 9 Snapshot)
If `has_071 = false`, apply intermediate migrations in chronological order:
1. `migrations/069_bank_import_atomic_confirm.sql` — Atomic bank statement review confirmation.
2. `migrations/070_atomic_business_balance.sql` — Atomic business balance calculation.
3. `migrations/071_financial_records_restrict_user_delete.sql` — Immutable financial record delete guard.
4. `migrations/20261010143341_import_balance_compat.sql` — Statement import balance compatibility.
5. `migrations/20261011001823_financial_writer_protocol.sql` — Financial writer invariant protocol.
6. `migrations/20261011222631_intercompany_balances_security_invoker.sql` — Intercompany security invoker view.
7. `migrations/20261012032717_durable_financial_recovery.sql` — Idempotent financial recovery intents.
8. `migrations/20261012110000_durable_company_creation.sql` — Durable company creation with owner transaction.
9. `migrations/20261012123000_atomic_team_membership.sql` — Atomic team member invites and roles.
10. `migrations/20261013001000_atomic_business_profile.sql` — Atomic company settings & tax profiles.
11. `migrations/20261013031755_historical_bank_import_review_receipts.sql` — Import review receipts.
12. `migrations/20261013062733_private_import_receipt_immutability.sql` — Immutable import receipts.
13. `migrations/20261013114500_atomic_bill_creation.sql` — Atomic bill & invoice creation.
14. `migrations/20261014040810_operation_document_control.sql` — Operational document attachment controls.

#### Stage B: CFO AI V2.0 Core Migration Batch (Mandatory for Release Candidate)
Apply these 4 migrations in strict sequential order:
1. **Platform Admin Server-Side RBAC (072):**
   - **File:** `migrations/072_platform_admins.sql`
   - **Purpose:** Creates `public.platform_admins` table, role enum (`super_admin`, `platform_admin`), `fn_platform_admins_guard` trigger protecting the last active super_admin, and canonical atomic `fn_bootstrap_platform_super_admin(BIGINT)` secured by `pg_advisory_xact_lock(hashtext('cfo_platform_admin_bootstrap'))`.
2. **D4 Dated Opening Balance Anchors (D4-A):**
   - **File:** `migrations/20261016090000_dated_opening_anchor.sql`
   - **Purpose:** Adds `opening_balance_date`, `opening_balance_reanchored_at`, and `opening_balance_reanchored_by` to `public.wallets`. Implements atomic re-anchoring function `fn_reanchor_wallet_opening_balance` to guarantee that historical transactions prior to the anchor date do not corrupt current wallet balances.
3. **Commercial Billing Phase 1 (Supabase Migration):**
   - **File:** `supabase/migrations/20261015033808_cfo_commercial_trial.sql`
   - **Purpose:** Creates `billing_schema_versions`, `commercial_billing_plans`, `company_subscriptions`, `billing_access_grants`. Seeds standard plans (Starter, Control, Pro) and enforces 168-hour trial lifecycle.
4. **Billing Management Center (Supabase Migration):**
   - **File:** `supabase/migrations/20261017090000_billing_management_center.sql`
   - **Purpose:** Creates `billing_overrides`, expands plan catalog with versioning columns (`version`, `is_published`, `change_summary`), and configures admin billing audit logs.

### Post-Migration Verification SQL:
Execute this verification script to ensure all schema invariants are satisfied:
```sql
-- 1. Verify all 6 critical V2 tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' 
AND tablename IN (
  'platform_admins', 
  'billing_schema_versions', 
  'commercial_billing_plans', 
  'company_subscriptions', 
  'billing_access_grants', 
  'billing_overrides'
);

-- 2. Verify D4-A wallet columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'wallets' 
AND column_name IN ('opening_balance_date', 'opening_balance_reanchored_at', 'opening_balance_reanchored_by');

-- 3. Verify platform admin bootstrap stored procedure signature
SELECT proname, pg_get_function_arguments(oid) as args
FROM pg_proc 
WHERE proname = 'fn_bootstrap_platform_super_admin';
-- Expected: Exactly 1 row with args: 'p_user_id bigint'

-- 4. Verify trigger protection on platform_admins
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_platform_admins_guard';
```
If any check fails, do NOT start application traffic. Follow Section 5 (Recovery) or Section 9 (Rollback).

---

## 3. Environment Variables & Feature Flags

### Required Server Environment:
- `NODE_ENV=production`
- `PORT=3000` (or platform default)
- `DATABASE_URL=postgresql://...` (Supabase / PostgreSQL connection string)
- `SUPABASE_URL=https://...`
- `SUPABASE_SERVICE_ROLE_KEY=ey...`
- `JWT_SECRET=...` (Min 32 characters, high entropy)
- `COMMERCIAL_BILLING_ENABLED=true` (Activates commercial billing APIs and catalog)
- `COMMERCIAL_BILLING_FIXTURES=false` (Must NEVER be true in production)
- `ADMIN_TELEGRAM_IDS=` (DEPRECATED: Ignored by authentication shield, leave blank or unset)

### Required Client Environment (Vite Build):
- `VITE_DESIGN_V2=true` (Activates V2 Navigation and Design 2.0 interface)
- `VITE_API_URL=/api` (or fully qualified domain `https://cfo.helmfinance.com/api`)
- `VITE_SUPABASE_URL=https://...`
- `VITE_SUPABASE_ANON_KEY=ey...`

---

## 4. Production Backup Procedure

Before applying any migration or code deployment:
1. **Database Snapshot:**
   ```bash
   # Supabase CLI or pg_dump:
   pg_dump -h <DB_HOST> -p 5432 -U postgres -d postgres \
     --format=custom --file="/backups/cfo_pre_v2_$(date +%Y%m%d_%H%M%S).dump"
   ```
2. **Configuration & Environment Snapshot:**
   - Export environment variables from hosting platform (Railway/Kamatera) to encrypted vault.
3. **Verify Dump Integrity:**
   ```bash
   pg_restore --list "/backups/cfo_pre_v2_*.dump" > /dev/null
   echo "Exit code: $?" # Must return 0
   ```

---

## 5. Verified Recovery Procedure

In case of fatal migration failure or corruption:
1. **Stop Application Traffic:**
   - Place load balancer / Cloudflare in maintenance mode (503 Service Unavailable).
2. **Restore Database from Snapshot:**
   ```bash
   pg_restore -h <DB_HOST> -p 5432 -U postgres -d postgres \
     --clean --if-exists --no-owner --no-privileges "/backups/cfo_pre_v2_*.dump"
   ```
3. **Verify Ledger & Balance Integrity:**
   ```sql
   SELECT count(*) FROM public.transactions WHERE deleted_at IS NULL;
   SELECT sum(balance) FROM public.wallets;
   ```
4. **Re-route Traffic.**

---

## 6. Super Admin Bootstrap Procedure

Platform Admin privileges **CANNOT** be claimed through Telegram or self-service signup. Bootstrap is restricted to an authorized operator via server console.

### Prerequisites:
1. The target administrator must have signed up via Email OTP / Magic Link and verified their email address.
2. Verified identity must exist in `public.user_email_identities` (`email_verified_at IS NOT NULL`).

### Bootstrap Command:
```bash
# On server host:
node scripts/bootstrapPlatformAdmin.mjs <OWNER_VERIFIED_EMAIL>
```

### Security Invariants:
- Fails closed if another `super_admin` already exists in `public.platform_admins`.
- Fails closed if the email is unverified or unregistered.
- Fails closed if audit event logging fails (`mandatory_security_audit_failed`).
- Emits structured audit event into `public.audit_events`.

---

## 7. Deployment Sequence

### Step 1: Pre-Flight Check (Staging First)
1. Verify git commit matches `release/cfo-v2-rc1` (`d714871`).
2. Run database migration rehearsal on cloned database.
3. Confirm clean migration execution.

### Step 2: Database Migration Execution
Apply CFO AI V2.0 Core Migrations in strict sequential order:
```bash
# 1. Platform Admin Server-Side RBAC (072)
psql $DATABASE_URL -f migrations/072_platform_admins.sql

# 2. D4 Dated Opening Balance Anchors (D4-A)
psql $DATABASE_URL -f migrations/20261016090000_dated_opening_anchor.sql

# 3. Commercial Billing Phase 1 (168h trial, plans, subscriptions)
psql $DATABASE_URL -f supabase/migrations/20261015033808_cfo_commercial_trial.sql

# 4. Billing Management Center (Plan versioning, overrides, admin audit)
psql $DATABASE_URL -f supabase/migrations/20261017090000_billing_management_center.sql
```

### Step 3: Frontend Build & Asset Deployment
```bash
cd client
npm ci
VITE_DESIGN_V2=true npm run build
# Deploy dist/ to CDN / Web Server
```

### Step 4: Backend Service Restart
Restart Node.js process under systemd / Railway / Docker.

### Step 5: Platform Admin Bootstrap
Run `node scripts/bootstrapPlatformAdmin.mjs <OWNER_VERIFIED_EMAIL>`.

---

## 8. Post-Deployment Smoke Tests

1. **Authentication Smoke Test:**
   - Attempt login via Email OTP with standard user account -> verify dashboard loads in V2 (`/`).
   - Attempt login with Telegram -> verify user account works, but no admin privileges are granted.
2. **Admin Security Smoke Test:**
   - Log in with non-admin email -> navigate to `/admin` -> verify immediate `403 Forbidden` / redirection.
   - Log in with bootstrapped super_admin email -> navigate to `/admin` -> verify Billing Center and Security Center load.
3. **Financial Ledger Smoke Test:**
   - Open `/accounts` -> verify opening balance anchor and current wallet balances match bank statement.
   - Record test expense -> verify wallet balance decreases by exact amount without double deduction.
4. **Billing Smoke Test:**
   - Open `/billing` -> verify Starter, Control, Pro plans display in currency.
   - Verify 168-hour trial status is properly displayed without 404 error.

---

## 9. Safe Multi-Tier Rollback Strategy (OPS-P1-02)

If a critical regression or operational failure occurs post-release, operators must follow this multi-tier rollback protocol depending on the severity and blast radius.

### Tier 1: Frontend Fast Presentation Rollback (`VITE_DESIGN_V2=false`)
- **Use Case:** Non-critical UI glitch, layout rendering bug, or client bundle regression in Design 2.0 components.
- **Action:** Re-build and redeploy client bundle with `VITE_DESIGN_V2=false`.
  ```bash
  cd client && VITE_DESIGN_V2=false npm run build
  # Redeploy dist/
  ```
- **Backend & Database Impact:** Zero downtime; backend remains at V2.0.
- **Operational Boundaries & `commercial_v2` Subscriptions:**
  - Companies created under V2.0 with `billing_policy='commercial_v2'` remain valid.
  - The backend `commercialAdmission` middleware continues to honor their active 168h trial without blocking read or write mutations.
  - The V1 interface does not show the new Billing Center or V2 navigation, but core transactions, accounts, and settings operate without error.

### Tier 2: Application Code Rollback (Backend + Frontend to `dd9b569`)
- **Use Case:** Critical server crash, memory leak, unhandled API exception, or severe regression in server routes.
- **Action:** Redeploy application container from previous release tag (`pilot-rc1-main` @ `dd9b569`).
- **CRITICAL HARD SECURITY BOUNDARY — PLATFORM ADMIN RBAC:**
  - **STRICT PROHIBITION:** Under NO circumstances may `ADMIN_TELEGRAM_IDS` be restored as an administrative grant mechanism during a rollback. In accordance with CFO AI security governance (AGENTS.md):
    - *Email is the primary identity entry.*
    - *Telegram is legacy login and future paid add-on only.*
    - *Admin privileges via Telegram are strictly forbidden.*
  - **Preserving PostgreSQL RBAC:**
    - The `public.platform_admins` table and `072_platform_admins.sql` are purely additive and do NOT disrupt legacy backend queries.
    - Keep `public.platform_admins` and the `fn_platform_admins_guard` trigger intact in PostgreSQL.
    - If administrative actions are needed while backend is on `dd9b569`, perform them directly via database SQL queries or apply an emergency hotfix preserving `server/lib/platformAdmin.js`.
- **Handling `commercial_v2` Subscriptions during Backend Rollback:**
  - In `dd9b569`, `commercial_billing` routes do not exist.
  - Existing `company_subscriptions` and `billing_overrides` rows in PostgreSQL remain dormant and will not interfere with legacy company operations.
  - Legacy companies continue to execute under standard pilot policy without forced commercial admission.

### Tier 3: Database Rollback (Restoring from Pre-Release Backup)
- **Use Case:** Critical database corruption or unrecoverable ledger inconsistency.
- **Action:**
  1. Stop all client traffic immediately (Cloudflare 503 Maintenance Page).
  2. Restore database from pre-release snapshot (Section 4):
     ```bash
     pg_restore -h $DB_HOST -U postgres -d postgres --clean --if-exists "/backups/cfo_pre_v2_*.dump"
     ```
  3. **Point-In-Time Transaction Reconciliation:**
     - Extract any financial transactions created between V2 deployment and rollback start:
       ```sql
       -- If WAL or transaction audit logs are available, replay missing records:
       SELECT id, business_id, wallet_id, amount, created_at 
       FROM transactions WHERE created_at >= '<DEPLOY_TIMESTAMP>';
       ```
     - Re-verify wallet balances against actual bank statements before reopening traffic.

### Down-Migration Policy:
- Never execute down migrations (`DROP TABLE`) on a live production database while user traffic is connected. Down migrations (`*_down.sql`) are strictly reserved for isolated development and staging rehearsal tests.

---

## 10. Monitoring & Alerting After Release

Monitor the following metrics in Railway / Datadog / PM2:
1. **HTTP Error Rate:**
   - Alert threshold: 5xx errors > 0.5% over 5-minute rolling window.
2. **Admin Auth Rejections:**
   - Log filter: `[platformAdmin] unauthorized_access` — alert on sudden spikes indicating credential stuffing.
3. **Database Connection Pool:**
   - Monitor active pool connections; ensure no leaking client connections.
4. **Audit Trail:**
   - Verify `audit_events` table is actively recording platform admin grants and subscription changes.

---

## 11. Known Limitations & Deferred Items

1. **Fine-Grained Quota Enforcement (WIP):**
   - Document upload limit and AI query limits per subscription plan are currently in active development by Claude (`C:/tmp/cfo-enf`).
   - **Current State in RC1:** Plan selection, 168h trial expiration, server access exceptions, and billing admin overrides are fully active. Fine-grained quota enforcement will be integrated in patch release v2.0.1.
2. **Automated OCR Pipeline:**
   - Document upload and storage are fully functional. Full asynchronous OCR parsing runs when cloud vision workers are provisioned; manual classification is the primary pilot workflow.
3. **Payment Gateway Integration:**
   - Commercial billing is in pilot mode (trial activation and admin overrides). Live payment gateways (Midtrans / Xendit / Stripe) are deliberately unconfigured and flag-gated off.

---

## 12. Go / No-Go Checklist

| Check Item | Requirement | Status | Result |
|------------|-------------|--------|--------|
| **P0 Security** | PostgreSQL `platform_admins` RBAC enforced on all admin endpoints | Verified by 17 unit tests + HTTP harness | **PASS** |
| **Auth Shield** | `ADMIN_TELEGRAM_IDS` zero-grant verified across all codebase | Confirmed by AST and test suite | **PASS** |
| **Financial Integrity** | Double-entry invariants, D4 dated opening balances preserved | Regression suite passed | **PASS** |
| **Billing Trial** | 168-hour trial life-cycle, concurrency and expiry enforced on server | 9 integration scenarios passed | **PASS** |
| **Billing Admin** | Versioning, custom overrides, admin audit trail functional | 6 integration scenarios passed | **PASS** |
| **UI Design 2.0** | Design tokens, no hardcoded colors, RU/EN/ID localization complete | Guard tests + Vite production build passed | **PASS** |
| **Staging Rehearsal** | Migrations successfully executed against PostgreSQL 17 | Verified on local rehearsal DB | **PASS** |
| **Data Boundaries** | Personal vs Business wallet separation preserved | Confirmed by workspace guard tests | **PASS** |

### Release Gate Sign-Off:
- **Verdict:** **GO FOR STAGING REHEARSAL** / **CONDITIONAL GO FOR PRODUCTION PILOT** (pending owner email bootstrap approval).
