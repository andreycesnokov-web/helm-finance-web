# Helm Finance Web — Architecture

## Overview

Full-stack monorepo: Express API server + React PWA client, deployed on Railway.

```
helm-finance-web/
├── server/
│   └── index.js          Single-file Express server (395 lines)
├── client/
│   ├── index.html        PWA shell (also defines #root styles)
│   ├── vite.config.js    Vite dev server, proxy /api → :3001
│   ├── public/           PWA manifest, icons, service worker
│   └── src/
│       ├── main.jsx      React entry point
│       ├── App.jsx       Router, Sidebar, BottomNav, RightPanel, Layout
│       ├── index.css     CSS layout (does NOT define color tokens)
│       ├── lib/
│       │   └── api.js    fetch wrapper, fmt/fmtFull/daysUntil helpers
│       ├── hooks/
│       │   ├── useAuth.jsx      Auth context (JWT + Telegram)
│       │   └── useTranslation.js  i18n hook
│       ├── i18n/
│       │   ├── index.js  Translation engine (module-level state)
│       │   ├── en.js     English strings
│       │   └── ru.js     Russian strings
│       └── pages/
│           ├── Login.jsx     Telegram widget login
│           ├── Pulse.jsx     Main dashboard (debts, AI status, vitals)
│           ├── Add.jsx       Add transaction / debt / reminder (AI parse)
│           ├── Accounts.jsx  Account list & management
│           ├── Radar.jsx     30-day cash forecast
│           └── Settings.jsx  Profile, language, timezone, notifications
├── files/                Mirror of client/public (legacy, unused at runtime)
├── migration_v3.sql      PostgreSQL migration: debts, reminders, accounts.type
└── package.json          Root: server deps + concurrently scripts
```

## Data Flow

```
User → Telegram Bot ──(writes to Supabase)──→ transactions / accounts
User → Web/PWA ─→ React client ─→ Express API ─→ Supabase PostgreSQL
                                         └─→ Anthropic Claude (AI parse)
```

## Auth Flow

1. Telegram Login Widget → `POST /api/auth/telegram`
2. Server verifies HMAC with BOT_TOKEN, upserts user in Supabase
3. Server returns JWT (30d) signed with JWT_SECRET
4. Client stores JWT in `localStorage['hf_token']`
5. `useAuth` verifies JWT on mount by calling `GET /api/pulse`
6. All subsequent API calls send `Authorization: Bearer <token>`

## Desktop Layout (≥1024px)

```
[Sidebar 220px] [desktop-main max 520px] [desktop-right 300px]
```
- Sidebar and RightPanel rendered in `App.jsx`
- Main content rendered per-page in `.desktop-main`
- `BottomNav` hidden on desktop

## Mobile Layout (<1024px)

```
[Full-width page content]
[BottomNav fixed bottom, max-width 430px]
```
- Sidebar and RightPanel hidden
- #root centered at max 430px in index.html inline style

## Key Entity Map (Supabase tables)

| Table          | Key Columns                                          |
|----------------|------------------------------------------------------|
| users          | id, username, first_name, last_name, photo_url, language, timezone |
| transactions   | id, user_id, type, amount_original, currency_original, amount_idr, description, source, scope, project |
| debts          | id, user_id, type (receivable/payable), counterparty, amount, due_date, is_settled |
| reminders      | id, user_id, title, meta, due_date, is_done         |
| accounts       | id, name, type (personal/business) — *virtual; derived from transaction.source* |

**Note:** The `accounts` table referenced in migration_v3.sql already exists (created by the Telegram bot repo). Accounts in the web app are synthesized from `transactions.source` grouping, not from a separate accounts table.

## Server API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/telegram | no | Login via Telegram widget |
| GET | /api/pulse | yes | Full dashboard data |
| GET | /api/debts | yes | Unsettled debts |
| POST | /api/debts | yes | Create debt/receivable |
| PATCH | /api/debts/:id/settle | yes | Mark debt settled |
| POST | /api/debts/:id/pay | yes | Record payment |
| GET | /api/transactions | yes | Transaction list (broken: references categories) |
| POST | /api/reminders | yes | Create reminder |
| PATCH | /api/reminders/:id/done | yes | Mark reminder done |
| POST | /api/parse | yes | AI text → transactions (Claude) |
| POST | /api/transactions/batch | yes | Bulk save transactions |
| POST | /api/accounts | yes | Create account (via opening-balance tx) |
| POST | /api/accounts/adjust | yes | Adjust balance (via adjustment tx) |
| POST | /api/accounts/delete | yes | Clear source from transactions |
| POST | /api/accounts/rename | yes | Rename source across transactions |
| GET | /api/profile | yes | Get user profile |
| POST | /api/profile | yes | Update user profile |
| GET | * | no | Serve React SPA (client/dist) |

## i18n System

Module-level singleton in `i18n/index.js`. Language stored in `localStorage['hf_lang']`. Language change dispatches `window.Event('langchange')`. Only EN and RU are implemented; Settings shows 15 languages but most are unsupported.

## CSS Theme System

Layout CSS in `client/src/index.css`. Color CSS variables (`--bg`, `--text`, `--border`, etc.) are used extensively throughout but **are not defined in any file** (see BUG_REPORT.md #1).
