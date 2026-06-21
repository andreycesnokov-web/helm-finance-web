# CFO AI — Current State (source of truth)

_Last updated: release-prep for `feature/personal-funding-frontend-v1` → develop._

## Branches
- Active feature: `feature/personal-funding-frontend-v1` (premium UI + personal/funding).
- Backend (migrations 037–039 + funding API) already merged to `develop` (FF, no dupes).
- `main`: not touched.

## Premium UI status
- Shared premium shell (WorkspaceShell, WorkspaceSwitcher, ui primitives) — done.
- Personal: Overview / Accounts / Transactions / Onboarding — live, gated (see below).
- Business (premium, presentation-only; legacy routes untouched): Pulse, Accounts,
  Transactions, Payables, Receivables, Invoices (placeholder), AI Accountant Profile.
- Business nav: Pulse, AI CFO, AI Accountant, Transactions, Accounts, Invoices,
  Receivables, Payables, Funding & Investors, Bank Import, Payroll, Approvals, Team,
  Documents, Settings.
- Official CFO AI brand assets wired (login/onboarding/favicon/shell). Mobile stabilized
  (no horizontal overflow; tables → cards on mobile).

## Backend status
- `PATCH /api/business/current`: Business-only + workspace-aware (rejects personal /
  inaccessible ids; graceful country/timezone drop).
- AI Accountant: existing `tax_profiles` fields persist via `/api/accountant/profile`;
  expanded fields are local draft pending migration 040.

## Migrations / external
- **037–039 NOT applied to production.**
- **040 NOT applied to production** (proposal only: `migrations/040_*`).
- **Commercial FX provider NOT connected** (mock/manual only).

## Feature gates
- `VITE_PERSONAL_FUNDING_UI_ENABLED` (default **false**): when off, `/personal/*` routes
  redirect to `/` (Personal/Funding UI hidden) so production without 037–039 cannot hit
  missing tables. Business premium routes use existing prod endpoints and are safe.
- `VITE_PREMIUM_UI_PREVIEW` (default false): gates the synthetic `/demo/*` preview.

## Rollout blockers before `main`
1. Decide Option A (gated, no migrations) vs Option B (apply 037–039[/040] + deploy).
2. If Option A: ensure `VITE_PERSONAL_FUNDING_UI_ENABLED=false` and
   `VITE_PREMIUM_UI_PREVIEW=false` in production build.

## Next release steps
1. PR `feature/personal-funding-frontend-v1 → develop`; run regression; merge.
2. Develop smoke.
3. GO/NO-GO checklist → only then `develop → main` (Option A gated by default).
