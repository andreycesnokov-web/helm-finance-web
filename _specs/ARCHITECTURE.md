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

## Platform Admin Dashboard (foundation, 2026-08-11)

Built INSIDE the existing app/admin area — there is deliberately **no separate backend app**.

- `GET /api/admin/dashboard` (`auth` + `requireAdmin`) — read-only platform summary.
  Returns `users`, `businesses`, `identity_risks`, `activity_last_7_days`, `system`,
  `billing`, `warnings`. Counts only: no financial amounts, no secrets/tokens/keys.
- Frontend `/admin/dashboard` (`client/src/pages/AdminDashboard.jsx`), linked from the
  admin tab bar in `Admin.jsx` and the shared `AdminTabs` in `AdminBusinesses.jsx`.
- Safety model: every metric goes through a bounded `count`-only query (`head:true`).
  A missing table/column or a DB failure yields `null` + a human-readable `warnings` entry —
  numbers are never invented. All counts run in parallel so a DB outage cannot hang the
  request for minutes. Verified read-only (HEAD/GET only; zero write verbs).
- Identity risk signals are derived from the id-sign convention (positive = Telegram-origin,
  negative = email-first) plus `user_email_identities`, capped at 5000 rows with a
  truncation warning.
- `billing` is an explicit placeholder: `billing_enabled:false`, `paid_businesses:null`,
  `mrr:null` — billing/entitlements are NOT implemented.

Future direction (NOT now): a dedicated `admin.cfo-ai.site` console and an analytics
warehouse. Until then the dashboard stays inside this app.

## Admin Cleanup & Reset Console (Phase 1, 2026-08-15)

Internal support tooling for cleaning up test/duplicate accounts. Archive-first, never delete.

- `GET /api/admin/users/:id/cleanup-preflight` (auth + requireAdmin) — READ-ONLY assessment
  of one account: identity (email masked), ownership counts (owned/personal/company/archived
  workspaces + memberships), data footprint (transactions, documents, wallets across owned
  workspaces, audit events), `risk_flags`, `recommended_actions`, `safe_to_archive_or_reset`,
  `reset_scope_preview`, and the `reset_enabled` / `hard_delete_enabled` /
  `user_suspend_enabled` capability flags (all false in Phase 1). Bounded count queries only;
  unavailable metrics return null + a sanitized warning. Verified read-only (GET/HEAD only).
- Workspace cleanup REUSES the existing endpoints — no duplicates were created:
  `GET /api/admin/businesses/:id/cleanup-preflight`, `POST …/archive`, `POST …/unarchive`.
  Both mutations now additionally require a **reason** (3–500 chars) stored in the audit trail;
  archive still requires `confirm:true` + exact `confirm_name`.
- `recordCleanupAudit()` writes the audit row and REPORTS failure (unlike best-effort
  `recordAudit`). If the audit write fails, the status change is rolled back and the endpoint
  returns `audit_failed` — a cleanup action never happens without a trace.

Safety semantics (2026-08-15 hardening): both preflights FAIL CLOSED — query errors and
truncation yield `null` + sanitized warning and force `safe_to_archive_or_reset:false` /
`preflight_complete:false`; `is_empty` is `null` when unknown. Debt rows are `debts_count`
(`invoices` is `null`, no invoices table). On audit-write failure the status change is rolled
back and the response distinguishes `audit_failed_rolled_back` from
`audit_failed_rollback_failed` (`state:'uncertain'`, manual review) — the rollback result is
always checked. Future improvement: atomic DB/RPC so no compensating update is needed.

NOT implemented in Phase 1 (documented, no code): reset of child data, hard delete, and user
suspend/archive (there is no `users.status`/`disabled_at` column — that needs an approved
additive migration plus session handling).

## AI Accountant Document Intake (Phase 1, 2026-08-17)

One upload window; CFO AI classifies and files. **No migration** — see the storage note below.

- Uploading REUSES `/api/documents/upload-init` + `/api/documents/upload-complete` (same
  storage bucket, server-side SHA verification, dedup, role and plan gates, audit). No new
  upload path was created.
- New endpoints (all `auth` + `requireBusiness` + documents role/plan gates):
  - `GET /api/ai-accountant/document-intake` — intake inbox for the ACTIVE business.
  - `POST /api/ai-accountant/documents/classify` — STATELESS preview for the upload window.
  - `PATCH /api/ai-accountant/documents/:id/classification` — manual correction.
  - `GET /api/ai-accountant/required-documents` — preliminary checklist.
- Logic lives in `server/lib/documentIntake.js` (pure, unit-tested): taxonomy, `classify()`,
  `requirementsFor(profile)`, `buildChecklist()`, `readIntake()`, `intakePatch()`.
- **Storage note (why no migration):** migration 031 constrains
  `financial_documents.document_type` to a fixed CHECK list with no NPWP/NIB/Akta values.
  Rather than alter that constraint, the intake taxonomy is stored in the existing free-form
  `extracted_json.ai_intake` (`doc_type`, `confidence`, `classification_status`,
  `confirmed_by_user_id`, `confirmed_at`), while `document_type` keeps a CHECK-valid value via
  `INTAKE_TYPES[].maps_to`. Writes go through the same audited `rpc_document_update_metadata`.
- **Permission model (P0 fix):** the intake and checklist GETs reuse the Document Center rule
  exactly — `canViewAllDocuments(role)` else
  `docA.canAccessDocument({ role, userId, doc, ownedDebtIds })`, applied after `attachLinks`.
  A restricted role never receives metadata for documents it cannot access. Manual correction
  stays manage-role only and business-scoped (`loadDocumentScoped` ⇒ cross-business is 404).
- Requirements are **jurisdiction-aware** via `jurisdictionOf(profile)` (`id|other|unknown`):
  Indonesian documents are required only under the Indonesian regime, `not_required`
  elsewhere, `optional` + warned when the country is unknown.
- The loader fetches `INTAKE_DOC_CAP + 1` to detect truncation and returns `truncated`;
  a truncated set downgrades `missing` to `needs_review`.
- Frontend loads are protected by `client/src/lib/requestGuard.js` (generation + AbortController)
  so a response from a previously active workspace can never be rendered.
- `client/src/lib/documentKnowledge.js` holds the static Indonesian document knowledge base
  plus the grouping/priority derivation the checklist and the Workbench share. It reads the
  backend `requirement` and never overrides it.
- Phase 2 sits behind the default-OFF backend flag `DOCUMENT_CONTENT_CLASSIFICATION_ENABLED`;
  unset means the pipeline is Phase 1 only. Generic document responses pass through the
  `publicExtractedJson()` / `publicFileRow()` whitelists.
- **Phase 2 (content-based classification, 2026-08-18)** — `server/lib/pdfText.js` extracts
  text a PDF already carries (dependency-free zlib inflate of content streams; bounded work;
  garbage/illegible output rejected). `server/lib/documentContent.js` scores that text against
  Indonesian document markers and combines it with the Phase 1 file-name signal.
  It is NOT OCR: a scanned page has no embedded text and degrades to the file-name verdict.
  No OCR provider, no AI provider, no new env var, no migration — the result is stored in the
  existing free-form `extracted_json.ai_intake` (`signals`, `extraction`, `explanation`,
  `classifier_version: 2`).
  Classification runs inside `upload-complete` on the bytes already verified there (no second
  storage read) and can be re-run per document via
  `POST /api/ai-accountant/documents/:id/reclassify` (manage role, business-scoped, refuses to
  overwrite a manually confirmed type). Responses carry marker LABELS only — the extracted
  text and the stored sample never leave the server.
- Classification is deterministic: file name + MIME only. No OCR, no AI provider, no new env
  var. GET endpoints never write — auto-classification is derived on read; only a manual
  confirmation is persisted.
- Frontend: `client/src/components/DocumentIntakeModal.jsx` (multi-file drag & drop, reuses
  `uploadDocument()`) plus the "Compliance documents · preliminary" and "Document intake"
  sections on the AI Accountant Tax Profile page.

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

