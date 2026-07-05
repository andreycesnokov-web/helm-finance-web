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

