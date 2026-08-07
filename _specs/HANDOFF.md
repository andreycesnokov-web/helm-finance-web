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
