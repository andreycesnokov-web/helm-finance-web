# Helm Finance — Data Contract

Date: 2026-06-09
Status: CANONICAL — all systems must conform to this document
Scope: Telegram Bot, Web App (Express server + React client), Supabase schema, AI Parser output

---

## Governing Rules

1. Both the Telegram Bot and the Web App must write the same field names and value enums.
2. AI parsers in both systems must return the same output schema.
3. Any field marked **required** must never be null or undefined in any INSERT.
4. Any field marked **optional** may be null; consumers must handle null gracefully.
5. Enums are exhaustive. Any value outside the listed set is invalid.
6. All monetary amounts are stored as `DECIMAL(18,2)` in IDR unless explicitly noted.
7. All timestamps are stored as `TIMESTAMPTZ` in UTC.
8. The Telegram numeric user ID is the universal user identity key across all systems.

---

## 1. Transaction Schema

This is the most critical shared schema. Every financial event — whether entered
via Telegram, the web app, or created as a side-effect of paying a debt or
adjusting an account — must conform to this shape.

### Database Table: `transactions`

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id                SERIAL PRIMARY KEY,
  user_id           BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT         NOT NULL CHECK (type IN ('income', 'expense')),
  amount_original   DECIMAL(18,2) NOT NULL CHECK (amount_original > 0),
  currency_original TEXT         NOT NULL DEFAULT 'IDR',
  amount_idr        DECIMAL(18,2) NOT NULL,         -- always required, not null
  description       TEXT         NOT NULL,
  source            TEXT         DEFAULT NULL,      -- account / wallet name
  scope             TEXT         NOT NULL DEFAULT 'personal'
                                 CHECK (scope IN ('personal', 'business')),
  project           TEXT         DEFAULT NULL,
  category          TEXT         DEFAULT NULL,      -- human label, no FK
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Fields

| Field | Type | Required | Allowed values | Notes |
|-------|------|----------|---------------|-------|
| `id` | integer | auto | — | Set by DB |
| `user_id` | bigint | ✅ | Telegram numeric ID | Never null |
| `type` | text | ✅ | `"income"` \| `"expense"` | |
| `amount_original` | decimal | ✅ | positive number | Original currency amount |
| `currency_original` | text | ✅ | ISO 4217 code | `"IDR"`, `"USD"`, `"RUB"`, etc. |
| `amount_idr` | decimal | ✅ | positive number | Convert before saving; use `amount_original` if currency is IDR |
| `description` | text | ✅ | non-empty string | AI-generated or user-provided |
| `source` | text | optional | any string \| null | Account/wallet name. e.g. `"Permata Personal"`, `"Helm Care Pay"` |
| `scope` | text | ✅ | `"personal"` \| `"business"` | Default: `"personal"` |
| `project` | text | optional | any string \| null | e.g. `"Helm Care"`, `"Spa Factory"` |
| `category` | text | optional | any string \| null | e.g. `"Еда"`, `"Transport"`, `"Salary"` |
| `created_at` | timestamptz | auto | UTC | Set by DB |

### Removed / Deprecated Columns

| Column | Status | Reason |
|--------|--------|--------|
| `account_id` | REMOVED | Physical accounts table is unused; virtual accounts derived from `source` |
| `category_id` | REMOVED | FK to categories table never populated; replaced by `category` text field |

### Valid Example (bot-entered expense)

```json
{
  "user_id": 123456789,
  "type": "expense",
  "amount_original": 250000,
  "currency_original": "IDR",
  "amount_idr": 250000,
  "description": "Еда",
  "source": "Permata Personal",
  "scope": "personal",
  "project": null,
  "category": "Еда"
}
```

### Valid Example (web-entered income, foreign currency)

```json
{
  "user_id": 123456789,
  "type": "income",
  "amount_original": 1000,
  "currency_original": "USD",
  "amount_idr": 16200000,
  "description": "Client payment — Spa Factory website",
  "source": "Wise USD",
  "scope": "business",
  "project": "Spa Factory",
  "category": "Revenue"
}
```

### Auto-generated Transactions (side-effects)

When the system creates transactions as side-effects, these descriptions and
fields must follow these exact conventions:

| Trigger | `type` | `description` format | `source` |
|---------|--------|---------------------|---------|
| Account created with balance | `income` | `"Opening balance · {accountName}"` | `accountName` |
| Balance adjustment | `income`/`expense` | `"Balance adjustment · {accountName}"` | `accountName` |
| Debt paid / received | `expense`/`income` | `"Payment: {counterparty}"` | user-selected account |

---

## 2. Account Schema

Accounts in Helm Finance are **virtual** — derived at query time from
`transactions.source`. There is no physical accounts table in active use.

### Derived Account Object (API response shape)

```typescript
{
  id:      string,   // same as name (used as React key)
  name:    string,   // the source value from transactions
  balance: number,   // sum(income amounts) - sum(expense amounts) for this source
  type:    "personal" | "business"
}
```

### Rules for Virtual Account Derivation

```
For each transaction where source IS NOT NULL:
  account.id       = transaction.source
  account.name     = transaction.source
  account.type     = most recent transaction.scope for this source
  account.balance += amount_original  (if type === "income")
  account.balance -= amount_original  (if type === "expense")

Accounts with balance === 0 are included (show all accounts).
Sorted by balance descending.
Limit 10 accounts shown (configurable, not hardcoded).
```

### Account Name Conventions

Account names should follow natural language conventions. Examples:
- `"Permata Personal"` — Indonesian bank, personal
- `"BCA Business"` — Indonesian bank, business
- `"Helm Care Pay"` — business operating account
- `"Wise USD"` — foreign currency wallet
- `"Cash IDR"` — physical cash

Account names must be consistent across all systems. The bot parser must be
trained to extract the same name strings the user has established.

### Manual Account Creation

When a user manually creates an account via the web app:

```json
{
  "name": "Permata Personal",
  "type": "personal",
  "balance": 5000000
}
```

This creates an `Opening balance · Permata Personal` income transaction with
`source = "Permata Personal"`.

---

## 3. Payable Schema (Debts owed by user)

### Database Table: `debts`

```sql
CREATE TABLE IF NOT EXISTS debts (
  id            SERIAL PRIMARY KEY,
  user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT         NOT NULL CHECK (type IN ('payable', 'receivable')),
  counterparty  TEXT         NOT NULL,
  description   TEXT         DEFAULT NULL,
  amount        DECIMAL(18,2) NOT NULL CHECK (amount >= 0),
  currency      TEXT         NOT NULL DEFAULT 'IDR',
  due_date      TIMESTAMPTZ  DEFAULT NULL,
  scope         TEXT         NOT NULL DEFAULT 'personal'
                             CHECK (scope IN ('personal', 'business')),
  is_settled    BOOLEAN      NOT NULL DEFAULT FALSE,
  settled_at    TIMESTAMPTZ  DEFAULT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Payable Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | integer | auto | |
| `user_id` | bigint | ✅ | |
| `type` | text | ✅ | Must be `"payable"` for debts owed by user |
| `counterparty` | text | ✅ | Person or company user owes |
| `description` | text | optional | What the debt is for |
| `amount` | decimal | ✅ | Remaining unpaid amount (decremented on partial payment) |
| `currency` | text | ✅ | Default: `"IDR"` |
| `due_date` | timestamptz | optional | When payment is due |
| `scope` | text | ✅ | `"personal"` \| `"business"` |
| `is_settled` | boolean | ✅ | `false` by default; `true` when fully paid |
| `settled_at` | timestamptz | optional | Set when `is_settled` becomes `true` |

### Valid Example

```json
{
  "user_id": 123456789,
  "type": "payable",
  "counterparty": "Spa Factory Bali",
  "description": "Disinfectant order #12",
  "amount": 3500000,
  "currency": "IDR",
  "due_date": "2026-06-20T00:00:00Z",
  "scope": "business",
  "is_settled": false
}
```

### Payment Behavior

When a payable is paid:
1. A `type: "expense"` transaction is created with `description: "Payment: {counterparty}"`
2. If `paidAmount >= amount`: set `is_settled = true`, `settled_at = now()`
3. If `paidAmount < amount`: set `amount = amount - paidAmount` (partial payment)

---

## 4. Receivable Schema (Debts owed to user)

Receivables use the **same `debts` table** as payables, distinguished by `type`.

### Receivable Fields

Identical to payable schema above, with:

| Field | Required value |
|-------|---------------|
| `type` | `"receivable"` |

### Valid Example

```json
{
  "user_id": 123456789,
  "type": "receivable",
  "counterparty": "Client Ivan Petrov",
  "description": "Website project payment, Invoice #004",
  "amount": 15000000,
  "currency": "IDR",
  "due_date": "2026-06-15T00:00:00Z",
  "scope": "business",
  "is_settled": false
}
```

### Mark Received Behavior

When a receivable is marked as received:
1. A `type: "income"` transaction is created with `description: "Payment: {counterparty}"`
2. If `receivedAmount >= amount`: set `is_settled = true`, `settled_at = now()`
3. If `receivedAmount < amount`: set `amount = amount - receivedAmount` (partial)

---

## 5. Employee Schema

Employees do not yet have a database table. This is the canonical schema for
when the table is created (Roadmap Phase 2).

### Database Table: `employees` (to be created)

```sql
CREATE TABLE IF NOT EXISTS employees (
  id            SERIAL PRIMARY KEY,
  user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT         NOT NULL,
  role          TEXT         NOT NULL,
  salary_idr    DECIMAL(18,2) NOT NULL,
  pay_day       INT          NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
  scope         TEXT         NOT NULL DEFAULT 'business'
                             CHECK (scope IN ('personal', 'business')),
  project       TEXT         DEFAULT NULL,
  telegram_id   BIGINT       DEFAULT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  notes         TEXT         DEFAULT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Employee Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | integer | auto | |
| `user_id` | bigint | ✅ | Owner / employer (Telegram ID) |
| `name` | text | ✅ | Full name |
| `role` | text | ✅ | Job title, e.g. `"Manager"`, `"Therapist"` |
| `salary_idr` | decimal | ✅ | Monthly base salary in IDR |
| `pay_day` | integer | ✅ | Day of month salary is due (1–31) |
| `scope` | text | ✅ | `"business"` in most cases |
| `project` | text | optional | Which business/project they work for |
| `telegram_id` | bigint | optional | If employee also uses the bot |
| `is_active` | boolean | ✅ | Soft delete flag |
| `notes` | text | optional | Free-form notes |

### Valid Example

```json
{
  "user_id": 123456789,
  "name": "Dewi Kusuma",
  "role": "Head Therapist",
  "salary_idr": 8000000,
  "pay_day": 25,
  "scope": "business",
  "project": "Helm Care",
  "telegram_id": null,
  "is_active": true
}
```

---

## 6. Payroll Schema

Payroll records document each salary payment made to an employee.

### Database Table: `payroll` (to be created)

```sql
CREATE TABLE IF NOT EXISTS payroll (
  id              SERIAL PRIMARY KEY,
  user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id     INT          NOT NULL REFERENCES employees(id),
  period_month    INT          NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year     INT          NOT NULL,
  base_salary_idr DECIMAL(18,2) NOT NULL,
  bonus_idr       DECIMAL(18,2) NOT NULL DEFAULT 0,
  deduction_idr   DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_idr       DECIMAL(18,2) NOT NULL,     -- base + bonus - deduction
  source          TEXT         DEFAULT NULL,  -- paid from which account
  transaction_id  INT          REFERENCES transactions(id),
  is_paid         BOOLEAN      NOT NULL DEFAULT FALSE,
  paid_at         TIMESTAMPTZ  DEFAULT NULL,
  notes           TEXT         DEFAULT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Payroll Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | integer | auto | |
| `user_id` | bigint | ✅ | |
| `employee_id` | integer | ✅ | FK to employees |
| `period_month` | integer | ✅ | 1–12 |
| `period_year` | integer | ✅ | e.g. 2026 |
| `base_salary_idr` | decimal | ✅ | Base salary for the period |
| `bonus_idr` | decimal | ✅ | Default 0 |
| `deduction_idr` | decimal | ✅ | Default 0 |
| `total_idr` | decimal | ✅ | `base + bonus - deduction` |
| `source` | text | optional | Account paid from |
| `transaction_id` | integer | optional | Set after payment transaction is created |
| `is_paid` | boolean | ✅ | `false` until payment confirmed |
| `paid_at` | timestamptz | optional | Set when `is_paid = true` |

### Payroll → Transaction Link

When payroll is marked paid, a transaction is auto-created:

```json
{
  "type": "expense",
  "amount_original": 8000000,
  "currency_original": "IDR",
  "amount_idr": 8000000,
  "description": "Salary: Dewi Kusuma · May 2026",
  "source": "Helm Care Pay",
  "scope": "business",
  "project": "Helm Care",
  "category": "Payroll"
}
```

### Valid Payroll Record Example

```json
{
  "user_id": 123456789,
  "employee_id": 1,
  "period_month": 5,
  "period_year": 2026,
  "base_salary_idr": 8000000,
  "bonus_idr": 500000,
  "deduction_idr": 0,
  "total_idr": 8500000,
  "source": "Helm Care Pay",
  "transaction_id": null,
  "is_paid": false
}
```

---

## 7. Reminder Schema

### Database Table: `reminders`

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id              SERIAL PRIMARY KEY,
  user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT         NOT NULL,
  meta            TEXT         DEFAULT NULL,
  due_date        TIMESTAMPTZ  DEFAULT NULL,
  is_recurring    BOOLEAN      NOT NULL DEFAULT FALSE,
  recur_interval  TEXT         DEFAULT NULL
                               CHECK (recur_interval IN (
                                 'daily', 'weekly', 'biweekly', 'monthly', null
                               )),
  scope           TEXT         NOT NULL DEFAULT 'personal'
                               CHECK (scope IN ('personal', 'business')),
  is_done         BOOLEAN      NOT NULL DEFAULT FALSE,
  snoozed_until   TIMESTAMPTZ  DEFAULT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Reminder Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | integer | auto | |
| `user_id` | bigint | ✅ | |
| `title` | text | ✅ | What to remind |
| `meta` | text | optional | Extra context, e.g. `"every 2 weeks, IDR 2,500,000"` |
| `due_date` | timestamptz | optional | When to fire |
| `is_recurring` | boolean | ✅ | Default `false` |
| `recur_interval` | text | optional | `"daily"` \| `"weekly"` \| `"biweekly"` \| `"monthly"` \| null |
| `scope` | text | ✅ | `"personal"` \| `"business"` |
| `is_done` | boolean | ✅ | Completed flag |
| `snoozed_until` | timestamptz | optional | If snoozed, hide until this time |

### Snooze Behavior

When a reminder is snoozed:
- `snoozed_until` is set to `now() + snooze_duration`
- `is_done` stays `false`
- The reminder is hidden from UI while `now() < snoozed_until`
- After `snoozed_until` passes, the reminder reappears

### Valid Example

```json
{
  "user_id": 123456789,
  "title": "Check Gojek settlement",
  "meta": "Every 2 weeks, approx IDR 2,500,000",
  "due_date": "2026-06-15T09:00:00Z",
  "is_recurring": true,
  "recur_interval": "biweekly",
  "scope": "business",
  "is_done": false,
  "snoozed_until": null
}
```

---

## 8. AI Parser Output Schema

This is the canonical output contract for both the Telegram Bot parser and
the Web App parser. Both must return the same shape. The caller is responsible
for mapping to the transaction INSERT schema before saving.

### Canonical AI Output Array

```typescript
Array<{
  type:        "income" | "expense",       // required
  amount:      number,                      // required, positive
  currency:    string,                      // required, ISO 4217, default "IDR"
  description: string,                      // required, non-empty
  source:      string | null,               // optional, account name
  scope:       "personal" | "business",    // required, default "personal"
  project:     string | null,              // optional
  category:    string | null               // optional, human-readable label
}>
```

### Canonical AI Prompt (both systems must use this)

```
Ты финансовый ассистент. Найди ВСЕ транзакции в тексте.

Верни ТОЛЬКО JSON массив без markdown, без пояснений:
[
  {
    "type": "expense или income",
    "amount": число (положительное),
    "currency": "IDR" (по умолчанию) или другой ISO 4217,
    "description": "краткое описание на языке оригинала",
    "source": "название счёта/кошелька или null",
    "scope": "personal или business",
    "project": "название проекта или null",
    "category": "категория или null"
  }
]

Правила:
- Суммы всегда положительные. Тип (income/expense) определяет знак.
- Если счёт не указан явно — source: null.
- Если не ясен тип (личное/бизнес) — scope: "personal".
- Если нет проекта — project: null.
- Если нет категории — category: null.
- Описание: краткое, 2–5 слов.
- Валюта: IDR если не указана явно.

Текст: "{text}"
```

### Mapping: AI Output → Transaction INSERT

```javascript
// Convert AI parser output to a transaction row
function aiOutputToTransaction(parsed, userId, exchangeRates) {
  return {
    user_id:           userId,                              // required
    type:              parsed.type,                         // "income" | "expense"
    amount_original:   parsed.amount,                       // positive number
    currency_original: parsed.currency || 'IDR',
    amount_idr:        parsed.currency === 'IDR'            // always required
                         ? parsed.amount
                         : parsed.amount * (exchangeRates[parsed.currency] || 1),
    description:       parsed.description,
    source:            parsed.source || null,
    scope:             parsed.scope || 'personal',
    project:           parsed.project || null,
    category:          parsed.category || null,
  }
}
```

### Valid AI Parser Output Examples

**Input:** `"купил еды 250к и заправился 100к с Permata"`

```json
[
  {
    "type": "expense",
    "amount": 250000,
    "currency": "IDR",
    "description": "Еда",
    "source": "Permata Personal",
    "scope": "personal",
    "project": null,
    "category": "Еда"
  },
  {
    "type": "expense",
    "amount": 100000,
    "currency": "IDR",
    "description": "Бензин",
    "source": "Permata Personal",
    "scope": "personal",
    "project": null,
    "category": "Транспорт"
  }
]
```

**Input:** `"received 5M from client for Helm Care invoice"`

```json
[
  {
    "type": "income",
    "amount": 5000000,
    "currency": "IDR",
    "description": "Client invoice payment",
    "source": null,
    "scope": "business",
    "project": "Helm Care",
    "category": "Revenue"
  }
]
```

**Input:** `"paid Dewi salary 8 juta from BCA business account"`

```json
[
  {
    "type": "expense",
    "amount": 8000000,
    "currency": "IDR",
    "description": "Salary payment — Dewi",
    "source": "BCA Business",
    "scope": "business",
    "project": null,
    "category": "Payroll"
  }
]
```

### Error Handling Contract

| Failure mode | Required behavior |
|-------------|------------------|
| No transactions found | Throw error: `"No transactions found in text"` |
| Invalid JSON returned | Retry once; if still fails, throw |
| `amount` is negative | Flip sign, adjust `type` accordingly |
| `amount` is zero | Exclude from output |
| `type` is missing | Default to `"expense"` |
| `scope` is missing | Default to `"personal"` |
| `currency` is missing | Default to `"IDR"` |

---

## 9. User Schema

Included for completeness — this is the shared identity record.

### Database Table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id               BIGINT PRIMARY KEY,           -- Telegram numeric ID
  username         TEXT         DEFAULT NULL,
  first_name       TEXT         NOT NULL DEFAULT '',
  last_name        TEXT         DEFAULT NULL,
  photo_url        TEXT         DEFAULT NULL,
  language         TEXT         NOT NULL DEFAULT 'ru'
                                CHECK (language IN (
                                  'ru','en','id','zh','ar','es',
                                  'fr','de','pt','hi','ja','ko',
                                  'tr','vi','th'
                                )),
  timezone         TEXT         NOT NULL DEFAULT 'Asia/Makassar',
  role             TEXT         NOT NULL DEFAULT 'personal'
                                CHECK (role IN ('personal', 'business', 'admin')),
  default_currency TEXT         NOT NULL DEFAULT 'IDR',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Bot Write Shape

```javascript
// What the bot writes on every message
{
  id:         ctx.from.id,            // Telegram numeric ID — PK
  username:   ctx.from.username || '',
  first_name: ctx.from.first_name || '',
}
// NOT written by bot: last_name, photo_url, language, timezone, role
```

### Web Write Shape (on login)

```javascript
// What the web writes on Telegram Login
{
  id:         data.id,
  username:   data.username || '',
  first_name: data.first_name || '',
}
// NOT written on login: last_name, photo_url, language, timezone
// Written via /api/profile: first_name, last_name, photo_url, language, timezone
```

---

## 10. Cross-System Field Consistency Reference

Quick reference for fields that differ between current systems and what they
MUST become under this contract.

| Field | Bot (current) | Web (current) | Contract |
|-------|--------------|--------------|---------|
| `source` | ❌ not set | ✅ set | ✅ REQUIRED when identifiable |
| `category` | ✅ as `description` | ❌ not set | ✅ OPTIONAL, separate from `description` |
| `amount_idr` | ✅ set if IDR | ✅ set if IDR, null if USD | ✅ ALWAYS set (with exchange rate) |
| `scope` | ✅ set | ✅ set | ✅ REQUIRED, default `"personal"` |
| `project` | ✅ set | ✅ set | ✅ OPTIONAL |
| AI output `source` | ❌ not extracted | ✅ extracted | ✅ BOTH must extract |
| AI output `category` | ✅ as `category_name` | ❌ not extracted | ✅ BOTH must extract |

---

## 11. Enum Reference

All valid enum values across the system:

```
transaction.type       : "income" | "expense"
transaction.scope      : "personal" | "business"
debt.type              : "payable" | "receivable"
debt.scope             : "personal" | "business"
reminder.scope         : "personal" | "business"
reminder.recur_interval: "daily" | "weekly" | "biweekly" | "monthly" | null
employee.scope         : "personal" | "business"
user.role              : "personal" | "business" | "admin"
user.language          : "ru" | "en" | "id" | "zh" | "ar" | "es" |
                         "fr" | "de" | "pt" | "hi" | "ja" | "ko" |
                         "tr" | "vi" | "th"
```

---

## 12. Migration Required to Implement This Contract

The following database changes are needed to align the schema with this contract.
**No code changes yet** — this is planning only.

### Changes to `transactions` table

| Change | Type | Reason |
|--------|------|--------|
| Drop `account_id` column | ALTER TABLE DROP COLUMN | Unused; virtual accounts used instead |
| Drop `category_id` column | ALTER TABLE DROP COLUMN | FK never populated |
| Add `category TEXT DEFAULT NULL` | ALTER TABLE ADD COLUMN | New text-based category |
| Make `amount_idr NOT NULL` | ALTER TABLE ALTER COLUMN | Contract requires always-set |

### New tables to create

| Table | Phase |
|-------|-------|
| `employees` | Phase 2 |
| `payroll` | Phase 2 |

### Changes to `reminders` table

| Change | Type |
|--------|------|
| Add `snoozed_until TIMESTAMPTZ DEFAULT NULL` | ALTER TABLE ADD COLUMN |

### No changes needed

- `users` table — compatible with contract
- `debts` table — compatible with contract (already has both payable/receivable)
