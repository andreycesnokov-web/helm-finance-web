# Spec — Phase 1: Email Identity Foundation (PLAN ONLY)

Status: **PLAN ONLY.** No code, no migrations, no flags. Additive + non-breaking;
existing Telegram login keeps working. Email becomes the primary SaaS identity; Telegram
remains an optional paid channel (linked later — Phase 2). This deepens nothing in the
old `users.id == telegram_id` model. Builds on
[saas-identity-architecture.md](saas-identity-architecture.md).

## 1. Email registration / login
- **Method:** email **OTP** (6-digit code) as the primary flow; magic-link is an optional
  variant sharing the same token table. No passwords in v1 (can add later).
- **Endpoints (gated by `EMAIL_AUTH_ENABLED`):**
  - `POST /api/auth/email/start { email }` → normalize email, rate-limit, create/find a
    single-use login code, email it. Always returns `{ ok: true }` (never reveals whether
    the email exists — anti-enumeration).
  - `POST /api/auth/email/verify { email, code }` → validate (exists, unexpired, unused,
    attempts under cap) → resolve-or-create the user → issue JWT.
- **User creation (resolve-or-create):**
  - If an `user_email_identities` row exists for the normalized email → use its `user_id`.
  - Else create a NEW `users` row with an **app-allocated negative BIGINT id** (see below)
    + an `user_email_identities` row (email, verified_at). `users.username/first_name`
    seeded from the email local-part until the user sets a name.
  - Existing Telegram users who later add email attach an identity row to their EXISTING
    positive `users.id` (Phase 2 connect) — no new user, no migration of their id.
- **Negative BIGINT id strategy:** a dedicated sequence
  `CREATE SEQUENCE app_user_id_seq INCREMENT -1 START -1 MINVALUE -9223372036854775808 MAXVALUE -1`.
  Telegram ids are always positive → negative ids are **collision-proof** by construction.
  Email-first `users.id = nextval('app_user_id_seq')`. (UUID canonical id is a later,
  optional phase; not now — would rewrite every BIGINT FK.)
- **Session / JWT shape:** unchanged & compatible — `{ userId, firstName }` signed with
  `JWT_SECRET`, 30-day expiry, `Authorization: Bearer`. `userId` is the internal
  `users.id` (may be negative for email users). Optional additive claim
  `auth_channel: 'email' | 'telegram'` for diagnostics; existing `auth` middleware
  (`req.user.userId`) keeps working untouched.

## 2. Tables (additive)
```
-- email identity attached to an internal user (one email ↔ one user)
user_email_identities (
  user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email          CITEXT UNIQUE NOT NULL,          -- normalized; case-insensitive
  password_hash  TEXT NULL,                        -- null in v1 (OTP-only)
  email_verified_at TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
-- one-time codes / magic-link tokens (OTP + magic link share this)
email_login_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        CITEXT NOT NULL,
  code_hash    TEXT NOT NULL,                       -- store a HASH of the 6-digit code/token
  purpose      TEXT NOT NULL DEFAULT 'login',       -- login | invite_accept
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX email_login_codes_email_idx ON email_login_codes(email, created_at DESC);
-- app-allocated negative ids
CREATE SEQUENCE app_user_id_seq INCREMENT -1 START -1 MINVALUE -9223372036854775808 MAXVALUE -1;
```
- `user_telegram_links` (telegram_id ↔ user_id) is **defined here but backfilled/used in
  Phase 2** (Telegram linking); not required to ship email login.
- **`users` table:** no required new fields. (Optional convenience columns later, e.g.
  `primary_email`, are not needed — email lives in `user_email_identities`.)

## 3. Existing Telegram users
- Untouched: `/api/auth/telegram` keeps upserting `users.id = telegram_id` exactly as
  today. No forced migration, no id change.
- They can LATER attach email to their existing `users.id` (an `user_email_identities`
  row) — additive, optional, Phase 2.
- Both identity types resolve to the same internal `users.id`, so all business
  memberships and financial rows are identical regardless of login channel.

## 4. Team invites by email
- `POST /api/team/invite` (already business-scoped via `requireBusiness`) gains an
  optional `{ email, role }` mode: creates a `business_invites` row + an
  `email_login_codes(purpose='invite_accept')` and emails an accept link.
- **Accept flow:** invited user does email OTP/verify; if an invite is present, after
  user resolve-or-create we insert the `business_members` row (active, invited role) for
  that business. **Telegram not required** at any point.
- Reuses the existing invite/role guards (owner/CEO/admin; cannot invite ≥ own rank).

## 5. Compatibility
- All existing routes keep using `req.user.userId` — unchanged.
- Negative ids work with the current BIGINT FKs (`businesses.owner_user_id`,
  `business_members.user_id`, `created_by_user_id`, payroll, …) — same type, just a
  disjoint value range.
- No Telegram code path is modified. Email is purely additive, behind `EMAIL_AUTH_ENABLED`.
- `bizOrFilter`, `requireBusiness`, reset, team — all already key on `users.id` /
  `business_id`, agnostic to how the user authenticated.

## 6. Security
- **OTP:** 6 digits, short TTL (e.g. 10 min), **single-use** (`consumed_at`), stored as a
  HASH (never plaintext), max attempts (e.g. 5) then invalidate.
- **Rate limiting:** per email + per IP on `/start` (e.g. N/min, M/hour) and on `/verify`
  (attempt cap). Throttle to blunt brute-force + email-bombing.
- **Email normalization:** trim + lowercase; `CITEXT UNIQUE` so `A@x.com` == `a@x.com`.
  (Optional: strip Gmail dots/plus — decide later; default = simple normalization.)
- **No account takeover:** `/start` never reveals existence; verify requires the code;
  invite-accept binds membership only to the email that received the invite; one email ↔
  one user (`UNIQUE`); codes are purpose-scoped (`login` vs `invite_accept`).
- Magic-link variant uses the same hashed-token + expiry + single-use rules.

## 7. Rollout
- **Feature flag `EMAIL_AUTH_ENABLED`** (default OFF) gates all email endpoints + UI.
- **Additive migration only** (the tables/sequence above) — no existing row/column changed.
- **No auth cutover:** Telegram login stays fully active throughout; email runs alongside.
- Apply under the gated process (backup → apply → verify), flag stays off until tested,
  then flip on. Phase 2 (Telegram linking) and the `/api/auth/telegram` resolver cutover
  are separate, later, and independently flagged.

## 8. Tests
1. Email signup (start → verify) creates a NEW user with a **negative** id + an
   `user_email_identities` row.
2. Email login (existing identity) returns a valid JWT resolving to the same `users.id`.
3. Invited email user accepts → `business_members` row created for that business
   (no Telegram).
4. Existing Telegram user still logs in via `/api/auth/telegram` (unchanged).
5. Email user can create a business (`POST /api/businesses`) and use the web app.
6. **No id collision:** a generated negative id never equals any Telegram (positive) id;
   `user_email_identities.email` is unique/case-insensitive.
7. Security: expired code rejected; reused code rejected; attempt cap enforced;
   `/start` does not reveal account existence; rate limit triggers.
8. Flag off → email endpoints return 404/disabled; Telegram unaffected.

## Out of scope (later phases)
Telegram linking + resolver cutover (Phase 2), Telegram routing (Phase 3), Telegram
pricing/limits (Phase 4), Personal Workspace (037+), Invoices Phase B. Email provider
selection (SES/Resend/etc.) is an implementation detail decided at build time.
