# B_RISKS — Incoming Payments Foundation PR1

Reviewer: Agent B · Round 1
Scope: risks introduced, reduced, or left standing by PR1. Ordered by expected cost.

Baseline posture: the flag is off everywhere, migration 048 is unapplied, nothing is pushed or
deployed. **No risk below is currently live in production.** They are risks of *promoting* this
PR as written.

---

## Risks INTRODUCED by this PR

### R1 · Silent zero-fee assertion on gateway receipts — **HIGH** (blocking, = B1)

`server/lib/incomingPayments.js:125-127` + `migrations/048:47-49`

A gateway receipt submitted with gross only records `fee = 0, net = gross`, asserting the
gateway charged nothing. Verified empirically. Downstream this inflates net and, once Phase 4
turns receipts into revenue, inflates revenue and the tax base derived from it — the precise
failure NO-GO #3 exists to prevent and that `A_IMPLEMENTATION_NOTES.md:43` names in writing.

Bounded today: PR1 books nothing, and the honest gross+net caller gets a loud 400 rather than a
wrong row. The exposure is a *stored* wrong value that a later phase trusts.

*Mitigation:* B1/B2 fixes. Source-aware fee default; drop `DEFAULT 0`.

### R2 · Cross-business links are API-enforced only — **MEDIUM**

`server/index.js:3357-3366`; no DB trigger on `wallet_id`, `linked_transaction_id`,
`linked_debt_id`.

The route check is correct and tested, so the risk is not "today's code is wrong" — it is that
the *only* thing standing between a future feeder (Phase 3 bank import, Phase 2 webhook, a
backfill script, an admin tool) and a cross-company link is one `if` in one handler that a new
write path will not automatically inherit. Spec NO-GO #5 calls this a hard constraint
violation; migrations 031/033 enforce equivalents in the DB.

*Mitigation:* a `fn_ic_funding_guard`-style trigger. Does **not** require the `wallets`
backfill A was worried about — triggers work against nullable columns. No later than the
matching PR.

### R3 · Two columns can disagree about the same fact — **MEDIUM-LOW**

`status` and `reconciliation_status` both carry `matched`/`unmatched` (048:63-66).

Today the API keeps them consistent by refusing `matched` in `status`. That is a runtime
invariant with no DB backing, so any direct write, backfill, or future route can desynchronise
them, and a period-readiness computation reading the wrong column would report a match that
does not exist.

*Mitigation:* narrow `status` to `draft/reviewed/rejected` while 048 is unapplied. Free now;
a migration plus backfill later.

### R4 · Evidence is destroyed by business deletion — **MEDIUM-LOW**

`048:22` `ON DELETE CASCADE`, locked in by `incomingPaymentsMigration.test.js:204`.

Migration 031 deliberately chose `RESTRICT` for `financial_documents` because evidence must
outlive the workspace record, and 048 itself argues that case for ledger rows at lines 68-69.
The app archives businesses rather than deleting them, so this is reachable mainly through an
admin hard-purge path — but that is exactly when losing payment evidence is least acceptable.

*Mitigation:* `RESTRICT`, matching 031.

### R5 · Review stamp can be erased in-row — **LOW**

`server/index.js:3461-3464`. Un-reviewing nulls `reviewed_by_user_id`/`reviewed_at`. The
append-only `audit_events` row survives, so the trail is recoverable — but reconstructing it
requires a separate query an accountant will not run.

### R6 · Float money arithmetic — **LOW**

`lib:48,141,148` use `Math.round(n * 100) / 100` while `server/lib/transactionClass.js` exists
specifically to forbid float money math. Safe at IDR magnitudes (well inside 2^53); the risk is
precedent — the next module copies it, and eventually one handles a currency with real
sub-units.

### R7 · Caller-controlled dedup key — **LOW now, MEDIUM at Phase 2**

`buildIdempotencyKey` derives from provider ids when present, so a replayed webhook collides.
But an explicit caller-supplied key overrides that, so the same `provider_transaction_id`
submitted with two different keys double-records. Spec §6 names
`(business_id, source, external_reference)` as the key; there is no uniqueness on
`provider_transaction_id` itself.

*Mitigation:* partial unique index on `(business_id, provider, provider_transaction_id)` when
the gateway feeder lands.

### R8 · `raw_provider_payload` PII, no retention policy — **LOW now**

Correctly excluded from list responses and returned only on detail. But it is verbatim provider
data (payer names, contacts, possibly card metadata) stored indefinitely with no redaction or
retention rule. A's own risk #4. Becomes real when a live gateway feed writes it at volume.

### R9 · Audit write is not atomic with the payment write — **LOW**

`recordAudit` is best-effort by existing project convention, so a payment can exist with no
audit row. A flagged this. Matters more if incoming payments ever become approval-bearing; the
notification-grants work already established the RPC pattern that solves it.

---

## Risks REDUCED by this PR

- **First money-path audit coverage in the codebase.** Before this, `audit_events` carried only
  tax-rule/profile/source and identity entities — transactions, wallets, debts, and bank imports
  wrote nothing. `entityType: 'incoming_payment'` is the first money mutation that leaves a
  trail. This is a genuine improvement to a standing gap.
- **First DB-level idempotency guard on an ingestion path.** `bank_import_rows_dedup_idx` is a
  *non-unique* index and duplicate protection there is application-level only.
  `incoming_payments_idempotency_uidx` is a real unique constraint, and the `COALESCE(provider,
  '')` handles the NULL-distinctness trap that would otherwise have made it useless for manual
  entry.
- **No existence oracle across tenants.** The detail route returns 404 rather than 403 for
  another workspace's row — better than several existing routes.
- **NO-GO #1 held at the boundary that matters.** `future_bank_api`/`future_gateway_api` exist
  as reserved vocabulary but are refused at the API, so the model can express a direct bank feed
  while no code can pretend to have one.

---

## Risks NOT addressed (pre-existing, inherited)

These are not this PR's fault and not its job to fix, but they bound how far it can go.

- **`invoices` does not exist in production.** 041 is unapplied and AGENTS.md lists it as
  do-not-touch. Spec §4.6 assumes `linked_invoice_id`; PR1 correctly does not have one. Any
  "payment settles invoice" flow is blocked on an owner decision. Receivables remain
  `debts.type='receivable'`.
- **`debt_settlement_allocations` exists in production and is unused by any route.** It is the
  correct many-to-one settlement table with over-allocation guards. The matching PR should use
  it rather than `debts.paid_amount` + a single `linked_transaction_id`.
- **IDR is assumed on the money-in path.** `BankImport.jsx:289` posts `currency: 'IDR'`
  unconditionally; `POST /api/debts/:id/pay` hardcodes `currency_original: 'IDR'`;
  `transactions.amount_reporting`/`fx_quote_id` are unapplied (037/038). PR1 stores a currency
  correctly but has nowhere to convert it.
- **`counterparties` is still `user_id`-scoped, not `business_id`-scoped.** Spec §11 Q4 flags
  this as blocking payer/customer matching in Phases 1–3. PR1 sensibly has no `counterparty_id`.
- **Gross/fee/net has no home in `transactions`.** When Phase 4 posts an approved receipt, the
  ledger can only express it as sibling rows, and `VALID_SYSTEM_TX_TYPES`
  (`server/index.js:3277`) excludes `bank_fee` even though `transactionClass.js` classifies it.

---

## Production rollout risk — **LOW, if sequenced**

The PR is deployable before 048 is applied: with the flag off every route 404s before touching
Supabase, and A's test proves nothing is written. Correct order is: merge code (flag off) →
owner applies 048 under the backup→apply→verify runbook → enable the flag on a non-production
deploy only.

The one thing that must not happen is enabling the flag before 048 is applied — every route
would 500 on a missing table. Nothing in the PR does this, and `.env.example` documents the
default as `false`.

---

## Bank-import compatibility — **no conflict**

Nothing in 021/022 was touched: no shared table, no shared route, no changed column. The two
paths are independent today. The Phase 3 plan (a confirmed credit row produces one
`incoming_payment` carrying the row id as provenance) is sound, but note two things it will hit:
`bank_import_rows` has no provenance column pointing the other way, and its dedup index is
non-unique — so the Phase 3 feeder must derive its `idempotency_key` from `dedup_hash` rather
than trusting the row's uniqueness.
