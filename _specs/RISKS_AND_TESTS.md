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
- **No background queries after a degraded response:** EVERY Supabase call — including the
  two bounded `identity_risks` selects — goes through a `signed()` helper that attaches the
  shared abort signal, `raceDeadline()` refuses to start new work once `timedOut` is true,
  and the deadline timer is cleared on both the success and error paths.
  Proven with a hanging-DB harness: 14 requests before the deadline, **0 after**, 14 aborted;
  and with counts-OK/selects-hanging: both bounded GETs issued then **ABORTED**, 0 later.
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

## Build Determinism (2026-08-13)

Root cause of the Railway build failure (`Cannot find module @rollup/rollup-linux-x64-gnu`):

- `client/node_modules` was COMMITTED to git (2310 files) — `.gitignore` listed it, but
  tracked files ignore `.gitignore`. The committed tree carried only the **Windows** Rollup
  binaries (`rollup-win32-x64-gnu`, `rollup-win32-x64-msvc`) plus `vite` 5.4.21.
- Nothing installed `client/` dependencies on Railway (no workspaces, no `postinstall`), so
  the Linux builder used the checked-in Windows tree: vite resolved, the Linux native binary
  did not exist. Builds only passed while a Nixpacks cache held a real Linux install.
- The lockfile was NOT at fault — it already lists all 26 platform binaries.

Rules now in force:

- **Never commit `client/node_modules` or `client/dist`.** Both are untracked; the build
  regenerates `dist` on every deploy and every dist asset has a tracked source in
  `client/public/` (31 files) or `client/index.html`.
- The root `build` script runs `cd client && npm ci && npm run build`, so the builder always
  installs client deps from `client/package-lock.json` and gets **its own platform's**
  binaries.
- Build/runtime Node is pinned to **22 LTS** via `.nvmrc` (Nixpacks prefers `.nvmrc` over
  `engines`), with `engines.node ">=20.11.0"` as the documented floor. Railway had drifted to
  Node 24.18.1 (Current, not LTS).
- Do NOT add `@rollup/rollup-linux-x64-gnu` as a normal dependency — it hard-codes one
  platform and hides the real problem.

Verified: fresh-clone simulation (no `client/node_modules`, no `client/dist`) → root
`npm run build` installs and builds successfully, producing `index.html`, `sw.js` and 16
assets. Root and client `npm ci --dry-run` both in sync; no lockfile modified.

## Admin Cleanup & Reset Console (Phase 1, 2026-08-15)

Rules:

- Archive-first. **No hard delete anywhere**; no reset of child data in Phase 1.
- Every cleanup mutation needs a **reason** (3–500 chars); archive also needs `confirm:true`
  plus the exact workspace name typed. Both are admin-only.
- Every cleanup mutation writes an audit event containing action, actor admin id, target
  type/id/name, reason and before/after. **If the audit write fails the action is rolled back**
  (`audit_failed`) — no state change without a trace.
- Preflights are strictly read-only and never invent numbers (null + sanitized warning).
- Personal and Business workspaces stay separate; archived workspaces remain hidden from the
  user switcher (`listAccessibleWorkspaces`) and visible in admin.

Tested (this batch):

- User preflight: unauth **401**, non-admin **403**, bad id **400**, admin **200** with the
  documented shape; **read-only proven** (5 GET + 4 HEAD, **0 write verbs**).
- Archive rejects: missing reason, <3-char reason, wrong `confirm_name`, missing `confirm`,
  non-admin (403). Restore rejects missing reason.
- Audit healthy → archive 200 with 1 audit insert and 1 status PATCH.
- Audit broken → **500 `audit_failed` and 2 PATCHes** (archive then rollback to active).
- Builds Personal OFF/ON exit 0; 26 integration tests pass; no secrets; `client/node_modules`
  and `client/dist` untracked and clean.

Fail-closed rules (safety fixes, 2026-08-15):

- **Never infer safety from missing data.** Any query error, any truncated/capped list, any
  unknown critical count ⇒ metric `null` + sanitized warning + `safe_to_archive_or_reset:false`
  (user) / `preflight_complete:false`, `is_empty:null` (business).
- `adminUserSummary()` reports query failures (`_errors`/`_partial`) so a failed lookup can
  never read as "no email" or "no memberships". `has_email_identity` becomes `null` and
  `identity_type` becomes `unknown`.
- Business preflight checks `{ error }` on EVERY count/select — a DB error never becomes `0`
  or `[]`. Its unexpected-failure path returns `business_cleanup_preflight_unavailable`
  (no relation/column/schema/network detail).
- **debts ≠ invoices.** Debt rows are reported as `debts_count` (+payables/receivables);
  `invoices` is `null` with a warning because there is no invoices table.
- Risk flag `email_only_duplicate` was renamed **`email_origin_owner`** — nothing in the
  preflight proves a duplicate exists.
- Audit failure ⇒ rollback, and the **rollback result is checked**:
  `audit_failed_rolled_back` (undo confirmed) vs `audit_failed_rollback_failed` +
  `state:'uncertain'` + "Manual review required." Never claims an unverified rollback.
  Future improvement: make the status change + audit a single atomic DB/RPC operation.
- Frontend fails closed: `preflight_complete:false` ⇒ Archive disabled with
  "Cleanup preflight incomplete. Archive disabled until metrics are available."; null counts
  render as `n/a`, never `0`.

Final fail-closed rules (2026-08-15, second review pass):

- **Rollback counts as successful only when CONFIRMED.** The compensating update runs as
  `.update({status}).eq('id',…).select('id,status').single()` and is accepted only if a row
  comes back AND its status equals the expected previous status. "No error" is not enough —
  an update can succeed while affecting zero rows. No row, wrong status, or an error ⇒
  `audit_failed_rollback_failed` + `state:'uncertain'` + "Manual review required."
  "No change was kept" is never claimed unless the undo was confirmed.
- **Frontend archive requires `preflight_complete === true` explicitly.** `false`, `null`,
  `undefined`, a missing field, a wrong type, or a malformed payload all resolve to
  incomplete/error via `client/src/lib/preflight.js` — the UI can no longer fail open against
  an older or partially-broken backend.
- Tri-state identity display: `true` → linked, `false` → not linked, `null` → n/a. A failed
  identity read never renders as a confident "not linked".
- Real production archive stays BLOCKED until a disposable-workspace archive→audit→restore
  smoke passes against a live database.

Regression coverage: `tests/integration/adminCleanup.test.js` (13 tests) runs the real server
against a scriptable fake PostgREST and covers all of the above — guards (401/403/400/200),
count-error, identity-error, truncation, business count errors, debts-not-invoices,
sanitization, archive/restore guards, audit-ok, audit-fail+rollback-ok, audit-fail+rollback-fail.

Phase 2 requirements (NOT built):

- **User suspend/archive** needs an additive `users.status`/`disabled_at` migration plus an
  auth-middleware check and session revoke. Do not fake it.
- **Reset test data** must be specified table-by-table (transactions, documents, wallets,
  reminders, debts, business metadata, personal finance data) with per-table safety rules;
  resetting child rows is more dangerous than archiving a workspace.
- Email Identity Transfer and workspace ownership transfer stay out of scope until designed.

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

