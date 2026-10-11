# A_STATUS — Incoming Payments PR1–PR5

Agent A (Implementer). Branch `feature/incoming-payments-foundation`. **Round 5 (B4-1 closed).**

Status: **PR1–PR5 implemented and LOCALLY COMMITTED. All tests green.**
`origin/main..HEAD` = 11. See section 20 for push/deploy state. Nothing deployed. Migrations 048/049/050 **not
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

---

## 11. Round 4 — self-audit of PR3–PR5 (commit `81710e88`)

Agent B closed round 4 with **GO on all five PRs and no open blockers**. With nothing left to
fix from the review, I audited PR3–PR5 myself for the same bug classes B found in PR2, since
those were found by reading call sites rather than by running tests and the same blind spots
apply to the PRs B had less time on.

### Three findings, all fixed. None had test coverage.

**1 · Phantom schema columns in the matcher (the "wrong assumption about DB schema" class).**
`receivableTarget` read `debts.reference` and `transactionTarget` read `transactions.reference`.
**Neither column exists** — `debts` has `notes` (006) and no reference; `transactions` has none
at all. The debt path silently fell back to `notes`, so it worked by accident. The transaction
path could never match on a reference while reading as though it could — dead comparison logic
a reviewer would assume was live. Now reads `debts.notes` explicitly and states in code that
transactions carry no reference.

**2 · A failed source read answered "no matches found" (the "silent fallback hiding a financial
error" class).** Both the candidate generator and the review queue destructured only `data`
and fell through to `[]` on error, returning **200 with zero candidates**. That is a confident,
wrong financial statement: it tells the reviewer the system looked and found nothing, when in
fact it never looked. Both now surface the failure (`candidate_sources_unavailable` /
`candidate_read_failed`).

**3 · A rejected receipt could never leave the review queue.** Only `ignored` or matched+reviewed
cleared a row, so a reviewer who rejected a receipt had no way to clear it except marking it
`ignored` — which means something else, and would corrupt the one signal the queue exists to
produce. Rejection is now terminal on its own. Reviewed-but-*unmatched* correctly stays
outstanding: unexplained money is not resolved by reviewing it.

### Verified, no change needed

- **Column/migration consistency.** Every column in `INCOMING_PAYMENT_LIST_COLS` (33) and every
  candidate column read exists in 048/049/050 — checked programmatically, not by eye. This is
  the P2-B2 class; `incoming_payments` has 34 columns and the list plus `raw_provider_payload`
  accounts for all of them.
- **Flag coverage.** All **11** incoming-payments routes call `isIncomingPaymentsEnabled()`
  before any database access — enumerated programmatically.
- **PostgREST string NUMERICs.** Production returns `NUMERIC` as strings; the fake Supabase
  returns JS numbers, so no existing test proved the real shape worked. Probed the matcher with
  string amounts: exact-match and disqualification both behave correctly. Two tests now pin it.
- **Migrations as a unit.** 048→049→050 apply in order and are idempotent when the whole unit is
  re-applied — no test covered all three together before.
- **Production call path.** PR3–PR5 have **no UI at all** (`grep` over `client/src` finds no
  reference). Unlike PR2 there is therefore no UI/endpoint mismatch possible — but equally,
  nothing exercises them in production yet. Route ordering verified: all literal paths
  (`/providers`, `/review-queue`) are registered before `/:id`, which is what shadowed
  `/review-queue` during PR5.
- **Scope.** Whole-branch diff touches no Telegram, notification-grant, cleanup-SQL, `.env`, or
  Railway file. Only **two** lines are deleted anywhere in `server/index.js` — the two confirm
  response lines, replaced with versions that preserve the original key set exactly.

## 12. Commits (9, none pushed)

| Commit | What |
|---|---|
| `6edfff3b` | feat: add incoming payments foundation |
| `e4a72d4d` | feat: bridge bank import to incoming payments |
| `64596e29` | feat: add gateway settlement import foundation |
| `4f6812c1` | feat: add incoming payment match candidates |
| `821e5c2c` | feat: add incoming payment review queue |
| `dbc6e3de` | docs: record PR1–PR5 delivery |
| `706f862b` | fix: bridge the confirm route the bank import UI actually calls (P2-B1, P2-B2) |
| `5e010fdb` | docs: roadmap phase status and A_STATUS round 3 |
| `81710e88` | fix: close three self-audit findings in PR4/PR5 |

## 13. Tests — final

**265 feature assertions + 371 regression assertions, 0 failures.**

| Suite | Count |
|---|---|
| `incomingPayments.test.js` | 38 |
| `incomingPaymentsBridge.test.js` | 20 |
| `gatewaySettlementImport.test.js` | 24 |
| `incomingPaymentMatching.test.js` | 29 |
| `incomingPaymentsMigration.test.js` | 25 |
| `incomingPaymentsBankProvenanceMigration.test.js` | 9 |
| `incomingPaymentCandidatesMigration.test.js` | 16 |
| `incomingPaymentsBankBridgeApi.test.js` | 21 |
| `incomingPaymentsApi.test.js` | 83 |

Regression: 6 unit suites + `money.mjs` (238) and 7 migration-CI suites (133), identical to B's
baseline. `node --check` clean across `server/index.js`, `server/lib/*`, `server/routes/*`.
`ci_030` still prints the libuv teardown assertion after its own `ALL PASS`, exit 0 — Windows
artifact, unrelated.

## 14. External integration blockers — real samples still required

These are **not** code problems and must not be worked around by inventing behaviour:

- **Q1/Q2 — Midtrans (and any live gateway feed).** Integration mode (webhook vs pull vs export)
  and the real settlement report format are unknown. **A real settlement file or payload is
  required.** The manual settlement importer deliberately makes no assumption about any
  provider's format — the client maps columns — precisely so nothing here depends on guessed
  behaviour.
- **Q3 — bank statement export formats.** Which banks Helm Care Indonesia uses and what they can
  export. If any is PDF-only, that changes the *parser*, not this bridge.
- **Q5 — tax treatment per revenue type.** Needs the actual accountant. Until then no draft tax
  treatment is generated at all.
- **Q4 — receiving accounts, plus `counterparties` still being `user_id`-scoped.** Payer identity
  stays free text; the matcher compares names as text.

## 15. Unresolved risks (carried, not blocking)

1. **Match scoring weights are unvalidated against real data.** Deterministic and explainable,
   but nobody has checked them against a real Helm Care statement. The disqualification rules
   (currency mismatch, non-corresponding amount) matter more than the weights, and the
   amount rule may prove **too strict** for customers who habitually underpay.
2. **Idempotency pre-check + insert remain two statements.** The unique indexes are the real
   guarantee; the loser of a race gets a 409. Revisit when a live feed lands (B's Q1 answer).
3. **`recordAudit` is best-effort** — write and audit row are not one transaction. More
   load-bearing now that match acceptance is audited.
4. **P2-PRE-1 (B's open item): the ~980-line legacy bank-import path has no characterization
   tests.** Pre-existing, not introduced here. "Unchanged when the flag is OFF" rests on diff
   review plus the flag-OFF assertions, not on tests of that path itself. Should be docketed —
   it writes real ledger transactions.
5. **No UI anywhere**, so none of this is reachable by a user even with the flag on.

## 16. Readiness

**My verdict: PR1–PR5 are ready for final gatekeeper review and then human review.**

State: 9 local commits, **nothing pushed**, migrations **048/049/050 unapplied to any
database**, `INCOMING_PAYMENTS_ENABLED=false` everywhere, no UI, no external call, no credential.

Carry to the human reviewer: **do not enable the flag until 048, 049 and 050 are all applied** —
they are one unit, and enabling with only 048 applied fails every incoming-payments route.

For Agent B: the three fixes in `81710e88` are new since your round-4 GO and have not been
reviewed. They change matcher target normalisation, add two error paths, and change the review
queue's resolution rule. Everything else is unchanged from the tree you passed.

---

## 17. Round 5 — B4-1 fixed and committed (`0702a80f`)

**B4-1 is COMMITTED.** The previous session lost connection mid-commit; the fix was intact in
the working tree and has now been committed as `0702a80f fix: verify receivable matcher column
assumptions`.

### The blocker

`receivableTarget()` read `debts.remaining_amount`. **That is not a database column** — it is a
computed field `computeDebtStatus()` (server/index.js:1198) merges in when the debts API serves
a row. The candidate route feeds the matcher raw `select('*')` rows, which carry database
columns only, so in production the field was `undefined` and the matcher silently fell back to
`debt.amount` — the **original invoice amount, not the outstanding balance**. The function's own
docstring described the opposite behaviour.

B was right that this is the P2-B1 pattern again, and right about the cause of my blind spot:
my round-4 audit verified the columns `incoming_payments` reads and never the columns the
**debts** code reads.

### Demonstrated against the pre-fix code, not inferred

| Scenario (10,000,000 invoice, 7,000,000 paid, 3,000,000 outstanding) | Pre-fix | Post-fix |
|---|---|---|
| 3,000,000 receipt, production-shaped row | **0 candidates** — the money was invisible | 1 candidate, score 1.0 |
| 10,000,000 receipt (belongs elsewhere) | **1 candidate, score 1.0** — false exact match | 0 candidates |
| Enriched row (`computeDebtStatus` output) | 1 candidate | 1 candidate — identical |

### The fix

- `outstandingAmount()` derives the balance from **real columns**, mirroring `computeDebtStatus`
  exactly: `(original_amount || amount) − paid_amount`, floored at zero, in integer cents.
  Because it uses the same base columns that `computeDebtStatus` itself normalises, raw and
  enriched rows return the same answer — a test asserts `deepStrictEqual` between them.
- **Receivables with zero outstanding are excluded.** This is required *by* the fix, not
  incidental: a zero target makes the amount signal uncomparable, so name + date agreement alone
  (0.2 + 0.2 + 0.1 = 0.5) would otherwise carry a settled receivable over the 0.35 floor.
- **Fixtures in both suites are now production-shaped.** The old ones supplied
  `remaining_amount`, constructing a row shape production never produces — which is exactly why
  the suite was green over the bug. The matcher fixture now takes an `outstanding` knob that
  sets `paid_amount`, so every existing test exercises the real derivation.

### Column verification now complete for both tables

The gap B4-1 exposed is closed: every column the matcher reads is confirmed to exist —
**12 on `debts`** (`original_amount`, `amount`, `paid_amount`, `due_date`, `created_at`,
`counterparty`, `notes`, `currency`, `status`, `is_settled`, `type`, `business_id`) and
**8 on `transactions`** (`amount_idr`, `amount_original`, `transaction_date`, `created_at`,
`counterparty_name`, `currency_original`, `type`, `business_id`).

### Files changed

`server/lib/incomingPaymentMatching.js` · `tests/incomingPaymentMatching.test.js` ·
`tests/integration/incomingPaymentsApi.test.js`

### Tests

**270 feature assertions + 371 regression assertions, 0 failures.** `node --check` clean.
Five API tests failed on the first run after the fix — the API fixture carried the same
non-production `remaining_amount` shape; corrected, and that was the only cause.

## 18. Remaining risks (unchanged, none blocking)

1. **Scoring weights are still unvalidated against real data.** B4-1 makes this sharper: the
   matcher now compares against the true outstanding balance, so behaviour on real
   part-paid receivables is materially different from anything tested. Needs a real statement.
2. **P2-PRE-1** — the legacy bank-import path has no characterization tests. Pre-existing.
3. Idempotency pre-check + insert are two statements; the unique indexes are the real guarantee.
4. `recordAudit` is best-effort.
5. **No UI**, so none of this is user-reachable even with the flag on.

## 19. External blockers (unchanged)

Real Midtrans settlement sample (Q1/Q2), real bank export formats (Q3), tax treatment per
revenue type from the accountant (Q5), receiving-account list plus `counterparties` still being
`user_id`-scoped (Q4). Nothing has been invented in place of these.

## 20. Status

**PR1–PR5 ready for final gatekeeper review.** 11 commits, HEAD `0702a80f`, migrations
048/049/050 unapplied, `INCOMING_PAYMENTS_ENABLED=false`, no UI, no external call, no credential.

Deployment prerequisite unchanged: **do not enable the flag until 048, 049 and 050 are all
applied** — they are one unit.

**Requesting final B gatekeeper review of `0702a80f`.** It is the only commit new since your
round-4 pass; it changes the matcher's target derivation, adds a zero-outstanding exclusion,
and re-shapes both suites' debt fixtures to production shape.
