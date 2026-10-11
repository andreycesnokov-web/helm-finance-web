# Spec — Telegram Bot as a Locked/Premium Business Integration

Status: **SPEC ONLY.** No code, no migrations, no flags. Business-level entitlement.
Builds on [saas-identity-architecture.md](saas-identity-architecture.md) (Telegram =
linked paid channel) and [telegram-company-routing.md](telegram-company-routing.md)
(per-user active business). Email stays the primary registration; Telegram is an
optional **paid business integration**.

## Two-layer gate (access + usage)
1. **Access (entitlement)** — business-level: an active `business_addons` row with
   `addon = 'telegram_bot_channel'`. Free plan = no add-on → **locked**.
2. **Usage (limits)** — `plan_limits` caps per business plan (connected users + monthly
   action limits). Enforced on every bot write.

Both are checked **per business**, never per user and never globally for the bot.

## Plan matrix
| Plan      | telegram_bot_channel add-on | connected TG users | monthly bot actions |
|-----------|-----------------------------|--------------------|---------------------|
| Free      | locked (cannot enable)      | 0                  | 0                   |
| Tier 1    | available                   | 1–2                | limited (e.g. N)    |
| Higher    | available                   | more               | higher / unlimited  |

Exact numbers live in `plan_limits` (NULL = unlimited), so pricing can change without
code edits.

## Schema (additive; apply later under the gated process)
- Entitlement reuses the existing `business_addons` table (migration 020):
  `addon = 'telegram_bot_channel'`, `status IN (active|trialing|suspended|cancelled)`.
- Additive `plan_limits` columns (NULL = unlimited, 0 = blocked):
```
ALTER TABLE plan_limits
  ADD COLUMN IF NOT EXISTS max_telegram_users                    INT NULL,
  ADD COLUMN IF NOT EXISTS max_telegram_records_per_month        INT NULL,
  ADD COLUMN IF NOT EXISTS max_telegram_receipt_parses_per_month INT NULL,
  ADD COLUMN IF NOT EXISTS max_telegram_approval_actions_per_month INT NULL;
-- Free plan row: all four = 0. Tier1: e.g. users=2, records=200, parses=100, approvals=200.
```
- Usage counting needs a per-row channel marker. Existing rows already carry
  `last_action_channel` / `approved_via_channel`; for accurate "created via Telegram"
  counts, confirm/add a `created_via_channel` marker (additive) on financial rows
  (transactions/debts) set to `'telegram'` on bot creation. Counts are
  `business_id = active AND created_via_channel='telegram' AND created_at >= month_start`.

## Bot write gate (order — fail closed; never write when locked/over limit)
1. Resolve linked app user (`user_telegram_links`); else `telegram_not_linked`.
2. Resolve active business (routing spec); if ambiguous → `company_selection_required`.
3. **Entitlement**: business has active `telegram_bot_channel`? else
   `{ error: 'telegram_addon_required', upgrade_required: true }`.
4. **Connected-users limit**: distinct active `user_telegram_links` among the business's
   active members ≤ `max_telegram_users`; else `telegram_user_limit_reached`.
5. **Usage limit**: monthly telegram-created count < the relevant
   `max_telegram_*_per_month`; else `{ error: 'telegram_limit_reached', limit, usage }`.
6. Only then create the record with the resolved `business_id`.

Read-only bot commands (e.g. `/company`, balance view) are allowed without consuming
usage, but still require the entitlement to act/write.

## UI — Business Settings → Integrations → Telegram Bot
- **Free**: a **locked card** describing what the bot does (capture expenses, receipts,
  approvals from Telegram) + **"Upgrade plan"** CTA. No enable/connect controls.
- **Paid**: enable/connect flow (the linking flow from the identity spec) and a usage
  panel:
  - `Connected users: used / allowed`
  - `Monthly bot actions: used / allowed` (and per-type if surfaced)
- Visibility uses the existing `integrations_enabled` plan flag for the section; the
  Telegram card itself is gated by the `telegram_bot_channel` add-on.

## Bot behavior summary
- No entitlement → `telegram_addon_required` / `upgrade_required` (no write).
- Over limit → `telegram_limit_reached` (no write).
- Locked (Free) → bot explains it's a paid feature and links to upgrade; never writes.
- Always business-scoped; `business_id` non-null on every created record.

## API surface (proposed; for the web Integrations screen)
- `GET /api/business/integrations/telegram` → `{ entitled, plan, limits:
  { max_telegram_users, max_*_per_month }, usage: { connected_users, actions_this_month },
  locked: !entitled }`.
- Enable/connect reuse the identity spec's linking flow + the existing add-on grant path.

## Tests required before enablement
1. Free plan: Telegram card is locked; enable/connect blocked; bot writes rejected with
   `telegram_addon_required`.
2. Tier 1: add-on active → bot can create records; connected-user cap (1–2) enforced
   (3rd link → `telegram_user_limit_reached`).
3. Monthly action cap enforced → `telegram_limit_reached`; no record written over cap.
4. Higher tier: larger caps apply (NULL = unlimited).
5. Revoked/suspended add-on → bot writes blocked immediately (web unaffected).
6. Entitlement is per business (Business A entitled, Business B not → bot writes allowed
   only for A).
7. Every Telegram-created record has a non-null `business_id` and a Telegram channel marker.
8. Email-primary unaffected: an email user with no Telegram still uses the web app fully.

## Out of scope
Personal Workspace (gated). Financial isolation/reset already shipped. This spec only
adds entitlement + usage gating for the Telegram channel.
