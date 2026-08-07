# Architecture Map - CFO AI / Helm Finance

Last updated: 2026-07-04.

## LIVE

- React/Vite frontend served by Express/Railway.
- Express API in `server/index.js`.
- Supabase Postgres as primary database.
- Supabase Storage for documents and avatars.
- Email identity via magic links.
- Business Workspace as the main operational workspace.
- Telegram bot as a separate Railway service/repo, calling web API endpoints.
- `app.cfo-ai.site` custom domain.

## DARK / BEHIND FLAG

- Personal Account v1 finance backend (`/api/personal/*`).
- Personal finance dashboard UI.
- Premium Business UI.
- Premium AI Accountant UI.
- Telegram paid gate.

## PLANNED / NOT IMPLEMENTED

- Billing/entitlements foundation.
- Personal-to-Business bridge.
- Telegram linking/cutover.
- Professional Partner Portal.
- Full e-Filing/payment rails.

## Frontend Structure

Main areas:

- `client/src/App.jsx` - route registration and high-level guards.
- `client/src/pages/Login.jsx` - email-first login.
- `client/src/pages/EmailLogin.jsx` / `EmailCallback.jsx` - magic-link flow.
- `client/src/pages/TelegramLogin.jsx` - legacy Telegram login.
- `client/src/pages/PersonalProfile.jsx` - `/account` entry.
- `client/src/pages/PersonalDashboard.jsx` - gated personal finance dashboard.
- `client/src/pages/business/index.jsx` - Business Pulse/dashboard.
- `client/src/pages/business/AccountantPremium.jsx` - gated premium AI Accountant UI.
- `client/src/shell/*` - shared workspace shell, switcher, mobile shell, UI primitives.

## Backend/API Structure

Main API file:

- `server/index.js` - auth, email, personal, business, Telegram, accountant, documents, wallets, transactions, payroll, admin.

Important libs:

- `server/lib/businessResolver.js` - active business resolution.
- `server/lib/businessAccess.js` - business access checks.
- `server/lib/workspaceAccess.js` - personal/business workspace access helpers.
- `server/lib/personalWorkspace.js` - personal workspace provisioning/categories/helpers.
- `server/lib/emailSender.js` - Resend magic-link email sending.
- `server/lib/documentAccess.js` / `documentValidation.js` - document access/security.
- `server/lib/taxGate.js`, `taxDocMath.js`, `transactionClass.js` - tax/document/classification helpers.

## Auth Identity Model

LIVE:

- Legacy Telegram users use positive ids.
- Email users use negative ids from `app_user_id_seq`.
- JWT contains user identity and auth channel.
- `hf_token` stores client token.

Database:

- `users`
- `user_email_identities`
- `user_profiles`
- `email_login_codes`
- `app_user_id_seq`

## Identity & Account Model (Account & Identity MVP, 2026-07-05)

One `users` row = one account (one person). Login methods attach to it:

- Telegram identity: the `users` row itself, positive `id`, created by `POST /api/auth/telegram`.
- Email identity: a `user_email_identities` row (`user_id`, `email`, `email_verified_at`).
  Email-first accounts get a NEGATIVE `users.id` from `next_app_user_id`.
- Sign in is unified by `resolveOrCreateEmailUser`: an email that already has an identity
  resolves to that existing `user_id` (Telegram or email origin) — same profile, personal
  workspace, and business memberships.

Derivation used by the admin/account surfaces:

- `is_telegram_connected` / `telegram_linked` = `users.id > 0` (positive = Telegram-origin).
- A Telegram account with a linked email keeps its positive id and gains an email identity.

Account surfaces:

- `GET /api/me/login-methods` (self, no internal id) — email, email_verified, telegram_linked,
  display_name, avatar_url. Backs the `/account` "Login & Security" section.
- `GET /api/admin/users` — list incl. `emails[]` per user (search by name/username/email/id).
- `GET /api/admin/users/:id` — detail incl. `email_identities`, `businesses` (memberships),
  `is_telegram_connected`, `account_status` ('active' placeholder — no disable column yet).
- `POST /api/admin/users/:id/link-email` (admin-only) — safe email→user linking; returns
  `linked` | `already_linked` | `conflict` (never merges). Writes `audit_events`.

NOT IMPLEMENTED (documented, needs owner go): account disable/suspend (no `users.status`
column — would be an additive migration + an auth-middleware check), and hard delete /
anonymize / account merge.

## Admin Cleanup / Archive Model (2026-07-06)

Businesses and personal workspaces are `businesses` rows with a `status` column
(`'active'` default). Cleanup uses SOFT archive — no row/data deletion:

- `businesses.status = 'archived'` hides a workspace from `listAccessibleWorkspaces`
  (server/lib/workspaceAccess.js), so it leaves the switcher and `/api/workspaces` while
  all wallets/transactions/documents/audit stay intact. Admin queries `businesses` directly
  and still see archived rows (`GET /api/admin/businesses` now returns `status`).
- `GET /api/admin/businesses/:id/cleanup-preflight` — all-time counts (members, wallets,
  transactions, invoices, payables, receivables, documents, audit_events) + `is_empty`.
- `POST /api/admin/businesses/:id/archive` — admin-only; requires `confirm:true` AND
  `confirm_name` === exact business name (accident guard for real workspaces); audited.
- `POST /api/admin/businesses/:id/unarchive` — reverse to `status='active'`; audited.
- Hard delete: NOT implemented (blocked by default — see DECISIONS D9).
- Duplicate-user disable: NOT implemented — needs a `users.status` migration (see identity
  MVP notes); archive covers duplicate *workspaces*, not the duplicate user row.

## User Profile Model

LIVE:

- `user_profiles` stores display name, locale, timezone, avatar URL.
- `/api/me/profile` reads/writes profile.
- `/api/me/avatar` uploads avatar image and updates profile.

## Personal Workspace Model

DARK / BEHIND FLAG:

- Personal workspace is a `businesses` row with `type='personal'`.
- Owner is `owner_user_id`.
- Membership is owner-only.
- One personal workspace per owner is enforced by migration 044.
- Personal finance rows reuse `wallets`, `transactions`, and `cashflow_categories` with:
  - `business_id = personal_workspace_id`
  - `scope='personal'`

## Business Workspace Model

LIVE:

- Business workspace is a `businesses` row with business type.
- Membership in `business_members` controls access.
- Active business selected by `x-business-id`, query/body business id, or stored client workspace selection depending on route.
- Business financial rows must be scoped by business id.

## Wallet Model

LIVE:

- Business wallets: `wallets.business_id = active business id`, `scope='business'`.

DARK:

- Personal wallets: `wallets.business_id = personal workspace id`, `scope='personal'`.

Rule:

- Never combine different currencies without conversion.

## Transaction Model

LIVE:

- Business transactions are in `transactions` and scoped to active business.
- Debts/payables/receivables are in `debts` and related routes.
- Payroll, bank imports, documents, and AI Accountant modules are business-scoped.

DARK:

- Personal transactions are in `transactions` with `scope='personal'` and personal workspace id.

## Document Model

LIVE:

- Document storage uses `financial-documents` bucket by default.
- Documents are business-scoped.
- Document access and linking are protected by migrations/tests around document audit and business id.

## Telegram State/Routing Model

LIVE / FLAGGED:

- `telegram_user_state` stores `user_id`, `active_business_id`, `updated_at`.
- `GET/POST /api/telegram/active-business` are bot-facing endpoints.
- Active business selection is used so Telegram submissions write to a selected business, not null.
- Personal workspaces are rejected for active Telegram business selection.

## Feature Flag Model

Backend runtime flags:

- `EMAIL_AUTH_ENABLED`
- `EMAIL_AUTH_DEV_RETURN_CODE`
- `PERSONAL_ACCOUNT_V1_ENABLED`
- `PERSONAL_WORKSPACE_ENABLED`
- `TELEGRAM_ACTIVE_BUSINESS_ENABLED`
- `TELEGRAM_PAID_GATE_ENABLED`
- `PERSONAL_FUNDING_BRIDGE_ENABLED` (default OFF — Personal→Business bridge kill-switch; keep unset in prod until the bridge is approved)

Frontend build-time flags:

- `VITE_EMAIL_AUTH_ENABLED`
- `VITE_PERSONAL_ACCOUNT_V1_ENABLED`
- `VITE_BUSINESS_PREMIUM_UI`
- `VITE_AI_ACCOUNTANT_PREMIUM`
- `VITE_PERSONAL_FUNDING_UI_ENABLED`
- `VITE_PREMIUM_UI_PREVIEW`
- `VITE_BOT_USERNAME`

Important:

- Vite flags are build-time. Changing them requires frontend rebuild/redeploy.

## Deployment Model

LIVE:

- Web service deploys from GitHub/Railway.
- Bot service is separate and deploys from `andreycesnokov-web/helm-finance-bot`.
- Railway does not automatically apply SQL migrations.
- Production migrations are applied manually through runbooks/Supabase.

