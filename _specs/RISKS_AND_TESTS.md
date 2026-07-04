# Risks and Tests - CFO AI / Helm Finance

Last updated: 2026-07-04.

## High Risks

### R1 - Personal/Business Data Leakage

Where:

- `server/index.js` personal routes.
- `server/lib/businessResolver.js`.
- wallet and transaction endpoints.

Risk:

- Personal wallets/transactions could appear in business views or vice versa.

Required tests:

- Personal wallet invisible in Business Pulse/Accounts.
- Business wallet invisible in Personal Wallets.
- Personal transaction invisible in Business Transactions.
- Business transaction invisible in Personal Transactions.
- Business resolver rejects personal workspace.

Existing protection:

- `tests/integration/personalAccount.test.js`.
- `tests/integration/businessResolver.test.js`.
- `tests/integration/businessIsolation.test.js`.

Missing:

- Authenticated browser smoke covering switching Personal <-> Business after real login.

### R2 - Auth Regression

Where:

- email auth routes.
- Telegram legacy login.
- JWT storage/useAuth.

Risk:

- Email-first changes could break legacy Telegram or authenticated business access.

Required tests:

- `/login`, `/login/email`, `/login/telegram` open.
- Email magic-link signs in.
- Telegram legacy login still works for existing users.
- Email user can open business workspace.

### R3 - Workspace Selection Drift

Where:

- `activeBusinessId`, `activeWorkspaceId`, `last_active_workspace_id`.
- `WorkspaceProvider`.
- `PulseWrapper`.

Risk:

- Email user can be bounced from Business back to Personal if stale `personal` selection remains.

Required tests:

- Open company workspace from `/account`.
- Switch Personal -> Company.
- Switch Company -> Personal.
- Switch old business -> new business.

### R4 - Telegram Wrong Business Routing

Where:

- `telegram_user_state`.
- `/api/telegram/active-business`.
- bot `/company`.
- bot submission confirmation.

Risk:

- Telegram expense/request goes to wrong company or null business id.

Required tests:

- User with multiple businesses sees all options.
- Active business is marked.
- Confirmed submission writes selected `business_id`.
- Employee can submit expense but cannot request management reports.

## Medium Risks

### R5 - Broken Mobile UX

Where:

- Personal Dashboard.
- Business Pulse/Accounts.
- Telegram UX.

Risk:

- Buttons/cards become unclickable or overflow on mobile.

Required tests:

- Mobile viewport screenshots for Personal Wallets, Transactions, AI CFO, Profile.
- Modal buttons fit and are clickable.

### R6 - Pricing/Entitlement Ambiguity

Where:

- future plan/trial gate.
- Telegram paid add-on.
- Business Pro / AI Accountant.

Risk:

- Free email identity could be confused with free product access.

Required fix/test:

- Add explicit entitlements layer before enforcing payment gates.
- Grandfather current users or provide trial policy.

### R7 - Tax/AI Accountant False Numbers

Where:

- `/api/accountant/obligations`.
- Accountant premium UI.

Risk:

- Showing estimated tax as factual.

Rule:

- Engine calculates, AI explains.
- If deterministic data is absent, show `insufficient_data` or `unavailable`.

## Low Risks

### R8 - Documentation Drift

Where:

- `_specs/`.
- Drive docs.
- chat summaries.

Risk:

- Agents follow stale docs.

Required process:

- Keep local `_specs/` canonical.
- Export to Drive only after explicit approval.

## Stabilization Hardening (2026-07-04, `feature/stabilization-pass`)

Reduced risks (backend runtime flags — no Railway change required to stay safe, defaults are safe):

- Dev code leak: `EMAIL_AUTH_DEV_RETURN_CODE` can no longer return login codes/magic links
  when `NODE_ENV==='production'` (hard-disabled regardless of the env var).
- Unapproved bridge exposure: Personal→Business bridge routes are gated by a NEW default-OFF
  backend flag `PERSONAL_FUNDING_BRIDGE_ENABLED`. Leave UNSET/absent in production to keep
  the bridge fully closed. Set to `true` only in tests / when the bridge is approved.
- Telegram paid gate correctness: gate now reads `.effective_plan` (was a no-op `undefined`
  comparison). Still default OFF via `TELEGRAM_PAID_GATE_ENABLED`.
- API hygiene: `/api/health` is JSON; unknown `/api/*` returns JSON 404, not the SPA shell.
- Email body: magic-link URL HTML-escaped; secret length removed from logs.

## Minimum Checks by Change Type

Personal UI:

- Build Personal OFF.
- Build Personal ON.
- Verify no `/api/personal` refs in OFF bundle when expected.

Business UI:

- Build normal.
- Open `/business/pulse`, `/business/accounts`, `/business/accountant`.

Backend:

- `node --check server/index.js`.
- Relevant integration tests.

Telegram:

- Bot syntax check in live bot repo.
- Confirm Railway bot deploy.
- Live Telegram smoke.

Docs-only:

- `git diff --stat`.
- Ensure no app source changed.

