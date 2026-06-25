# Spec — Telegram Multi-Company Routing (per Telegram user)

Status: **DESIGN (doc-only).** No code, no migrations, no flags. Needs an additive
migration + endpoints in this repo AND bot-side work in the separate bot app.

One Telegram bot serves many clients/companies. Company selection is **per Telegram
user**, never per bot. Active company is stored **per user**, never globally.

## Current state (audit)
- `users.id` IS the Telegram user id; bot endpoints (`/api/telegram/debts/:id/*`) auth
  with a bot secret + `telegram_id` and look up `business_members` by `user_id =
  telegram_id`.
- Business is currently resolved **per record** (a debt's `business_id`, else the
  owner's earliest business). There is **no** stored "active Telegram business per
  user" and **no** routing/`/company` contract. New Telegram-created records have no
  guaranteed per-user company routing.
- The Telegram bot itself (message handling, `/company`, record creation UX) is a
  SEPARATE application; this repo provides the API + storage contract.

## Model
`telegram_user_id (= users.id)` → accessible businesses (active `business_members`,
`type='business'`) → **selected active Telegram business** (stored per user).

## Routing rules
1. 1 accessible business → auto-route there (no prompt).
2. 2+ businesses and no active Telegram business → ask the user to choose (return the
   list; do NOT guess/default).
3. Active Telegram business set → route all new Telegram-created records there.
4. User can switch with `/company`.
5. Active Telegram business stored per user (never global to the bot).
6. Never silently default when 2+ businesses exist.
7. Every Telegram-created financial record MUST carry `business_id` (the active one).

## Storage proposal (additive migration — apply under the gated process)
Prefer a small dedicated table over a `users` column (keeps channel state isolated):
```
CREATE TABLE IF NOT EXISTS telegram_user_state (
  user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_business_id UUID   NULL REFERENCES businesses(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ DEFAULT now()
);
```
`ON DELETE SET NULL` means deleting the active business cleanly drops the selection
(next bot action re-resolves per the rules). Additive; independent of 037–039/040.

## Backend contract (this repo; bot-secret authed like existing /api/telegram/*)
- `GET /api/telegram/active-business?telegram_id=` → resolves per rules:
  - 0 businesses → `{ status: 'none' }`
  - 1 business → `{ status: 'auto', business: {...} }` (and persist it)
  - 2+, none active → `{ status: 'choose', options: [{id, name, business_code}] }`
  - active set → `{ status: 'active', business: {...} }`
- `POST /api/telegram/active-business { telegram_id, business_id }` → validate the user
  has an active membership in a `type='business'` workspace; upsert
  `telegram_user_state`; return the selection. (Backs `/company`.)
- All Telegram WRITE endpoints (record creation) must resolve the active business via
  this contract and **reject** when `status='choose'` (multiple, none active) with a
  clear "pick a company first" response — never write without `business_id`.

## Auth / isolation rules
- Bot secret required (existing `requireBotSecret`).
- `telegram_id` must have an **active membership** in the target business
  (`business_members`, status active); reject otherwise.
- Per-user state only — one user's active company never affects another user or the bot
  globally. Business type must be `business` (reject personal here).
- `business_id` is set server-side from the resolved active business; never trusted
  blindly from the bot payload without the membership check.

## Tests required before enablement
1. User with 1 business → `auto`, business_id stamped on a new record.
2. User with 2+ and none active → `choose` (list returned, NO record written).
3. Set active via `/company` (POST) → subsequent records route there.
4. Switch company via `/company` → new records route to the new company.
5. Active state is per user (user A's choice doesn't change user B's routing).
6. Every Telegram-created record has a non-null `business_id`.
7. Non-member `telegram_id` for a business → rejected.
8. Deleting the active business clears the selection (next action re-resolves).

## Cross-repo split
- **This repo**: `telegram_user_state` migration + the active-business endpoints +
  ensure all Telegram write paths stamp `business_id` from the resolved active business.
- **Bot app (separate)**: `/company` command UX (list + pick), prompt-on-ambiguous,
  and call the endpoints above before creating any financial record.

## Out of scope
Personal workspaces (gated, 037+). Telegram routing is business-only; never route a
Telegram record into a personal workspace.
