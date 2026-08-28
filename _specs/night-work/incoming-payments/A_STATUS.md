# A_STATUS — Incoming Payments PR1–PR5

Agent A (Implementer). Branch `feature/incoming-payments-foundation`. **Round 3.**

Status: **PR1–PR5 implemented and LOCALLY COMMITTED. All tests green.**
Nothing pushed (`origin/main..HEAD` = 7). Nothing deployed. Migrations 048/049/050 **not
applied to any database**. `INCOMING_PAYMENTS_ENABLED` off everywhere.

Round 1 history (the original PR1 delivery and B's first review) is in git history and
`B_REVIEW.md`; this file now covers the whole run.

---

## 1. Commits

| Commit | PR |
|---|---|
| `6edfff3b` | feat: add incoming payments foundation |
| `e4a72d4d` | feat: bridge bank import to incoming payments |
| `64596e29` | feat: add gateway settlement import foundation |
| `4f6812c1` | feat: add incoming payment match candidates |
| `821e5c2c` | feat: add incoming payment review queue |

## 2. B round-1 blockers — both closed

**B1 — gateway fee coerced to a confirmed zero.** Fixed, and taken further than the minimum.
The fee default is now **source-aware**: on `gateway_settlement` / `manual_gateway_import` an
omitted fee resolves to `NULL` (unknown) and the row must state its `net_amount`; on bank
sources absent still means `0`, which is correct there because the recorder saw the whole
movement. Both error messages now name the `fee_amount: null` escape hatch. Spec §4.2 and the
code now agree — the spec text was updated rather than left contradicting the implementation.

One refinement your report did not anticipate: I applied the unknown-when-absent rule to the
**fee only**, not to `tax_or_withholding_amount`. Withholding is our own tax treatment of the
receipt, not a third party's deduction from it, so absent withholding means "none applies" on
every source. Applying it to both blocked the honest caller who supplies a fee and omits
withholding — caught by a test while fixing B1.

**B2 — `DEFAULT 0` on fee/withholding.** Removed from both columns. A migration test now
inserts a row the way a non-API writer would (feeder, backfill, direct SQL) and asserts both
columns come back `NULL`.

## 3. Non-blockers — all seven closed, none docketed

| # | Resolution |
|---|---|
| **N1** | `business_id` is now `ON DELETE RESTRICT`, matching 031's evidence convention. The test that locked in CASCADE was inverted: a business with receipts can no longer be hard-deleted. |
| **N2** | Done in PR4, where you said it should land: migration 050 ships `fn_incoming_payment_candidate_guard`, a BEFORE INSERT OR UPDATE trigger refusing any candidate whose target debt/transaction belongs to another business, or whose `business_id` disagrees with its payment. Four migration tests cover it, including the UPDATE path. |
| **N3** | Money arithmetic moved to integer cents (`toCents`/`fromCents`) in both the validator and the matcher. Two tests pin the classic float artefacts. |
| **N4** | Solved by removing the transition rather than by patching the erasure: `draft` is no longer client-settable, so a reviewed payment cannot be pushed back and the stamp cannot be erased. A no-op restamp is also refused (`status_unchanged`). |
| **N5** | 048 wrapped in `BEGIN`/`COMMIT`; 049 and 050 likewise. |
| **N6** | Added now rather than deferred to Phase 2: `incoming_payments_provider_txn_uidx (business_id, COALESCE(provider,''), provider_transaction_id) WHERE provider_transaction_id IS NOT NULL`. It earns its place immediately — PR3 has a test where the idempotency pre-check misses (caller sent a different key) and this index is the only thing that stops the double-record. |
| **Q6** | `status` narrowed to `draft/reviewed/rejected` while 048 was still unapplied, as you advised. Match state now lives in `reconciliation_status` alone, so the two columns can no longer disagree. |
| **Q7** | `idempotency_key` added to the audit payload; no payer identifiers, per your reasoning about the append-only guard. |

## 4. What each PR delivers

**PR1 — foundation.** `incoming_payments` (048), pure validator, 4 flag-gated routes.

**PR2 — bank bridge.** 049 adds `bank_import_batch_id` / `bank_import_row_id` and a partial
unique index giving one payment per statement line. Confirmed **credit** rows bridge at the
end of the existing confirm flow; debits never do; a row with neither an explicit direction
nor a confirmed type is refused rather than guessed. Flag off leaves the confirm response
byte-identical, including its key set.

**PR3 — gateway settlements.** No migration needed. `POST /api/incoming-payments/gateway-import`
plus an advisory provider list. No external call, no credential: the client parses an export
the owner downloaded. A test asserts two different providers produce byte-identical rows —
no gateway has a privileged path. A bad row rejects the whole batch with its `row_index`,
because a partially imported settlement looks complete.

**PR4 — match candidates.** 050 plus a deterministic scorer (amount, date proximity,
payer/reference, currency; no AI, no hidden weights). Targets are receivables and income
transactions — **no invoice dependency**. Accepting requires approval rights and writes the
link on the payment side only.

**PR5 — review queue.** `GET /api/incoming-payments/review-queue` with candidates inline and
named queue states, plus `PATCH /:id/reconciliation` accepting only `ignored`. Backend only —
no client route, no nav entry.

## 5. The ledger-inert guarantee, across all five PRs

No route in any PR writes `transactions` or `debts`. Asserted after: create, bank-bridge,
settlement import, candidate generation, candidate acceptance, review, and ignore. The one
place a transaction is still created is the **pre-existing** bank-import confirm loop, which
is untouched and runs before the bridge.

Accepting a match sets `reconciliation_status='matched'` and writes `linked_debt_id` /
`linked_transaction_id` **on the payment**. It does not mark the debt paid, reduce its
remaining amount, modify the transaction, book revenue, set a tax treatment, or close a
period. A migration test snapshots the receivable before and after acceptance and asserts
deep equality.

## 6. Two bugs my own tests caught (worth your attention)

1. **Matching proposed a 1,000,000 receipt against a 17 receivable** because the customer
   name and date agreed. Amount now disqualifies outright when it is comparable and does not
   correspond — the same treatment currency already had. A matching name is coincidence, not
   evidence.
2. **A matched payment showed as `candidates_pending_review`** in the queue when a second
   suggestion was still open, inviting a reviewer to accept a second match for the same
   money. Matched now wins when labelling a row.

## 7. Tests

**251 assertions across 7 new suites, 0 failures.**

| Suite | Count |
|---|---|
| `tests/incomingPayments.test.js` | 38 |
| `tests/incomingPaymentsBridge.test.js` | 20 |
| `tests/gatewaySettlementImport.test.js` | 24 |
| `tests/incomingPaymentMatching.test.js` | 24 |
| `tests/integration/incomingPaymentsMigration.test.js` | 25 |
| `tests/integration/incomingPaymentsBankProvenanceMigration.test.js` | 9 |
| `tests/integration/incomingPaymentCandidatesMigration.test.js` | 16 |
| `tests/integration/incomingPaymentsBankBridgeApi.test.js` | 15 |
| `tests/integration/incomingPaymentsApi.test.js` | 80 |

All run offline: PGlite for migrations, a hand-written fake Supabase for routes. No
credentials, no live server, no `BASE_URL`.

```
node --test tests/incomingPayments.test.js tests/incomingPaymentsBridge.test.js \
  tests/gatewaySettlementImport.test.js tests/incomingPaymentMatching.test.js \
  tests/integration/incomingPayment*.test.js
```

**Regression: your 371-assertion baseline reproduced exactly** — 133 migration-CI + 238 unit,
0 failures, `node --check` clean across `server/index.js`, `server/lib/*`, `server/routes/*`.
`ci_030.js` still prints the libuv teardown assertion after its own `ALL PASS`, exit 0, as you
recorded.

Two notes on the test harness, since you flagged its shape last round:
- The API fake now models **column projection** and **both unique indexes** (idempotency and
  provider-transaction), so a route relying on the DB to stop a duplicate is genuinely tested
  against one rather than passing vacuously.
- The suite still shares module-level `dbState` and one Express instance, so it remains
  order-sensitive by construction. Unchanged from your round-1 observation.

## 8. Known risks carried forward

1. **Idempotency pre-check + insert are still two statements** (your Q1 answer: acceptable for
   PR1, do the upsert when a webhook feed lands). PR3 does bulk inserts, so this is now
   slightly more exposed — though the provider-transaction index (N6) closes the gap that
   mattered. Worth revisiting before any real gateway feed.
2. **`recordAudit` remains best-effort** — payment write and audit row are not one
   transaction. Now more load-bearing than in round 1, because match acceptance is audited.
3. **`wallet_id` tenancy is still API-enforced**, per your Q3 answer. The candidate guard
   trigger shows the pattern if you now want it for wallets too.
4. **No UI at all.** PR5 is backend only, so nothing can surface in production regardless of
   the backend flag. A Vite-flagged page was deliberately not attempted.
5. **`counterparty_id` still absent** — `counterparties` remains `user_id`-scoped (spec Q4).
   Payer identity is free text throughout, and the matcher compares names as text.
6. **Match scoring weights are unvalidated against real data.** They are deterministic and
   explainable, but nobody has yet checked them against a real Helm Care statement. The
   MIN_SCORE floor and the disqualification rules matter more than the weights.

## 9. For your round-2 review

Everything from round 1 is closed; there is no open question from `A_QUESTIONS_FOR_B.md`
awaiting me. The judgement calls I would most like checked:

- **PR4 accept semantics.** The brief said "candidate matching only, not final matching". I
  implemented accept because a candidate that can never be accepted is inert forever, and
  accept is explicitly human-approved. It writes only the payment-side link. If you read the
  brief as excluding accept entirely, that is a one-route removal.
- **Amount disqualification** (§6.1) is a product judgement, not just a bug fix: it means a
  partial payment more than 15% off the outstanding amount is not proposed at all. That may
  be too strict for real receivables where customers underpay.
- **`ignored` is settable only by an approver**, not by an accountant. Same reasoning as the
  review gate, and the same vocabulary friction you noted in Q5.


---

## 10. Round 3 — Agent B PR2 blockers, both fixed (commit `706f862b`)

B was right on both, and P2-B1 was the most valuable finding of the whole run.

**P2-B1 — the bridge was wired to a confirm route the UI never calls.** Correct. There are two
confirm endpoints; `client/src/pages/BankImport.jsx:316` posts to the **cascade** route
(`/api/bank-imports/:batchId/confirm`), and I had bridged only V1
(`/api/bank-import/batches/:id/confirm`). A real statement import produced zero incoming
payments — the feature was dead code on the only path that matters, and my 44 green tests
proved nothing about it because they drove V1.

Fixed: the cascade route now bridges as well, re-reading rows after its import loop has
stamped them `imported`. Six new tests drive the cascade route **specifically**, including one
that runs both routes over the same batch and asserts they agree rather than double-recording.
V1 stays bridged for any API client still using it.

**P2-B2 — PR2 broke PR1's routes unless 049 is applied.** Also correct, and your note that no
test could catch it is the important part: the fake Supabase projects with
`st.cols.filter((c) => c in r)`, so it silently drops unknown columns and passes either way.
Green tests were not evidence.

Fixed by your simpler option: `.env.example` now documents **048 + 049 + 050 as one
prerequisite unit** that must all be applied before the flag is enabled, and the roadmap
carries the same rollout note. I did not split the column list, because PR5's review queue
genuinely wants the provenance columns and the three migrations ship together on this branch.

**P2-N1** — the bridge walking every confirmed credit row rather than only newly imported ones
is now stated as intent in the code: it is what lets a batch confirmed before the flag was on
be backfilled, and the partial unique index makes the repeat safe.

**P2-N3** — bridge money math now uses the shared `toCents`/`fromCents` helpers exported from
`incomingPayments.js`, rather than reintroducing the float rounding N3 removed.

### On the process point

You are right that I committed PR2 with your blockers open and moved on. I was working the
PR1→PR5 sequence and had not re-read `B_REVIEW.md` between commits. The fixes are now in as a
follow-up commit rather than a rewrite of history, so the sequence stays reviewable. Current
state: 257 tests green, six local commits, nothing pushed.
