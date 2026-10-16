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

The release candidate is compiled on branch `release/cfo-v2-rc1` with base `integration/pilot-rc1-main` (`dd9b569`).

Integrated commits:
1. `dd9b569` — Base integration: D4 dated opening anchors (`6f70adb`, `9b5c843`, `b741e21`), UI pilot readiness (`b3f55ab`, `2c1e173`), atomic business profile editor, bill modal.
2. `a7fee5b` — `fix(security): migrate platform admin to PostgreSQL RBAC and verified email auth` (AntiGravity).
3. `40baef6` — `fix(security): resolve stale role cache and serialize concurrent bootstrap` (Codex P1 Hardening).
4. `c617f54` — Merge branch `fix/platform-admin-auth-hardening` into `release/cfo-v2-rc1`.
5. `a8d5d4c` — `feat: billing management center - plan versioning, custom overrides, and admin control` (merged with unified routes in `client/src/App.jsx` and `client/src/v2/AdminApp.jsx`).
6. `e8ffc9f` — Merge branch `feat/billing-management-center` into `release/cfo-v2-rc1`.
7. `d714871` — `fix(security): fail closed on audit failure during admin bootstrap and align integration harnesses with platform_admins`.

---

## 2. Database Migrations & Order of Execution

The database migration chain requires strict execution across `migrations/` and `supabase/migrations/`:

### Migration Execution Chain:
1. **Financial Baseline & D4 Anchors (Pre-existing up to 071):**
   - Ensure migrations up to `migrations/071_*.sql` are applied.
2. **Platform Admin RBAC (Migration 072):**
   - File: `migrations/072_platform_admins.sql`
   - Purpose: Creates table `public.platform_admins`, defines enum/check for roles (`super_admin`, `platform_admin`), configures RLS and indices.
3. **Commercial Billing Phase 1 (Supabase Migration):**
   - File: `supabase/migrations/20261015033808_cfo_commercial_trial.sql`
   - Purpose: Creates `billing_schema_versions`, `commercial_billing_plans`, `company_subscriptions`, `billing_access_grants`, seeds Starter/Control/Pro plans, adds `trial_ends_at` (168h).
4. **Billing Management Center (Supabase Migration):**
   - File: `supabase/migrations/20261017090000_billing_management_center.sql`
   - Purpose: Creates `billing_overrides`, expands plan catalog columns, adds versioning, overrides audit logging.

### Verification Command:
```bash
# In PostgreSQL terminal:
SELECT tablename FROM pg_tables WHERE schemaname = 'public' 
AND tablename IN ('platform_admins', 'billing_schema_versions', 'commercial_billing_plans', 'company_subscriptions', 'billing_overrides');
# Expected output: All 5 tables present.
```

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
Apply migrations in strict order:
```bash
psql $DATABASE_URL -f migrations/072_platform_admins.sql
psql $DATABASE_URL -f supabase/migrations/20261015033808_cfo_commercial_trial.sql
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

## 9. Rollback Strategy

If critical regression is detected post-release:
1. **Frontend Fast Rollback:**
   - Redeploy client with `VITE_DESIGN_V2=false`. This immediately switches users back to the tested V1 UI without requiring backend downtime.
2. **Backend Rollback:**
   - Revert application container to previous release tag (`pilot-rc1-main`).
   - Database rollback: Migration 072 and billing tables are additive and do NOT break legacy queries. They can remain in place safely during a code rollback.

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
