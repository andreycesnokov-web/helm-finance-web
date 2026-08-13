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

## Account & Identity MVP (2026-07-05)

Audit: identity-link actions ARE audited — `recordAudit()` → `audit_events` writes
`email_linked` / `email_already_linked` / `email_link_conflict` with actor (admin) id,
target user id, and the email. No secrets/tokens logged. (No audit-table gap here.)

Rules enforced:

- `POST /api/admin/users/:id/link-email` is admin-only (`requireAdmin`), never public.
- Email format validated; email that belongs to another user → CONFLICT, never auto-merge.
- Admin link sets `email_verified_at` (admin-verified). Normal-user UI shows no internal id.

Required tests (this batch):

- Email login still works; legacy Telegram login still works (routes present, not 404).
- Admin search by email/name/id works; link to existing Telegram user works; duplicate-email
  conflict handled safely; business access unchanged after linking.

Gaps / NOT IMPLEMENTED (needs follow-up):

- **Account disable/suspend**: no `users.status`/`disabled_at` column. Required follow-up =
  additive migration + `auth` middleware check that 401s disabled users + admin toggle
  endpoint (audited). Do NOT fake disable without the column.
- **Hard delete / anonymize / merge**: future design only. Deleting a sole business owner
  must be blocked unless ownership is transferred or the business archived. Business audit
  trail and financial records must be retained even when a login is disabled.
- **Link endpoint DB branches** (linked/already/conflict) were verified by code review +
  local guard/validation smoke (401/403/400); not run against a live Supabase in CI
  (no creds). Run against local/staging DB before relying on them in production.

## Admin Cleanup / Archive MVP (2026-07-06)

Production cleanup rules:

- Archive (soft, reversible) is the DEFAULT. Hard delete is blocked (DECISIONS D9).
- Archive requires admin auth + `confirm:true` + exact `confirm_name`. Real workspaces
  (Helm Care Indonesia / Helm Care Pay) cannot be archived without typing their exact name.
- Archiving mutates ONLY `businesses.status`; never touches wallets/transactions/documents/
  audit. Archived workspaces are hidden from the switcher, still visible in admin.
- Every archive/unarchive is written to `audit_events` (actor admin id, business id, action).

Duplicate user cleanup:

- Marking the duplicate email user `-1` as disabled is NOT supported — no `users.status`
  column. Required follow-up = additive migration (`users.status`/`disabled_at`) + auth
  check. Do NOT delete the user row, audit history, or historical references.

Tested (this batch):

- Admin-only gating on preflight/archive/unarchive (401 unauth, 403 non-admin), bad UUID
  → 400 (live smoke). Build OFF/ON, funding E2E (uses `listAccessibleWorkspaces`) pass.

Gaps / NOT RUN:

- Archive DB write + switcher-hide + confirm/name-mismatch branches verified by code review;
  not run against a live Supabase (no creds) — run on staging before production cleanup.
- No production data archived by this task (implementation only).

Remaining risk — archived workspaces still reachable by direct access:

- Archive hides a workspace from the SWITCHER / `/api/workspaces` only
  (`listAccessibleWorkspaces`). Other resolution paths (direct `/business/*` routes, stale
  `activeWorkspaceId` / `last_active_workspace_id` in localStorage, `/api/access/status`
  auto-resolve) do NOT check `businesses.status`, so an archived workspace may still be
  reachable until a future "resolver status-check" task adds that guard. Deliberately out of
  scope here. Not a data-loss risk (archive deletes nothing), and it does not affect the
  intended cleanup targets (owned by duplicate user `-1`).

Archive UI safety gate (2026-07-06):

- The Archive action is DISABLED unless `GET …/cleanup-preflight` loaded successfully.
  Loading / failed / incomplete-payload states all disable it, show a visible error, and
  display: "Cleanup preflight must load successfully before archive is allowed." The
  `archive()` handler also returns early when preflight is not `ok` (defense in depth).

## Email Auth Hardening (2026-08-11, after the Supabase outage)

Rule: **an email magic link may only be sent AFTER the token is persisted.**

- `issueEmailSecret()` now checks the `email_login_codes` insert error and throws a typed
  `secret_not_persisted` error instead of silently continuing.
- `POST /api/auth/email/start` aborts before sending any email and returns **503**
  `auth_temporarily_unavailable` with "Login is temporarily unavailable. Please try again in
  a few minutes." The generic catch no longer echoes internal error text to the client.
- `/login/email` shows that message and stays on step 1 — it never claims a link was sent.
- Invite creation tolerates the failure: the invite row still returns, with
  `email_invite_failed: true`, instead of 500-ing the whole request.

Outage failure mode (what went wrong):

- While Supabase was unreachable the insert failed silently, the server still logged
  "secret issued", the email was still sent, and every callback reported
  "invalid or expired" because the token row never existed.
- **Links issued during the outage are permanently invalid — expected, not a bug.** Always
  request a fresh link after an outage.

Logging safety:

- Never log the token, the magic link, or any secret. On failure we log only:
  purpose, normalized email, and the technical DB error message (e.g. "TypeError: fetch
  failed"). Verified: 0 token/link occurrences in logs on both success and failure paths.

Tested (this batch):

- Simulated insert failure (unreachable Supabase host): 503 + safe message, **0** "secret
  issued" logs, **0** email-send attempts, **0** secret leakage.
- Success path (local fake PostgREST): 200 `{ok:true}`, 2 rows inserted, "secret issued"
  logged, no secret leakage. Invalid email still 400.
- Invalid token → 400; bad 6-digit code → 401 `invalid_or_expired_code` (unchanged).

## Platform Admin Dashboard (2026-08-11)

Rules:

- Admin-only (`auth` + `requireAdmin`); never public. Counts only — no financial amounts,
  no secrets/tokens/keys, no raw magic links.
- Read-only by construction: `head:true` count queries + two bounded selects. Verified with
  a method-capturing fake DB: **17 HEAD + 2 GET, 0 write verbs**.
- Never invent a number: a missing table/column or DB error ⇒ `null` + `warnings` entry.
- Bounded queries only. Identity-risk selects are capped at 5000 rows and warn when
  truncated. All counts run in parallel (a DB outage must not hang the request for minutes).

Tested (this batch):

- unauth → **401**; non-admin → **403**; admin → **200** with the expected top-level shape.
- Healthy DB: 200 in ~0.05s. DB unreachable: still **200** with all-null metrics,
  `db_reachable:false` and 19 warnings, in ~21s (was ~105s before parallelizing).
- No secrets in the response (grep for key/token/secret patterns → 0).
- Builds Personal OFF/ON exit 0; 26 integration tests pass.

Review-blocker fixes (2026-08-11):

- **Timeout:** metric collection races a shared 6s deadline (AbortController aborts in-flight
  queries). On expiry the endpoint returns 200 immediately with `system.degraded:true`,
  `system.db_reachable:false`, unresolved metrics null, and the warning
  "Dashboard metrics timed out. Some metrics are unavailable." Measured: **6.0s** during a
  full DB outage (was ~21s), **0.06s** when healthy.
- **No fake zeros:** `duplicate_email_conflicts` is now **null** (was a hardcoded 0) plus the
  warning "unavailable; conflicts are currently detected at link time".
- **Cap semantics:** if either bounded identity/owner select reaches the 5000-row cap, the
  dependent risk metrics return **null** with "identity_risks: unavailable because source
  rows reached the safety cap" — partial counts are never presented as exact.
- **`email_only_owners` correctness:** counts owners that are negative-id **AND** present in
  the email-identity set; a negative id alone no longer implies an email login.
- **Sanitized warnings:** responses contain metric names and safe phrasing only — no raw
  Supabase/network/schema text. Technical detail goes to the server log instead.

Known gaps / not computed:

- `businesses.inactive_no_recent_activity` — requires per-business aggregation; returns null.
- `duplicate_email_conflicts` — not computed; detected at link time via `/link-email`.
- Metrics are null (never 0) whenever they cannot be measured; the UI renders them as "n/a".

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

