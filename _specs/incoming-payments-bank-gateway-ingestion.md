# Spec — Incoming Payments / Gateway & Bank Ingestion

Status: **SPEC + PHASE 1 BUILT (not enabled).** Phase 1 is implemented on branch
`feature/incoming-payments-foundation` behind `INCOMING_PAYMENTS_ENABLED` (default OFF) —
see §13 for what was actually built and where it differs from this spec. Phases 2–5 remain
plan only; their table shapes are still *conceptual* and must be re-approved before any
further migration is written.

Last updated: 2026-08-27.

Related: [[D22]] (Incoming Payments Are Accounting Evidence) · [[D6]] (Engine Calculates,
AI Explains) · [[D3]] (Personal and Business Money Are Separate) · [[D9]] (Archive-First) ·
`_specs/invoices-phase-b.md` · `_specs/ROADMAP.md` → "Payment & Bank Ingestion Layer".

---

## 0. Why this exists

CFO AI / Helm Finance OS is moving from "a place where a human types transactions" to an
**AI Accountant**. The differentiator is that the system **ingests the money that actually
arrived** — from payment gateways and bank accounts — and turns it into
**accountant-reviewable evidence**, instead of asking the owner to retype it.

Two real production workspaces drive the design:

| Workspace | Code | How money arrives today |
|---|---|---|
| Helm Care Pay | `HF-BIZ-000004` | Midtrans / payment gateway settlements |
| Helm Care Indonesia | `HF-BIZ-000002` | Bank account transfers (car wash + other services) |

These two must **never** be mixed. See §8 and §9.

## 1. What already exists (do not rebuild)

This is not greenfield. The repo already has a bank-statement ingestion path:

- **Migration 021** (`migrations/021_bank_import.sql`) — `bank_import_batches`,
  `bank_import_rows`, `bank_import_matches`, `bank_reconciliations`. All business-scoped,
  all with a `dedup_hash` on rows.
- **Live API** in `server/index.js` — `POST/GET /api/bank-import/batches`,
  `GET /api/bank-import/batches/:id`, `PATCH /api/bank-import/rows/:id`,
  `POST /api/bank-import/batches/:id/confirm`, plus the classification cascade
  `POST /api/bank-imports/:batchId/suggest` and `GET /api/bank-imports/:batchId/review`.
- **`wallets.type` already includes `payment_gateway`** (migration 003) — a Midtrans
  account is a wallet, not a new account concept.
- **`financial_documents`** already has `document_type = 'payment_proof'` and a
  `review_status` lifecycle — the evidence layer exists and should be reused.
- **`counterparties`** exists but is still `user_id`-scoped (Phase 1), not
  `business_id`-scoped. This is a known gap that payer/customer matching will hit — see
  §11 Q4.

**Design consequence:** `incoming_payments` is a **normalization layer above** these
sources, not a replacement for them. Bank import stays the CSV/XLSX parsing and review
machinery; it *feeds* incoming payments. Midtrans becomes a second feeder of the same
normalized shape.

```
  midtrans settlement ──┐
  bank statement row ───┼──► incoming_payment ──► reconciliation ──► evidence package
  manual bank entry ────┤     (normalized,          candidate         (accountant-
  future bank API ──────┘      business-scoped)     → matched          reviewable)
                                                    → unmatched
```

## 2. Concepts

### 2.1 `incoming_payment`

One **normalized record of money that arrived** into one business workspace, from one
source, at one point in time. It is the single canonical row every downstream consumer
(reconciliation, reporting, tax draft, evidence package) reads.

An `incoming_payment` is a **statement of fact about cash**, not a statement about revenue.
It says "this much money landed here at this time from this source". It does **not** by
itself say "this is revenue", "this is taxable", or "this period is closed".

### 2.2 `payment source`

The system of record the payment came from, plus enough provenance to re-derive it: source
type (§3), the source account/wallet it landed in, the raw payload or raw statement row,
and the ingestion batch/event it arrived in. Provenance is **immutable** — corrections
create new records or reviewed overrides, never silent edits to raw source data.

### 2.3 `payment gateway settlement`

A gateway (Midtrans) does not pay per transaction; it **settles in batches**. A settlement
is a payout from the gateway to the company bank account, covering N underlying
transactions, **net of gateway fees**.

This gives a three-level structure that must not be collapsed:

- **gateway transaction** — one customer order/payment, gross.
- **settlement batch** — many gateway transactions, one payout, gross − fees = net.
- **bank credit** — the payout as it appears on the bank statement.

The **same money appears twice** (once as gateway settlement, once as a bank statement
line). Treating both as separate income is the single most likely accounting error in this
layer. See §9 NO-GO #3 and #4.

### 2.4 `bank statement line`

One credit line on a bank statement for a business bank account. Today this is a
`bank_import_rows` row with `direction = 'in'`. Only credit lines become incoming payments;
debit lines stay in the existing expense/payables path.

### 2.5 `reconciliation candidate`

A **proposed** link between an `incoming_payment` and something the business already knows
about — an invoice, an order, a customer, an existing transaction, or a gateway settlement.
A candidate carries a match type, a confidence score, and the reason it was proposed.
Candidates are suggestions. They are never automatically final. This mirrors the existing
`bank_import_matches` shape (`match_type`, `confidence`, `status`).

### 2.6 `matched payment`

An `incoming_payment` whose reconciliation candidate has been **accepted by a human**
(owner, CFO, or accountant), producing a durable link to invoice / order / customer /
transaction, with who accepted it and when. AI may pre-fill; a human accepts.

### 2.7 `unmatched receipt`

Money that arrived but has **no accepted link**. This is a first-class, expected, visible
state — not an error and not something to hide. An unmatched receipt is cash the company
holds without a known reason, which is exactly the thing an accountant needs surfaced.
Sub-states: `no_candidate`, `candidates_pending_review`, `rejected_all_candidates`,
`needs_more_info`.

### 2.8 `accounting evidence package`

The bundle an accountant can actually work from for one payment (or one period):

- the `incoming_payment` itself (gross / fee / net / currency / received_at),
- its source provenance (raw payload, statement line, batch id),
- the accepted links (invoice, order, customer, transaction, settlement),
- attached proof documents (`financial_documents`, typically `payment_proof`),
- the **draft** accounting/tax treatment with its rationale and confidence,
- the review trail: who reviewed what, when, and what they changed.

A package has a review status. Only a **human-approved** package is accountant-ready.

### 2.9 `report readiness impact`

Every incoming payment either **improves** or **degrades** the readiness of a reporting
period. Unmatched receipts, unreviewed drafts, missing evidence, and unbalanced
reconciliations all push a period toward `not_ready`. This reuses the existing engine
vocabulary (`insufficient_data` / explicit status, per [[D6]]) rather than inventing a new
scoring scheme. Readiness is **computed and explainable** — "this period is not ready
because 4 receipts totalling X are unmatched" — never a bare number.

## 3. Source types

| `source` | Meaning | Phase | Notes |
|---|---|---|---|
| `midtrans` | Payment gateway settlement / transaction feed | 2 | Helm Care Pay only. Integration mode still open — §11 Q1. |
| `bank_statement_upload` | Parsed statement file (CSV/XLSX) | 3 | Reuses the existing `bank_import_*` pipeline. |
| `manual_bank_entry` | Human types a receipt directly | 1 | The always-available fallback; must exist from Phase 1 so no money is unrecordable. |
| `future_bank_api` | Direct bank API / open banking | 5 | **Reserved name only. NOT implemented, NOT in v0.** See §9 NO-GO #1. |

Rules:

- The source vocabulary is **closed**. New sources require a spec update, not an ad-hoc
  value.
- Every source must be able to produce a **stable external reference** for deduplication
  (§6). If a source cannot, it must supply a deterministic content hash instead — this is
  what `bank_import_rows.dedup_hash` already does.
- `manual_bank_entry` is the only source where a human authors the raw data; it is
  therefore the only source with no external provenance, and must be visibly labelled as
  such in any evidence package.

## 4. Required fields (conceptual)

Field names below are **conceptual**, not final DDL. Types follow existing repo conventions
(`business_id UUID`, money `NUMERIC(20,2)`, timestamps `TIMESTAMPTZ`, user ids `BIGINT`).

### 4.1 Identity & scope

| Field | Purpose | Rules |
|---|---|---|
| `id` | Primary key | UUID, like all recent tables. |
| `business_id` | Owning workspace | **NOT NULL**, FK `businesses(id)`. Exactly one. Never null, never defaulted, never inferred from "the user's other company". |
| `source` | Source type (§3) | NOT NULL, closed vocabulary. |
| `external_reference` | The source's own id | Gateway transaction/settlement id, bank reference, or deterministic hash. Basis of dedup (§6). |

### 4.2 Money

| Field | Purpose | Rules |
|---|---|---|
| `gross_amount` | What the customer paid | ≥ 0. The revenue-side figure. |
| `fee_amount` | Gateway/bank fee deducted | ≥ 0. `0` means "confirmed zero"; unknown must be `NULL`, never coerced to 0. |
| `net_amount` | What actually landed | ≥ 0. Must equal `gross_amount − fee_amount` when all three are known; a mismatch is a hard validation error, not a silent correction. |
| `currency` | ISO code | Default `IDR`, consistent with existing tables. Cross-currency conversion is out of scope for v0. |

Explicitly: **`net_amount` is never written into a revenue field.** See §8.

### 4.3 Time

| Field | Purpose | Rules |
|---|---|---|
| `received_at` | When the money actually arrived | TIMESTAMPTZ, NOT NULL. Drives period assignment. |
| `settled_at` | When the gateway settled it (gateway only) | Nullable. May differ from `received_at` and may fall in a different period — flag when it does. |
| `ingested_at` | When we learned about it | Provenance only. Must never be used for period assignment. |

### 4.4 Payer / customer

| Field | Purpose | Rules |
|---|---|---|
| `payer_name_raw` | As given by the source | Free text, immutable copy of source data. |
| `payer_contact_raw` | Email/phone/account as given | Free text. Treat as personal data; do not export outside the workspace. |
| `counterparty_id` | Resolved customer | Nullable FK. **Only set on human acceptance.** Blocked on the `counterparties` scoping gap — §11 Q4. |

### 4.5 Status & lifecycle

| Field | Purpose | Values |
|---|---|---|
| `status` | Payment lifecycle | `received` · `pending_settlement` · `settled` · `refunded` · `partially_refunded` · `chargeback` · `failed` · `void` |
| `reconciliation_status` | Match state (§2.6 / §2.7) | `unmatched` · `candidates_pending` · `matched` · `partially_matched` · `disputed` · `ignored` |
| `accountant_review_status` | Human review gate | `not_reviewed` · `in_review` · `approved` · `rejected` · `needs_info` |

Three independent axes on purpose: money can be `settled` (bank fact), `unmatched` (no
known invoice), and `not_reviewed` (no accountant sign-off) all at once. Collapsing them
into one status is what makes systems lie about readiness.

### 4.6 Links

| Field | Purpose | Rules |
|---|---|---|
| `linked_invoice_id` | Invoice this pays | Nullable FK `invoices(id)`. Same `business_id` enforced. |
| `linked_order_reference` | Order/booking id | Nullable text until an orders model exists. |
| `linked_transaction_id` | Ledger transaction created | Nullable. Created only on approval. |
| `linked_settlement_id` | Parent gateway settlement | Nullable FK, for the three-level structure in §2.3. |
| `wallet_id` | Receiving wallet / bank account | Nullable FK `wallets(id)`, same business. `payment_gateway` type for Midtrans, `bank` for bank accounts. |

Every link must be **same-business**. A cross-business link is a hard constraint violation
(§9 NO-GO #5), not a warning.

### 4.7 Evidence & audit

| Field | Purpose |
|---|---|
| `raw_payload` | JSONB. Verbatim source data. Immutable. |
| `evidence_document_ids` | Link to `financial_documents` (typically `payment_proof`). Reuses the existing document layer, does not create a parallel one. |
| `draft_treatment` | JSONB. Engine/AI-proposed accounting + tax treatment, with rationale, confidence, and which rule produced it. **Draft only.** |
| `reviewed_by_user_id` / `reviewed_at` | Who approved, when. |
| `created_by_user_id`, `created_at`, `updated_at` | Standard provenance. |

Audit follows the existing append-only contract (`audit_events`) — the same guard triggers
that survived the 2026-08-27 cleanup. Ingestion, matching, approval, and reversal are all
audited events.

## 5. Relationship to existing tables

| Existing | Relationship |
|---|---|
| `bank_import_rows` | **Feeder.** A confirmed credit row produces exactly one `incoming_payment`. The row keeps its `dedup_hash`; the payment records the row id as provenance. |
| `bank_reconciliations` | **Complementary.** Balance-level check per batch; incoming payments are the item-level layer. Both must agree before a period is ready. |
| `wallets` | Receiving account. Gateway = `type='payment_gateway'`. No new account concept. |
| `invoices` / `debts` | Per `invoices-phase-b.md`, debts stay the cash/aging source of truth and invoices are the document layer. An incoming payment **proposes** a debt payment; it does not bypass the debt flow. |
| `financial_documents` | Evidence store. `payment_proof` + existing `review_status`. |
| `counterparties` | Customer resolution — blocked on business scoping (§11 Q4). |
| `transactions` | The ledger. A transaction is created **on approval**, not on ingestion. |

## 6. Deduplication (non-negotiable)

Webhooks retry. Statements overlap. Users re-upload the same file. Duplicate money is worse
than missing money because it silently inflates revenue.

- **Uniqueness key:** `(business_id, source, external_reference)` must be UNIQUE.
- When a source has no stable reference, a deterministic content hash stands in — the same
  approach `bank_import_rows.dedup_hash` already uses
  (`date|amount|direction|deschash|wallet|ref`).
- Re-ingesting a known reference is an **idempotent no-op**, not an insert and not an error.
- A gateway settlement and its matching bank credit are **the same money seen twice**. They
  must be linkable and must not both count as income. Detecting this pairing is a Phase 4
  reconciliation job, but the data model must make it *expressible* from Phase 1.
- Refunds, chargebacks, and reversals are **new records that reference the original**, never
  edits or deletions of it.

## 7. Lifecycle

```
ingest → normalize → dedup check → propose candidates → human review
       → approve (creates ledger transaction + links) → evidence package
       → period readiness recompute
```

- **Ingest** writes raw provenance and never blocks on classification.
- **Normalize** splits gross/fee/net and assigns the receiving wallet.
- **Dedup** is checked before anything downstream runs.
- **Propose** runs the deterministic cascade first, then AI — the same order the existing
  `/api/bank-imports/:batchId/suggest` endpoint already uses.
- **Approve** is the only step that writes to the ledger. Everything before it is reversible.
- **Reversal** of an approved payment is an explicit, audited action producing a
  compensating record — never a delete. Consistent with [[D9]].

## 8. Accounting rules

1. **A payment received is cash evidence, not automatically accountant-ready revenue.**
   Ingestion proves money moved. It does not prove what the money was for, which period it
   belongs to, or how it is taxed.
2. **Gross revenue, gateway/bank fees, and net received must be separated** and stored as
   three distinct values. A fee is an expense, not a discount on revenue.
3. **Net received may differ from the invoice/order amount** — fees, partial payments,
   overpayments, rounding, FX, refunds. The system must represent the difference explicitly
   and surface it, never force a match by adjusting either side.
4. **A payment belongs to exactly one business workspace.** `business_id` is mandatory and
   immutable after creation. Re-assignment requires a reversal plus a new record, audited.
5. **Helm Care Pay and Helm Care Indonesia are never mixed.** Different revenue models
   (gateway vs. services), different evidence, different tax treatment. No shared queue, no
   "all companies" ingestion inbox, no cross-workspace matching.
6. **AI may suggest classification; a user or accountant approves it.** Per [[D6]], the
   deterministic engine computes and AI explains/proposes. Every AI suggestion carries its
   rationale and confidence and lands in `draft_treatment` — never directly in a final field.
7. **No auto-submit of tax or reporting.** Nothing in this layer files, submits, or
   transmits anything to a tax authority or to an external accountant system. The output is
   a reviewable package a human sends.

Additionally:

- **Period assignment uses `received_at`**, never ingestion time. A payment ingested in
  September for money received in August belongs to August, and reopening a closed period
  is an explicit reviewed event.
- **Unknown is a value.** Missing fee data is `NULL` with an `insufficient_data`-style
  status, never `0`.

## 9. NO-GO rules

1. **No direct bank API in v0.** No open banking, no bank credentials, no screen scraping.
   `future_bank_api` is a reserved name in the model and nothing more.
2. **No final tax classification without human review.** AI output is always `draft_*` and
   always requires approval before it can affect a report.
3. **No treating net settlement as gross revenue.** Booking a Midtrans payout as income
   understates both revenue and expenses and produces wrong tax figures.
4. **No duplicate payments from repeated webhooks or re-imports.** Idempotency by
   `(business_id, source, external_reference)` is mandatory, not best-effort.
5. **No cross-company payment mixing.** No ingestion path may write a payment to a workspace
   other than the one it was scoped to. No queue spans workspaces.
6. **No production migration or code implementation in this task.** This document is spec
   only. No schema, no endpoint, no flag, no data change.

Also out of scope for this layer entirely: outgoing payments/disbursements, personal-scope
payments (business-only per [[D3]]), multi-currency conversion, and Telegram Mini App work.

## 10. Staged roadmap

### Phase 1 — Incoming Payments Foundation

Model and vocabulary only, plus the manual path.

- Approve the `incoming_payments` conceptual model → one additive migration.
- Sources: `manual_bank_entry` only.
- Business-scoped list/detail UI; gross/fee/net always visible and always separate.
- Dedup key and idempotency enforced at the DB level from day one.
- Statuses on all three axes (§4.5). No matching engine yet — everything is `unmatched` /
  `not_reviewed` and honestly displayed as such.
- **Exit criteria:** a human can record a real receipt for Helm Care Indonesia with correct
  gross/fee/net separation, and it cannot be duplicated.

### Phase 2 — Midtrans v0 for Helm Care Pay

Read-only ingestion from the gateway.

- Resolve integration mode first (§11 Q1) — nothing is built before that answer.
- Ingest gateway transactions and settlements into the model; represent the three-level
  structure (§2.3).
- Midtrans account modelled as a `wallets` row with `type='payment_gateway'`.
- Fees captured as a first-class `fee_amount`, never netted away.
- Scoped to Helm Care Pay only, behind a flag, off in production until reviewed.
- **Exit criteria:** a real settlement reconciles gross − fees = net against the Midtrans
  report, with zero duplicates across a replayed/re-fetched window.

### Phase 3 — Bank Statement Import v0 for Helm Care Indonesia

Connect the existing pipeline to the new model.

- Extend the existing `bank_import_*` flow so confirmed **credit** rows produce
  `incoming_payments`. Do not fork the parser or the review queue.
- Resolve supported export formats first (§11 Q3).
- Map each receiving bank account to a `wallets` row.
- Keep `bank_reconciliations` balance checks working alongside item-level payments.
- **Exit criteria:** a real Helm Care Indonesia statement imports with correct credit
  detection, no duplicates on re-upload, and a balanced reconciliation.

### Phase 4 — Reconciliation Engine

Candidates, matching, and readiness.

- Deterministic cascade first (exact reference → amount+date → fuzzy), AI second — the
  existing suggest-endpoint ordering.
- `reconciliation_candidate` records with match type, confidence, and rationale.
- Human accept/reject producing `matched_payment`; explicit `unmatched_receipt` queue.
- Gateway-settlement ↔ bank-credit pairing so the same money is not counted twice.
- Draft accounting/tax treatment with rationale; accountant review workflow.
- Evidence package assembly and export.
- Period `report readiness impact`, computed and explainable.
- **Exit criteria:** for one real closed month per workspace, every receipt is either
  matched or explicitly listed as unmatched with a reason, and readiness explains itself.

### Phase 5 — Direct Bank APIs (later)

- Only after Phases 1–4 are live and stable on real data.
- Requires its own security spec: credential storage, consent, revocation, audit, incident
  handling. Not started, not designed, not scheduled here.

## 11. Open implementation questions

These block the phases noted. Do not guess — each wrong assumption costs a migration.

**Q1 — Midtrans integration mode. (blocks Phase 2)**
Webhook (HTTP notification), pull API (transaction/settlement query), or manual settlement
report export? Each implies different infrastructure: webhooks need a public verified
endpoint plus signature validation and replay protection; a pull API needs credentials and
scheduling; export needs a file parser. Which Midtrans account/environment, and who holds
the server key?

**Q2 — Settlement report format. (blocks Phase 2)**
What does a real Helm Care Pay settlement actually contain — per-transaction rows or
totals? Which fields carry gross, fee, tax on fee, and net? Is there a stable settlement id
and a stable per-transaction id? **A real sample file/payload is required.**

**Q3 — Bank statement export formats. (blocks Phase 3)**
Which banks does Helm Care Indonesia use, and what can they export — CSV, XLSX, PDF, or
copy-paste only? PDF-only changes Phase 3 materially (parsing/OCR vs. tabular import). Date
format, decimal separator, debit/credit representation, and whether a running balance
column exists all need real samples.

**Q4 — Receiving bank accounts and wallets. (blocks Phases 1–3)**
Exact list of receiving accounts per workspace, and the intended `wallets` row for each.
Related blocker: `counterparties` is still `user_id`-scoped, not `business_id`-scoped —
customer matching needs that resolved or a documented interim rule.

**Q5 — Tax treatment per revenue type. (blocks Phase 4)**
For each revenue type — gateway-collected payments (Helm Care Pay) vs. car wash and other
services (Helm Care Indonesia) — what is the correct Indonesian treatment: PPN
applicability, final vs. non-final PPh, withholding by customers, and how gateway fees are
deducted? Confirmation from the actual accountant is required; the system must not infer
this. Per [[D6]], unknown treatment renders as `insufficient_data`.

**Q6 — Accountant export format. (blocks Phase 4)**
What does the accountant actually want to receive — CSV/XLSX ledger, PDF package, or a
shared review view in-app? Per period, per payment, or per workspace? Which fields are
mandatory for their filing workflow?

**Q7 — Evidence required per payment type. (blocks Phase 4)**
Minimum proof for each payment type — is a settlement report enough for a gateway payment,
or is a bank credit advice also needed? For a bank transfer, is the statement line
sufficient, or is a customer invoice/receipt mandatory? This defines when a package can
reach `approved` versus `needs_info`.

## 12. Guardrails for the first implementation

(Followed by PR1 — see §13.)

- One additive migration, reviewed before it is written.
- Behind a flag, built OFF and ON, per [[D5]].
- No changes to Telegram identity, notification grants, or production flags.
- No production data touched; no deploy or push as part of spec work.
- Batch flow per the multi-agent rule: one scoped task, one implementing agent, one
  commit/report, Codex review, owner go/no-go.

---

## 13. PR1 — Incoming Payments Foundation, as built

Branch: `feature/incoming-payments-foundation`. Flag: `INCOMING_PAYMENTS_ENABLED`, default
OFF. **Not applied to production, not enabled, not deployed.**

### 13.1 What shipped

| Artefact | Path |
|---|---|
| Migration (additive, idempotent) | `migrations/048_incoming_payments_foundation.sql` |
| Pure validation/normalisation | `server/lib/incomingPayments.js` |
| Routes | `server/index.js` (before the bank-import block) |
| Unit tests (30) | `tests/incomingPayments.test.js` |
| Migration tests (20) | `tests/integration/incomingPaymentsMigration.test.js` |
| API tests (32) | `tests/integration/incomingPaymentsApi.test.js` |
| Flag documented | `.env.example` |

Routes, all business-scoped and flag-gated (404 when OFF):

- `GET /api/incoming-payments` — list for the active business; validated filters
  (`status`, `reconciliation_status`, `source_type`, `provider`), `limit` 1–500.
- `POST /api/incoming-payments` — record one receipt.
- `GET /api/incoming-payments/:id` — detail (the only route returning `raw_provider_payload`).
- `PATCH /api/incoming-payments/:id/status` — human review decision.

Roles reuse the existing helpers: read `canViewBusinessFinance`, create
`canCreateConfirmedFinancialRecord`, review `canApproveFinancialRecord`.

### 13.2 Ledger-inert, proved not just asserted

No route writes to `transactions` or `debts`. `linked_transaction_id` / `linked_debt_id` are
set to NULL explicitly on insert, and a client that *supplies* either is refused with
`linking_not_supported` rather than having the field quietly dropped. `reconciliation_status`
is derived (`unmatched`), never client-chosen, and `status` cannot be created or PATCHed to
`matched` — a status claiming a match with no link behind it would be a lie in the data.
Two API tests assert the `transactions` and `debts` tables stay empty after create and after
review.

### 13.3 Where PR1 differs from §4 (deliberate)

- **Field names follow the PR1 brief**, not §4 verbatim: `transaction_at` (not `received_at`),
  `payer_name` / `payer_reference` (not `payer_name_raw` / `payer_contact_raw`),
  `raw_provider_payload` (not `raw_payload`), plus `tax_or_withholding_amount`,
  `provider_*`, `settlement_batch_reference`, and `payment_method`. §4 remains the conceptual
  vocabulary; the table is the implementation of it.
- **`source_type` replaces `source`**, with the six-value vocabulary from the brief. The two
  `future_*` values exist in the DB CHECK but are **refused by the API**
  (`source_type_not_available`) — the column can express them, no feed may use them.
- **`counterparty_id` was NOT added.** `counterparties` is still `user_id`-scoped (§11 Q4);
  adding the FK now would bake in a scoping bug. Payer identity stays free text in PR1.
- **No invoice dependency.** Matching will target `debts` (receivables) and `transactions`
  when reconciliation is built; `invoices` is not referenced at all.
- **Idempotency is keyed on `(business_id, source_type, COALESCE(provider,''),
  idempotency_key)`.** The COALESCE is load-bearing: Postgres treats NULLs as distinct, so a
  plain UNIQUE would let unlimited duplicate manual entries through. A test covers exactly
  that case.
- **Unknown vs. zero is preserved, and the default is source-aware.** `fee_amount` /
  `tax_or_withholding_amount` are nullable with **no DB default**: NULL = not known yet,
  `0` = confirmed no fee. An *omitted* fee resolves per source: on a bank receipt the
  recorder saw the whole movement, so absent means `0`; on a **gateway** receipt
  (`gateway_settlement`, `manual_gateway_import`) the fee is deducted by a third party and
  is not knowable from the receipt, so absent means **NULL** and an explicit `net_amount`
  is required. Storing `0` there would assert on the caller's behalf that the gateway
  charged nothing — the mirror image of NO-GO #3. Withholding is our own tax treatment, not
  a third party's deduction, so absent withholding means none applies on every source.
  The arithmetic CHECK (`net = gross - fee - withholding`) fires **only when every
  component is known**, so an unknown fee is storable but a wrong number is not.
- **A supplied `net_amount` is validated, never corrected.** A mismatch is a 400
  (`net_amount_mismatch`) — the D22 rule that a gateway payout must not be booked as gross.

### 13.4 Known gaps carried forward

- **Concurrency edge:** the duplicate pre-check and the insert are two statements. The unique
  index still prevents the duplicate row; the loser of a genuine race gets a 409
  (`duplicate_payment`) rather than the winning row. Acceptable for a staging table, worth an
  upsert/RPC when volume justifies it.
- **`recordAudit` is best-effort** (existing project behaviour): the payment write and its
  audit row are not one transaction. The grants work solved this with an RPC; the same fix
  applies here if incoming payments become approval-bearing.
- **`wallet_id` same-business ownership is enforced in the API, not the DB.** A composite FK
  needs `wallets.business_id` to be NOT NULL, which needs a backfill (`audit_null_business_ids.sql`).
- **No UI.** Backend + tests only; nothing appears in navigation.
- **`raw_provider_payload` may carry payer PII.** It is excluded from list responses and
  returned only on detail. No redaction/retention policy exists yet.

---

## 14. PR2 — Bank import bridge, as built

Migration `049_incoming_payments_bank_import_provenance.sql` (additive: two nullable
provenance columns + one partial unique index). Bridge logic in
`server/lib/incomingPaymentsBridge.js` (pure), called from the end of
`POST /api/bank-import/batches/:id/confirm`.

- **Entirely inside the flag.** With `INCOMING_PAYMENTS_ENABLED` off the bridge is not called,
  nothing is read, and the confirm response keys are unchanged (asserted by a test).
- **Credits only.** A debit line never produces a payment. An explicit `direction` wins over a
  mis-suggested transaction type, and a row with neither is refused rather than guessed --
  guessing permissively would record an expense as incoming revenue.
- **Confirmed only.** The bridge reuses the confirm route's own notion of a reviewed row, so an
  excluded or unreviewed line is never picked up.
- **One payment per statement line**, guaranteed by
  `incoming_payments_bank_row_uidx (business_id, bank_import_row_id)`. Re-confirming a batch
  reports `duplicates`, not a second row.
- **Idempotency key** is `bank_row:<dedup_hash>`, so a re-uploaded overlapping statement
  collides on content rather than on row identity; falls back to the row id.
- **Provenance:** `bank_import_batch_id` / `bank_import_row_id`, both `ON DELETE SET NULL` --
  deleting import artefacts must not delete the evidence that money arrived.
- **Bank reference goes to `payer_reference`, not `provider_transaction_id`.** Bank exports
  repeat references across lines, and 048's provider-transaction unique index would then reject
  legitimate rows as duplicates.
- **Ledger-inert.** The bridge writes no transaction and no debt. The confirm flow's own ledger
  write is unchanged and happens first. `linked_transaction_id` is left NULL even though the
  transaction id is known -- copying it would assert a reviewed match nobody performed. The
  matching step proposes it as a candidate instead.
- **Fee semantics:** a bank credit is `gross = net` with a *confirmed* zero fee, because the
  statement line shows what actually landed and carries no separate itemised fee. This is why
  `bank_statement_import` is deliberately not in `GATEWAY_SOURCE_TYPES`.
