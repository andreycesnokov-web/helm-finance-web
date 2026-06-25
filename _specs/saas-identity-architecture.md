# Spec — SaaS Identity Architecture (email-primary; Telegram as paid add-on channel)

Status: **DISCOVERY / SPEC ONLY.** No code, no migrations, no flags. Do NOT alter
production auth. Phased + additive; existing Telegram users keep working throughout.

## 1. Current auth model (audit)
- **Identity = Telegram.** `POST /api/auth/telegram` verifies the Telegram login hash
  (BOT_TOKEN) and upserts `users` with **`id = data.id`** (the Telegram chat id). The
  JWT carries `userId = users.id`. There is no email/password path.
- **`users.id` IS the Telegram id**, BIGINT. Code states this explicitly (e.g.
  `/api/telegram/connect`: "a member may only connect their own Telegram account").
- **Tables that depend on `users.id` being the Telegram id** — FKs (BIGINT) to
  `users(id)`: `businesses.owner_user_id`, `business_members.user_id`,
  `business_members.invited_by_user_id`, `businesses.override_created_by_user_id`,
  `payroll_employees.user_id`, `payroll_payments.user_id`,
  `payroll_payment_items.user_id`, `user_workspace_preferences.user_id` (037). Plus many
  **non-FK** BIGINT columns holding user ids: `created_by_user_id`, `approved_by_user_id`,
  `contributor_user_id`, `reviewed_by_user_id`, etc. The `users` table itself is base
  schema (not in migrations).
- **Endpoints assuming Telegram identity** — all bot-secret routes treat `telegram_id`
  as `user_id` directly: `/api/telegram/debts/:id/{approve,reject,request-info,decision}`,
  `/api/telegram/debts/{attach-receipt,from-receipt}`, `/api/telegram/connect`,
  `resolveBotApprover()`. Web auth = Telegram login only.
- **What breaks if email users are introduced naively** — a new email user has no
  Telegram id, so there's no value to put in `users.id` under the current scheme; any
  approach that keeps generating positive BIGINT ids risks colliding with real/future
  Telegram ids; the bot's `telegram_id == user_id` assumption breaks the moment a user's
  app id differs from their Telegram id; `/api/auth/telegram`'s `upsert(id=data.id)`
  would create a SECOND user for an already-email-registered person.

## 2. Target model
- **Primary account = email** (password or email OTP). Web app works without Telegram.
- **Internal `users.id` is NOT the Telegram chat id long-term.** It is an opaque internal
  id; Telegram identity is stored **separately** and linked.
- **Telegram identity** lives in `user_telegram_links` (one Telegram account ↔ exactly
  one app user; a user may connect/disconnect). The bot becomes a **channel** that acts
  on behalf of the linked app user.

### Internal id strategy (compatibility-first)
Changing `users.id` to UUID now would rewrite 8 FKs + dozens of BIGINT columns — too
risky. Phased approach:
- **Keep `users.id` BIGINT.** Existing Telegram users keep their current id (= their
  Telegram id). Backfill a `user_telegram_links` row (`telegram_id = users.id`) for each.
- **New email-first users** get an app-generated BIGINT id from a **reserved, disjoint
  range** so it can never collide with a Telegram id — recommend a dedicated sequence in
  **negative space** (`users.id < 0`), since Telegram ids are always positive. (Telegram
  ids can be 64-bit, so no safe positive offset exists.)
- **Eventual clean state (optional, later):** a UUID canonical id behind a compatibility
  view. Documented as future work; not part of this phase.

## 3. Business model (Telegram = paid add-on)
- Email SaaS account uses the web app normally (no Telegram required).
- Telegram bot is a **paid add-on**: `business_addons.addon = 'telegram_bot_channel'`
  (active status), per business (reuses the existing 020 entitlement table).
- **Without the add-on**: Telegram commands for that company are rejected with an upgrade
  message (`{ error: 'telegram_addon_required', upgrade_required: true }`).
- **With the add-on**: the bot can create transactions/payables/receipts/approvals for
  the selected company (per the routing spec).

## 4. Multi-company routing (unchanged contract, re-homed on app user)
- Routing is per **linked app user** (resolve `telegram_id → user_telegram_links.user_id`
  first, then the existing rules).
- Active Telegram business stored per user in `telegram_user_state`
  (see [telegram-company-routing.md](telegram-company-routing.md)).
- Multiple businesses + none active → bot asks; never guess.

## 5. Migration strategy (additive, non-breaking)
- **Phase 1 (additive tables only):** add `user_email_identities`,
  `user_telegram_links`, `telegram_user_state`, link-code table, and the
  `telegram_bot_channel` add-on. Backfill `user_telegram_links` from existing users
  (`telegram_id = users.id`). No change to `users.id` or existing FKs. Telegram login
  keeps working unchanged.
- **Phase 2 (email login live + bot via link):** add email register/login/OTP; switch
  the bot to resolve the app user via `user_telegram_links` instead of assuming
  `users.id == telegram_id`. `/api/auth/telegram` upserts a LINK for the resolved app
  user rather than forcing `users.id = telegram_id`. New telegram-first users get an
  app-allocated id + a link row.
- **Phase 3 (optional, later):** UUID canonical id behind a compat view; long-term only.
- **Compatibility layer during transition:** a single resolver
  `resolveAppUserId({ telegram_id?, email? })` that returns the internal `users.id` from
  whichever identity is presented, so call sites stop hard-coding `telegram_id` as the
  user id. Existing positive-id Telegram users resolve to themselves.

## 6. Proposed tables (additive; apply later under the gated process)
```
-- email identity attached to an existing/new internal user
user_email_identities (
  user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email          CITEXT UNIQUE NOT NULL,
  password_hash  TEXT NULL,              -- null when OTP-only
  email_verified_at TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
-- Telegram channel link (one tg account ↔ one app user)
user_telegram_links (
  telegram_id    BIGINT PRIMARY KEY,                 -- the Telegram chat id
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'active',     -- active | revoked
  linked_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id)                                   -- one link per user (V1)
);
-- one-time codes for the connect flow
telegram_link_codes (
  code           TEXT PRIMARY KEY,                   -- short, single-use
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ NULL
);
-- per-user active Telegram business (from the routing spec)
telegram_user_state ( user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_business_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now() );
-- entitlement: business_addons.addon = 'telegram_bot_channel' (existing table, 020)
```
`app_users`/`auth_users` are NOT introduced now — email/Telegram identities attach to the
existing `users` row to avoid a dual-identity split. (UUID `app_users` is the Phase-3
option if/when we move off BIGINT.)

## 7. Security
- **Web** = email session (password or OTP); standard JWT as today, `userId` = internal
  `users.id`.
- **Telegram linking flow (anti-hijack):**
  1. Web: user clicks **Connect Telegram** → server creates a single-use
     `telegram_link_codes` row (short TTL, e.g. 10 min) for their `user_id`.
  2. User sends the code to the bot (`/start <code>` or a message).
  3. Bot calls `POST /api/telegram/link { telegram_id, code }` (bot secret).
  4. Server validates: code exists, not expired, not used; **`telegram_id` not already
     linked to a different user** (reject hijack); then upsert `user_telegram_links` and
     mark the code used.
- **Unlink:** web `DELETE` the link (or set `status='revoked'`) → subsequent bot writes
  for that `telegram_id` are rejected (`telegram_not_linked`).
- A Telegram id can map to only one app user; an app user has one Telegram link (V1).
- Bot secret still required on all bot endpoints; `business_id` always server-resolved
  with a membership check.

## 8. Product UX
- Register by **email** → verify (OTP/link).
- **Create business** (existing flow), become Owner.
- **Invite team by email** (email invites; today invites are Telegram-centric).
- **Settings → Integrations → Telegram Bot**: enable the `telegram_bot_channel` add-on
  (billing), then **Connect Telegram** (generates the one-time code).
- In the bot: **choose active company** (`/company`) per the routing spec.
- Disconnect Telegram from the same Integrations screen.

## 9. Required tests (before enablement)
1. Email user can register + create a business + use the web app **without any Telegram**.
2. Telegram cannot act unless **linked** (unlinked `telegram_id` → `telegram_not_linked`).
3. Telegram cannot act unless the business has the **`telegram_bot_channel` add-on**
   (`telegram_addon_required`).
4. A linked Telegram user can select a company and create records (business_id stamped).
5. **Revoked add-on** blocks bot writes (upgrade message), web unaffected.
6. **Unlink** Telegram blocks bot writes immediately.
7. Anti-hijack: a `telegram_id` already linked to user A cannot be linked to user B;
   expired/used codes rejected.
8. Existing Telegram-only users keep working through Phase 1 (no regression).
9. No collision: an email-first user's internal id never equals a real Telegram id.

## Out of scope / unaffected
Personal Workspace (037+, gated) and the financial isolation/reset work already shipped.
This spec changes identity/onboarding only; financial scoping stays business_id-based.
