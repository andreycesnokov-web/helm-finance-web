# Design v2 — proposals that need owner approval

**Owner decisions (3 Oct 2026, `DECISIONS.md`):**
- P-01, P-04, P-05 and P-08 are approved and implemented in batch 8 (migrations 058–061, not applied).
- The P-10 template is in `P10_TEMPLATE.md` for review.
- Everything else below is still a proposal.

Before batch 8, nothing in this file was implemented. Each entry is something a v2 screen would need
that does not exist today (a table, a column, a setting, an endpoint shape). Until it
is approved, the screen shows an honest empty / "not set up yet" state or a documented
default. Migrations are NOT written; AGENTS.md requires explicit approval first.

Format: what · fields · why · risk · what the UI does meanwhile.

## P-01 · Per-business runway target (batch 2)

> **Approved → batch 8.** Migration `058_business_runway_target.sql`; `GET/PATCH /api/business/targets`; Pulse uses it, 60 when null.

- **What:** a runway target in days, per business.
- **Fields:** `businesses.runway_target_days int null` (or a row in an existing settings
  table), editable in Settings by owner/CFO.
- **Why:** Pulse compares runway with a target ("Target 60 days") and the hero status
  depends on it.
- **Risk:** low — additive nullable column, no financial meaning; needs a migration and a
  write path with the usual role check.
- **Meanwhile:** `RUNWAY_TARGET_DAYS = 60` in `client/src/v2/lib/pulseModel.js` (the design
  default), shown openly as "Target 60 days".

## P-02 · Structured context for the AI CFO (batch 2 → 5)

- **What:** an optional `context` object on `POST /api/ai-cfo/ask` (page, period, filters).
- **Why:** "Looking at: …" should reach the model as data, not as text in the question.
- **Risk:** backend change to the AI route (not auth); prompt-injection review needed.
- **Meanwhile:** context is prepended to the question text on the client.

## P-03 · Funding register (batch 3)

- **What:** a business-scoped table of funding records: equity, founder loans,
  intercompany loans, with terms and a repayment schedule.
- **Fields:** `funding_records(id, business_id, source_kind [founder|investor|intercompany|bank],
  instrument [equity|loan], counterparty_id null, amount, currency, received_on,
  outstanding, interest_rate null, terms_text, due_on null, created_by, created_at)` plus
  `funding_repayments(id, funding_record_id, due_on, amount, paid_transaction_id null)`.
- **Why:** Funding shows "Raised from outside", "Still to pay back" and "Next repayment";
  repayments should land on Radar.
- **Risk:** medium. A founder loan must NOT be mirrored from Personal without the
  approved Personal↔Business bridge (migrations 037–039 stay untouched). Needs audit on writes.
- **Meanwhile:** the register is an empty state; the page shows only the cash the
  existing classifier already marks as funding (never revenue).

## P-04 · Counterparty tax fields (batch 3)

> **Approved → batch 8.** Migration `060_counterparty_tax_fields.sql` (`entity_form`, `payment_terms_days`); `landlord`/`lender` roles need no column (they go in the unconstrained `type`). Written through the existing POST/PATCH `/api/counterparties`; accountant role and above.

- **What:** entity form (PT / CV / person / foreign), landlord and lender roles,
  payment terms in days.
- **Fields:** `counterparties.entity_form text null`, extend the role list with
  `landlord`, `lender`; `counterparties.payment_terms_days int null`.
- **Why:** the withholding rule depends on the counterparty type (services from a
  company, rent, a person, a foreign company); payment terms drive expected dates.
- **Risk:** low–medium. The rule mapping must stay in the verified rule engine, not in UI.
- **Meanwhile:** these options are shown disabled ("needs a new field"); the rest of the
  form saves through the existing POST /api/counterparties.

## P-05 · Bill document checklist status (batch 3)

> **Approved → batch 8, reworked to option B (DECISIONS.md, final decisions item 1).** Migration `061_bill_checklist_status.sql` adds only `accountant_checked_at/by`; `PATCH /api/debts/:id/checklist` (accountant role and above, audited). The slip is **not** a debts column: it is read from `withholding_records.bukti_potong_document_id` (031) through the read-only `GET /api/withholding-slips`.

- **What:** per-bill status for the withholding slip (bukti potong) and the accountant check.
- **Fields:** `debts.withholding_slip_document_id uuid null`, `debts.accountant_checked_at
  timestamptz null`, `debts.accountant_checked_by bigint null`.
- **Why:** Bill detail shows a 4-item checklist and "Nothing closes on its own".
- **Risk:** low; additive. Writes need the accountant role and an audit row.
- **Meanwhile:** those two rows say "not tracked here yet".

## P-06 · Customer payment reminders from the web (batch 3)

- **What:** a "Send reminder" action for a late invoice.
- **Why:** the design offers it on Pulse, Radar and Bills.
- **Risk:** outbound messaging (email/Telegram) to a third party — needs consent,
  templates, rate limits and an audit trail. Not a UI-only change.
- **Meanwhile:** the button is visible but disabled with "Coming soon".

## P-07 · Accountant review and monthly package (batch 4)

- **What:** "Send to your accountant for review", per-folder comments, and a monthly
  ZIP (folder per transaction + Excel index + statements + tax summary).
- **Fields:** `accounting_period_reviews(id, business_id, period, status, sent_at,
  sent_by, reviewer_user_id, completed_at)`, `document_comments(id, business_id,
  target_type, target_id, author_user_id, body, created_at)`; a server-side package
  builder over existing documents (signed URLs only).
- **Why:** Month close and Documents by transaction end in a review by the accountant.
- **Risk:** medium — exports client documents; needs role checks (accountant role),
  audit rows and size limits.
- **Meanwhile:** both buttons are disabled with "not available yet"; "Accountant review"
  shows "not tracked here yet".

## P-08 · Targets and alerts (batch 4, extends P-01)

> **Approved → batch 8.** Migration `059_business_targets_alerts.sql`. The schedule is stored only: **no brief is sent**. There is no scheduler; that needs its own approval, and recipients must come from `notificationPolicy`.

- **What:** minimum cash and the weekly brief schedule, next to the runway target.
- **Fields:** `businesses.min_cash_idr numeric null`, `businesses.weekly_brief_cron text null`.
- **Why:** Settings → Targets & alerts.
- **Risk:** low; the brief sends Telegram messages — reuse the existing notification policy.
- **Meanwhile:** shown as "Not set up yet"; the runway target uses the 60-day default.

## P-09 · Company people (batch 4)

- **What:** directors, commissioners and shareholders with their share.
- **Fields:** `company_people(id, business_id, role [director|commissioner|shareholder],
  name, share_percent null, source_document_id null)`.
- **Why:** Company profile → People; needed for the annual return.
- **Risk:** personal data (names, ownership); access limited to owner/accountant.
- **Meanwhile:** "Not filled in", with a note that it is not stored yet.

## P-10 · Category → group mapping and accrual profit (batch 6)

> **Approved → batch 9 (migration 062).** 9 groups (DECISIONS.md "P-10 decisions"). `GET/PATCH /api/pnl-mapping`; Performance → Profit switches to the accrual view once a business confirms; page `/business/performance/groups`.

- **What:** every cash-flow category belongs to exactly one group (revenue, direct cost,
  operating cost, asset purchase, funding, tax, transfer), seeded per industry template from
  the KBLI codes; plus accrual rules (revenue in the invoice month, costs in the month the
  bill is received, including unpaid bills).
- **Fields:** `cashflow_categories.pnl_group text null` (CHECK on the 7 groups),
  `industry_templates(kbli_prefix, category_name, pnl_group)`, and an accrual read model
  (a server function, no new table) over `debts` + `transactions`.
- **Why:** PERFORMANCE_METRICS.md Profit view; coverage "N of M records have a category";
  the profit-to-cash bridge.
- **Risk:** medium — it changes what Performance reports; existing Pulse/AI figures use the
  keyword classifier and must not silently change. Needs tests on the formulas and an
  owner-confirmed template.
- **Meanwhile:** Profit is labelled *Estimate · counted when money moved* (existing classifier),
  the bridge shows "not set up yet".

## P-11 · Asset register and depreciation (batch 6)

> **Approved → batch 11 (migration 063).** `GET/POST /api/assets`, `POST /api/assets/:id/dispose`. The useful life comes only from an active, verified `tax_rules` row with `obligation_type = 'depreciation'`; none exists yet, so assets are saved without a life until a platform admin adds and verifies that rule.

- **What:** assets bought above the threshold, with cost, date, quantity, location,
  useful life from the verified tax rules, monthly depreciation, documents per type.
- **Fields:** `assets(id, business_id, name, asset_type, quantity, cost, currency,
  acquired_on, supplier_counterparty_id null, purchase_debt_id null, purchase_document_id null,
  useful_life_months, depreciation_method, location text null, custodian text null,
  disposed_on null, created_by, created_at)`; depreciation is computed, not stored.
- **Why:** Assets & balance, Add asset, Performance net profit (depreciation) and
  "assets add themselves" when an equipment bill is approved.
- **Risk:** medium — touches profit; must not double-count a purchase as both a cost and
  an asset. Useful life must come from the tax rule engine, not UI.
- **Meanwhile:** the register and "Save asset" are honest "not set up yet"; the purchase
  invoice can already be uploaded; Assets shows only the known parts of the balance and no
  net worth.

## P-12 · Admin metrics: usage, AI cost, service health (batch 7)

- **What:** a usage-event store (AI CFO questions, documents read, MCP drafts, Telegram
  messages) with provider cost per event, and uptime/error counters per service.
- **Fields:** `usage_events(id, business_id, kind, units, cost_idr null, created_at)`,
  `service_checks(service, checked_at, ok, detail)`.
- **Why:** Platform overview (AI usage, AI cost, plan limits) and Flags & system (services).
- **Risk:** low for privacy if it stores counts only — never prompts, answers or amounts.
- **Meanwhile:** these blocks say "Not tracked yet"; database reachability and the deployed
  commit come from the existing dashboard response.

## P-13 · Support-access grants (batch 7)

- **What:** the platform owner requests read-only access to one client company; the client
  owner approves in their app; access lasts 24 hours and is written to the client's audit log.
- **Fields:** `support_access_grants(id, business_id, requested_by, reason, status
  [requested|approved|denied|expired|revoked], approved_by null, approved_at null,
  expires_at null, created_at)` + server middleware that admits admin reads of that business
  only while a grant is approved and unexpired, and audits every read.
- **Why:** DESIGN_SPEC rule 7; the "Request support access" button in Companies.
- **Risk:** high — it opens client financial data to platform staff. Needs owner approval,
  a security review (auth middleware) and the client-side approval screen (not drawn).
- **Meanwhile:** the button is disabled with "Waiting for the grant design approval"; admin
  screens read only /api/admin/* counts (enforced by tests/design/v2AdminModel.test.mjs).

## F-01 · Finding: `/allocate` and `/pay` count the same money twice against the 031 guard

**Status: reported only.** DECISIONS.md, final decisions item 5, says it is not fixed without approval. Found while preparing batch 10, and checked against `main`.

**What happens**
- `POST /api/debts/:id/pay` raises `debts.paid_amount` and creates the payment transaction.
- `POST /api/invoices/:debtId/allocate` describes itself as "audit trail only". It records a transaction as a `debt_settlement_allocations` row with `settlement_source_type = 'transaction'`.
- The DB guard `fn_debt_settlement_guard` (migration 031) allows allocations only up to `invoice amount − paid_amount`. It counts **every** allocation, including `transaction` ones.

**The problem**
- `paid_amount` and transaction allocations describe the same money, but the guard adds them together.
- Example: an invoice of 100 is paid 90 through `/pay`, which leaves room for 10.
  - Allocating that same 90 payment through `/allocate` is rejected: 90 > 10. This happens today, without v2.
  - Once any transaction allocation exists, the room left for a later withholding allocation is smaller, or zero.

**Effect on batch 10**
- The withholding route answers **409** with the message from DECISIONS.md: "This invoice already has payment records in the settlement log; record the withholding with the accountant."
- It does this whenever the guard rejects. It never fails silently, and it never raises `paid_amount` instead.

**Options for later (each needs the owner's approval)**
- **A. Fix the guard (changes 031).** It would count only non-`transaction` allocations against `invoice amount − paid_amount`.
- **B. Stop `/allocate` writing allocation rows.** Keep the audit trail in `audit_events` instead.
- **C. Make allocations the single source of truth for payments.** `/pay` would write a `transaction` allocation, and `paid_amount` would become a derived figure. This is the larger change.
