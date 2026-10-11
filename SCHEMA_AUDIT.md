# Helm Finance — Schema Audit

**Date:** 2026-06-09  
**Project:** cbsbnzttkndlgdpjxcxe.supabase.co  
**Method:** Live read-only column probes via Supabase JS client (SELECT per column, LIMIT 1)  
**Secrets:** Not printed. Credentials used only for connection, not stored here.  
**Migration status:** ✅ COMPLETE — `migrations/001_group_e_additive.sql` executed 2026-06-09

---

## Audit Summary

| Finding | Count |
|---------|-------|
| Tables confirmed existing | 6 |
| Tables missing (Phase 2) | 2 |
| Columns confirmed existing | 38 |
| Columns confirmed missing | 8 |
| Migrations executed (additive) | 2 |
| Migrations verified post-execution | 2 |
| Destructive changes recommended | 0 (deferred, awaiting approval) |

---

## Table Inventory

| Table | Exists | Row count | Notes |
|-------|--------|-----------|-------|
| `transactions` | ✅ | 14 | Main data table |
| `reminders` | ✅ | 0 | No data yet |
| `debts` | ✅ | 1 | One debt record |
| `users` | ✅ | 1 | One registered user |
| `accounts` | ✅ | 0 | Empty — virtual accounts used instead |
| `categories` | ✅ | 7 | Seeded defaults |
| `employees` | ❌ | — | Phase 2 — not yet created |
| `payroll` | ❌ | — | Phase 2 — not yet created |

---

## transactions — Column Audit

| Column | Status | Data type (inferred) | Notes |
|--------|--------|----------------------|-------|
| `id` | ✅ EXISTS | uuid / bigint | PK |
| `user_id` | ✅ EXISTS | bigint | FK → users.id |
| `type` | ✅ EXISTS | text | 'income' or 'expense' |
| `amount_original` | ✅ EXISTS | numeric | Original amount in source currency |
| `currency_original` | ✅ EXISTS | text | e.g. 'IDR', 'USD' |
| `amount_idr` | ✅ EXISTS | numeric | Converted IDR amount |
| `description` | ✅ EXISTS | text | Transaction description |
| `source` | ✅ EXISTS | text | Virtual account name |
| `scope` | ✅ EXISTS | text | 'personal' or 'business' |
| `project` | ✅ EXISTS | text | Project name, nullable |
| `created_at` | ✅ EXISTS | timestamptz | Auto-set by Supabase |
| `category_id` | ✅ EXISTS | uuid / int | Legacy FK → categories.id (unused) |
| `account_id` | ✅ EXISTS | uuid | Legacy FK → accounts.id (unused) |
| `category` | ❌ **MISSING** | — | **Required — Group E migration** |

**Migration executed ✅:** `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL`  
**Post-migration verification:** Column exists, all 14 pre-existing rows have `category = NULL` (expected), new inserts with `category` populated succeed.

---

## reminders — Column Audit

| Column | Status | Data type (inferred) | Notes |
|--------|--------|----------------------|-------|
| `id` | ✅ EXISTS | uuid / bigint | PK |
| `user_id` | ✅ EXISTS | bigint | FK → users.id |
| `title` | ✅ EXISTS | text | Reminder title |
| `due_date` | ✅ EXISTS | timestamptz | When due |
| `is_done` | ✅ EXISTS | boolean | Completion flag |
| `created_at` | ✅ EXISTS | timestamptz | Auto-set |
| `description` | ❌ MISSING | — | Not used by current code — no action needed |
| `snoozed_until` | ❌ **MISSING** | — | **Required — Group E migration** |
| `body` | ❌ MISSING | — | Not used by current code |
| `note` | ❌ MISSING | — | Not used by current code |
| `repeat` | ❌ MISSING | — | Not used by current code |
| `type` | ❌ MISSING | — | Not used by current code |
| `category` | ❌ MISSING | — | Not used by current code |

**Migration executed ✅:** `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL`  
**Post-migration verification:** Column exists. Table has 0 rows — no backfill needed.

---

## debts — Column Audit

| Column | Status | Notes |
|--------|--------|-------|
| `id` | ✅ EXISTS | |
| `user_id` | ✅ EXISTS | |
| `type` | ✅ EXISTS | 'payable' or 'receivable' |
| `counterparty` | ✅ EXISTS | |
| `description` | ✅ EXISTS | Used as notes field |
| `amount` | ✅ EXISTS | |
| `currency` | ✅ EXISTS | |
| `due_date` | ✅ EXISTS | |
| `scope` | ✅ EXISTS | |
| `is_settled` | ✅ EXISTS | |
| `settled_at` | ✅ EXISTS | |
| `created_at` | ✅ EXISTS | |
| `notes` | ❌ MISSING | Not used by current code — `description` used instead |

**No migration needed.** The `description` column serves the notes purpose.

---

## users — Column Audit

| Column | Status | Notes |
|--------|--------|-------|
| `id` | ✅ EXISTS | Telegram user ID (bigint) |
| `username` | ✅ EXISTS | |
| `first_name` | ✅ EXISTS | |
| `last_name` | ✅ EXISTS | |
| `role` | ✅ EXISTS | |
| `default_currency` | ✅ EXISTS | |
| `photo_url` | ✅ EXISTS | Base64 JPEG (see SECURITY_FIX_PLAN.md Issue 6) |
| `language` | ✅ EXISTS | |
| `timezone` | ✅ EXISTS | |
| `created_at` | ✅ EXISTS | |

**No migration needed.**

---

## accounts — Column Audit

| Column | Status | Notes |
|--------|--------|-------|
| `id` | ✅ EXISTS | |
| `user_id` | ✅ EXISTS | |
| `name` | ✅ EXISTS | |
| `type` | ✅ EXISTS | |
| `balance` | ✅ EXISTS | |
| `currency` | ✅ EXISTS | |
| `is_active` | ✅ EXISTS | |
| `created_at` | ✅ EXISTS | |

**No migration needed.** Table is empty (0 rows). Virtual account derivation from
`transactions.source` is the active mechanism. Physical accounts table is unused.

---

## categories — Column Audit

| Column | Status | Notes |
|--------|--------|-------|
| `id` | ✅ EXISTS | |
| `user_id` | ✅ EXISTS | |
| `name` | ✅ EXISTS | |
| `type` | ✅ EXISTS | |
| `emoji` | ✅ EXISTS | |
| `is_default` | ✅ EXISTS | |

**7 rows — seeded defaults present.**  
`transactions.category_id` references this table but is always null in practice.  
Category is now handled via the new `transactions.category TEXT` field (Group E).

---

## Required Migrations — Group E

### Migration 1: transactions.category

```sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;
```

- **Type:** Additive. No existing data affected.
- **Default:** NULL. All 14 existing rows will have `category = NULL`.
- **Reversible:** Yes — `DROP COLUMN category` if needed.
- **Risk:** None.

### Migration 2: reminders.snoozed_until

```sql
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL;
```

- **Type:** Additive. No existing data affected.
- **Default:** NULL. All 0 existing rows unaffected.
- **Reversible:** Yes.
- **Risk:** None.

### Deferred (do not run yet): destructive cleanup

The following are documented but NOT to be executed until explicitly approved:

```sql
-- DO NOT RUN — deferred until approval
-- ALTER TABLE transactions DROP COLUMN IF EXISTS category_id;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS account_id;
```

These columns are unused by the application but are harmless to keep.
Dropping them requires verifying no external integrations reference them.

---

## Execution — Completed 2026-06-09

DDL executed by user via Supabase Dashboard → SQL Editor.

| Method used | Status |
|-------------|--------|
| Supabase Dashboard SQL Editor | ✅ Executed by user |

---

## Post-Migration Verification Results

All checks passed. Executed via live Supabase JS client probes.

| Check | Result |
|-------|--------|
| `transactions.category` column exists | ✅ PASS |
| `transactions.category_id` still exists | ✅ PASS — not dropped |
| `transactions.account_id` still exists | ✅ PASS — not dropped |
| `reminders.snoozed_until` column exists | ✅ PASS |
| Existing 14 transaction rows intact | ✅ PASS — count unchanged |
| Bot insert (source, category, scope, project) | ✅ PASS — id=15 created and cleaned up |
| Web batch insert (source, category, scope) | ✅ PASS — id=17 created and cleaned up |
| All Pulse page queries execute without error | ✅ PASS |
| All Accounts page queries execute without error | ✅ PASS |
| All Radar page queries execute without error | ✅ PASS |

**Live DB state:**
- 14 transactions (all pre-migration rows have `category = NULL` — expected)
- 6 virtual accounts derived from `transactions.source`
- 12 of 14 transactions have `source` set
- 2 transactions have `source = null` → fall into default bucket in Pulse
