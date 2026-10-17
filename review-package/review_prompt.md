You are an independent reviewer of a release candidate of CFO AI (Express + Supabase/PostgreSQL financial app).
Read-only review. Do not modify files. Do not run network calls. Repository is the current directory.

Scope: `git diff 1f51422..HEAD` (branch feat/v2-email-password-auth). Main areas:
1. Email + Password auth via Supabase Auth/GoTrue: server/lib/passwordAuth.js, server/lib/sessionUser.js,
   migrations/074_supabase_auth_password_link.sql, server/index.js (auth gates, magicLinkGate, emailAuthGate),
   client/src/hooks/useAuth.jsx, client/src/v2/auth/AuthApp.jsx.
   Contracts that must hold: app identity/roles/memberships/RLS/app-JWT preserved; Supabase user linked to the app
   user only through a verified immutable auth user id, never by an unverified email; email confirmation required
   before a session; password reset revokes sessions; rate limiting; logout revokes the server session.
2. Billing plan matrix: supabase/migrations/20261018090000_billing_plan_matrix.sql (+ _down), server/lib/commercialBilling.js,
   server/lib/commercialAdmission.js, server/lib/billingPaused.js, server/lib/billingRoutes.js, client/src/v2/admin/billing/*.
   Contracts: absent metered limit = undecided (publication refused), 0 = disabled, null = unlimited; existing subscribers
   keep their pinned version; only super_admin can change/publish plans; company overrides temporary, audited; with
   COMMERCIAL_BILLING_ENABLED=false commercial companies are "billing paused" (no legacy Free limits, plan features
   still apply, no metering, costly external features 503) and legacy companies unchanged; public GET /api/public/plans
   exposes only published approved plans and no internal fields.
3. Clean installer: scripts/install-v2.mjs, scripts/migrate-v2.mjs, install/000*, install/001*: refuses non-empty
   foreign databases, idempotent re-run, private document bucket, no customer data.

Report ONLY concrete, verifiable defects. For each finding give:
- Severity: P0 (data loss, auth bypass, cross-tenant access, money moved wrongly), P1 (security/contract violation or
  release blocker), P2 (minor).
- File and line.
- A concrete failure scenario (inputs/state -> wrong result).
- Why the existing tests do not catch it (if known).
If you find no P0/P1, say exactly "NO P0/P1 FINDINGS" and list P2s if any. Do not speculate without pointing at code.
