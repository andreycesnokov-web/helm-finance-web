# Decisions - CFO AI / Helm Finance

Last updated: 2026-08-27.

Numbering note: D10-D21 are unused. They are reserved, not lost — do not renumber D22 to
close the gap, and do not reuse D10-D21 for unrelated decisions without a spec update.

## D1 - Email is Primary Identity

Decision:

- Email registration/login is a free identity entry.
- Product usage can be gated by plan/trial after identity is created.

Reason:

- Email is universal and works before Telegram or business workspace setup.

Impact:

- Do not block email registration behind payment.
- Do not make Telegram the primary login again.

## D2 - Telegram is Legacy Login and Future Paid/Add-on Channel

Decision:

- Telegram login remains for existing users.
- Telegram bot/channel is future paid/add-on for new flows.

Reason:

- Telegram is useful for lightweight employee submissions and notifications, but should not be the identity foundation.

Impact:

- Keep `/login/telegram` as legacy access.
- Future Telegram linking/cutover requires explicit plan.

## D3 - Personal and Business Money Are Separate

Decision:

- Personal wallets and business wallets are different financial contexts.
- No implicit transfer between personal and business.

Reason:

- Legal/accounting separation and trust.

Impact:

- Personal rows use personal workspace + `scope='personal'`.
- Business rows use business workspace + `scope='business'`.
- Bridge flows must be explicit and audited later.

## D4 - Personal Workspace Uses a `businesses.type='personal'` Row

Decision:

- Personal finance reuses existing workspace tables, but with a personal type and strict scope.

Reason:

- Reuse wallet/transaction/category infrastructure while preserving isolation.

Impact:

- Business resolver must reject personal workspaces.
- Personal resolver must reject business workspace ids.

## D5 - Premium UI Must Be Flagged

Decision:

- Premium Business UI and Personal v1 UI ship behind flags.

Reason:

- Allows safe dark deploys without production behavior changes.

Impact:

- Build OFF and ON when applicable.
- Production flag changes require explicit owner go.

## D6 - Engine Calculates, AI Explains

Decision:

- Deterministic engine computes financial/tax values.
- AI explains, summarizes, and guides.

Reason:

- Avoid fake or hallucinated financial numbers.

Impact:

- If source data is missing, show `insufficient_data` or `unavailable`.
- Do not invent tax values.

## D8 - Email + Telegram Are Login Identities of ONE Account (Admin-Linked)

Decision:

- A single user account (`users.id`) may carry a Telegram identity, an email identity, a
  profile, a personal workspace, and business memberships — they are login methods, not
  separate people.
- Linking an email to an existing Telegram user is an ADMIN action for this MVP
  (`POST /api/admin/users/:id/link-email`). No self-serve email↔Telegram linking yet.
- Linking is additive: it inserts a `user_email_identities` row for the existing user id;
  after that, email login resolves to the same account and keeps all business access.
- An admin link is treated as admin-verified (`email_verified_at` set).
- If the email already belongs to a DIFFERENT user, the action returns a CONFLICT and never
  auto-merges. Destructive account merge is future work.

Reason:

- PT Helm Care Indonesia (and other early accounts) were created via Telegram identity;
  owners need email login without losing their workspace.

Impact:

- Admin UI may show internal ids; normal-user UI must not (`/api/me/login-methods` never
  returns the id).
- Every link attempt (linked / already_linked / conflict) is written to `audit_events`.
- Account disable/suspend and hard delete are NOT implemented (see PROJECT_STATE / RISKS).

## D9 - Cleanup Is Archive-First; Hard Delete Is Blocked by Default

Decision:

- Removing a test/duplicate business or workspace uses a reversible SOFT archive
  (`businesses.status='archived'`), never a destructive delete.
- Archived workspaces disappear from the switcher / `/api/workspaces`
  (`listAccessibleWorkspaces` filters `status!='archived'`) but stay visible in admin.
- Archive is admin-only and requires typing the EXACT business name (`confirm_name`) plus
  `confirm:true`, so a real workspace (Helm Care Indonesia / Helm Care Pay) can never be
  archived by accident. Every archive/unarchive is audited to `audit_events`.
- Hard delete is NOT implemented. It is allowed only in a future task when ALL hold: owner
  explicitly approves; preflight shows zero financial/document footprint; dependencies are
  handled; audit exists; a backup/export is confirmed.

Reason:

- Production data safety: never lose real financial/business/audit data during cleanup.

Impact:

- No wallets/transactions/documents/audit are moved or deleted by cleanup.
- Duplicate-user disable needs a `users.status` column (not present) — documented as a
  required future migration; not faked. See [[D8]].

## D7 - Canonical Docs Are Local `_specs/`

Decision:

- Local `_specs/` is the source of truth for specs/roadmap.
- Google Drive docs are final exports only after explicit approval.

Reason:

- Avoid fragmented memory between AI agents and Drive copies.

## D22 - Incoming Payments Are Accounting Evidence

Decision:

- Money arriving from a payment gateway or a bank account is ingested as an
  `incoming_payment`: a normalized, business-scoped record of **cash received**.
- An incoming payment is **evidence of cash**, not automatically accountant-ready revenue.
  Ingesting it never asserts what the money was for, which period it belongs to, or how it
  is taxed.
- `gross_amount`, `fee_amount`, and `net_amount` are always stored separately. The net
  settlement figure is never written into a revenue field.
- Matching a payment to an invoice/order/customer produces a **reconciliation candidate**
  with a confidence and a rationale. A candidate becomes a **matched payment** only when a
  human accepts it. `unmatched receipt` is a first-class, visible state.
- Accounting/tax treatment is produced as a **draft** and requires user/accountant
  approval before it can affect any report. Nothing is auto-submitted to a tax authority.
- Every payment belongs to **exactly one** business workspace. Helm Care Pay and Helm Care
  Indonesia are never mixed, and no ingestion queue spans workspaces.
- Direct bank APIs are out of scope for v0; `future_bank_api` is a reserved source name only.

Reason:

- The AI Accountant differentiator is understanding money that actually arrived and turning
  it into reviewable evidence. That only holds if cash facts, proposed meaning, and approved
  accounting stay three separate layers.
- Treating a gateway payout as gross revenue understates both revenue and expenses and
  produces wrong tax figures. A gateway settlement and its bank credit are the same money
  seen twice.
- Duplicate money from retried webhooks or re-uploaded statements silently inflates revenue,
  which is worse than missing money.

Impact:

- Deduplication by `(business_id, source, external_reference)` is a hard uniqueness
  constraint, not best-effort. Re-ingesting a known reference is an idempotent no-op.
- Payment lifecycle, reconciliation state, and accountant review state are three independent
  status axes and must not be collapsed into one.
- A ledger transaction is written on **approval**, never on ingestion. Reversal is a
  compensating audited record, never a delete — consistent with [[D9]].
- Extends [[D6]]: the engine computes gross/fee/net and deterministic matches; AI explains
  and proposes; the human approves.
- Extends [[D3]]: this layer is business-scope only. No personal-scope incoming payments.
- Builds on the existing `bank_import_*` pipeline (migration 021) rather than replacing it.
- Full model, source types, fields, phases, and open questions:
  `_specs/incoming-payments-bank-gateway-ingestion.md`.

Status (2026-08-27):

- Phase 1 is BUILT on `feature/incoming-payments-foundation`: migration 048
  (`incoming_payments`), `server/lib/incomingPayments.js`, four flag-gated routes, 82 tests.
- Gated by `INCOMING_PAYMENTS_ENABLED`, default OFF. Not applied to production, not enabled,
  not deployed. With the flag off the routes 404 and the table is never queried, so the code
  is safe to deploy before 048 is applied.
- The ledger-inert rule is enforced, not just documented: no route writes `transactions` or
  `debts`, a client-supplied ledger link is refused (`linking_not_supported`), and `matched`
  is unreachable from the API. See §13 of the spec.

