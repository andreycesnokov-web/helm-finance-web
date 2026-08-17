# Handoff - CFO AI / Helm Finance

Last updated: 2026-07-04.

## Current State

- Web app is live at `https://app.cfo-ai.site`.
- Email auth is live and is the primary identity entry.
- Telegram login remains as legacy access.
- Personal Account v1 exists but finance features are gated.
- Business Workspace is active and is the main monetization path.
- Telegram active-business routing has been applied and improved.
- Bot work happens in separate repo `C:\Users\HUAWEI\Desktop\Fin Bot`.

## Current Local Branch

- Branch: `feature/business-premium-p3b`.
- Local commit ahead of `origin/main`: `7bb6a3ce feat(business): P3b - deterministic tax obligations (no estimates)`.
- Treat P3b as not fully production-confirmed unless owner confirms promote/deploy.

## Last Known Important Production Facts

- App shell returns HTTP 200 on `app.cfo-ai.site`.
- `/api/documents/health` returns API-style 401 when unauthenticated.
- `/api/health` returned SPA HTML shell during this audit. FIXED on branch
  `feature/stabilization-pass` (now JSON; unknown `/api/*` → JSON 404). Not yet promoted —
  production still serves the old behavior until deploy.

## Stabilization Pass Batch (pending review)

- Branch: `feature/stabilization-pass` (off `main` at `6c96666f`).
- Backend-only safe fixes: JSON `/api/health` + JSON `/api/*` 404; Telegram paid-gate
  `.effectivePlan`→`.effective_plan`; `EMAIL_AUTH_DEV_RETURN_CODE` prod hard-disable;
  magic-link HTML escaping; removed secret-length from logs; default-OFF bridge kill-switch
  `PERSONAL_FUNDING_BRIDGE_ENABLED`.
- No migrations, no env changes, no Telegram linking/cutover, no payments, no bridge
  implementation, no backend auth changes.
- Verified: `node --check` (3 files) OK; 29 integration tests pass; builds Personal OFF/ON
  exit 0; local smoke of health/404/SPA/documents-health OK; secret scan clean.
- Awaiting Codex review before promote (Claude writes, Codex reviews, owner go/no-go).

## Account & Identity Management MVP Batch (2026-07-05, pending review)

- Branch: `feature/account-identity-mvp` (off `main`).
- Adds: `/account` "Login & Security" (read-only), admin Users console enrichment (email
  identities, memberships, email search), and admin action `POST /api/admin/users/:id/link-email`
  (safe email→existing-user linking; linked/already_linked/conflict; audited). New read
  endpoint `GET /api/me/login-methods` (no internal id).
- Core rule: email + Telegram are login methods of ONE account. Linking is additive (inserts
  `user_email_identities` for the existing user id); email login then resolves to that account.
- NOT implemented (documented): account disable/suspend (needs additive `users.status`
  migration + auth check), hard delete / anonymize / merge (future design).
- No migrations, no env, no Telegram/payments/bridge/backend-auth-architecture changes.
- Verified: `node --check` OK; builds Personal OFF/ON exit 0; 26 boundary/auth tests pass;
  local guard smoke (link-email 401/403/400, /me/login-methods 401, Telegram+email login
  routes still present). Link DB branches verified by review (no live DB in CI).
- Awaiting Codex review before promote.

## Admin Test Data Cleanup / Archive MVP Batch (2026-07-06, pending review)

- Branch: `feature/admin-archive-mvp` (off `main`).
- Adds: soft archive of businesses/workspaces via existing `businesses.status='archived'`
  — `GET …/cleanup-preflight`, `POST …/archive` (confirm + exact-name guard),
  `POST …/unarchive`; `listAccessibleWorkspaces` hides archived from the switcher; admin
  business list returns `status`; Admin Business Detail Cleanup card (preflight + archive).
- Archive is reversible and deletes nothing; audited to `audit_events`. Hard delete NOT
  implemented (blocked by default). Duplicate-user disable NOT implemented (needs
  `users.status` migration).
- No migrations, no env, no Telegram/payments/bridge/backend-auth changes. No production data
  archived by this task (implementation only).
- Verified: `node --check` OK; builds OFF/ON exit 0; 20 boundary/funding tests pass; live
  guard smoke (preflight/archive/unarchive 401/403, bad-uuid 400). Archive DB write +
  confirm/name guards verified by review (no live DB in CI).
- Owner cleanup target (owner-run later): archive `My Business` + duplicate personal
  workspace (both owner `-1`); keep 1057134807/@Andrei_Cn + Helm Care Indonesia/Pay +
  Andrei's personal workspace.
- Awaiting Codex review before promote.

## Email Auth Hardening Hotfix Batch (2026-08-11, pending review)

- Branch: `hotfix/email-auth-persistence` (off `main`).
- Root cause it fixes: `issueEmailSecret()` ignored the `email_login_codes` insert error, so
  during the Supabase outage links were emailed for tokens that were never stored → every
  callback said "invalid or expired" while logs said "secret issued".
- Change: persist first, then send. Typed `secret_not_persisted` error → `POST
  /api/auth/email/start` returns 503 `auth_temporarily_unavailable` (user-safe message, no
  email sent); `/login/email` shows it and stays on step 1; invite path degrades to
  `email_invite_failed: true`; generic catch no longer leaks internal error text.
- No migrations, no env, no Telegram/payments/bridge/archive changes.
- Verified: `node --check` OK; simulated insert failure → 503 + 0 "secret issued" + 0 email
  sends + 0 secret leakage; success path (fake PostgREST) → 200, 2 inserts, correct logs;
  invalid token 400 / bad code 401 unchanged; builds Personal OFF/ON exit 0; 26 tests pass.
- NOT tested: success path against a real Supabase (would write to production) — owner
  should confirm with one fresh magic-link login after deploy.
- Awaiting Codex review before promote.

## Platform Admin Dashboard Foundation Batch (2026-08-11, pending review)

- Branch: `feature/admin-dashboard` (off `main` = `be6d2f71`).
- Adds read-only `GET /api/admin/dashboard` (auth + requireAdmin) and the `/admin/dashboard`
  page, linked from the admin tab bar. Built inside the existing app — NOT a separate backend.
- Counts only; unavailable metrics return null + warnings; billing is an explicit placeholder.
- Verified: `node --check` OK; 401/403/200 guards; healthy-DB 200 in ~0.05s; DB-unreachable
  200 with nulls + warnings in ~21s; read-only proof (17 HEAD + 2 GET, 0 writes); no secrets
  in response; builds Personal OFF/ON exit 0; 26 tests pass; client/dist clean.
- No migrations, no env, no auth/Telegram/payments/bridge/archive changes. Nothing deployed.
- Future (not now): admin.cfo-ai.site + analytics warehouse.
- **Review-blocker fixes applied (2026-08-11)**: 6s collection deadline (degraded 200 instead
  of a ~21s hang); `duplicate_email_conflicts` null instead of hardcoded 0; capped selects
  null out dependent risk metrics; `email_only_owners` requires an actual email identity, not
  just a negative id; warnings sanitized (no raw DB internals in the response).
  Verified: 6.0s degraded / 0.06s healthy, 401/403 guards, cap→null, email_only_owners=1 (not
  2) on controlled data, builds OFF/ON, 26 tests, dist clean, no secrets.
- **Final timeout-abort fix (2026-08-11)**: the two bounded `identity_risks` selects now
  carry the shared abort signal, no new query starts once the deadline passed, and the
  deadline timer is cleared on success and error. Proven: 0 requests after the degraded
  response; both bounded GETs aborted. Healthy path 0.05s, degraded 6.03s, guards 401/403.
- Awaiting Codex final review before promote. Nothing deployed.

## Railway Build Hotfix Batch (2026-08-13, pending review)

- Branch: `hotfix/railway-build-rollup` (off `main`).
- Fixes the failed Railway build (`Cannot find module @rollup/rollup-linux-x64-gnu`).
- Root cause: committed `client/node_modules` (Windows binaries only) + no client install
  step on the Linux builder. Lockfile was fine — it lists all 26 platform binaries.
- Changes: untrack `client/node_modules` (2310 files) and `client/dist` (7 files); root
  `build` now runs `npm ci` in client; `.nvmrc` = 22 LTS; `engines.node >=20.11.0`.
- No lockfile edits, no new dependency, no product code, no env changes.
- Verified: fresh-clone simulation (no node_modules, no dist) builds successfully;
  `npm ci --dry-run` in sync at root and client; `node --check` OK; builds Personal
  OFF/ON exit 0; integration tests pass; secret scan clean.
- NOTE: first Railway build after this will be slower (real `npm ci`, no cached tree).
- Awaiting Codex review before promote. Nothing deployed.

## Admin Cleanup & Reset Console Phase 1 Batch (2026-08-15, pending review)

- Branch: `feature/admin-cleanup-console` (off `main` = 11f710f4).
- Adds read-only `GET /api/admin/users/:id/cleanup-preflight` + Cleanup & Reset panel on
  `/admin/users/:id`; upgrades `/admin/businesses/:id` cleanup to reason + typed-name inputs.
- Archive/restore now REQUIRE a reason and roll back if the audit event cannot be written.
- No hard delete, no reset, no user suspend (no `users.status` column — Phase 2, needs an
  approved migration). No migrations, no env, no auth/Telegram/payments/bridge changes.
- Verified: `node --check` OK; guards 401/403/400/200; preflight read-only (0 write verbs);
  archive guard matrix; audit-failure rollback proven; builds OFF/ON exit 0; 26 tests pass;
  node_modules/dist untracked; secret scan clean. Nothing deployed.
- **Safety fixes after NO-GO (2026-08-15)**: fail-closed preflights (errors/truncation ⇒ null +
  warning + unsafe), business counts never collapse errors to 0, sanitized preflight failure
  code, truthful rollback reporting (`audit_failed_rolled_back` vs
  `audit_failed_rollback_failed` + uncertain), `email_origin_owner` rename, debts≠invoices,
  frontend blocks Archive on incomplete preflight. NEW regression suite
  `tests/integration/adminCleanup.test.js` — 13 tests, all passing (39 total across suites).
- **Final fail-closed fixes (2026-08-15)**: rollback confirmed via returned row+status
  (zero-row/wrong-status ⇒ uncertain, never "rolled back"); frontend gate requires explicit
  `preflight_complete === true` (new `client/src/lib/preflight.js`, unit-tested); tri-state
  identity so `null` shows n/a instead of "not linked". Regression suite now 18 tests;
  44 tests pass across all suites. Real production archive still blocked until a
  disposable-workspace smoke passes.
- Awaiting Codex final review before promote.

## Tax Profile Input Focus Fix Batch (2026-08-17, pending review)

- Branch: `fix/tax-profile-input-focus` (off `main` = 8b164ae4).
- Fixes the production bug where AI Accountant → Tax Profile inputs accepted one character
  then lost focus. Root cause: `Field` declared inside `BusinessAccountant` ⇒ new component
  type per render ⇒ React remounted the `<input>`. Hoisted to module scope.
- Frontend only: `client/src/pages/business/Accountant.jsx` + new guard test. No backend, no
  migrations, no env, no production data mutations.
- Verified in a browser before AND after: pre-fix lost focus after character 1 (value "0");
  post-fix 15+ characters typed continuously into NPWP/NIB/KPP/legal name with focus and DOM
  node intact; select + date fields work; status chip updates without remounting.
- New regression guard `tests/integration/formComponentStability.test.js` (fails on the
  pre-fix file, passes on the fix). Builds OFF/ON exit 0; 46 tests pass.
- Awaiting Codex review before promote. Nothing deployed.

## AI Accountant Document Intake Phase 1 Batch (2026-08-17, pending review)

- Branch: `feature/ai-accountant-doc-intake` (off `main` = 0ed2cd25).
- One upload window + classification + preliminary required-document checklist + manual
  correction, on the AI Accountant Tax Profile page. Upload reuses the existing Document
  Center flow; **no migration** (intake metadata lives in `extracted_json.ai_intake`).
- 4 new endpoints, all business-scoped and auth-gated; GETs never write.
- Verified: 66 tests pass (19 new); builds Personal OFF/ON exit 0; all endpoints 401 unauth;
  browser check of the checklist, intake inbox, upload-modal detection and manual correction;
  no migrations/env/new provider; secret scan clean; node_modules and dist untracked.
- Phase 2 backlog: OCR, AI classification from document text, official KB-backed
  requirements, accountant review workflow, expiry tracking, Telegram upload routing, and
  consolidating the legacy manual checkbox card.
- Awaiting Codex review before promote. Nothing deployed.

## Next Recommended Work

1. Personal -> Business Activation MVP.
2. Entitlements/pricing foundation.
3. Personal AI CFO insights after 5-10 transactions.
4. Business Pro value dashboard.
5. Telegram paid integration design.

## Multi-Agent Rule

Use one writer, one reviewer, one auditor:

- Claude writes small approved batches.
- Codex reviews and verifies before merge/promote.
- MiMo audits independently after fixes.

No parallel code edits from multiple agents.

## Do Not Touch

- Reset/R001.
- Migrations 037-039/040/041/043.
- Payments.
- Personal-to-Business bridge.
- Telegram linking/cutover.
- Railway env.
- Backend auth.
