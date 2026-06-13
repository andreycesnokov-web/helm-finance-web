# CFO AI — Architecture & Source of Truth

> Last updated: 2026-06-12 · "Migrate financial data access to business scope" (migration 017)

## A. Product purpose

CFO AI is a financial operating system for small-business owners (primary market:
Indonesia, IDR base). One owner runs their business cash, receivables, payables,
payroll and team through a Web App, with Telegram as an operational channel and
an AI CFO as the analysis layer.

## B. Core objects

| Object | Table | Identity | Notes |
|---|---|---|---|
| User | `users` | **BIGINT id = Telegram user id** | Platform identity. Created via Telegram Login upsert. |
| Business | `businesses` | UUID | Financial workspace. `owner_user_id BIGINT → users(id)`. |
| Business Member | `business_members` | UUID | `user_id BIGINT`, role: owner / admin / cfo / manager / employee. |
| Invite | `business_invites` | UUID | 6-char code, role, expiry, max_uses. |
| Wallet | `wallets` | UUID | Money container. `scope: business \| personal`. Balance is **always computed** from transactions, never stored. |
| Transaction | `transactions` | BIGINT | The only confirmed money movement. |
| Receivable / Payable | `debts` | BIGINT | Expected money. `type: receivable \| payable`. |
| Payroll | `payroll_employees`, `payroll_payments`, `payroll_payment_items` | BIGINT | Salary context layer **over** transactions. |
| Task | (none) | — | Tasks page is a **derived view**: generated from debts/pulse data, no table. |
| AI CFO | — | — | Analysis layer. Not a source of truth. |
| Telegram | — | — | Operational channel. Not a source of truth. |
| WhatsApp | — | — | Future premium channel. Same backend, not a separate system. |

**ID convention: `users.id` is BIGINT (= Telegram id). Every new user reference
must be BIGINT.** All migrations conform (002–016 verified).

## B2. Business-scoped financial data (migration 017)

Since migration 017, **`business_id` is the financial owner** of wallets,
transactions, debts, payroll (employees/payments/items), reference data and
reminders. Responsibility fields:

| Field | Meaning |
|---|---|
| `business_id` | which workspace owns the record (UUID → businesses) |
| `user_id` | legacy compatibility: always set to the business **owner's** id on new records |
| `created_by_user_id` | the person who actually created the record |
| `approved_by_user_id` | the person who approved (debts) |

**Access resolution** (`resolveActiveBusiness` in server/index.js):
`x-business-id` header → `?business_id` → `body.business_id` → user's default
business (`ensureDefaultBusiness`). A requested business where the caller is
not an active member silently falls back to their default — no cross-business
leak, and a stale localStorage id after account switching cannot break the app.

**Read filter** (`bizOrFilter`): `business_id = <active>` OR
(`business_id IS NULL` AND `user_id = <owner>`) — the legacy branch keeps
pre-migration rows visible to the owner until backfill completes.

**Write rule** (`bizWriteFields`): every new financial record gets
`business_id`, `user_id = owner`, `created_by_user_id = acting user`.

**Role gates** (backend-first; role-specific frontend UX is a follow-up task):

| Capability | owner | admin | cfo | accountant | manager | employee | auditor |
|---|---|---|---|---|---|---|---|
| view finance (pulse, wallets, transactions) | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| create confirmed records (batch, pay, settle) | ✓ | ✓ | ✓ | ✓ | — | — | — |
| submit requests (debts → pending_approval) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| approve / reject / request-info | ✓ | ✓ | ✓ | — | — | — | — |
| manage payroll | ✓ | ✓ | ✓ | — | — | — | — |
| manage wallets (create/edit/delete/adjust) | ✓ | ✓ | ✓ | — | — | — | — |
| use AI CFO | ✓ | ✓ | ✓ | ✓ | — | — | — |

Manager/employee on `GET /api/debts` see **only their own submissions**
(`created_by_user_id = caller`). Web-created debts by manager/employee are
forced to `pending_approval` regardless of client payload.

**Frontend**: `apiFetch` sends `x-business-id` from localStorage; `useAccess`
persists `business.id` after `/access/status`. Single-business users never see
a switcher; a multi-business switcher is future work.

**Telegram**: `POST /api/debts/from-telegram` accepts optional `business_id`
(membership validated). Without it: single membership → that business;
multiple memberships → `409 multiple_businesses` (bot must ask which one);
no membership → legacy owner-telegram-id path with NULL business_id.

## C. Source of truth

```
Database (Supabase Postgres) + backend validation (server/index.js) = truth
AI CFO / Telegram / Web App / future mobile / WhatsApp = interfaces
```

- Wallet balances are derived: `Σ income − Σ (expense + payroll) + Σ correction (signed)`
  over transactions matched by `wallet_id` OR legacy `source == wallet.name`.
- `debts.original_amount` is locked at creation and never mutated; progress is
  `paid_amount` / `status`.
- No interface may compute its own financial logic. Telegram bot calls the same
  endpoints as the Web App.

## D. Money movement rules (cash impact model)

| Event | Cash effect |
|---|---|
| `income` transaction | + wallet |
| `expense` transaction | − wallet |
| `payroll` transaction | − wallet (net paid only) |
| `correction` transaction | signed delta (±), excluded from income/expense KPIs |
| `transfer` transaction | **NEUTRAL (Phase 1 limitation)** — only one leg stored; no destination credit |
| Creating a receivable | no cash change |
| Creating a payable | no cash change |
| Debt payment (`POST /api/debts/:id/pay`) | exactly one transaction (income for receivable, expense for payable) |
| Payroll payment (`POST /api/payroll/payments`) | exactly one transaction (net amount); items are display-only |
| Wallet adjust-balance | one signed `correction` transaction; wallet row never touched |

Hard rules:
- Payables are NOT expenses until paid. Receivables are NOT cash until received.
- One business event = one transaction. Payroll components and debt records never
  create a second cash impact.

## E. Receivables / Payables logic

States: `status` (open / due_soon / overdue / partial / paid / cancelled — partly
computed via `enrichDebts`) × `approval_status` (approved / pending_approval / rejected).

- Only `approved` (or legacy null) records count in Pulse / AI CFO totals.
- `pending_approval` = Telegram submissions from employee/manager. Shown in UI
  with amber border + "⏳ Pending approval", surfaced as `pendingReceivables` /
  `pendingPayables` in Pulse and `pending_submissions` in AI CFO context —
  **never** in confirmed totals.
- `rejected` → `status = cancelled`, excluded everywhere.
- Overpayment is blocked server-side (`paymentAmount > remaining + 0.01` → 400).
- Partial payment → `status = partial`; full → `paid` + `is_settled`.
- Audit fields: `source_channel`, `raw_input_text`, `created_by_user_id/_name/_role/_telegram_id`,
  `approved_by_user_id`, `approved_at`, `approved_via_channel`, `last_action_channel`,
  `linked_transaction_id`, `last_payment_at`, `info_request_*`.

⚠️ Known inconsistency (documented, not changed): `PATCH /api/debts/:id/settle`
marks a debt paid **without creating a transaction** (no cash impact). Use it only
for "settled outside the system". The normal path is `/pay`.

## F. Payroll logic

```
gross  = Σ items where direction = addition
deduct = Σ items where direction = deduction
net    = gross − deduct   (must be > 0)
```

- One payment → one `payroll` transaction for **net** only, linked via
  `payroll_payments.transaction_id`.
- Items live in `payroll_payment_items`, zero cash impact.
- Legacy V1 single-amount payments still accepted (fallback path).
- Transactions page expands payroll rows inline via `GET /api/payroll/by-transaction/:id`.

## G. Telegram role model

Telegram is an operational channel; behaviour depends on `business_members.role`:

| Role | Telegram behaviour |
|---|---|
| employee / manager | **Input channel.** Submissions → `pending_approval` drafts. Cannot approve anything, cannot create confirmed cash records. |
| admin / cfo / owner | Also **notification + approval channel.** Their own Telegram submissions are auto-approved (`approved_via_channel='telegram'`). They receive bot notifications about pending submissions and act through the same backend endpoints. |

- `POST /api/debts/from-telegram` — bot-only endpoint, authenticated with
  `x-bot-secret` header (`TELEGRAM_WEBHOOK_SECRET` or `BOT_TOKEN`). Resolves
  `telegram_id → users → business_members.role`. No anonymous records.
- Approve / reject / request-info: `POST|PATCH /api/debts/:id/approve|reject`,
  `POST /api/debts/:id/request-info` — role-gated (owner/admin/cfo), every action
  stores who / when / via which channel.
- Self-approval: an admin/cfo cannot approve their own submission; only the owner can.
- Notifications: `notifyBusinessAdminsViaTelegram()` + `telegram_*` templates
  (en/ru/id) in `NOTIFICATION_TEMPLATES`. Requires `TELEGRAM_BOT_TOKEN` env on
  the server; silently no-ops otherwise.
- Daily Pulse template exists (`telegram_daily_financial_pulse`); **no scheduler
  in this repo yet** (TODO: Railway cron or bot-side schedule hitting
  `GET /api/ai-cfo/context`).
- The bot itself lives in a **separate repo**. This repo only provides endpoints.

## H. AI CFO logic

`buildAiCfoContext()` (server/index.js) builds the context: business cash
(business wallets + scope-column fallback), runway/burn (rolling 30-day window),
month income/expense, receivables/payables (approved only), `pending_submissions`
(separate block), wallets, risks, CFO Score, AI alert, hiring readiness,
next actions.

AI CFO **may**: analyze, warn, recommend, answer in the user's language
(en/ru/id), apply the owner-withdrawal policy.

AI CFO **must not**: invent data, count pending submissions as confirmed,
mix personal cash into business answers unless asked, approve anything, or
bypass permissions. The system prompt explicitly labels pending submissions
"NOT confirmed — potential cash pressure".

Fallback: `generateLocalCfoAnswer()` when no Anthropic key — same context, rule-based.

## I. Business vs Personal mode

- `wallets.scope` and `transactions.scope` ∈ {business, personal}.
- Pulse accepts `?scope=business|personal|all`; opening-balance and adjust
  transactions inherit the wallet's scope (fixed 2026-06).
- CFO Score / runway / hiring use **business** cash only; `personal_cash`
  is informational (`wallets_summary`).
- Future personal-finance features must keep filtering by scope and never leak
  personal cash into business KPIs.

## J. WhatsApp (future premium channel)

Same model as Telegram: an interface calling the same endpoints, gated by plan.
`ACTION_CHANNELS` already reserves `'whatsapp_future'`. No separate logic allowed.

## K. Security principles

- JWT (`auth` middleware) on every user endpoint; Telegram Login HMAC verified
  with `BOT_TOKEN`, auth_date ≤ 24 h.
- All financial queries filter by `user_id = req.user.userId` (verified in audit).
- Platform admin = `ADMIN_TELEGRAM_IDS` env allow-list (`requireAdmin`).
- Role checks for approvals/team via `business_members` (owner/admin/cfo).
- No self-approval (owner excepted). Every approval is attributed and channel-stamped.
- Bot endpoint requires shared secret. Required env validated at boot
  (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `BOT_TOKEN`, `JWT_SECRET`).
- Migrations are additive-only and idempotent (`IF NOT EXISTS`).

## L. Current limitations (known, accepted)

1. **Business scoping done at endpoint level, not RLS** — Supabase row-level
   security is not enabled; all enforcement lives in server/index.js. Reference
   data PATCH/DELETE and reminders are still legacy user-scoped. Role-specific
   frontend UX (hide pages from manager/employee) is a follow-up; backend
   already enforces 403s.
2. **Transfers are cash-neutral** — single-leg storage, no destination credit.
3. **Tasks are virtual** — derived from /pulse data, no table, no persistence.
4. **`/settle` bypasses cash impact** (see §E).
5. **No scheduler** for daily Telegram pulse / overdue notifications.
6. **Invoices page is a placeholder** (no invoice table).
7. **Currency**: amounts effectively IDR; `amount_idr` mirrors `amount_original`
   without FX conversion for non-IDR.
8. **Plan limits fail open** if the limit check itself errors (deliberate).
9. Telegram bot code is in a separate repo; this repo is endpoints-only.

## Migration ledger

| # | File | Purpose | Must exist in Supabase |
|---|---|---|---|
| 001 | group_e_additive | early additive fields | yes |
| 002 | reference_foundation | categories/counterparties/directions/activities | yes |
| 003 | wallets_foundation | wallets | yes |
| 005 | saas_foundation | businesses, business_members, plans/trial | yes |
| 006 | debts_v2 | original_amount/paid_amount model | yes |
| 007 | wallet_scope | wallets.scope | yes |
| 008 | user_language | users.language | yes |
| 009 | transaction_date | transactions.transaction_date | yes |
| 010 | user_reference_data | user-scoped reference data | yes |
| 011 | payroll_v1 | payroll_employees/payments | yes |
| 012 | payroll_payment_items | payroll components | yes |
| 013 | telegram_approval_fields | debts approval/audit fields | yes |
| 014 | business_invites | invites + member columns | yes |
| 015 | debts_payment_tracking | linked_transaction_id, last_payment_at | yes |
| 016 | action_channels | approved_via_channel, last_action_channel, info_request_* | yes |

| 017 | business_scoped_financial_data | business_id on all financial tables + backfill + indexes | yes |

(004 intentionally absent.) All are idempotent; run order is numeric.

## Personal mode (future)

`businesses.type = 'business' | 'personal'` is the recommended extension —
a personal workspace reuses the same tables (wallets/transactions/debts) with
the same business_id ownership. Until then `wallet.scope = personal` continues
to separate personal cash, which is never mixed into business KPIs or AI CFO
context unless explicitly requested.

## AI CFO Decision Engine (V1)

**Principle:** the deterministic backend engine is the source of truth for every
financial recommendation; the LLM only explains the result. The LLM never
recomputes arithmetic and may not contradict the engine.

```
DB records → buildBusinessFinancialSnapshot() → assess*() → structured result → AI explains → Web/Telegram show
```

**Snapshot** (`buildBusinessFinancialSnapshot`) reuses the same CASH model and
`computeBurnAndRunway()` as Pulse/AI CFO — no second cash/runway formula. It
returns business-only cash (personal wallets excluded), per-wallet balances,
burn/runway, payable/receivable buckets (overdue / 7 / 14 / 30 days, pending
separate), and a best-effort payroll estimate from `payroll_employees.pay_day`.
Training records and rejected/cancelled debts are excluded.

**Approve ≠ Pay.** Two separate assessments:
- `assessDebtApproval` — confirming an obligation/receivable. **Zero cash
  change.** Reports obligation change and 30-day coverage. A request can be
  *safe to approve* yet *not safe to pay today*.
- `assessDebtPayment` — SIMULATES a payment/receipt: cash/wallet/runway
  before→after, excluding the debt itself from upcoming obligations to avoid
  double counting. Never writes data.

**Risk policy** — centralized `DEFAULT_DECISION_POLICY` (V1 defaults, not
universal accounting rules): critical runway < 15d, caution < 30d, target 60d,
protected reserve 30d of burn, large payment > 15% of cash. Recommendations:
`safe | caution | not_recommended | insufficient_data`.

**Endpoints** (auth, business-scoped, view-finance roles; training excluded):
- `GET  /api/decisions/debts/:id/approval`
- `POST /api/decisions/debts/:id/payment` (simulation only — no transaction, no debt update)
- `GET  /api/decisions/payment-priority`
- `POST /api/telegram/debts/:id/decision` (bot-safe, x-bot-secret + telegram_id)

**Surfaces:** DebtPaymentModal shows an AI CFO payment check (before/after);
`not_recommended` requires an explicit "I understand the risk" acknowledgement
(owner/admin/cfo only — managers/employees can't reach payment). Telegram admin
notifications carry a `📊 View impact` button → bot-safe decision endpoint.
AI CFO system prompt enforces approve/pay separation and "never redo arithmetic".

**Local fallback:** the engine is pure and runs without Anthropic; the
deterministic result (and a rule-based explanation) is always available.

**Limitations (V1):** risk policy not yet business-configurable; payroll due is
a pay_day estimate (no scheduled-payroll table); no bank balance sync; no
multi-month scenario planning; no tax/legal payment priority.

## AI Accountant (add-on, Phase 1 — foundation)

A premium compliance add-on. **Not** a substitute for a licensed accountant.
Model: `DB + versioned rules + deterministic calc = truth; AI explains;
licensed professional reviews; owner approves`.

**Tables (migration 020, additive):**
- `official_sources` — jurisdiction reference (authority, title, url, verified_at). Every active rule must cite one.
- `tax_rules` — **versioned, never overwritten**; a change inserts a new version row. status: draft/under_review/active/deprecated/superseded. Only `active` rules apply. Seeded ID rules: PPN monthly (11%), PPh Badan annual (22%), PPh 21 monthly — all `active` but `last_verified_at = NULL` until a professional confirms in-app.
- `tax_profiles` — one per business (country, legal_entity_type, NPWP, vat/pkp status, FY dates, regime…). Business-scoped, owner/admin/cfo/ceo edits.
- `compliance_events` — calendar events generated from profile + active rules (step 2).
- `business_addons` — entitlement rows (`ai_accountant_*`).

**Entitlement:** `hasAccountantAddon(biz)` — active add-on OR founder/trial plan.

**Endpoints (Phase 1 step 1):** `GET /api/accountant/status` (entitlement + profile completeness + localized disclaimer), `GET|PUT /api/accountant/profile`, `GET /api/accountant/rules` (active, jurisdiction-scoped, joins official source), `GET /api/accountant/sources`.

**Disclaimer** (`AI_ACCOUNTANT_DISCLAIMER`, ru/en/id) accompanies every draft/answer.

**Principle:** the LLM never invents a rate or due date — those come only from
the Tax Rules Registry; each recommendation carries `rule_code` + official source.

**Next steps:** (2) Compliance Calendar generation + AI Accountant page;
(3) CFO AI / Decision Engine integration (tax payments in cash forecast) +
Telegram reminders. Then Phase 2: Bank Statement Import & Reconciliation.
