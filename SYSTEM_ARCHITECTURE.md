# Helm Finance — System Architecture

Date: 2026-06-09
Author: Founding CTO (Claude)
Scope: Full system — Telegram Bot, Web API, React PWA, Supabase database

---

## System Overview

Helm Finance is a two-front-end, one-database financial operating system for
small business founders. Both a Telegram Bot and a React Web App write to and
read from the same Supabase PostgreSQL database. There is no service mesh,
no message queue, and no shared API contract between the two systems beyond the
database schema itself.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          HELM FINANCE SYSTEM                                │
│                                                                             │
│   ┌──────────────────┐           ┌─────────────────────────────────────┐   │
│   │  TELEGRAM BOT    │           │           WEB PLATFORM              │   │
│   │  (Node.js)       │           │                                     │   │
│   │  ~/Desktop/Fin   │           │  ┌─────────────────────────────┐   │   │
│   │  Bot/src/bot.js  │           │  │   React PWA (Vite)          │   │   │
│   │                  │           │  │   client/src/               │   │   │
│   │  grammy library  │           │  │   - Pulse (dashboard)       │   │   │
│   │                  │           │  │   - Add (AI input)          │   │   │
│   │  /start          │           │  │   - Radar (forecast)        │   │   │
│   │  /report         │           │  │   - Accounts                │   │   │
│   │  /balance (stub) │           │  │   - Settings                │   │   │
│   │  text messages   │           │  └──────────────┬──────────────┘   │   │
│   └────────┬─────────┘           │                 │ REST /api/*      │   │
│            │                     │  ┌──────────────▼──────────────┐   │   │
│            │ Supabase JS         │  │   Express Server            │   │   │
│            │ service key         │  │   server/index.js           │   │   │
│            │                     │  │   + serves client/dist      │   │   │
│            │                     │  └──────────────┬──────────────┘   │   │
│            │                     │                 │ Supabase JS      │   │
│            │                     └─────────────────┼───────────────────┘   │
│            │                                       │ service key           │
│            │                                       │                       │
│            ▼                                       ▼                       │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │                   SUPABASE (PostgreSQL)                            │   │
│   │                                                                    │   │
│   │  users ──────── transactions ──────── debts ──────── reminders    │   │
│   │                      │                                             │   │
│   │                  accounts (virtual)   categories (bot only)       │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                        ┌──────────────────┐                                │
│                        │  Anthropic API   │                                │
│                        │  claude-sonnet-  │                                │
│                        │  4-5             │                                │
│                        │  (used by BOTH   │                                │
│                        │   systems)       │                                │
│                        └────────┬─────────┘                                │
│                          ▲      │                                           │
│                          │      │                                           │
│                   Bot:   │      │  Web: POST /api/parse                    │
│                   parser │      │  returns JSON array                      │
│                   .js    │      │                                           │
└──────────────────────────┴──────┴───────────────────────────────────────── ┘
```

---

## 1. How the Telegram Bot Works

**Location:** `~/Desktop/Fin Bot/src/`
**Runtime:** Node.js, CommonJS modules
**Library:** grammy (long-polling by default)
**Entry point:** `src/bot.js`

### Startup

The bot initializes a grammy `Bot` instance using `BOT_TOKEN` from `.env`.
It does not use webhook mode — it uses grammy's default long-polling (`bot.start()`).

### Message Flow

```
User sends text in Telegram
         │
         ▼
grammy receives via long-poll
         │
         ▼
bot.on('message:text') handler
         │
         ├── if starts with '/' → skip (handled by command handlers)
         │
         ▼
getOrCreateUser(ctx.from)
  → Supabase upsert into users table (by Telegram numeric ID)
         │
         ▼
"Анализирую..." sent to user
         │
         ▼
getCategories(user.id)
  → SELECT from categories WHERE user_id = {id} OR is_default = true
         │
         ▼
parseTransactions(text, categories)  [src/parser.js]
  → Anthropic claude-sonnet-4-5 API call
  → Returns JSON array of transactions
         │
         ▼
Pending object stored in memory:  pending[key] = transactions
         │
         ▼
Confirmation message with inline keyboard [Да, все | Отмена]
```

### Confirmation Flow

```
User taps "Да, все"
         │
         ▼
callbackQuery(/^saveall:/)
  → pending[key] retrieved from in-memory map
  → for each transaction: saveTransaction() → INSERT into transactions
  → pending[key] deleted
  → "Сохранено N транзакций!" sent to user
```

### Commands

| Command   | Behavior |
|-----------|----------|
| `/start`  | Upsert user, send welcome message |
| `/report` | Show inline keyboard: Today / Week / Month |
| `/balance`| Stub reply: "Функция балансов — скоро!" |

### Report Flow

```
User taps period button
         │
         ▼
getTransactions(user.id, from, to)
  → SELECT *, categories(name, emoji) FROM transactions
  → Filtered by scope: personal / business
         │
         ▼
buildSection() groups by description (used as category key)
         │
         ▼
Text report sent inline (replaces the "choose period" message)
```

---

## 2. How the Web App Works

**Location:** `~/Desktop/helm-finance-web/.claude/worktrees/intelligent-wilbur-2e5714/`
**Client:** React 18, Vite 5, React Router v6, plain JSX (no TypeScript)
**Server:** Express 4, Node.js, serves both the API and `client/dist`
**Deployment:** Railway (single service, Express serves static + API)

### Client Architecture

```
main.jsx
  └── App.jsx
        └── AuthProvider (context)
              ├── /login   → Login.jsx
              │               Telegram Login Widget
              │               POST /api/auth/telegram
              │               JWT stored in localStorage (hf_token)
              │
              ├── /        → PulseWrapper → Layout + Pulse.jsx
              │               GET /api/pulse?scope={all|personal|business}
              │               AI status, balance, debts, reminders
              │
              ├── /add     → Layout + Add.jsx
              │               POST /api/parse (AI)
              │               POST /api/transactions/batch
              │               POST /api/debts
              │               POST /api/reminders
              │
              ├── /radar   → Layout + Radar.jsx
              │               GET /api/pulse?scope=all (reuses pulse endpoint)
              │               30-day cash forecast (client-side math)
              │
              ├── /accounts → Layout + Accounts.jsx
              │               GET /api/pulse?scope=all (reuses pulse endpoint)
              │               POST /api/accounts
              │               POST /api/accounts/rename
              │               POST /api/accounts/adjust
              │               POST /api/accounts/delete
              │
              └── /settings → Layout + Settings.jsx
                              GET /api/profile
                              POST /api/profile
```

### Layout System

```
Desktop (≥1024px)                      Mobile (<1024px)
┌────────────────────────────────┐     ┌──────────────────┐
│ Sidebar  │  desktop-main  │ Right│     │   page content   │
│ 220px    │  max-width     │ 300px│     │                  │
│          │  520px         │      │     │                  │
│ NAV 5    │  scrollable    │sticky│     │                  │
│ items    │                │      │     ├──────────────────┤
└────────────────────────────────┘     │ BottomNav 4 items│
                                        └──────────────────┘
```

**Note:** BottomNav shows only 4 of 5 NAV items — Settings is mobile-hidden.
Desktop Sidebar shows all 5. The right panel (`RightPanel`) is only shown on
the Pulse page via `PulseWrapper` in App.jsx.

### Authentication Flow (Web)

```
1. User visits /login
2. Telegram Login Widget loads from telegram.org/js/telegram-widget.js?22
3. User clicks "Log in with Telegram"
4. Telegram redirects with signed auth data in URL hash
5. Login.jsx calls loginWithTelegram(telegramData)
6. POST /api/auth/telegram
   → verifyTelegramAuth(): HMAC-SHA256 verification
   → check auth_date within 24 hours
   → Supabase upsert into users table
   → JWT signed (30d expiry): { userId, firstName }
7. JWT stored in localStorage as 'hf_token'
8. AuthProvider reads user from JWT payload (no server round-trip)
9. On reload: JWT present → GET /api/pulse to verify still valid
```

---

## 3. How Supabase Is Used

Both systems use the Supabase JavaScript client (`@supabase/supabase-js`).
Both use the **service role key** (bypasses Row Level Security).
Neither system uses Supabase Auth — identity is managed externally (Telegram + JWT for web, Telegram ID directly for bot).

### Access Pattern

| System | Supabase Key | RLS | Auth Method |
|--------|-------------|-----|-------------|
| Telegram Bot | `SUPABASE_SECRET_KEY` (service role) | Bypassed | Telegram `from.id` |
| Web Server | `SUPABASE_SECRET_KEY` (service role) | Bypassed | JWT middleware |

### Connection

- **Bot:** `createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)` at module level
- **Web:** `createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)` at module level
- Both use persistent connection objects — no pooling, no connection management

---

## 4. Which Tables Are Shared

```
DATABASE TABLES
═══════════════════════════════════════════════════════════════════════

TABLE           WRITTEN BY              READ BY         STATUS
──────────────────────────────────────────────────────────────────────
users           Bot (upsert on /start)  Bot, Web        SHARED
                Web (upsert on login)   

transactions    Bot (saveall callback)  Bot (/report)   SHARED
                Web (/api/transactions  Web (all pages)
                /api/accounts/*)

debts           Web only                Web only        WEB ONLY

reminders       Web only                Web only        WEB ONLY

categories      Neither (seeded by      Bot (for AI     BOT ONLY
                migration.sql)          prompt context)
                                        
accounts        (table exists in        Bot (getUserAcc SCHEMA MISMATCH
(physical)      migration.sql schema)   ounts reads it) — see below
                Web does NOT write
                to this table

══════════════════════════════════════════════════════════════════════
```

### Critical Schema Mismatch

The bot's `migration.sql` defines a physical `accounts` table:
```sql
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  user_id BIGINT,
  name TEXT,
  currency TEXT,
  balance DECIMAL(18,2),
  is_active BOOLEAN,
  ...
)
```

The web app does **not use this table**. Instead, it derives "virtual accounts"
at query time from `transactions.source`:

```js
// server/index.js line 103–113
const sourceMap = {}
allTxs.forEach(t => {
  const src = t.source || ...
  sourceMap[src].balance += or -= t.amount_original
})
const accounts = Object.values(sourceMap)
```

The physical `accounts` table is populated by the bot's `getUserAccounts()`
but the bot never calls that function after retrieval — `getOrCreateUser()` is
the only db function the bot actively uses. The accounts table is vestigial in
both systems.

---

## 5. How Transactions Flow Through the System

### Via Telegram Bot

```
User types: "купил еды 250000 и заправился 100000"
         │
         ▼
Anthropic API → JSON array:
[
  { type: "expense", amount: 250000, currency: "IDR",
    category_name: "Еда", description: "еда", scope: "personal", project: null },
  { type: "expense", amount: 100000, currency: "IDR",
    category_name: "Транспорт", description: "бензин", scope: "personal", project: null }
]
         │
         ▼
Stored in memory: pending["123456_1717935600000"] = [...]
User confirms → INSERT into transactions:
  user_id, type, amount_original, currency_original, amount_idr,
  description, scope, project
         │
NOTE: source field is NOT set by the bot.
      category_id is NOT set by the bot (despite schema having it).
      account_id is NOT set by the bot.
```

### Via Web App

```
User types: "получил 5М с клиента за проект Helm Care"
         │
         ▼
POST /api/parse → Anthropic API → JSON array:
[
  { type: "income", amount: 5000000, currency: "IDR",
    description: "client payment", source: "Helm Care Pay",
    scope: "business", project: "Helm Care" }
]
         │
         ▼
User confirms preview → POST /api/transactions/batch
INSERT into transactions:
  user_id, type, amount_original, currency_original, amount_idr,
  description, source, scope, project
         │
NOTE: source IS set by the web app.
      category_id is NOT set by the web app either.
      The 'source' field is what creates virtual accounts.
```

### Transaction Schema (actual columns used)

```sql
-- transactions table as actually used
id              SERIAL PRIMARY KEY
user_id         BIGINT   (always set, Telegram numeric ID)
type            TEXT     "income" | "expense"
amount_original DECIMAL  raw amount in original currency
currency_original TEXT   "IDR" | "USD" etc.
amount_idr      DECIMAL  IDR equivalent (null if not IDR)
description     TEXT     free text, AI-generated
source          TEXT     account name (web only, null from bot)
scope           TEXT     "personal" | "business"
project         TEXT     project tag (nullable)
created_at      TIMESTAMPTZ

-- NOT used in practice (despite existing in schema):
account_id      INT REFERENCES accounts(id)   → always null
category_id     INT REFERENCES categories(id)  → always null
```

---

## 6. How AI Parsing Works

Two separate implementations — no shared code.

### Bot Parser (`src/parser.js`)

```
Input: raw text + categories array from DB
         │
         ▼
Prompt structure:
  "Ты финансовый ассистент. Найди ВСЕ транзакции в тексте.
   Категории: [emoji name (type), ...]
   Текст: "..." 
   Верни ТОЛЬКО JSON массив без markdown:
   [{ type, amount, currency, category_name, description, scope, project }]"
         │
Model: claude-sonnet-4-5
max_tokens: 1000
         │
         ▼
Response: strip ```json``` markdown fences → JSON.parse()
         │
Output: array of { type, amount, currency, category_name, description,
                   scope, project }
         │
NOTABLE: category_name is returned but NOT used when saving to DB.
         The bot saves only: type, amount_original, currency_original,
         amount_idr, description, scope, project
```

### Web Parser (`POST /api/parse` in server/index.js)

```
Input: raw text (no categories passed to AI)
         │
         ▼
Prompt structure:
  "Ты финансовый ассистент. Разбери текст и верни ТОЛЬКО JSON массив без markdown:
   [{ type, amount, currency, description, source, scope, project }]
   Текст: "...""
         │
Model: claude-sonnet-4-5
max_tokens: 1000
         │
         ▼
Response: strip markdown → JSON.parse()
         │
Output: array of { type, amount, currency, description, source, scope, project }
         │
NOTE: 'source' (account name) IS extracted by web parser — not by bot.
      No categories are passed to the web prompt — they are unused.
```

### Key Differences Between Parsers

| Aspect | Bot | Web |
|--------|-----|-----|
| Categories in prompt | Yes (from DB) | No |
| Returns `source` field | No | Yes |
| Returns `category_name` | Yes | No |
| Saves `category_id` | No | No |
| Saves `source` | No | Yes |
| Prompt language | Russian | Russian |
| Markdown strip | Yes | Yes |
| Error handling | try/catch → "Не смог распознать" | try/catch → 500 JSON |

---

## 7. How Authentication Works

### Telegram Bot

No authentication. The bot trusts `ctx.from.id` (Telegram numeric user ID)
as the authoritative identity. Every message handler calls `getOrCreateUser(ctx.from)`
which upserts into the users table using the Telegram ID as the primary key.
There is no token, no session, and no expiry.

**Risk:** Any user can message the bot and immediately write transactions as
themselves. There is no allow-list, no invite system, no RBAC.

### Web App

```
TELEGRAM LOGIN WIDGET  (client-side, telegram.org JavaScript)
         │
         │ Redirects with signed auth data:
         │ { id, first_name, username, photo_url, auth_date, hash }
         ▼
POST /api/auth/telegram
         │
         ▼
verifyTelegramAuth(data):
  secret = SHA256(BOT_TOKEN)
  checkString = sort(keys).map(k=>`${k}=${v}`).join('\n')
  hmac = HMAC-SHA256(checkString, secret)
  verify: hmac === data.hash
  verify: Date.now()/1000 - auth_date < 86400 (24 hour window)
         │
         ▼
Supabase upsert: users (id, username, first_name)
         │
         ▼
jwt.sign({ userId, firstName }, JWT_SECRET, { expiresIn: '30d' })
         │
         ▼
Token returned to client → stored in localStorage('hf_token')
         │
         ▼
All subsequent requests:
  Authorization: Bearer {token}
  auth middleware: jwt.verify(token, JWT_SECRET) → req.user
  All queries filtered by: .eq('user_id', req.user.userId)
```

**JWT Payload:** `{ userId: <telegram_id>, firstName: <string>, iat, exp }`

**Note:** `JWT_SECRET` defaults to the hardcoded string `'helm-finance-secret'`
if the env var is not set. This is a security vulnerability.

---

## 8. Environment Variables Required

### Telegram Bot (`~/Desktop/Fin Bot/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Telegram BotFather token |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SECRET_KEY` | ✅ | Supabase service role key (bypasses RLS) |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key for claude-sonnet-4-5 |

### Web Server (`.env` in web project root)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Same Supabase project URL as bot |
| `SUPABASE_SECRET_KEY` | ✅ | Same service role key as bot |
| `BOT_TOKEN` | ✅ | Same bot token (used to verify Telegram Login Widget signatures) |
| `JWT_SECRET` | ✅ | Random secret for signing JWTs (has insecure default) |
| `PORT` | optional | Default: 3001 |
| `CLIENT_URL` | optional | CORS origin. Default: http://localhost:5173 |

### Web Client (Vite, `client/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_BOT_USERNAME` | ✅ | Telegram bot username for Login Widget (e.g. HCfinance_Bot) |
| `VITE_API_URL` | optional | API base URL (currently unused — hardcoded to `/api`) |

---

## 9. System Diagram — Complete Data Flow

```
                    ┌───────────────────────────────────────────┐
                    │              TELEGRAM                     │
                    │  Long-poll messages sent to grammy bot    │
                    └──────────────────┬────────────────────────┘
                                       │
                    ┌──────────────────▼────────────────────────┐
                    │         TELEGRAM BOT PROCESS              │
                    │         ~/Desktop/Fin Bot/                │
                    │                                           │
                    │  bot.js → parser.js ──────────────────────┼──► Anthropic API
                    │         ↓                                 │    claude-sonnet-4-5
                    │  db.js (getOrCreateUser,                  │
                    │         saveTransaction,                  │
                    │         getTransactions,                  │
                    │         getCategories)                    │
                    └──────────────────┬────────────────────────┘
                                       │ Supabase JS (service key)
                                       │
                    ┌──────────────────▼────────────────────────┐
                    │           SUPABASE POSTGRESQL             │
                    │                                           │
                    │  users          (shared)                  │
                    │  transactions   (shared)                  │
                    │  categories     (bot reads, seeded)       │
                    │  accounts       (physical, unused)        │
                    │  debts          (web only)                │
                    │  reminders      (web only)                │
                    └──────────────────┬────────────────────────┘
                                       │ Supabase JS (service key)
                    ┌──────────────────▼────────────────────────┐
                    │        EXPRESS SERVER (Railway)           │
                    │        server/index.js :3001              │
                    │                                           │
                    │  POST /api/auth/telegram                  │
                    │  GET  /api/pulse                          │
                    │  GET  /api/transactions                   │
                    │  POST /api/parse ──────────────────────────┼──► Anthropic API
                    │  POST /api/transactions/batch             │    claude-sonnet-4-5
                    │  GET/POST /api/debts                      │
                    │  PATCH /api/debts/:id/settle              │
                    │  POST /api/debts/:id/pay                  │
                    │  POST/PATCH /api/reminders                │
                    │  GET/POST /api/profile                    │
                    │  POST /api/accounts                       │
                    │  POST /api/accounts/rename                │
                    │  POST /api/accounts/adjust                │
                    │  POST /api/accounts/delete                │
                    │  GET  * → client/dist/index.html          │
                    └──────────────────┬────────────────────────┘
                                       │ HTTP REST
                    ┌──────────────────▼────────────────────────┐
                    │          REACT PWA (Vite)                 │
                    │          client/src/                      │
                    │                                           │
                    │  Auth: JWT in localStorage                │
                    │  Pages: Pulse, Add, Radar, Accounts,      │
                    │         Settings                          │
                    │  i18n: ru/en (localStorage)               │
                    │  PWA: manifest + service worker           │
                    └───────────────────────────────────────────┘
                               ▲
                    ┌──────────┴────────────────────────────────┐
                    │  Telegram Login Widget (telegram.org CDN) │
                    │  Loaded on /login page                    │
                    └───────────────────────────────────────────┘
```

---

## 10. Analysis — Duplicated Logic

### 10.1 Two AI parsers with divergent prompts and output schemas

Both the bot and the web server make independent calls to `claude-sonnet-4-5`
with different Russian prompts that produce different output shapes.

| Field | Bot output | Web output |
|-------|-----------|------------|
| `category_name` | ✅ returned | ❌ absent |
| `source` | ❌ absent | ✅ returned |
| Categories in context | ✅ injected | ❌ none |

The bot's output is richer (includes category context) but the field is discarded
before saving. The web parser produces `source` which drives the virtual accounts
system. These two parsers have drifted and cannot be trivially unified without
a schema decision.

**Impact:** A transaction entered via bot has no `source` → does not appear in
any virtual account. The same financial event looks different in the web UI
depending on which front-end was used.

### 10.2 `getOrCreateUser` implemented twice

Bot: `src/db.js` line 10 — `supabase.from('users').upsert({id, username, first_name})`
Web: `server/index.js` line 39 — same query, same fields.

Both upsert on `id` (Telegram numeric ID). Any change to the user schema
(e.g. adding `last_name`) would need to be applied in both places.

### 10.3 Number formatting

Bot: `Number.toLocaleString()` (locale-unspecified, depends on Node.js locale)
Web client: `api.js` exports `fmt()` and `fmtFull()` using `'ru-RU'` locale.
Web server: uses `Number(x).toLocaleString('en-US')` in the `todayFocus` builder (line 148).

Three different formatting approaches used in the same financial system.

### 10.4 Anthropic SDK instantiated at module level in both systems

Both create `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` at top
of their respective files. No token budget management, no retry logic, no
timeout configuration in either.

---

## 11. Analysis — Missing Integrations

### 11.1 Bot ↔ Web are not connected in real time

When a user adds a transaction via bot, the web dashboard does not update until
the next manual page refresh. There is no Supabase Realtime subscription, no
WebSocket push, and no polling on the client. This is a critical UX gap for
a product where the bot is the primary input channel.

### 11.2 Bot cannot see debts or reminders

The bot has no commands for `/debts`, `/reminders`, or `/radar`. Users must
switch to the web UI to manage these. The bot's `/balance` command is a stub.

### 11.3 Bot does not set `source` field

All bot-entered transactions have `source = null`. Virtual accounts on the
web UI are populated from `source`. This means bot-entered transactions appear
in totals but not in the accounts breakdown — the most visible part of the
Accounts page.

### 11.4 Web app never uses the `categories` table

The web parser does not inject categories into the AI prompt and does not set
`category_id` when saving transactions. The categories table exists, has seed
data, is read by the bot, but is invisible to the entire web application.

### 11.5 No Telegram push notifications from web events

When a debt becomes overdue or a reminder fires, there is no mechanism to
notify the user via Telegram. The bot only processes inbound messages.

### 11.6 `amount_idr` is null for non-IDR web transactions

The web server sets `amount_idr: t.currency === 'IDR' ? t.amount : null`.
All Pulse/Radar calculations use `amount_original` exclusively (not `amount_idr`).
Multi-currency support is schema-ready but calculation-unready.

---

## 12. Analysis — Future Scaling Risks

### 12.1 Single `server/index.js` — monolithic, unbounded

All routes, all business logic, all middleware, and all Supabase queries are
in one 397-line file. Adding Teams, Invoices, Banking, or multi-company
features (Roadmap Phase 2–4) will make this file unmanageable.

**Risk level:** High. Must be modularized before Phase 2.

### 12.2 Virtual accounts computed at every `/api/pulse` request

The Pulse endpoint fetches ALL transactions ever for a user, then groups them
in-memory to derive account balances:

```js
const { data: allTxs } = await allTxQuery  // every transaction ever
const sourceMap = {}
allTxs.forEach(t => { ... })
```

At 100 transactions this is fine. At 10,000 transactions this becomes a
full table scan + large in-memory object on every page load.

**Risk level:** Medium now, Critical at scale.

### 12.3 Bot uses in-memory `pending` map for confirmation state

```js
const pending = {}   // in server/index.js equivalent in bot.js
pending[key] = transactions
```

This is a plain object in the bot process heap. If the bot crashes, restarts,
or scales to multiple instances, all pending confirmations are lost. Users
who confirmed transactions mid-restart would silently lose their data.

**Risk level:** Medium for single-instance; Critical for HA/multi-instance.

### 12.4 No database connection pooling

Both systems call `createClient()` once and reuse the connection. Supabase's
JavaScript client manages its own pooling via PostgREST, so this is acceptable
at low traffic, but there is no explicit pool size configuration or connection
timeout handling.

### 12.5 CORS is hardcoded to one origin

```js
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
```

A single `CLIENT_URL`. Supporting staging + production + preview deployments
would require this to become an allow-list array.

### 12.6 No API rate limiting

`POST /api/parse` triggers a paid Anthropic API call on every request.
There is no rate limiting, no per-user call budget, and no circuit breaker.
A single user making automated requests could exhaust the API budget.

### 12.7 Photo stored as base64 in the database

`Settings.jsx` converts uploaded photos to base64 JPEG at 200×200px and
saves the entire base64 string to `users.photo_url`. This column will grow
to ~15–20KB per user. At 10,000 users that is ~150–200MB in the users table
for what should be file storage.

---

## 13. Analysis — Technical Debt

### 13.1 No TypeScript

Both systems use plain JavaScript with no type checking. The transaction object
shape is inconsistently typed across bot parser output, web parser output,
DB schema, and client-side state. Field names diverge (`amount` vs `amount_original`,
`category_name` vs `category_id`, `source` present/absent).

### 13.2 i18n is incomplete

`client/src/i18n/en.js` and `ru.js` exist. Settings.jsx shows 15 language options
(Indonesian, Chinese, Arabic, Spanish, French, German, Portuguese, Hindi, Japanese,
Korean, Turkish, Vietnamese, Thai) but only `en` and `ru` translation files exist.
Selecting any other language silently falls back to English.

### 13.3 `category_id` and `account_id` are orphaned columns

The transactions table schema has `category_id INT REFERENCES categories(id)` and
`account_id INT REFERENCES accounts(id)`. Neither column is ever populated by either
system. They exist as schema intention that was never implemented.

### 13.4 The physical `accounts` table is vestigial

`migration.sql` creates an `accounts` table. The bot has `getUserAccounts()` that
reads it. But the bot never calls this function in any handler. The web app
never writes to it. The table likely has 0 rows in production and serves no
current purpose.

### 13.5 `migration_v3.sql` is additive but not versioned

`migration_v3.sql` contains `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type`.
This implies migrations v1 and v2 exist somewhere (likely only the bot's
`migration.sql`). There is no migration runner, no migration history table,
and no guarantee the schema in the DB matches the code's expectations.

### 13.6 Bot `/balance` command is a stub

```js
bot.command('balance', async (ctx) => {
  await ctx.reply('Функция балансов — скоро!');
});
```

This has been a stub since the initial commit with no issue or milestone
tracking its completion.

### 13.7 Snooze modal makes no API call

`Pulse.jsx` line 356: the snooze confirmation handler calls `alert()` and
closes the modal. No API call is made. No reminder is updated. The feature
is visually complete but functionally broken.

```jsx
onClick={() => { alert('Snoozed: ' + opt.label); setSnoozeModal(null) }}
```

### 13.8 `focusDone` state is not persisted

Checking off a "Today's Focus" item on the Pulse page sets local state
`focusDone[id] = true`. This is not sent to the server. On refresh, all items
reappear unchecked.

### 13.9 Login.jsx `useEffect` not visible in this codebase

`Login.jsx` was not found in the pages directory glob — it exists at
`client/src/pages/Login.jsx` (confirmed by App.jsx import). The file content
was not captured in this analysis; the Telegram Login Widget implementation
details inside it are unknown beyond what's visible in `useAuth.jsx`.

---

## 14. Analysis — Security Risks

### 14.1 CRITICAL — Service Role Key in both processes

Both the bot and the web server use `SUPABASE_SECRET_KEY` (service role),
which bypasses ALL Row Level Security policies. If either process is compromised
or the key is leaked, the attacker has unrestricted read/write access to the
entire database including all users' financial data.

**Mitigation:** Use the anon key + RLS policies for row-scoped access.
Service role should only be used for admin operations.

### 14.2 HIGH — JWT_SECRET has an insecure default

```js
const JWT_SECRET = process.env.JWT_SECRET || 'helm-finance-secret'
```

If the environment variable is not set, every JWT is signed with a public
string. An attacker who knows the default could forge valid tokens for any
`userId`.

### 14.3 HIGH — No Telegram Login Widget data re-validation after 24h

The auth route checks `auth_date` is within 24 hours. But once a JWT is issued
(30-day expiry), there is no mechanism to invalidate it if the Telegram account
is compromised, the user deauthorizes the app, or the bot token is rotated.

### 14.4 MEDIUM — XSS surface: `photo_url` rendered as `<img src>`

`Settings.jsx` and `Pulse.jsx` render `user.photo_url` and `profile.photo_url`
directly in `<img src={...}>`. If this value were ever set from an external
source to a `javascript:` URI, it would execute. Currently photo_url can only
be set by the user themselves (file upload), so this is low severity today —
but if `/api/auth/telegram` starts syncing `photo_url` from Telegram's auth
data, the risk increases.

### 14.5 MEDIUM — No input validation on parse endpoint

`POST /api/parse` accepts `{ text }` and passes it directly into the AI prompt
as a template literal:

```js
content: `... Текст: "${text}"`
```

There is no length limit enforced server-side (Express limit is 10mb). A large
text input could drive up Anthropic API costs. Prompt injection is theoretically
possible (a user could craft text to manipulate the AI output), though since
the output is only JSON parsed by the same user's client, the practical risk is
low.

### 14.6 MEDIUM — No HTTPS enforcement

The Express server has no HTTPS redirect or HSTS header. Railway handles TLS
termination upstream, but if the service is ever accessed directly or deployed
elsewhere, JWT tokens could be sent over plain HTTP.

### 14.7 LOW — Telegram Login Widget `data-auth-url` not set

The Login Widget has no `data-auth-url` callback configured (bot domain is
the only check). The widget posts data to the page via callback. If the
widget's origin changes, the data would not be verified.

### 14.8 LOW — `localStorage` token storage

The JWT is stored in `localStorage('hf_token')`. This is accessible to any
JavaScript on the page, making it vulnerable to XSS. `HttpOnly` cookie storage
would be more secure, but this is a known trade-off for PWA-first apps.

---

## Summary Table

| Category | Item | Severity |
|----------|------|----------|
| Security | Service role key used everywhere | CRITICAL |
| Security | JWT_SECRET hardcoded default | HIGH |
| Security | No JWT revocation | HIGH |
| Missing | Bot ↔ Web real-time sync | HIGH |
| Missing | Bot cannot see/set source field | HIGH |
| Duplicated | AI parser (two implementations) | HIGH |
| Duplicated | getOrCreateUser (two implementations) | MEDIUM |
| Scaling | Full TX scan on every Pulse load | MEDIUM |
| Scaling | In-memory pending map in bot | MEDIUM |
| Scaling | No API rate limiting | MEDIUM |
| Scaling | Photo as base64 in DB | MEDIUM |
| Debt | No TypeScript | MEDIUM |
| Debt | i18n incomplete (13 missing languages) | MEDIUM |
| Debt | category_id / account_id orphaned | MEDIUM |
| Debt | Snooze modal makes no API call | MEDIUM |
| Debt | focusDone not persisted | LOW |
| Debt | Bot /balance is a stub | LOW |
| Debt | Physical accounts table unused | LOW |
| Debt | No migration versioning | LOW |
| Scaling | Monolithic server/index.js | HIGH (future) |
| Scaling | Single CORS origin | LOW now |
