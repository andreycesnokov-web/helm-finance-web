# CFO AI / Helm Finance Project Sync Report

Last updated: 2026-07-04.

## 1. Executive Summary

CFO AI / Helm Finance is an email-first Finance OS. The current target architecture is:

Email account -> Personal Account -> Personal Finance -> optional Business Workspace -> optional Telegram paid integration.

The product currently has a live Business Workspace and live email identity. Personal finance v1 exists behind flags. Telegram remains useful as a bot/channel and legacy login, but is no longer the main identity strategy.

This sync created a durable local AI memory system in `_specs/` and `AGENTS.md`. No production logic was changed.

## 2. Current Live State

LIVE:

- Primary app domain: `https://app.cfo-ai.site`.
- Email magic-link login with Resend.
- Email users use negative ids.
- `/account` Personal Account entry.
- Legacy `/login/telegram`.
- Business Workspace dashboard and modules.
- Business wallets/transactions/payables/receivables/team/documents/payroll/bank import.
- Avatar upload.
- Telegram bot service separate from web app.
- Telegram active-business state/routing is present.

DARK / BEHIND FLAG:

- Personal finance backend `/api/personal/*`.
- Personal Dashboard UI.
- Premium Business UI.
- AI Accountant premium UI.
- Telegram paid gate.

PLANNED / NOT IMPLEMENTED:

- Entitlements/pricing foundation.
- Personal-to-Business bridge.
- Telegram identity linking/cutover.
- Professional Partner Portal.
- Full e-Filing/payment rails.

## 3. Architecture Map

Frontend:

- React + Vite.
- Routes in `client/src/App.jsx`.
- Shared workspace shell in `client/src/shell`.
- Business pages in `client/src/pages` and `client/src/pages/business`.
- Personal entry in `PersonalProfile.jsx`, gated dashboard in `PersonalDashboard.jsx`.

Backend:

- Express API in `server/index.js`.
- Supabase client using service role key.
- Business access/resolution helpers in `server/lib`.
- Personal workspace helpers in `server/lib/personalWorkspace.js`.
- Email sending in `server/lib/emailSender.js`.

Database:

- Supabase Postgres.
- Migration files stored under `migrations/`.
- Railway deploy does not auto-apply migrations.

Deployment:

- Web service deploys from GitHub/Railway.
- Bot service deploys from separate GitHub/Railway service.

## 4. Personal vs Business Boundary

Personal:

- Personal workspace is a `businesses` row with `type='personal'`.
- Personal wallet/transaction rows use `business_id = personal_workspace_id` and `scope='personal'`.
- Personal routes reject incoming business workspace context.

Business:

- Business workspace is a normal business row.
- Business rows are scoped by active business id and `scope='business'` where applicable.
- Business resolver must not resolve personal workspaces.

Protected by tests:

- `tests/integration/personalAccount.test.js`.
- `tests/integration/businessResolver.test.js`.
- `tests/integration/businessIsolation.test.js`.
- `tests/integration/teamIsolation.test.js`.

Missing tests:

- End-to-end authenticated browser smoke for Personal <-> Business switching.
- Live smoke proving personal wallet edits cannot affect Business Pulse totals.

## 5. Recent Changes

Email-first login:

- Files: `Login.jsx`, `EmailLogin.jsx`, `EmailCallback.jsx`, `useAuth.jsx`, routes in `App.jsx`.
- Risk: legacy Telegram confusion.
- Status: live; Telegram moved to `/login/telegram`.

Resend magic link:

- Files: `server/lib/emailSender.js`, `server/index.js`.
- Risk: provider/env misconfiguration.
- Status: live.

Negative email ids:

- Migration: 042.
- Risk: schema differences around users table.
- Status: live and verified during go-live.

Telegram legacy flow:

- Files: `TelegramLogin.jsx`, `TelegramLoginWidget.jsx`, Telegram auth route.
- Risk: BotFather domain / legacy identity.
- Status: live.

Personal Account foundation:

- Migration: 044.
- Files: `server/lib/personalWorkspace.js`, personal routes.
- Risk: Personal/Business leakage.
- Status: dark behind backend flag.

Personal UI / wallets / transactions:

- Files: `PersonalDashboard.jsx`, `PersonalProfile.jsx`.
- Risk: mobile UX and feature flag drift.
- Status: dark behind frontend flag.

Currency dropdown / multi-currency display:

- Files: personal dashboard UI.
- Risk: combining currencies without FX.
- Status: UI direction accepted; verify current implementation before future edits.

Avatar upload:

- Files: `server/index.js`, `PersonalProfile.jsx`, package deps.
- Risk: storage bucket/config.
- Status: live.

Business isolation fixes:

- Files: business resolver/access/server routes/tests.
- Risk: stale workspace selection.
- Status: tests exist; live smoke still important.

Business-only wallets:

- Files: wallet endpoints and business resolver logic.
- Risk: personal rows leaking into business views.
- Status: protected by tests and conventions.

Payables/Receivables manual creation:

- Files: debt/payables/receivables routes/pages.
- Risk: status/approval lifecycle.
- Status: live.

Team API isolation:

- Tests: `teamIsolation.test.js`.
- Status: live.

Domain:

- `app.cfo-ai.site`.
- Status: live app shell.

Health checks:

- App shell 200 confirmed.
- JSON `/api/health` uncertain because route returned SPA HTML in this audit.

## 6. Feature Flags and Env Flags

Backend runtime:

- `EMAIL_AUTH_ENABLED`
- `EMAIL_AUTH_DEV_RETURN_CODE`
- `EMAIL_PROVIDER`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `APP_BASE_URL`
- `PERSONAL_ACCOUNT_V1_ENABLED`
- `PERSONAL_WORKSPACE_ENABLED`
- `TELEGRAM_ACTIVE_BUSINESS_ENABLED`
- `TELEGRAM_PAID_GATE_ENABLED`
- `AVATARS_BUCKET`
- `DOCUMENTS_BUCKET`
- `WEB_APP_URL`
- `BOT_TOKEN` / `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `ANTHROPIC_API_KEY`

Frontend build-time:

- `VITE_EMAIL_AUTH_ENABLED`
- `VITE_PERSONAL_ACCOUNT_V1_ENABLED`
- `VITE_BUSINESS_PREMIUM_UI`
- `VITE_AI_ACCOUNTANT_PREMIUM`
- `VITE_PERSONAL_FUNDING_UI_ENABLED`
- `VITE_PREMIUM_UI_PREVIEW`
- `VITE_BOT_USERNAME`

## 7. Database / Migrations

Important migrations:

- 042 email identity - applied in production per go-live report.
- 043 Telegram user state - applied in production per guided apply and verification.
- 044 Personal Account v1 foundation - applied in production per guided apply and verification.

Not to touch without explicit go:

- 037-039.
- 040.
- 041.
- R001 reset.

UNKNOWN:

- Full production migration table state was not queried during this sync.

## 8. API Surface

Identity/profile:

- `/api/auth/email/start`
- `/api/auth/email/verify`
- `/api/auth/email/accept-invite`
- `/api/auth/telegram`
- `/api/me/profile`
- `/api/me/avatar`

Personal:

- `/api/personal/summary`
- `/api/personal/wallets`
- `/api/personal/transactions`
- `/api/personal/categories`

Business:

- `/api/access/status`
- `/api/business/current`
- `/api/business/active`
- `/api/businesses`
- `/api/pulse`
- `/api/wallets`
- `/api/transactions`
- `/api/debts`
- `/api/team`
- `/api/invite/:code`

AI Accountant / premium:

- `/api/accountant/status`
- `/api/accountant/profile`
- `/api/accountant/applicability`
- `/api/accountant/calendar`
- `/api/accountant/summary`
- `/api/accountant/ask`
- `/api/audit/events`
- `/api/accountant/obligations` (local P3b branch during this sync)

Telegram:

- `/api/telegram/active-business`
- `/api/debts/from-telegram`
- `/api/telegram/debts/from-receipt`
- approval/reject/request-info bot endpoints.

Documents:

- `/api/documents/*`

## 9. Frontend Structure

Core:

- `client/src/App.jsx`
- `client/src/hooks/useAuth.jsx`
- `client/src/shell/*`

Login:

- `Login.jsx`
- `EmailLogin.jsx`
- `EmailCallback.jsx`
- `TelegramLogin.jsx`
- `TelegramLoginWidget.jsx`

Personal:

- `PersonalProfile.jsx`
- `PersonalDashboard.jsx`

Business:

- `business/index.jsx`
- `business/Accountant.jsx`
- `business/AccountantPremium.jsx`
- `Accounts.jsx`, `Transactions.jsx`, `Receivables.jsx`, `Payables.jsx`, `Team.jsx`, `Settings.jsx`, etc.

## 10. Risks and Regressions

High:

- Personal/Business data leakage.
- Auth regression between email and legacy Telegram.
- Workspace selection drift.
- Telegram submissions to wrong business.

Medium:

- Mobile UX regressions.
- Pricing/entitlement ambiguity.
- Tax/AI Accountant false numbers.

Low:

- Documentation drift.
- Old docs with broken encoding.

See `_specs/RISKS_AND_TESTS.md`.

## 11. Tests / Checks Run

Run during this sync:

- Git status/branch inspection.
- Route/flag/static code audit with ripgrep.
- Migration file inventory.
- Test file inventory.
- Production public app shell probe: HTTP 200.
- Authenticated API probe `/api/documents/health`: 401 unauthenticated, proving API path responds.

Not run:

- Full test suite.
- Frontend builds.
- Live authenticated browser smoke.
- Production DB queries.

## 12. AI Working Memory Files Created/Updated

Created:

- `AGENTS.md`
- `_specs/PROJECT_STATE.md`
- `_specs/ARCHITECTURE.md`
- `_specs/DECISIONS.md`
- `_specs/ROADMAP.md`
- `_specs/AI_WORKING_MEMORY.md`
- `_specs/HANDOFF.md`
- `_specs/RISKS_AND_TESTS.md`
- `_specs/PROJECT_SYNC_REPORT.md`

## 13. Recommended Next 5 Tasks

1. Personal -> Business Activation MVP.
2. Entitlements / pricing foundation.
3. Personal AI CFO insights after 5-10 transactions.
4. Business Pro value dashboard.
5. Telegram paid integration design, not implementation.

## 14. Do Not Touch List

- Telegram linking/cutover.
- Payments.
- Personal-to-Business bridge.
- Reset/R001.
- Migrations 037-039.
- Migration 040.
- Migration 041.
- Migration 043.
- Railway env.
- Backend auth.

## 15. Open Questions

- Is `/api/health` intended to return JSON? It returned SPA HTML through the custom domain during this sync.
- Which feature flags are currently enabled in Railway for production? Repo cannot prove exact runtime values.
- Has P3b deterministic tax obligations been promoted to production after this sync branch? Current local branch is ahead of `origin/main`.
- Which Personal v1 screens should be considered acceptable before enabling the personal frontend flag broadly?

