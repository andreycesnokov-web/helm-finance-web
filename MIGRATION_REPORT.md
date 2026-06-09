# Helm Finance — Migration Report

**Migration:** 001_group_e_additive  
**Date:** 2026-06-09  
**Executed by:** Andrey (Supabase Dashboard SQL Editor)  
**Verified by:** Automated live DB probes via Supabase JS client  
**Status:** ✅ COMPLETE — all verifications passed

---

## Migration Scope

Group E — additive schema changes required to unblock transaction writes in both
the Telegram Bot and the Web App after Groups A and B were implemented.

**Type:** Additive only. No columns dropped. No data modified. No tables altered destructively.

---

## SQL Executed

```sql
-- migrations/001_group_e_additive.sql

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL;
```

Both statements used `IF NOT EXISTS` — safe to re-run without side effects.

---

## Pre-Migration State

| Column | Table | Status before migration |
|--------|-------|------------------------|
| `category` | `transactions` | ❌ Did not exist |
| `snoozed_until` | `reminders` | ❌ Did not exist |
| `category_id` | `transactions` | ✅ Existed (legacy, retained) |
| `account_id` | `transactions` | ✅ Existed (legacy, retained) |

**Row counts before migration:**

| Table | Rows |
|-------|------|
| `transactions` | 14 |
| `reminders` | 0 |
| `debts` | 1 |
| `users` | 1 |

---

## Post-Migration Verification

All checks executed against live Supabase project via read-only probes and
controlled insert+delete tests. No production data was modified net.

### Column existence

| Column | Table | Result |
|--------|-------|--------|
| `category` | `transactions` | ✅ EXISTS |
| `snoozed_until` | `reminders` | ✅ EXISTS |
| `category_id` | `transactions` | ✅ EXISTS — not dropped |
| `account_id` | `transactions` | ✅ EXISTS — not dropped |

### Existing data integrity

| Check | Result |
|-------|--------|
| Transaction row count after migration | 14 ✅ — unchanged |
| Existing rows readable (id, type, source, scope, category) | ✅ — all fields return |
| `category` value on pre-migration rows | `NULL` ✅ — expected default |
| No rows corrupted or lost | ✅ confirmed |

### Insert tests — Telegram Bot (bot.js saveall shape)

**Test 1 — Scenario 1: BCA / Helm Care / бензин**

```javascript
// Insert payload
{
  user_id: 1057134807, type: 'expense',
  amount_original: 300000, currency_original: 'IDR', amount_idr: 300000,
  description: 'Бензин [TEST]',
  source: 'BCA', scope: 'business', project: 'Helm Care', category: 'Транспорт'
}
// Result
id=15  source=BCA  scope=business  project=Helm Care  category=Транспорт
amount_idr=300000  currency_original=IDR
```

**Status: ✅ PASS** — all 9 fields written correctly, including `category`.

**Test 2 — Scenario 2: Permata income**

```javascript
// Insert payload
{
  user_id: 1057134807, type: 'income',
  amount_original: 5000000, currency_original: 'IDR', amount_idr: 5000000,
  description: 'Оплата от клиента [TEST]',
  source: 'Permata', scope: 'business', project: null, category: 'Доход от клиента'
}
// Result
id=16  source=Permata  scope=business  category=Доход от клиента
amount_idr=5000000
```

**Status: ✅ PASS**

### Insert test — Web App (server/index.js batch shape)

**Test 3 — Scenario 3: Coffee cash**

```javascript
// Insert payload (batch array, 1 item)
{
  user_id: 1057134807, type: 'expense',
  amount_original: 35000, currency_original: 'IDR', amount_idr: 35000,
  description: 'Кофе [TEST]',
  source: 'Наличные', scope: 'personal', project: null, category: 'Еда и напитки'
}
// Result
id=17  source=Наличные  scope=personal  category=Еда и напитки
```

**Status: ✅ PASS**

### Cleanup verification

All 3 test rows (ids 15, 16, 17) were deleted after verification.  
Transaction count after cleanup: **14** — matches pre-test count. ✅

---

## Page Query Verification

Queries used by each page were simulated against the live DB to confirm
the migration did not break anything.

### Pulse page

| Query | Result |
|-------|--------|
| `transactions.select('*').eq('user_id',…)` | ✅ 14 rows returned |
| `transactions.select('*').eq('user_id',…).gte('created_at', monthStart)` | ✅ 14 rows returned |
| `debts.select('*').eq('user_id',…).eq('is_settled', false)` | ✅ 1 debt returned |
| `reminders.select('*').eq('user_id',…).eq('is_done', false)` | ✅ 0 rows (empty table) |
| Virtual account derivation (6 accounts) | ✅ Correct |

**Live balance snapshot (read-only, for reference):**

| Metric | Value |
|--------|-------|
| Total income | 17,422,000 IDR |
| Total expenses | 38,347,000 IDR |
| Net balance | -20,925,000 IDR |
| Virtual accounts | 6 |

### Accounts page

| Query | Result |
|-------|--------|
| Transactions with `source` set | 12 of 14 ✅ |
| Transactions with `source = null` | 2 (fall into default bucket) |
| Virtual accounts derived from source | 6 accounts ✅ |

### Radar page

| Query | Result |
|-------|--------|
| `transactions.select('id,description,category,scope')` | ✅ Returns — `category` field readable |
| Existing rows show `category = null` | ✅ Expected for pre-migration data |

---

## Schema State After Migration

### transactions

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | — | NO | PK |
| user_id | bigint | NO | FK → users.id |
| type | text | — | 'income' / 'expense' |
| amount_original | numeric | — | |
| currency_original | text | — | |
| amount_idr | numeric | — | |
| description | text | — | |
| source | text | YES | Virtual account name |
| scope | text | YES | 'personal' / 'business' |
| project | text | YES | |
| **category** | **text** | **YES** | **✅ NEW — added this migration** |
| category_id | — | YES | Legacy, retained |
| account_id | — | YES | Legacy, retained |
| created_at | timestamptz | — | |

### reminders

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | — | NO | PK |
| user_id | bigint | NO | FK → users.id |
| title | text | — | |
| due_date | timestamptz | — | |
| is_done | boolean | — | |
| **snoozed_until** | **timestamptz** | **YES** | **✅ NEW — added this migration** |
| created_at | timestamptz | — | |

---

## Deferred Changes (not executed — awaiting approval)

```sql
-- DO NOT RUN — awaiting explicit approval
-- ALTER TABLE transactions DROP COLUMN IF EXISTS category_id;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS account_id;
```

These columns are unused by the application. They are harmless to keep.
Dropping requires confirming no external tools or scripts reference them.

---

## Impact on Code

| File | Status |
|------|--------|
| `server/index.js` — POST /api/transactions/batch | ✅ Now writes `category` successfully |
| `Fin Bot/src/bot.js` — saveall callback | ✅ Now writes `category` successfully |
| `server/index.js` — POST /api/accounts/adjust | ⚠️ Does not write `category` — intentional (auto-generated row) |
| `server/index.js` — GET /api/pulse | ✅ No change needed — reads `select('*')` |
| `server/index.js` — GET /api/transactions | ✅ No change needed — reads `select('*')` |

---

## Next Steps

| Group | Status | Notes |
|-------|--------|-------|
| A — Parser unification | ✅ Done | Deployed in this worktree |
| B — Transaction write alignment | ✅ Done | `category` now writes to DB |
| D — Bot getTransactions fix | ✅ Done | `select('*')` no join |
| **E — Schema migration** | ✅ **Done** | This report |
| C — Auto-generated tx hygiene | ⏳ Pending approval | Requires Group E ✅ |
| F — Snooze endpoint + form fixes | ⏳ Pending approval | Requires snoozed_until ✅ |
| G — Source normalization | ⏳ Pending approval | Reduces virtual account fragmentation |
