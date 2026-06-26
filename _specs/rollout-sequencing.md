# Spec — Rollout Sequencing (identity → Telegram channel → pricing → personal)

Status: **SPEC ONLY.** No code, no migrations, no flags in this doc. One implementation
order for the architecture captured in:
[saas-identity-architecture.md](saas-identity-architecture.md),
[telegram-company-routing.md](telegram-company-routing.md),
[telegram-bot-pricing.md](telegram-bot-pricing.md),
[personal-workspace-enablement.md](personal-workspace-enablement.md),
[personal-wallet-endpoint.md](personal-wallet-endpoint.md).

Each phase is independently shippable, additive, and reversible. Every phase keeps
production auth working for existing Telegram users until explicitly cut over (Phase 2).

> **Reset smoke is SEPARATE.** It is an operational verification of the already-shipped
> atomic reset (R001), not part of this architecture rollout. Do not bundle it into any
> phase below; run it on its own, on a throwaway/test business, when explicitly chosen.

---

## Phase 0 — current stable state (today)
- **State:** `users.id` is still the Telegram id; business isolation fixed (strict
  business_id scoping live); Personal/Funding OFF; Telegram bot NOT re-architected.
- **Migrations:** none. **Env flags:** none.
- **Backend / Frontend / Bot:** no change.
- **Tests:** existing CI green (resolver, reset RPC, businessAccess); live isolation
  verified.
- **Rollback/safety:** n/a (baseline).
- **MUST NOT touch:** 037–039, 040, Personal/Funding flag, `PERSONAL_WORKSPACE_ENABLED`,
  `users.id` semantics.

## STATUS (2026-06-26)
- **Phase 1 backend: SHIPPED to main, FLAG OFF.** Migration 042 (user_email_identities,
  user_profiles, email_login_codes, app_user_id_seq + next_app_user_id) is APPLIED
  LOCAL ONLY — **NOT in production**. Endpoints (`/api/auth/email/start|verify|accept-invite`,
  `/api/me/profile`, email mode on `/api/team/invite`) are live in prod code but gated by
  `EMAIL_AUTH_ENABLED` (unset → 404). Telegram auth untouched. Verified: PGlite migration
  6/6, local HTTP flow 9/9.
- **Still missing for Phase 2:** `user_telegram_links` table (NOT in 042 — needs a new
  additive migration, e.g. 043) + connect/unlink endpoints + the bot resolver cutover.
- **Product model (authoritative):** Personal Account = the human (a `users` row +
  `user_email_identities` + `user_profiles` shell). Business Workspace = a company
  (`businesses` type='business'). One Personal Account owns/joins many businesses via
  `business_members`. **Telegram is NOT an account — it's a linked channel** to a Personal
  Account; bot actions resolve `telegram_id → user_telegram_links.user_id → memberships →
  selected active business` (inline buttons when multiple; never free-text).

## A) Personal Account shell UI (safe to build now, flag-gated)
- Email **login/register** screen (request OTP → enter code) + **Personal profile** page
  (display_name/locale/timezone/avatar via `/api/me/profile`). NO wallets, NO
  transactions, NO personal finance. Gated by a frontend flag `VITE_EMAIL_AUTH_ENABLED`
  (default off; route tree-shaken/redirect when off) talking to the already-shipped
  backend (which is itself gated by `EMAIL_AUTH_ENABLED`). Local/dev only until both
  flags + prod 042 are deliberately enabled.

## B) Telegram linking — Phase 2 (plan; needs migration 043 + endpoints)
- Migration **043** (additive): `user_telegram_links(telegram_id BIGINT PK, user_id
  BIGINT REFERENCES users(id) ON DELETE CASCADE, status, linked_at, UNIQUE(user_id))` +
  `telegram_link_codes` (one-time connect codes). Backfill existing Telegram users
  (`telegram_id = users.id`) so they keep working.
- Endpoints: web "Connect Telegram" (issue one-time code) · `POST /api/telegram/link`
  (bot-secret; anti-hijack: reject a telegram_id already linked elsewhere) · unlink.
- Resolver cutover (flagged): bot + `/api/auth/telegram` resolve the app user via
  `user_telegram_links` instead of assuming `users.id == telegram_id`. Legacy positive-id
  users resolve to themselves via the backfilled link.

## C) Business membership model (already supported)
- A Personal Account creates a business (`POST /api/businesses`, owner membership) and can
  own/join MANY via `business_members`. Employees are invited to a business first
  (`/api/team/invite`, incl. the new email mode) then accept. The Telegram link belongs to
  the USER, not the business — one linked Telegram channel can act across all the user's
  businesses (with per-user active-business selection, Phase 3).

## Phase 1 — email identity foundation (additive; no cutover)
- **Goal:** email accounts exist alongside Telegram; existing Telegram users untouched.
- **Migrations:** additive only — `user_email_identities`, `user_telegram_links`
  (backfill `telegram_id = users.id` for all existing users), a dedicated **negative**
  BIGINT sequence for new email-user `users.id` (collision-proof vs positive Telegram
  ids). No FK/`users.id` changes for existing rows.
- **Env flags:** `EMAIL_AUTH_ENABLED` (default off) to gate the new login UI/endpoints.
- **Backend:** email register + OTP/magic-link + session (JWT `userId` = internal id);
  `resolveAppUserId({ email?, telegram_id? })` compatibility resolver; email team invites.
- **Frontend:** email register/login screens; email invite flow (gated by flag).
- **Bot repo:** none.
- **Tests:** email user registers + creates business + uses web with NO Telegram; new
  email-user id is negative and never equals a Telegram id; existing Telegram login
  unchanged; backfilled links are 1:1.
- **Rollback/safety:** flag off hides email UI; tables are additive (drop-safe); no
  existing row mutated. Gate: backfill row-count == existing user count.
- **MUST NOT touch:** `/api/auth/telegram` behavior (still upserts as today),
  bot endpoints, financial scoping, Personal/Funding.

## Phase 2 — Telegram as a linked integration (cutover of identity assumption)
- **Goal:** Telegram stops being primary identity; bot resolves `telegram_id → app user`.
- **Migrations:** additive — `telegram_link_codes` (one-time connect codes).
- **Env flags:** `TELEGRAM_LINK_FLOW_ENABLED` (default off).
- **Backend:** web "Connect Telegram" (issue one-time code), `POST /api/telegram/link`
  (validate code, anti-hijack: reject `telegram_id` already linked elsewhere), unlink
  (`status='revoked'`); switch bot endpoints + `/api/auth/telegram` to resolve via
  `user_telegram_links` instead of assuming `users.id == telegram_id`; new
  telegram-first users get an app-allocated id + a link row.
- **Frontend:** Settings → Integrations → Telegram: connect/disconnect UI.
- **Bot repo:** send the one-time code to `/api/telegram/link`; act as the linked user.
- **Tests:** connect via code; unlink blocks bot writes; anti-hijack (linked id can't be
  re-linked, expired/used codes rejected); legacy Telegram users keep acting (their link
  resolves to themselves); no regression in approvals/receipts.
- **Rollback/safety:** flag off → linking hidden, legacy `telegram_id==user_id` path
  still works (resolver returns self for positive ids). Gate: every active Telegram user
  has a resolvable link before flipping the resolver default.
- **MUST NOT touch:** financial scoping, pricing/limits (Phase 4), Personal/Funding.

## Phase 3 — Telegram multi-company routing
- **Goal:** per-user active business; explicit company choice when multiple.
- **Migrations:** additive — `telegram_user_state(user_id, active_business_id, ...)`.
- **Env flags:** none required beyond Phase 2 (routing is part of bot acting).
- **Backend:** `GET/POST /api/telegram/active-business`; resolver (none/auto/active/
  choose; invalid→clear+re-resolve); Telegram write endpoints stamp `business_id` and
  return `409 company_selection_required` when ambiguous.
- **Frontend:** none (web already has the switcher).
- **Bot repo:** `/company` inline keyboard + ambiguous-create prompt.
- **Tests:** 1 business auto; 2+ none-active blocks write; selection persists per user;
  switching changes target; invalid/inactive cleared; never `business_id IS NULL`.
- **Rollback/safety:** drop `telegram_user_state` (additive); writes fail closed if the
  table is absent. Gate: no Telegram write path can persist a null/guessed business_id.
- **MUST NOT touch:** identity resolver (Phase 2 contract is fixed), pricing, Personal.

## Phase 4 — Telegram pricing / limits
- **Goal:** Telegram is a locked premium business integration with usage caps.
- **Migrations:** additive — `plan_limits` columns (`max_telegram_users`,
  `max_telegram_records_per_month`, `max_telegram_receipt_parses_per_month`,
  `max_telegram_approval_actions_per_month`); seed Free=0; entitlement reuses
  `business_addons.addon='telegram_bot_channel'`. Add a `created_via_channel` marker on
  financial rows (additive) for accurate monthly counting if not already present.
- **Env flags:** none (gating is data-driven via plan/add-on).
- **Backend:** entitlement + limit checks in the bot write gate (fail closed);
  `GET /api/business/integrations/telegram` (entitled/limits/usage/locked); usage counters.
- **Frontend:** Integrations → Telegram card: Free = locked + upgrade CTA; Paid =
  enable/connect + usage panel (users used/allowed, monthly actions used/allowed).
- **Bot repo:** upgrade/limit messages (`telegram_addon_required`,
  `telegram_user_limit_reached`, `telegram_limit_reached`).
- **Tests:** Free locked + writes rejected; Tier1 caps (1–2 users, monthly cap) enforced;
  higher tier larger caps; revoked add-on blocks writes; per-business entitlement; email
  users unaffected.
- **Rollback/safety:** missing entitlement/limits → fail closed (no writes), never open.
  Additive columns drop-safe. Gate: no write occurs when locked or over limit.
- **MUST NOT touch:** identity, routing contract, Personal/Funding.

## Phase 5 — bot-side implementation (separate bot repo)
- **Goal:** complete the Telegram UX against the Phase 2–4 contracts.
- **Migrations:** none. **Env flags:** bot-side config only.
- **Backend / Frontend (this repo):** none (contracts already shipped).
- **Bot repo:** inline company selector (`/company`); pending parsed-item confirmation
  (receipt/invoice → confirm before write); saved-to-company confirmation per record;
  upgrade/limit message rendering; link-code entry.
- **Tests:** end-to-end against staging — selection, ambiguous prompt, parse-confirm,
  per-record confirmation, upgrade/limit paths.
- **Rollback/safety:** bot deploy is independent; the API rejects anything out of
  contract, so a stale bot can't bypass entitlement/limits.
- **MUST NOT touch:** this repo's data model; the bot only consumes the API.

## Phase 6 — Personal Workspace + Funding Bridge (later; separate approval)
- **Goal:** enable Personal Workspace and personal funding into businesses.
- **Migrations:** apply **037 → 038 → 039** (preflight/postflight provided); 040
  independent. Personal-wallet endpoint per [personal-wallet-endpoint.md](personal-wallet-endpoint.md).
- **Env flags:** `VITE_PERSONAL_FUNDING_UI_ENABLED=true`, `PERSONAL_WORKSPACE_ENABLED=true`;
  per-user entitlements `personal_finance_workspace`, `personal_investor_funding`.
- **Backend:** dedicated personal-wallet endpoint (NOT scope-aware `/api/wallets`);
  funding bridge already built in `personalFunding.js`.
- **Frontend:** unlock `/personal/*` (already gated); "+ Create personal workspace".
- **Bot repo:** none (Telegram stays business-only).
- **Tests:** personal wallet isolation; funding A/B via bridge; no leak either way;
  legacy tx 46/47 migration AFTER a personal workspace exists for user 7826585034.
- **Rollback/safety:** requires explicit approval + backup before each migration; flags
  off by default; personal stays invisible until all three are set.
- **MUST NOT touch:** business isolation (strict business_id scoping must remain);
  business routes never create/return personal wallets.

---

## Dependency order (hard)
Phase 1 → 2 (links require identity) → 3 (routing requires linked user) →
4 (pricing gates the routed writes) → 5 (bot UX against 2–4). Phase 6 is independent of
1–5 and can be scheduled separately, but never weakens business isolation.

## Cross-cutting invariants (all phases)
- Production auth unchanged until Phase 2's explicit, flagged cutover.
- Every financial record stays business-scoped with a non-null `business_id`.
- Additive migrations only; backup + gated apply for anything touching prod DB.
- Fail closed on entitlement/limit/identity ambiguity — never write on doubt.
- **Reset smoke remains a separate operational gate, not part of this rollout.**
