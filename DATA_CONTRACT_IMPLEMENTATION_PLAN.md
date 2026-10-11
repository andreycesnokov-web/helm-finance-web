# Data Contract Implementation Plan

Date: 2026-06-09
Status: PLANNING — no code changed
Reference: DATA_CONTRACT.md
Scope: Every place transactions, debts, reminders are created, parsed, saved, read, or displayed

---

## How to Read This Document

Each section covers one code location. For every location:
- **Current shape** = what the code actually writes or expects today
- **Contract shape** = what DATA_CONTRACT.md requires
- **Gap** = the exact difference
- **Proposed fix** = the minimal change needed (no redesign, no new features)
- **Risk** = impact of getting it wrong

---

## Summary Table

| # | Location | System | Category | Gap severity | Risk | Status |
|---|----------|--------|----------|-------------|------|--------|
| T-01 | `bot.js` saveall callback | Bot | Transaction write | HIGH — `source`, `category`, `amount_idr` missing | HIGH | ✅ DONE (Group B-1) |
| T-02 | `parser.js` AI prompt + output | Bot | AI parse | HIGH — no `source` extracted, `category_name` unused | HIGH | ✅ DONE (Group A-1) |
| T-03 | `server/index.js` POST /api/parse | Web | AI parse | MEDIUM — no `category` in prompt | MEDIUM | ✅ DONE (Group A-2) |
| T-04 | `server/index.js` POST /api/transactions/batch | Web | Transaction write | MEDIUM — `amount_idr` null for non-IDR | MEDIUM | ✅ DONE (Group B-2) |
| T-05 | `server/index.js` POST /api/accounts (opening balance) | Web | Transaction write | LOW — conformant except `category` | LOW | ⏳ Group C (pending schema) |
| T-06 | `server/index.js` POST /api/accounts/adjust | Web | Transaction write | LOW — conformant except `category` | LOW | ⏳ Group C (pending schema) |
| T-07 | `server/index.js` POST /api/debts/:id/pay | Web | Transaction write | LOW — conformant except `category` | LOW | ⏳ Group C (pending schema) |
| T-08 | `server/index.js` GET /api/pulse (virtual accounts) | Web | Transaction read | LOW — derivation logic correct | LOW | ⏳ Group G (after B deployed) |
| T-09 | `server/index.js` GET /api/transactions | Web | Transaction read | NONE — read-only, no shape imposed | — | N/A |
| T-10 | `db.js` saveTransaction | Bot | Transaction write | HIGH — same as T-01 root | HIGH | ✅ DONE (fix is in caller T-01) |
| T-11 | `db.js` getTransactions | Bot | Transaction read | MEDIUM — joins non-existent `categories` table | MEDIUM | ✅ DONE (Group D-1) |
| D-01 | `server/index.js` POST /api/debts | Web | Debt create | LOW — missing `scope` default enforcement | LOW | ⏳ Group F |
| D-02 | `Add.jsx` debt form | Web client | Debt create (UI) | LOW — no `scope` field in form | LOW | ⏳ Group F |
| R-01 | `server/index.js` POST /api/reminders | Web | Reminder create | MEDIUM — `snoozed_until` column missing | MEDIUM | ⏳ Group F (pending schema) |
| R-02 | `Add.jsx` reminder form | Web client | Reminder create (UI) | LOW — `is_recurring`, `recur_interval` not exposed | LOW | ⏳ Group F |
| P-01 | — | Future | Payroll compatibility | MEDIUM — `category` field needed in transactions | MEDIUM | ⏳ Group E (schema migration) |

---

## T-01 — Bot: saveall callback (transaction write)

**File:** `~/Desktop/Fin Bot/src/bot.js` lines 111–122

### Current Shape Written to DB

```javascript
await saveTransaction({
  user_id:           user.id,          // ✅ present
  type:              t.type,           // ✅ present ("income" | "expense")
  amount_original:   t.amount,         // ✅ present
  currency_original: t.currency,       // ✅ present
  amount_idr:        t.currency === 'IDR' ? t.amount : null,  // ⚠️ null when not IDR
  description:       t.description,   // ✅ present
  scope:             t.scope,         // ✅ present
  project:           t.project,       // ✅ present
  // source:   MISSING — never set
  // category: MISSING — t.category_name is returned by parser but discarded here
});
```

### Contract Shape Required

```javascript
{
  user_id:           bigint,   // required
  type:              "income" | "expense",   // required
  amount_original:   positive decimal,       // required
  currency_original: ISO 4217 string,        // required
  amount_idr:        positive decimal,       // REQUIRED, never null
  description:       non-empty string,       // required
  source:            string | null,          // optional but should be extracted
  scope:             "personal" | "business", // required
  project:           string | null,          // optional
  category:          string | null,          // optional
}
```

### Gap

| Field | Current | Required | Gap |
|-------|---------|----------|-----|
| `source` | Never set | Optional (extract if possible) | Parser doesn't extract it; bot never writes it |
| `category` | Discarded (parser returns `category_name`, bot ignores it) | Optional | Value is available from parser output but thrown away |
| `amount_idr` | `null` when currency ≠ IDR | Never null — always required | No exchange rate conversion exists |

### Proposed Minimal Fix

**In `bot.js` saveall callback:**
```javascript
// Change:
amount_idr: t.currency === 'IDR' ? t.amount : null,
// To:
amount_idr: t.currency === 'IDR' ? t.amount : (t.amount_idr || t.amount),
// ^ use amount_idr if parser provides it; fallback to same amount (1:1 for now)

// Add:
source:   t.source   || null,
category: t.category || t.category_name || null,
```

**Note on `amount_idr`:** Until a live exchange rate API is integrated, storing
`amount_original` as `amount_idr` for non-IDR amounts is the correct fallback.
It is wrong but explicitly wrong, and the column will be non-null. The alternative
(keeping null) silently breaks balance calculations.

### Risk: HIGH

Transactions entered via bot have `source = null`, which means they contribute
to total balance but never appear in the virtual account breakdown. A user who
enters 100% of transactions via bot sees a correct total balance but zero
accounts on the Accounts page. This is a core UX failure.

---

## T-02 — Bot: AI parser prompt and output shape

**File:** `~/Desktop/Fin Bot/src/parser.js` lines 11–26

### Current Prompt

```javascript
content: 'Ты финансовый ассистент. Найди ВСЕ транзакции в тексте.\n\n'
       + 'Категории:\n' + categoryList + '\n\n'
       + 'Текст: "' + text + '"\n\n'
       + 'Верни ТОЛЬКО JSON массив без markdown:\n'
       + '[{"type":"expense или income","amount":число,"currency":"IDR или USD",'
       + '"category_name":"из списка","description":"описание",'
       + '"scope":"personal или business","project":"Helm Care или null"}]'
```

### Current Output Shape

```json
{
  "type": "expense | income",
  "amount": 250000,
  "currency": "IDR",
  "category_name": "Еда",
  "description": "еда",
  "scope": "personal",
  "project": null
}
```

### Contract Output Shape Required

```json
{
  "type": "expense | income",
  "amount": 250000,
  "currency": "IDR",
  "description": "краткое описание",
  "source": "Permata Personal | null",
  "scope": "personal | business",
  "project": null,
  "category": "Еда | null"
}
```

### Gap

| Field | Current | Required | Gap |
|-------|---------|----------|-----|
| `category_name` | ✅ returned | — | Field name wrong; should be `category` |
| `source` | ❌ not extracted | Optional but important | Prompt never asks for account/wallet name |
| `category` | ❌ not in output | Optional | Should be `category`, not `category_name` |
| Prompt quality | Asks for `category_name` from a fixed list | Asks for free-form `category` | Category list inject is good but creates rigid dependency on categories table |

### Proposed Minimal Fix

Replace the prompt in `parser.js` with the canonical prompt from DATA_CONTRACT.md:

```javascript
const response = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1000,
  messages: [{
    role: 'user',
    content: `Ты финансовый ассистент. Найди ВСЕ транзакции в тексте.

Верни ТОЛЬКО JSON массив без markdown, без пояснений:
[{"type":"expense или income","amount":число,"currency":"IDR по умолчанию","description":"краткое описание","source":"счёт или null","scope":"personal или business","project":"проект или null","category":"категория или null"}]

Правила:
- Суммы всегда положительные. Тип определяет знак.
- source: название счёта/кошелька если упомянуто, иначе null.
- scope: "personal" если не ясно.
- Валюта: IDR если не указана.

Текст: "${text}"`
  }]
})
```

**Note:** The categories array from DB is dropped from the prompt. This removes
the DB dependency from the AI call and aligns the bot prompt with the web prompt.
Free-form `category` from the AI is equally useful and doesn't require seeded data.

### Risk: HIGH

The bot and web parsers return different field names for the same semantic field
(`category_name` vs `category`). Any shared display or reporting code must handle
both names or will silently drop one system's categories.

---

## T-03 — Web: POST /api/parse (AI prompt)

**File:** `server/index.js` lines 248–255

### Current Prompt

```javascript
content: `Ты финансовый ассистент. Разбери текст и верни ТОЛЬКО JSON массив без markdown:
[{"type":"expense или income","amount":число,"currency":"IDR","description":"краткое описание","source":"счёт или null","scope":"personal или business","project":"название проекта или null"}]

Текст: "${text}"`
```

### Current Output Shape

```json
{
  "type": "expense | income",
  "amount": 250000,
  "currency": "IDR",
  "description": "краткое описание",
  "source": "Permata Personal | null",
  "scope": "personal | business",
  "project": null
}
```

### Contract Output Shape Required

Same as T-02 plus `category` field.

### Gap

| Field | Current | Required | Gap |
|-------|---------|----------|-----|
| `category` | ❌ not in prompt or output | Optional | Prompt doesn't ask for it |
| `source` | ✅ extracted | ✅ | Correct |
| Text length limit | ❌ none | Contract says add validation | Missing (tracked in SECURITY_FIX_PLAN) |

### Proposed Minimal Fix

Replace the web prompt with the canonical prompt from DATA_CONTRACT.md (adds `category`
field, adds explicit rules, aligns with bot):

```javascript
content: `Ты финансовый ассистент. Найди ВСЕ транзакции в тексте.

Верни ТОЛЬКО JSON массив без markdown, без пояснений:
[{"type":"expense или income","amount":число,"currency":"IDR по умолчанию","description":"краткое описание","source":"счёт или null","scope":"personal или business","project":"проект или null","category":"категория или null"}]

Правила:
- Суммы всегда положительные. Тип определяет знак.
- source: название счёта/кошелька если упомянуто, иначе null.
- scope: "personal" если не ясно.
- Валюта: IDR если не указана.

Текст: "${text}"`
```

### Risk: MEDIUM

The web parser currently works correctly for source and scope. Missing `category`
means the category column in the DB is never populated from web-entered transactions.
This is a gap but not a breakage — the field is currently optional.

---

## T-04 — Web: POST /api/transactions/batch (transaction write)

**File:** `server/index.js` lines 263–282

### Current Code

```javascript
const rows = transactions.map(t => ({
  user_id:           req.user.userId,
  type:              t.type,
  amount_original:   t.amount,
  currency_original: t.currency || 'IDR',
  amount_idr:        t.currency === 'IDR' ? t.amount : null,  // ⚠️ null when not IDR
  description:       t.description,
  source:            t.source || null,
  scope:             t.scope || 'personal',
  project:           t.project || null,
}))
```

### Gap

| Field | Current | Required | Gap |
|-------|---------|----------|-----|
| `amount_idr` | `null` when currency ≠ IDR | Never null | Same issue as T-01 |
| `category` | ❌ not mapped | Optional | AI output may include `category`; it's discarded here |

### Proposed Minimal Fix

```javascript
const rows = transactions.map(t => ({
  user_id:           req.user.userId,
  type:              t.type,
  amount_original:   t.amount,
  currency_original: t.currency || 'IDR',
  amount_idr:        t.currency === 'IDR' ? t.amount : (t.amount_idr || t.amount),
  description:       t.description,
  source:            t.source || null,
  scope:             t.scope || 'personal',
  project:           t.project || null,
  category:          t.category || null,
}))
```

### Risk: MEDIUM

For current users who operate entirely in IDR, `amount_idr = null` never causes
a wrong balance (the balance calculation uses `amount_original`, not `amount_idr`).
The risk is latent: if multi-currency reporting is added that relies on `amount_idr`,
all historical non-IDR transactions will appear as zero-amount.

---

## T-05 — Web: POST /api/accounts (opening balance transaction)

**File:** `server/index.js` lines 330–343

### Current Code

```javascript
await supabase.from('transactions').insert({
  user_id:           req.user.userId,
  type:              'income',
  amount_original:   balance || 0,
  currency_original: 'IDR',
  amount_idr:        balance || 0,
  description:       `Opening balance · ${name}`,
  source:            name,
  scope:             type || 'personal',
})
```

### Gap

| Field | Current | Required | Gap |
|-------|---------|----------|-----|
| `category` | ❌ missing | Optional | Contract defines: `category: null` for auto-generated transactions. Minor. |
| `project` | ❌ missing | Optional | Should be null explicitly |

### Proposed Minimal Fix

```javascript
description: `Opening balance · ${name}`,   // ✅ matches contract convention
category:    null,                           // add explicit null
project:     null,                           // add explicit null
```

### Risk: LOW

Functional. The only gap is missing optional fields. No balance or display logic
is broken by the absence of `category` on opening balance transactions.

---

## T-06 — Web: POST /api/accounts/adjust (balance adjustment transaction)

**File:** `server/index.js` lines 287–302

### Current Code

```javascript
await supabase.from('transactions').insert({
  user_id:           req.user.userId,
  type:              diff > 0 ? 'income' : 'expense',
  amount_original:   Math.abs(diff),
  currency_original: 'IDR',
  amount_idr:        Math.abs(diff),
  description:       `Balance adjustment · ${name}`,
  source:            name,
  scope:             type || 'personal',
})
```

### Gap

Same as T-05: `category` and `project` not explicitly set.

### Proposed Minimal Fix

Add `category: null, project: null` to the insert object.

### Risk: LOW

Functional. Optional fields only.

---

## T-07 — Web: POST /api/debts/:id/pay (payment transaction)

**File:** `server/index.js` lines 362–390

### Current Code

```javascript
await supabase.from('transactions').insert({
  user_id:           req.user.userId,
  type:              debt.type === 'payable' ? 'expense' : 'income',
  amount_original:   paidAmount,
  currency_original: 'IDR',
  amount_idr:        paidAmount,
  description:       `Payment: ${debt.counterparty}`,
  source:            account || null,
  scope:             debt.scope || 'business',
})
```

### Gap

| Field | Current | Required | Gap |
|-------|---------|----------|-----|
| `category` | ❌ missing | Optional | Contract says `category: null` for auto-generated. Minor. |
| `project` | ❌ missing | Optional | Should propagate `debt.project` if it exists |

### Proposed Minimal Fix

```javascript
description: `Payment: ${debt.counterparty}`,  // ✅ matches contract
category:    null,
project:     debt.project || null,              // propagate project from debt
```

### Risk: LOW

`project` propagation from debt to payment transaction is a useful data hygiene
improvement but not blocking anything currently.

---

## T-08 — Web: GET /api/pulse (virtual account derivation)

**File:** `server/index.js` lines 102–113

### Current Code

```javascript
const sourceMap = {};
(allTxs || []).forEach(t => {
  const src = t.source || (t.scope === 'business' ? 'Helm Care Pay' : 'Personal');
  if (!sourceMap[src]) sourceMap[src] = {
    id: src, name: src, balance: 0, type: t.scope || 'personal'
  };
  if (t.type === 'income') sourceMap[src].balance += Number(t.amount_original);
  else sourceMap[src].balance -= Number(t.amount_original);
});
```

### Gap

| Aspect | Current | Contract | Gap |
|--------|---------|----------|-----|
| Null source fallback | `t.scope === 'business' ? 'Helm Care Pay' : 'Personal'` | No fallback specified | Creates synthetic account names for bot-entered transactions. Misleading. |
| Uses `amount_original` | ✅ | ✅ | Correct |
| Account type | Uses `t.scope` | Uses `most recent t.scope for this source` | Close enough for now |

### Proposed Minimal Fix

The fallback synthetic account name is the correct approach for now. When bot
transactions gain `source` (from T-01 fix), this fallback becomes rarely used.
The only change needed: document the fallback behavior in code, not change it.

One real gap: bot-entered transactions without `source` are lumped into
`'Personal'` or `'Helm Care Pay'` as synthetic accounts. This inflates those
account balances with amounts that don't belong to real accounts.

**Better fallback:**
```javascript
const src = t.source || null;
if (!src) return;   // exclude sourceless transactions from virtual accounts
```

This means sourceless bot transactions still count in `totalBalance` (they're
in `allTxs`) but don't create phantom accounts. The total balance is correct;
the accounts breakdown simply won't show them.

### Risk: LOW

Current behavior creates misleading phantom "Personal" and "Helm Care Pay"
accounts for bot-entered transactions. After T-01 is fixed, the bot always
sets `source`, so this becomes edge-case only.

---

## T-09 — Web: GET /api/transactions (read only)

**File:** `server/index.js` lines 200–216

No gap. This is a read-only endpoint. It returns whatever is in the DB.
No data shape is imposed by this route.

---

## T-10 — Bot: db.js saveTransaction

**File:** `~/Desktop/Fin Bot/src/db.js` lines 49–57

### Current Code

```javascript
async function saveTransaction(tx) {
  const { data, error } = await supabase
    .from('transactions')
    .insert(tx)
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

This function is a pass-through — it inserts whatever object is passed to it.
The gap is in T-01 (the caller), not here. The function itself is contract-compatible.

### Proposed Fix

None needed here. Fix the caller (T-01).

---

## T-11 — Bot: db.js getTransactions (categories join)

**File:** `~/Desktop/Fin Bot/src/db.js` lines 61–71

### Current Code

```javascript
const { data, error } = await supabase
  .from('transactions')
  .select('*, categories(name, emoji)')   // ← PostgREST join
  .eq('user_id', userId)
  .gte('created_at', from)
  .lte('created_at', to)
  .order('created_at', { ascending: false });
```

### Gap

The `categories(name, emoji)` join uses `category_id` as the foreign key.
Per the architecture audit, `category_id` is never populated — it is always null.
The join returns `categories: null` for every row.

Additionally, when the `category_id` FK is dropped from the schema (as planned
in DATA_CONTRACT.md migration), this query will throw a Supabase schema error,
identical to the bug (BUG-02) previously fixed in the web server.

### Proposed Minimal Fix

```javascript
// Change:
.select('*, categories(name, emoji)')
// To:
.select('*')
```

The `category` field (new text column) will be available directly on the
transaction row — no join needed.

### Risk: MEDIUM

**This will break when the schema migration drops `category_id`.** It needs to
be fixed before any schema migration runs. Currently it silently returns null
for the join, so the report still works (it uses `t.description` as the
grouping key, not `t.category_name`).

---

## D-01 — Web: POST /api/debts (debt creation)

**File:** `server/index.js` lines 183–187

### Current Code

```javascript
app.post('/api/debts', auth, async (req, res) => {
  const { data, error } = await supabase.from('debts')
    .insert({ ...req.body, user_id: req.user.userId }).select().single();
```

### Gap

`req.body` is spread directly into the insert. No field validation, no
default enforcement.

| Field | Contract requirement | Current behavior | Gap |
|-------|---------------------|-----------------|-----|
| `scope` | Required, default `"personal"` | Passed from client or missing | If client omits `scope`, it inserts as `null` — violates NOT NULL constraint if added |
| `type` | Must be `"payable"` or `"receivable"` | Not validated server-side | Invalid values accepted |
| `amount` | Must be positive | Not validated | Negative amounts accepted |

### Proposed Minimal Fix

```javascript
const { type, counterparty, amount, currency, due_date, scope, description } = req.body;
if (!type || !counterparty || !amount) {
  return res.status(400).json({ error: 'type, counterparty, and amount are required' });
}
if (!['payable', 'receivable'].includes(type)) {
  return res.status(400).json({ error: 'type must be payable or receivable' });
}
const { data, error } = await supabase.from('debts').insert({
  user_id:      req.user.userId,
  type,
  counterparty,
  amount:       Number(amount),
  currency:     currency || 'IDR',
  due_date:     due_date || null,
  scope:        scope || 'personal',
  description:  description || null,
}).select().single();
```

### Risk: LOW

The current DB schema has `scope TEXT DEFAULT 'personal'` so missing scope
defaults correctly at the DB level. But explicit validation is safer.

---

## D-02 — Web client: Add.jsx debt form (UI)

**File:** `client/src/pages/Add.jsx` lines 20–25, 183–230

### Current Form State

```javascript
const [debt, setDebt] = useState({
  type:         'receivable',
  counterparty: '',
  amount:       '',
  due_date:     '',
  description:  ''
  // scope: MISSING from form state
})
```

### Gap

| Field | In form | Contract | Gap |
|-------|---------|----------|-----|
| `scope` | ❌ not in form | Required (`"personal"` \| `"business"`) | User cannot classify a debt as personal vs. business |
| `currency` | ❌ not in form | Optional (defaults to IDR) | Acceptable for now |
| `project` | ❌ not in form | Optional | Acceptable for now |

The `scope` gap matters because the Pulse page filters debts by scope when
the user selects "Personal" or "Business" view. A debt without `scope` always
defaults to `'personal'` at the DB level — business debts created via web are
incorrectly classified unless scope is passed.

### Proposed Minimal Fix

Add a scope toggle (Personal / Business) to the debt form, identical to the
one already in the account add/edit modal. It's a 2-button toggle, already
styled elsewhere.

```javascript
// Add to initial state:
const [debt, setDebt] = useState({
  type: 'receivable', counterparty: '', amount: '',
  due_date: '', description: '',
  scope: 'personal'   // add this
})
```

And add the toggle UI (same pattern as in Accounts.jsx lines 237–244).

### Risk: LOW

Business debts currently default to `'personal'` silently. This causes them
to appear in Personal view and not in Business view on the Pulse page. Not a
crash, but incorrect data classification.

---

## R-01 — Web: POST /api/reminders (reminder creation)

**File:** `server/index.js` lines 221–226

### Current Code

```javascript
app.post('/api/reminders', auth, async (req, res) => {
  const { data, error } = await supabase.from('reminders')
    .insert({ ...req.body, user_id: req.user.userId }).select().single();
```

### Gap

| Field | Contract requirement | Current behavior | Gap |
|-------|---------------------|-----------------|-----|
| `snoozed_until` | Optional column (new) | Column doesn't exist in schema yet | Schema migration required before this field can be used |
| `scope` | Required, default `"personal"` | Passed from client; not validated | |
| `is_recurring` | Required boolean | Passed from client; not validated | |
| `recur_interval` | Must be enum or null | Not validated | |

### Proposed Minimal Fix

**Two steps required in sequence:**

1. Add `snoozed_until TIMESTAMPTZ DEFAULT NULL` column to `reminders` table (schema migration)
2. Update the snooze endpoint (`PATCH /api/reminders/:id/done`) to handle snooze:

```javascript
// New endpoint: PATCH /api/reminders/:id/snooze
app.patch('/api/reminders/:id/snooze', auth, async (req, res) => {
  const { until } = req.body;
  if (!until) return res.status(400).json({ error: 'until is required' });
  const { data, error } = await supabase.from('reminders')
    .update({ snoozed_until: until })
    .eq('id', req.params.id)
    .eq('user_id', req.user.userId)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

This is the backend fix for the broken snooze modal (BUG-11 in BUG_REPORT.md).

### Risk: MEDIUM

The `snoozed_until` column is referenced in DATA_CONTRACT.md but does not exist
in the current schema. Attempting to write it before the migration will cause
a Supabase error. **The schema migration must run first.**

---

## R-02 — Web client: Add.jsx reminder form (UI)

**File:** `client/src/pages/Add.jsx` lines 68–79, 234–258

### Current Form State

```javascript
const [reminder, setReminder] = useState({
  title:    '',
  due_date: '',
  meta:     ''
  // is_recurring: MISSING
  // recur_interval: MISSING
  // scope: MISSING
})
```

### Gap

| Field | In form | Contract | Gap |
|-------|---------|----------|-----|
| `is_recurring` | ❌ not in form | Optional boolean | User cannot mark a reminder as recurring |
| `recur_interval` | ❌ not in form | Optional enum | User cannot set repeat interval |
| `scope` | ❌ not in form | Required, default `"personal"` | All reminders default to personal |

### Proposed Minimal Fix

For Phase 1 alignment: add `scope` to the reminder form (same Personal/Business
toggle as elsewhere). Defer `is_recurring` and `recur_interval` to Phase 2.

### Risk: LOW

Recurring reminder logic is a new feature, not a contract gap. The `scope`
gap is the only thing that affects existing functionality.

---

## P-01 — Future Payroll Compatibility

**File:** N/A (payroll table does not exist yet)

### Analysis

When payroll is implemented (Phase 2), it generates transactions with:

```json
{
  "type": "expense",
  "description": "Salary: {employeeName} · {month} {year}",
  "category": "Payroll",
  "source": "{accountName}",
  "scope": "business",
  "project": "{employeeProject}"
}
```

The `category` field in the transactions table is the critical dependency.
If `category` is not added to the schema before payroll is built, payroll
transactions will have no way to distinguish salary payments from other
business expenses in reporting.

### What Must Be True Before Payroll

1. `transactions.category TEXT DEFAULT NULL` column exists in schema ✅ (in plan)
2. `employees` table exists ✅ (in DATA_CONTRACT.md)
3. `payroll` table exists ✅ (in DATA_CONTRACT.md)
4. AI parser always returns `category` field ✅ (after T-02/T-03 fixes)

### Risk: MEDIUM

No immediate impact. Risk materializes if payroll is built before the `category`
column migration runs. Payroll transactions would mix invisibly with other
expenses in the Accounts and Radar views.

---

## Proposed Implementation Order

Ordered by dependency and risk. Each group can be done independently.

### Group A — AI Parser Alignment ✅ COMPLETE
Fixes T-02 and T-03. Unified prompts. No DB changes. No UI changes.

| Step | File | Change | Status |
|------|------|--------|--------|
| A-1 | `Fin Bot/src/parser.js` | Canonical prompt; removed categories param; `category` field | ✅ Done |
| A-1b | `Fin Bot/src/bot.js` | Removed `getCategories` DB call; updated `parseTransactions` call | ✅ Done |
| A-2 | `server/index.js` POST /api/parse | Canonical prompt; `category` field added | ✅ Done |

### Group B — Transaction Write Alignment ✅ COMPLETE
Fixes T-01, T-04.

| Step | File | Change | Status |
|------|------|--------|--------|
| B-1 | `Fin Bot/src/bot.js` saveall | Added `source`, `category`; fixed `amount_idr` fallback; hardened defaults | ✅ Done |
| B-2 | `server/index.js` /api/transactions/batch | Added `category`; fixed `amount_idr` fallback | ✅ Done |

### Group C — Auto-generated Transaction Hygiene ⏳ PENDING
Fixes T-05, T-06, T-07. Awaiting schema migration (Group E) so `category` column exists.

| Step | File | Change | Status |
|------|------|--------|--------|
| C-1 | `server/index.js` /api/accounts | Add `category: null, project: null` | ⏳ Pending E |
| C-2 | `server/index.js` /api/accounts/adjust | Same | ⏳ Pending E |
| C-3 | `server/index.js` /api/debts/:id/pay | Add `category: null`; propagate `debt.project` | ⏳ Pending E |

### Group D — Bot DB Query Fix ✅ COMPLETE
Fixes T-11. Done before schema migration so there's no breakage window.

| Step | File | Change | Status |
|------|------|--------|--------|
| D-1 | `Fin Bot/src/db.js` getTransactions | Removed `categories(name, emoji)` join | ✅ Done |

### Group E — Schema Migration ⏳ PENDING (requires Supabase access)
Required before Groups C and F (snoozed_until) can run.

| Step | Migration SQL | Status |
|------|--------------|--------|
| E-1 | `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL` | ⏳ |
| E-2 | `ALTER TABLE transactions DROP COLUMN IF EXISTS category_id` | ⏳ |
| E-3 | `ALTER TABLE transactions DROP COLUMN IF EXISTS account_id` | ⏳ |
| E-4 | `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL` | ⏳ |

### Group F — Validation and Form Fixes ⏳ PENDING
Fixes D-01, D-02, R-01, R-02. F-4/F-5 (snooze) require E-4 schema first.

| Step | File | Change | Status |
|------|------|--------|--------|
| F-1 | `server/index.js` POST /api/debts | Add field validation | ⏳ |
| F-2 | `client/src/pages/Add.jsx` | Add `scope` to debt form | ⏳ |
| F-3 | `client/src/pages/Add.jsx` | Add `scope` to reminder form | ⏳ |
| F-4 | `server/index.js` | Add PATCH /api/reminders/:id/snooze endpoint | ⏳ Pending E-4 |
| F-5 | `client/src/pages/Pulse.jsx` | Wire snooze modal to endpoint | ⏳ Pending F-4 |

### Group G — Virtual Account Derivation Cleanup ⏳ PENDING
Fixes T-08. Depends on B-1 being deployed to production first.

| Step | File | Change | Status |
|------|------|--------|--------|
| G-1 | `server/index.js` /api/pulse | Exclude `source: null` transactions from virtual accounts | ⏳ |

---

## Files Changed Summary

| File | System | Groups | Changes |
|------|--------|--------|---------|
| `Fin Bot/src/parser.js` | Bot | A-1 | Prompt rewrite, field rename |
| `Fin Bot/src/bot.js` | Bot | B-1 | Add source/category to save; fix amount_idr |
| `Fin Bot/src/db.js` | Bot | D-1 | Remove categories join |
| `server/index.js` | Web | A-2, B-2, C-1/2/3, D-01, F-1/4 | Multiple targeted changes |
| `client/src/pages/Add.jsx` | Web client | D-02, R-02, F-2/3 | Add scope toggles |
| `client/src/pages/Pulse.jsx` | Web client | F-5 | Wire snooze to API |
| Supabase migration | DB | E-1/2/3/4 | Column add/drop |

**Total: 7 files + 1 migration**
**No new pages, no new components, no redesign.**
