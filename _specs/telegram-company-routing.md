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

## 2. Routing rules (refined — single resolver, applied on every Telegram action)
Resolve(`telegram_id`) →
1. **0 businesses** → `none` (nothing to route; bot tells the user to get access).
2. **1 business** → `auto`: route there and persist it as active (no prompt).
3. **2+, no valid active selection** → `choose`: return the list; do NOT guess/default.
4. **Valid active selection** (stored id still an active member + `type='business'`) →
   `active`: route there.
5. **Invalid/inactive active selection** (membership revoked, status≠active, business
   deleted, or became personal) → **clear it** (`active_business_id = NULL`) and
   re-resolve from step 1 (→ `auto` if now 1, else `choose`).
6. **Never silently default** when 2+ businesses exist and none is validly selected.
7. Switching via `/company` overwrites the active selection (after a membership check).
Every Telegram-created financial record MUST carry `business_id` = the resolved active
business; a write is refused if resolution is not exactly one business.

## 1. Storage (refined)
Active Telegram business is stored **per user, per channel** in a dedicated table —
NOT in `users` (avoid widening the core row) and NOT in `user_workspace_preferences`.
```
CREATE TABLE IF NOT EXISTS telegram_user_state (
  user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_business_id UUID   NULL REFERENCES businesses(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ DEFAULT now()
);
```
- `ON DELETE SET NULL`: deleting the active business cleanly drops the selection →
  next bot action re-resolves per the rules. Additive; independent of 037–039/040.

### Relationship to `user_workspace_preferences`
They are **separate on purpose** and must not be coupled:
- `user_workspace_preferences` (migration **037**, **gated/not applied**) is **web**
  workspace UI state — `primary_personal_workspace_id`, `default_business_workspace_id`,
  `last_active_workspace_id`. It is personal-workspace-aware and tied to the web shell.
- `telegram_user_state` is the **Telegram channel's** selected business and must work
  **now**, with zero dependency on 037. A user may legitimately have the web pointed at
  Business A while Telegram is set to Business B.
- Do NOT read/write `user_workspace_preferences` from the Telegram path (it may not
  exist in prod). No fallback coupling. If we later want "Telegram inherits the web
  default," that's an explicit, separately-approved enhancement — not the default.

## 3. Bot UX (separate bot app)
- **`/company`** → bot calls `GET /api/telegram/active-business`. Renders an **inline
  keyboard**, one button per accessible business: `«<name> · <business_code>»`, callback
  data = business id. The currently-active one is marked (e.g. ✅ prefix).
- **Tap a button** → bot calls `POST /api/telegram/active-business`; on success replies:
  `✅ Active company: <name> (<business_code>). New entries will be saved here.`
- **Ambiguous create** (user sends an expense/income with 2+ businesses, none active) →
  bot does NOT create the record; it replies `Which company is this for?` + the same
  inline keyboard, then retries the create after selection.
- **Every created record confirms the target**: `Saved to <name> (<business_code>).`
- **0 businesses** → `You don't have access to a company yet.`

## 4. Backend contract (this repo; bot-secret authed like existing /api/telegram/*)
`GET /api/telegram/active-business?telegram_id=<id>` → resolves per §2:
```
200 { "status": "none" }
200 { "status": "auto",   "business": { "id","name","business_code","role" } }
200 { "status": "active", "business": { "id","name","business_code","role" } }
200 { "status": "choose", "options": [ { "id","name","business_code","role" }, ... ] }
```
(For `auto`, the resolved id is persisted so subsequent calls return `active`.)

`POST /api/telegram/active-business { telegram_id, business_id }` → set active (backs
the `/company` button tap):
```
200 { "ok": true, "business": { "id","name","business_code","role" } }
403 { "error": "not_a_member" }                 // no active membership in business_id
400 { "error": "business_workspace_required" }  // business_id is a personal workspace
404 { "error": "business_not_found" }
```
**Telegram WRITE endpoints** (record creation) resolve the active business server-side
and stamp `business_id`. If resolution is not exactly one business:
```
409 { "error": "company_selection_required", "options": [ {id,name,business_code}, ... ] }
```
The bot maps `company_selection_required` to the inline-keyboard prompt. A write is
NEVER persisted with a null/guessed `business_id`.

## 5. Safety
- Every Telegram-created financial row has a **non-null `business_id`** = the resolved
  active business. No `business_id IS NULL` from Telegram.
- `business_id` is always **server-resolved**; a bot-supplied id is honored only after a
  membership check (`business_members`, status active, `type='business'`).
- User must be an **active member** of the selected business; personal workspaces are
  **ignored** by Telegram routing until Personal Workspace is enabled (and even then,
  Telegram stays business-only).
- Per-user state only; never global to the bot. Bot secret (`requireBotSecret`) required
  on all these endpoints.

## 6. Tests required before enablement
1. One business → `auto`; a new record gets that `business_id`.
2. 2+ businesses, no selection → write blocked with `company_selection_required`
   (NO record written); `GET` returns `choose`.
3. Selection persists per Telegram user across calls (`active`).
4. Switching company (`POST`) changes the target for subsequent records.
5. Per-user isolation: user A's selection never affects user B.
6. Inactive/invalid selected business (revoked membership / deleted / personal) →
   cleared and re-resolved (`auto` or `choose`); never routes to the stale id.
7. Non-member `telegram_id` for a `business_id` → `not_a_member` (403).
8. Telegram-created records are NEVER `business_id IS NULL`.

## Cross-repo split
- **This repo**: `telegram_user_state` migration + the active-business endpoints +
  ensure all Telegram write paths stamp `business_id` from the resolved active business.
- **Bot app (separate)**: `/company` command UX (list + pick), prompt-on-ambiguous,
  and call the endpoints above before creating any financial record.

## Out of scope
Personal workspaces (gated, 037+). Telegram routing is business-only; never route a
Telegram record into a personal workspace.
