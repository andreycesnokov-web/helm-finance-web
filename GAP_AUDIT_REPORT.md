# HELM FINANCE — TECHNICAL GAP AUDIT REPORT
Version: 1.0
Date: 2026-06-10
Status: Completed — DO NOT start implementation without reviewing this first

---

## A. CURRENT SYSTEM SUMMARY

### What exists and works today

| Layer | Status | Notes |
|---|---|---|
| Auth | ✅ Working | Telegram Login Widget + JWT 30d, Bearer token middleware |
| Transactions (web) | ✅ Working | GET /api/transactions, POST /api/parse, POST /api/transactions/batch |
| Pulse | ✅ Working | GET /api/pulse?scope=all/business/personal, virtual accounts, AI summary |
| Accounts (virtual) | ✅ Working | Derived from transactions.source at query time |
| Debts / Receivables / Payables | ✅ Working | GET/POST /api/debts, PATCH settle/pay |
| Reminders | ✅ Working | POST /api/reminders, PATCH done/snooze |
| Telegram bot input | ✅ Working | grammy bot, canonical AI parse, saveTransaction |
| Bot reports | ⚠️ Broken | getTransactionsFiltered uses broken categories join |
| Account Delete | ⚠️ Bug | Deletes source, Pulse re-creates 'Personal' virtual account immediately |
| Desktop layout | ✅ Working | Sidebar + BottomNav + RightPanel (AI CFO summary) |
| Pages | ✅ Working | Pulse, Add, Radar, Accounts, Settings — all functional |

### What does NOT exist anywhere in the codebase

- `businesses` table — does not exist
- `business_members` table — does not exist
- `plans` / `subscriptions` / `usage_limits` / `usage_events` tables — do not exist
- `business_id` column — not in transactions, reminders, debts, or any table
- Role / permission check — not in any endpoint
- Plan / subscription / trial check — not in any endpoint
- Usage limit check — not in any endpoint
- Invoices module — no table, no API, no frontend page
- Payroll module — no table, no API, no frontend page (Payroll page referenced in specs only)
- Multi-business support — not implemented anywhere
- AI CFO engine (`/api/cfo/context`) — not implemented
- Transactions page (dedicated) — no separate page, transactions shown in Pulse only

---

## B. DATABASE GAP AUDIT

### Existing tables (confirmed from code)

| Table | Status | Used by |
|---|---|---|
| `users` | ✅ Exists | Auth, all queries |
| `transactions` | ✅ Exists | All core logic |
| `debts` | ✅ Exists | Receivables/Payables |
| `reminders` | ✅ Exists | Reminders/Snooze |
| `profiles` | ✅ Exists | GET/POST /api/profile |
| `categories` | ⚠️ Uncertain | Referenced in db.js join, probably empty/unused |
| `accounts` | ❌ Does NOT exist | db.js `getUserAccounts` queries it — broken |

### Missing tables (required by architecture)

| Table | Priority | Risk if missing | Notes |
|---|---|---|---|
| `businesses` | P0 — Critical | Cannot scope any data per business | Root object in V2 architecture |
| `business_members` | P0 — Critical | No multi-user, no roles | Required for team access |
| `plans` | P1 | Cannot enforce limits | Seed data needed |
| `subscriptions` | P1 | No trial, no paid plan tracking | Per-business |
| `usage_limits` | P1 | Cannot count AI/voice/tx usage | Monthly reset needed |
| `usage_events` | P1 | No audit trail, no billing analytics | Event log |
| `billing_events` | P2 | No billing audit | Stripe webhooks later |
| `feature_flags` | P2 | No per-business overrides | Enterprise/beta |
| `invoices` | P1 | Invoices module blocked | Core product feature |
| `payroll` / `payroll_entries` | P2 | Payroll module blocked | Business plan feature |

### Missing columns in existing tables

| Table | Missing Column | Priority | Impact |
|---|---|---|---|
| `transactions` | `business_id UUID` | P0 | Cannot scope per business |
| `transactions` | `category` TEXT | ✅ Already added (parser returns it, saveall writes it) | — |
| `transactions` | `category_id` | ⚠️ Exists but always NULL — dead column | Should be dropped later |
| `transactions` | `account_id` | ⚠️ Exists but always NULL — dead column | Should be dropped later |
| `debts` | `business_id UUID` | P0 | Cannot scope per business |
| `reminders` | `business_id UUID` | P0 | Cannot scope per business |
| `users` | `telegram_id BIGINT` | Check — used for auth, should exist | |

---

## C. BACKEND / API GAP AUDIT

### Existing endpoints — status

| Endpoint | Status | Issues |
|---|---|---|
| `GET /api/pulse` | ✅ Works | No business_id scope, personal account bug |
| `GET /api/transactions` | ✅ Works | No business_id filter |
| `POST /api/parse` | ✅ Works | Canonical prompt, returns category field |
| `POST /api/transactions/batch` | ✅ Works | Writes user_id only |
| `GET /api/debts` | ✅ Works | No business_id filter |
| `POST /api/debts` | ✅ Works | No business_id |
| `PATCH /api/debts/:id/settle` | ✅ Works | No ownership check beyond user_id |
| `POST /api/debts/:id/pay` | ✅ Works | No ownership check beyond user_id |
| `POST /api/reminders` | ✅ Works | No business_id |
| `PATCH /api/reminders/:id/done` | ✅ Works | No ownership check |
| `PATCH /api/reminders/:id/snooze` | ✅ Works | No ownership check |
| `POST /api/accounts/adjust` | ✅ Works | Inserts adjustment transaction |
| `POST /api/accounts/delete` | ⚠️ Bug | Sets source=null, Pulse re-creates 'Personal' |
| `POST /api/accounts/rename` | ✅ Works | Updates source string on all matching tx |
| `POST /api/accounts` | ✅ Works | Inserts opening balance transaction |
| `GET /api/profile` | ✅ Works | — |
| `POST /api/profile` | ✅ Works | — |

### Missing endpoints (required by architecture / product)

| Endpoint | Priority | Module |
|---|---|---|
| `POST /api/businesses` | P0 | Business setup |
| `GET /api/businesses` | P0 | Business selector |
| `POST /api/businesses/:id/members` | P1 | Team Access |
| `GET /api/businesses/:id/members` | P1 | Team Access |
| `GET /api/businesses/:id/subscription` | P1 | Plan/Trial status |
| `POST /api/invoices` | P1 | Invoices module |
| `GET /api/invoices` | P1 | Invoices module |
| `PATCH /api/invoices/:id` | P1 | Invoices module |
| `GET /api/payroll` | P2 | Payroll module |
| `POST /api/payroll` | P2 | Payroll module |
| `GET /api/cfo/context` | P1 | AI CFO engine |
| `GET /api/usage` | P1 | Usage limits display |
| `POST /api/auth/upgrade` | P2 | Subscription upgrade |

### Critical missing middleware

| Check | Current State | Required |
|---|---|---|
| Business membership check | ❌ Not implemented | Every endpoint needs this |
| Role/permission check | ❌ Not implemented | Owner / Manager / Employee / Viewer |
| Plan/feature check | ❌ Not implemented | Before feature execution |
| Usage limit check | ❌ Not implemented | Before AI, voice, tx, invoice actions |
| Trial validity check | ❌ Not implemented | On every authenticated request |

### Current auth middleware — what it checks

```javascript
// server/index.js — current auth (lines ~30-45)
// Only checks: JWT exists → valid → user_id extracted
// Does NOT check: business membership, role, plan, usage limits, trial
```

---

## D. TELEGRAM BOT GAP AUDIT

### bot.js

| Feature | Status | Notes |
|---|---|---|
| Text transaction input | ✅ Works | classifyMessage → parseTransactions → confirm → saveall |
| Voice input | ✅ Works | Whisper transcription → same parse flow |
| Report generation | ⚠️ Broken | `getTransactionsFiltered` broken join (categories) |
| Business context | ❌ Missing | No business_id, no business selector |
| Plan check | ❌ Missing | No usage limit on AI requests or voice |
| Role check | ❌ Missing | No permission validation |
| Usage counting | ❌ Missing | Voice inputs not counted against limits |

### db.js — critical bugs

| Function | Status | Bug |
|---|---|---|
| `saveTransaction` | ✅ Works | Clean insert, correct fields |
| `getTransactionsFiltered` | ❌ Broken | `.select('*, categories(name, emoji)')` — foreign key join on `category_id` which is always NULL |
| `getUserAccounts` | ❌ Broken | Queries `FROM accounts` — this table does not exist |
| `getCategories` | ⚠️ Unused | Queries `categories` table — likely empty, but not called in current flow |

### parser.js

| Feature | Status | Notes |
|---|---|---|
| Canonical prompt | ✅ Correct | Matches web server /api/parse exactly |
| parseTransactions | ✅ Works | Returns: type, amount, currency, description, source, scope, project, category |
| classifyMessage | ✅ Works | Returns "transaction" or "query" |
| parseQuery | ✅ Works | Returns period/type/scope |

---

## E. FRONTEND GAP AUDIT

### App.jsx — current routes

```
/ → Pulse (with RightPanel AI CFO)
/add → Add (transaction input)
/radar → Radar (30-day forecast)
/accounts → Accounts (virtual accounts list)
/settings → Settings
```

### Missing pages / routes

| Page | Priority | Notes |
|---|---|---|
| `/transactions` | P1 | Dedicated transactions list with filter/search |
| `/invoices` | P1 | Invoices module |
| `/invoices/new` | P1 | Create invoice |
| `/payroll` | P2 | Payroll module |
| `/team` | P2 | Business members management |
| `/cfo` | P1 | AI CFO full screen (desktop) |
| `/settings/billing` | P2 | Plan / subscription management |
| `/settings/business` | P1 | Business profile |

### Existing pages — gaps

#### Pulse.jsx
- ✅ Scope filter (all/business/personal)
- ✅ Debt pay modal
- ✅ Snooze modal (reminders only — debt snooze is future)
- ✅ Focus items (upcoming debts and reminders)
- ❌ No business selector (hardcoded to user's single context)
- ❌ No plan/trial banner or usage counter
- ❌ No upgrade prompt when limits hit

#### Radar.jsx
- ✅ 30-day projection: base + best + worst case
- ✅ Receivables / payables timeline
- ⚠️ Only uses `/pulse` data — no dedicated Radar API
- ❌ No runway formula using spec: `(cash + recv_30d - pay_30d - payroll_30d) / daily_burn`
- ❌ No payroll in projection (payroll module not built)
- ❌ Projection math is client-side only — not server-calculated

#### Accounts.jsx
- ✅ Shows virtual accounts from /pulse
- ✅ Add / Edit / Delete flow
- ❌ Delete bug: sets source=null → Pulse re-creates 'Personal' immediately
- ❌ No business_id scope
- ❌ No account limit enforcement (Free Plan: 1 account)

#### App.jsx — RightPanel
- ✅ AI CFO status (healthy/attention/critical)
- ✅ AI summary text from Pulse
- ✅ Upcoming debts
- ✅ Quick stats (runway, burn rate, net position, receivables, payables)
- ❌ Recommendation is hardcoded logic (not AI-generated): 3 static strings based on runway days
- ❌ No AI Chat input in RightPanel (only shows summary)
- ❌ No business switcher in sidebar

#### Settings.jsx (not read, but referenced)
- Expected: profile, theme, logout
- ❌ No billing / subscription section

### Desktop layout status
- ✅ Sidebar with 5 nav items
- ✅ BottomNav for mobile (4 items, Settings hidden)
- ✅ Desktop 3-column layout (Sidebar + Main + RightPanel)
- ❌ Sidebar shows Settings in nav array but it's not visible in BottomNav
- ❌ No business switcher in sidebar header
- ❌ No plan/trial status indicator in sidebar
- ❌ Missing sections: Transactions, Invoices, Payroll, Team, AI CFO

---

## F. PERSONAL ACCOUNT DELETE BUG — ROOT CAUSE ANALYSIS

### Bug flow

```
User clicks "Delete account" on account named "Personal"
         ↓
POST /api/accounts/delete { name: "Personal" }
         ↓
server/index.js line ~355:
  UPDATE transactions SET source = null WHERE source = 'Personal' AND user_id = $uid
         ↓
User returns to Accounts page → page calls GET /api/pulse
         ↓
server/index.js line 121-124 (Pulse):
  const src = t.source || (t.scope === 'business' ? 'Helm Care Pay' : 'Personal')
  // source is NULL → scope is 'personal' → src becomes 'Personal'
         ↓
Virtual account 'Personal' is reconstructed from all null-source personal transactions
         ↓
Accounts page shows 'Personal' again — delete had no visible effect
```

### Fix options

**Option A — Preferred: Filter null-source transactions out of accounts list**
- In Pulse query: group accounts only where `source IS NOT NULL`
- Null-source transactions still exist and are counted in totals
- 'Personal' virtual account is not recreated from nulled transactions

**Option B: Use sentinel value instead of null**
- `POST /api/accounts/delete` sets `source = '__deleted__'` instead of `null`
- Pulse explicitly filters `WHERE source != '__deleted__'`
- Cleaner semantics but requires migrating existing null-source transactions

**Option C: Soft-delete with flag**
- Add `source_deleted BOOLEAN` to transactions
- Set flag on delete instead of nulling source
- Most correct but highest complexity

**Recommendation: Option A** — minimal change, no data migration needed, preserves transaction totals.

### Code change required (Option A)

In `server/index.js`, Pulse virtual account grouping:
```javascript
// Current (line ~121):
const src = t.source || (t.scope === 'business' ? 'Helm Care Pay' : 'Personal')

// Change to:
const src = t.source  // skip null-source transactions in account grouping

// And in account accumulation — skip if src is null:
if (!src) return acc  // don't add to accounts, but still count in totals
```

---

## G. RECOMMENDED NEXT TASKS (PRIORITY ORDER)

### Phase 0 — Foundation (do before any new feature)

| Task | Risk | Effort |
|---|---|---|
| Fix Personal Account Delete bug (Option A) | Low — 5-line change | 30 min |
| Fix `getTransactionsFiltered` broken join in db.js | Low — remove categories join | 15 min |
| Remove `getUserAccounts` function from db.js (or stub it) | Low — unused, queries nonexistent table | 15 min |
| Create `migrations/003_multi_business.sql` and run in Supabase | Medium — additive, no data loss | 2h |
| Add `business_id` column to transactions, debts, reminders (nullable first) | Low risk if nullable | 30 min |
| Create `businesses` and `business_members` tables | Low risk | 1h |
| Create first Business row for existing users (backfill) | Medium — data migration | 1h |
| Add `plans` seed data (free, starter, business, founder, enterprise) | Low | 1h |
| Create `subscriptions` table, add trial subscription for all existing businesses | Medium | 2h |

### Phase 1 — Business ID wiring

| Task | Notes |
|---|---|
| Add business_id to all API queries (server/index.js) | After migration run |
| Add business membership middleware | Replaces current user_id-only auth |
| Add business_id to bot saveTransaction | After db schema update |
| Business selector in Telegram bot (/business command) | For multi-business support |
| Business selector in sidebar (web) | UI change |

### Phase 2 — Plan/Trial enforcement

| Task | Notes |
|---|---|
| Create usage_limits table and reset job | Monthly counters |
| Add feature access middleware | Check plan before action |
| Add usage limit middleware | Check count before action |
| Trial banner in Pulse/Sidebar | Show days remaining |
| Upgrade prompt on limit hit | Conversion touchpoint |

### Phase 3 — New modules

| Task | Notes |
|---|---|
| Invoices module (API + frontend) | Per INVOICES_MODULE_SPEC.md |
| Dedicated Transactions page with filter | Separate from Pulse |
| AI CFO engine (`/api/cfo/context`) | Per ARCHITECTURE_V2.md |
| AI Chat in RightPanel | Replace static recommendation |

---

## H. DO NOT TOUCH YET

The following are working and must not be changed without a migration plan and regression test:

| System | Reason |
|---|---|
| Telegram bot transaction input (text + voice) | Core user habit — any break is critical |
| `POST /api/parse` — canonical prompt | Works, used by both web and bot |
| `POST /api/transactions/batch` | Used by web after confirm |
| Bot `saveall` callback | Correctly writes all fields including category |
| Pulse virtual accounts logic | Working — only fix the delete bug |
| `GET /api/pulse` | Working — highest-traffic endpoint |
| JWT auth middleware | Working — extend, don't replace |
| `PATCH /api/reminders/:id/snooze` | Working, used in Pulse |
| `POST /api/debts/:id/pay` | Working, used in Pulse |
| React router structure (App.jsx) | Working desktop+mobile layout |
| RightPanel AI CFO display | Working static summary display |

### Specific code NOT to change yet

- `DROP COLUMN category_id` — deferred, waiting for confirmation no code references it
- `DROP COLUMN account_id` — deferred, same reason
- Group C (auto-generated transaction hygiene) — deferred per previous decision
- Group G (source normalization) — deferred per previous decision

---

## SUMMARY: BY THE NUMBERS

| Category | Count |
|---|---|
| Working features | 17 |
| Confirmed bugs | 2 (account delete, getTransactionsFiltered) |
| Broken functions (db.js) | 2 (getUserAccounts, getTransactionsFiltered) |
| Missing database tables | 10 |
| Missing API endpoints | 13 |
| Missing frontend pages | 8 |
| Missing middleware layers | 5 |
| Endpoints with NO business_id scope | 100% (all 16 existing endpoints) |
| Endpoints with NO plan/trial check | 100% (all 16 existing endpoints) |

**The system is fully functional as a single-user MVP.**
**Zero architecture exists for multi-business, plans, subscriptions, or feature access.**
**All new product features depend on the Phase 0 foundation tasks above.**
