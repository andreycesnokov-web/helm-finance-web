# Project State - CFO AI / Helm Finance

Last updated: 2026-07-04.

This is the factual project state for future Claude/Codex/MiMo work. If a fact is uncertain, it is marked `UNKNOWN`.

## Product Direction

CFO AI / Helm Finance is becoming a Finance OS:

Email account -> Personal Account -> Personal Finance -> optional Business Workspace -> optional Telegram paid integration.

- Email is the primary free identity entry.
- Personal Account is the human user's identity and personal finance layer.
- Business Workspace is the main monetization layer for companies.
- Telegram is legacy login plus future paid/add-on integration.
- Personal wallets and business wallets must remain separated.
- Business Pro, AI Accountant, compliance, and owner/CFO workflows are the main commercial direction.

## Production URL / Domain

LIVE:

- Primary app domain: `https://app.cfo-ai.site`.
- Custom domain is connected to the Railway web service.
- `auth.cfo-ai.site` is the Resend sending domain for magic-link email.
- Public app shell returned HTTP 200 on 2026-07-04.

RESOLVED (on branch, pending deploy):

- `/api/health` returned HTTP 200 but responded with the SPA HTML shell during the audit.
  Fixed on `feature/stabilization-pass`: `/api/health` now returns JSON, and unknown
  `/api/*` routes return a JSON 404 instead of the SPA shell. Verified locally (health →
  200 JSON, `/api/nonexistent-test-route` → 404 JSON, `/login|/account` → 200 SPA HTML,
  `/api/documents/health` → 401 JSON). Production still serves the old behavior until this
  branch is promoted/deployed.

## Stabilization Pass (2026-07-04, on branch `feature/stabilization-pass`, pending review/deploy)

Safe technical fixes only — no product-behavior change, no migrations, no env changes:

- `/api/health` JSON + JSON 404 for unknown `/api/*` (above).
- Telegram paid gate compared a non-existent `.effectivePlan` (always `undefined`) so it
  never blocked free-plan businesses; corrected to `.effective_plan`. Gate is default OFF
  (`TELEGRAM_PAID_GATE_ENABLED`) so no current production behavior changes.
- `EMAIL_AUTH_DEV_RETURN_CODE` is now hard-disabled whenever `NODE_ENV==='production'`, so
  production can never echo login codes/magic links.
- Magic-link URL is HTML-escaped in the email body (defense-in-depth).
- Removed secret length (`len N`) from the email-auth log line.
- Personal→Business bridge routes (`/api/personal-business-connections*`, `/api/funding*`)
  are now behind a default-OFF kill-switch `PERSONAL_FUNDING_BRIDGE_ENABLED`. Prod behavior
  unchanged (no bridge entitlements exist there → routes already 403); the gate is now
  unconditional so no future addon row can silently open the unapproved bridge.

## Current App Entry Points

LIVE:

- `/login` - email-first login when `VITE_EMAIL_AUTH_ENABLED=true`.
- `/login/email` - magic-link email login.
- `/login/email/callback` - magic-link callback.
- `/login/telegram` - legacy Telegram login page.
- `/account` - Personal Account entry point.
- `/business/pulse` - Business Workspace dashboard.
- `/business/accountant` - AI Accountant / Tax Profile area, premium UI behind flag.
- `/invite/:code` - business invite acceptance page.

DARK / BEHIND FLAG:

- Personal finance dashboard and `/api/personal/*` behind personal v1 flags.
- Premium Business UI enhancements behind premium frontend flags.

## Account & Identity Management MVP (2026-07-05, branch `feature/account-identity-mvp`)

Status: implemented on branch, pending review/deploy. Frontend + additive read/action
endpoints only. No migrations, no env changes, no auth-architecture change.

LIVE (on branch):

- `/account` "Login & Security" section (read-only): shows primary email + verified state,
  Telegram linked status, display name, and copy: "Email and Telegram are login methods for
  the same account when linked." No raw email editing; no internal id shown.
- Admin Users console extended: search by name/username/email/user id; user detail shows
  internal id, email identities, Telegram identity, business memberships, account status.
- Admin action **Link email to existing user** (`POST /api/admin/users/:id/link-email`):
  validates email; links to the existing user (admin-verified) when the email is free;
  returns `already_linked` when it's the same user; returns a non-destructive `conflict`
  (with the other user's id + summary) when the email belongs to a different user. Audited.
- Result: an email can be linked to a Telegram-origin account (e.g. PT Helm Care's owner);
  subsequent email login resolves to that same account with the same business access.

NOT IMPLEMENTED (documented; needs owner go):

- Account disable/suspend — no `users.status`/`disabled_at` column exists. Requires an
  additive migration plus an auth-middleware check that rejects disabled users. Not faked.
- Hard delete / anonymize / account merge — future design only (see RISKS_AND_TESTS).

## Admin Test Data Cleanup / Archive MVP (2026-07-06, branch `feature/admin-archive-mvp`)

Status: implemented on branch, pending review/deploy. Additive endpoints + admin UI only;
no migrations (reuses existing `businesses.status`), no env, no data mutated during build.

- Soft archive of businesses/workspaces via `businesses.status='archived'` — reversible,
  deletes nothing. Archived workspaces leave the switcher (`listAccessibleWorkspaces` filter)
  but remain visible in admin. New: `GET …/cleanup-preflight`, `POST …/archive`,
  `POST …/unarchive`; admin business list now returns `status`.
- Archive requires `confirm:true` + exact `confirm_name` (guards Helm Care Indonesia /
  Helm Care Pay from accidental archive). Audited to `audit_events`.
- Admin Business Detail UI: Cleanup card with preflight counts + Archive/Unarchive (typed-name
  confirmation). No destructive delete shown.

NOT IMPLEMENTED (documented; needs owner go):

- Hard delete of businesses/users (blocked by default — see DECISIONS D9).
- Duplicate-user (`-1`) disable — needs a `users.status`/`disabled_at` additive migration.

Intended production cleanup (owner-run, NOT executed by this task): archive test business
`My Business` (owner `-1`) and the duplicate personal workspace (owner `-1`); keep user
`1057134807`/@Andrei_Cn, Helm Care Indonesia, Helm Care Pay, and Andrei's personal workspace.

## Email Auth Hardening Hotfix (2026-08-11, branch `hotfix/email-auth-persistence`)

Status: implemented on branch, pending review/deploy. Auth-path only; no migrations, no env.

Context: during the Supabase connectivity outage, magic-link emails were still sent even
though the token insert into `email_login_codes` had failed silently, so every link failed
later as "invalid or expired" while logs falsely showed "secret issued".

Fix: the email is only sent after the token is persisted.

- `issueEmailSecret()` checks the insert error and throws typed `secret_not_persisted`.
- `POST /api/auth/email/start` returns **503 `auth_temporarily_unavailable`** with a
  user-safe message and sends NO email; the generic catch no longer leaks internal errors.
- `/login/email` displays the message and stays on step 1 (never claims a link was sent).
- Invite creation degrades gracefully (`email_invite_failed: true`) instead of 500.

Unchanged when the DB is healthy: link requested → token stored → email sent → newest link
signs in; old/used/expired links still fail normally. Telegram auth untouched.

## Platform Admin Dashboard Foundation (2026-08-11, branch `feature/admin-dashboard`)

Status: implemented on branch, pending review/deploy. Additive read-only endpoint + admin
page. No migrations, no env, no auth/Telegram/payments/bridge/archive changes.

- `GET /api/admin/dashboard` (admin-only) + `/admin/dashboard` page, linked from the admin
  tab bar. Built inside the existing app — no separate backend app.
- Metrics: users (total, email/Telegram origin, linked, without email/Telegram, new 7/30d),
  businesses (total, active, archived, personal vs company, without owner, new 7/30d),
  identity risks (Telegram-only owners, email-first owners, users without login identity),
  activity last 7 days (audit events, transactions, documents, new users/businesses),
  system health (db_reachable, timestamp, commit, feature-flag booleans).
- Unavailable metrics return `null` + a `warnings` entry — never a guessed number.
  Known null: `businesses.inactive_no_recent_activity` (needs per-business aggregation) and
  `identity_risks.duplicate_email_conflicts` (detected at link time, not measured).
- Collection is bounded by a 6s deadline: on expiry the response still returns 200 with
  `system.degraded:true`, `db_reachable:false` and nulls (measured 6.0s during a DB outage,
  0.06s healthy). Risk metrics return null if their bounded selects hit the 5000-row cap.
  Warnings are sanitized — no raw DB/network internals reach the client.
- Billing is a placeholder only (`billing_enabled:false`, `paid_businesses:null`,
  `mrr:null`) — billing/entitlements remain NOT implemented.

## Build & Deployment Hygiene (2026-08-13, branch `hotfix/railway-build-rollup`)

Status: implemented on branch, pending review/deploy. Build-infra only — no product code.

- Railway build failed with `Cannot find module @rollup/rollup-linux-x64-gnu` because
  `client/node_modules` was committed to git carrying only Windows Rollup binaries, and
  nothing installed client deps on the Linux builder.
- `client/node_modules` and `client/dist` are now UNTRACKED (both were already in
  `.gitignore`; tracked files had been overriding it). Dependencies and build output are
  never shipped through git.
- Root `build` = `cd client && npm ci && npm run build` → deterministic, platform-correct
  install from `client/package-lock.json` on every build.
- Node pinned to **22 LTS** via `.nvmrc`; `engines.node >=20.11.0` documents the floor.
  Railway had been building on Node 24.18.1 (Current, not LTS).
- No lockfile changed, no dependency added, no env/Railway dashboard change.

## Login and Identity

LIVE:

- Email magic-link login is live.
- Email identity creates negative user ids through `app_user_id_seq`.
- Email profiles live in `user_profiles`.
- Email identities live in `user_email_identities`.
- Magic links are sent by Resend when provider env vars are configured.
- Telegram login remains as a legacy route for existing users.

DARK / PLANNED:

- Telegram as paid/add-on channel for new use is planned.
- Telegram linking/cutover between email identity and Telegram identity is not implemented.

## Personal Account

LIVE:

- `/account` exists and is the post-email identity landing area.
- Profile settings are available through `/api/me/profile`.
- Avatar upload is live through `/api/me/avatar`, using a public `avatars` storage bucket and owner-namespaced paths.

DARK / BEHIND FLAG:

- Personal Account v1 finance backend exists behind `PERSONAL_ACCOUNT_V1_ENABLED`.
- Personal UI/dashboard exists behind `VITE_PERSONAL_ACCOUNT_V1_ENABLED`.
- Personal wallets and transactions use `businesses.type='personal'` workspace rows with `scope='personal'`.

PLANNED / NOT IMPLEMENTED:

- Full Personal Pro entitlement model.
- Personal AI CFO based on enough real transaction history.
- Personal-to-Business bridge for owner loan, capital contribution, reimbursement, dividend.

## Business Workspace

LIVE:

- Business Workspace is active and production-facing.
- Business users can create/open business workspaces.
- Business wallets, transactions, receivables, payables, payroll, documents, bank import, team/invites, settings, AI CFO, and AI Accountant areas exist.
- Business isolation uses active business resolution and `business_id` scoping.
- Team API isolation has dedicated tests.

DARK / BEHIND FLAG:

- Business premium UI enhancements behind `VITE_BUSINESS_PREMIUM_UI`.
- Premium AI Accountant UI behind `VITE_AI_ACCOUNTANT_PREMIUM`.

PLANNED / NOT IMPLEMENTED:

- Full pricing/entitlement enforcement.
- Professional Partner Portal.
- Owner mobile approvals cockpit.
- Deterministic e-Filing/payment integration.

## Telegram

LIVE:

- Telegram bot exists as a separate Railway service and separate repo.
- Web API has Telegram bot-facing endpoints.
- Telegram active-business routing uses `telegram_user_state` after migration 043.
- `/company` selection and active business routing were recently improved.
- Bot now supports draft confirmation/edit/cancel flow for submissions.

DARK / BEHIND FLAG:

- `TELEGRAM_ACTIVE_BUSINESS_ENABLED` controls active-business API routing.
- `TELEGRAM_PAID_GATE_ENABLED` exists for future paid gate.

PLANNED / NOT IMPLEMENTED:

- Full Telegram paid integration.
- Email<->Telegram identity linking/cutover.
- Professional Russian localization cleanup in the bot repo.

## Wallet Logic

LIVE:

- Business wallets are business-scoped by `business_id` and generally `scope='business'`.
- Business wallet edit and balance adjustment exist.
- Personal wallet edit parity was implemented for the dark personal v1 flow.

DARK / BEHIND FLAG:

- Personal wallets exist through `/api/personal/wallets` behind `PERSONAL_ACCOUNT_V1_ENABLED`.
- Personal balances are shown by currency and must not combine USD and IDR without conversion.

## Transaction Logic

LIVE:

- Business transactions are business-scoped.
- Payables/receivables manual creation exists.
- Telegram can submit expense/payable-like drafts into the selected active business.

DARK / BEHIND FLAG:

- Personal transactions exist through `/api/personal/transactions`.
- Personal balance correction is scoped to personal wallet/transaction logic and must not affect business totals.

## Avatar Upload

LIVE:

- `POST /api/me/avatar` accepts image upload after email auth + JWT auth.
- It stores user avatar under `avatars/{userId}/...`.
- It writes public URL to `user_profiles.avatar_url`.
- UI no longer requires manual avatar URL input.

## Known Production / Repo State

LIVE:

- Current branch during this audit: `feature/business-premium-p3b`.
- Current local HEAD: `7bb6a3ce feat(business): P3b - deterministic tax obligations (no estimates)`.
- That P3b commit is ahead of `origin/main` during this audit; treat as not necessarily production unless separately promoted.

UNKNOWN:

- Exact current Railway env var values are not readable from the repo.
- Exact list of migrations applied in production is based on prior guided application reports and current code docs, not direct DB inspection during this task.

