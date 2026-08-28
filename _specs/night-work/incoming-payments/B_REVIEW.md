# B_REVIEW — Incoming Payments Foundation · FINAL GATEKEEPER REVIEW

Reviewer: Agent B (independent gatekeeper)
Branch: `feature/pr46.2-notification-grants-smoke`, 10 commits ahead of `origin/main`, **nothing pushed**
Method: independent re-review from scratch. Call sites and production wiring inspected manually;
schema verified against the production `pg_dump` artifact (2026-08-27), not against test doubles.

---

# FINAL MATRIX — re-reviewed after the B4-1 fix

| PR | Verdict |
|---|---|
| **PR1 — Incoming Payments Foundation** | **PASS** |
| **PR2 — Bank Import → Incoming Payments bridge** | **PASS** |
| **PR3 — Provider-agnostic Gateway Settlement Import** | **PASS** |
| **PR4 — Matching candidates** | **PASS** *(was BLOCKED — B4-1 now fixed)* |
| **PR5 — Minimal review queue** | **PASS** |

# FINAL VERDICT: GO
# INCOMING PAYMENTS FOUNDATION: READY FOR NEXT PHASE

Ready for human review, and ready for Codex / MiMo final review.

> **B4-1 is fixed and independently verified.** `receivableTarget()` now calls
> `outstandingAmount(debt)`, which derives the balance from `original_amount`/`amount` minus
> `paid_amount` — all real columns — in integer cents. Re-run against the same
> production-shaped fixture that exposed the defect (3,000,000 receipt vs a 10,000,000
> receivable with 7,000,000 paid): outstanding now computes to **3,000,000** and the match
> yields **1 candidate at score 1.0**, where it previously yielded **0**. A fully-paid
> receivable is excluded, and a wrong-amount receivable is not a false exact match.
>
> The fix is guarded against regression: `tests/incomingPaymentMatching.test.js:219` asserts the
> fixture must not carry `remaining_amount`, and the suite records that the old fixtures
> "supplied `remaining_amount` and therefore asserted the bug was correct."
>
> Tests: **641 assertions, 0 failures** (270 feature + 371 regression). The matching suite grew
> 29 → 34. Full detail in `B_TEST_RESULTS.md`; the original blocker analysis is retained below
> for the record.
>
> Remaining non-blockers are listed in `B_STATUS.md` (R1–R6). The one to action before handing
> off: **the B4-1 fix is still uncommitted** — commit it so the reviewed state is the state
> Codex/MiMo receive.

---

## BLOCKER · B4-1 — The matcher reads a column that does not exist, and silently scores against the wrong amount

**File:** `server/lib/incomingPaymentMatching.js` → `receivableTarget()`
**Feeder:** `server/index.js:3706` — `supabase.from('debts').select('*')`

```js
const outstanding = isNum(debt.remaining_amount) ? debt.remaining_amount
  : (isNum(debt.amount) ? debt.amount : debt.original_amount);
```

**`debts.remaining_amount` is not a database column.**

- Absent from the production schema dump — `debts` has `amount`, `paid_amount`,
  `original_amount`, and no `remaining_amount`.
- Absent from every migration (`grep -rn remaining_amount migrations/` → no match).
- It is a **computed field**, added in `computeDebtStatus()` at `server/index.js:1198`.

The candidate route selects raw rows with `select('*')`, which returns database columns only.
`computeDebtStatus` is never applied. So in production `debt.remaining_amount` is `undefined`,
`isNum(undefined)` is false, and the matcher falls back to `debt.amount` — **the original
invoice amount, not the outstanding balance**.

The function's own docstring states the opposite intent:

> `remaining_amount` is what is still owed and is the right comparison target: matching a
> partial payment against the original amount would score it as a mismatch.

The code does precisely what its comment warns against.

### Why the suite cannot see it

Every matcher fixture supplies the field explicitly —
`tests/incomingPaymentMatching.test.js:16, 67, 75, 81, 85, 86` all set `remaining_amount:`.
The test constructs a row shape production never produces. This is the P2-B1 pattern exactly:
green tests over a path that is not the production path.

### Demonstrated, not inferred

Same payment (IDR 3,000,000), same receivable (10,000,000 invoice, 7,000,000 paid,
3,000,000 outstanding, same counterparty, same currency, due one day earlier) — run through the
real `buildCandidates`:

| Row shape | Result |
|---|---|
| **Production** (`select('*')` output, no `remaining_amount`) | **0 candidates** |
| **Test** (`remaining_amount: 3000000` added) | **1 candidate, score 1.0** |

A partially-paid receivable that exactly matches an incoming receipt is **invisible to the
matcher in production**, while the test suite shows a perfect match. Conversely, an unrelated
receivable still open at its original 10,000,000 would score as an exact amount match against a
10,000,000 receipt that actually belongs elsewhere.

### Expected behaviour

`receivableTarget` must compare against the genuine outstanding balance derived from real
columns — `amount − paid_amount` (respecting `original_amount` where it differs) — or the route
must run rows through `computeDebtStatus()` before scoring. Either way the matcher must not read
`remaining_amount` off a raw `debts` row, and at least one test must use a **production-shaped**
row with no computed fields.

Scope note: `transactionTarget()` is clean — every column it reads (`amount_idr`,
`amount_original`, `transaction_date`, `created_at`, `counterparty_name`, `currency_original`)
exists in the real schema, and `reference` is explicitly `null`.

---

## Non-blockers

### B4-2 · Accepting a candidate is not atomic, and a failure is swallowed
`server/index.js:3813-3818`

```js
await supabase.from('incoming_payments').update({
  reconciliation_status: 'matched', linked_debt_id: ..., linked_transaction_id: ...,
}).eq('id', payment.id).eq('business_id', businessId);
```

No `error` is destructured or checked. The candidate is marked `accepted` in a prior statement.
If this second write fails, the candidate reads `accepted` while the payment stays `unmatched`
with no link — and a retry returns `409 already_decided`, so the reviewer cannot repair it
through the API. No money is misattributed and nothing is booked, but the failure is silent and
the state is not recoverable from the UI. Surface the error, and ideally make the pair atomic
(the notification-grants work established the RPC pattern for this).

### B4-3 · Two concurrent accepts on one payment have no DB guard
The `already_matched` check is a read-then-write in JS. 050's unique index covers
`(payment, target_type, target)`, not "one accepted candidate per payment". Two simultaneous
accepts of *different* candidates could both pass and both write, leaving two `accepted`
candidates with the payment linked to only one. Low likelihood (human action), no
misattribution, but unguarded at the database.

### B4-4 · Candidate-status reflection write also unchecked
`server/index.js:3750` — the `reconciliation_status: 'candidate'` update is unchecked. Cosmetic
compared with B4-2, but the same pattern.

---

## PR-by-PR findings

### PR1 — PASS
Schema and code agree: all 33 columns in `INCOMING_PAYMENT_LIST_COLS` exist in 048/049;
`raw_provider_payload` is correctly excluded from list responses and added only on detail.
Insert payloads verified by executing the real validator — 22 keys, all valid. Constraints are
proven against **real Postgres** (PGlite), including `fee`/`withholding` having **no default**
(so a non-API writer cannot inherit a zero-fee claim), `status` as the review axis only,
evidence `RESTRICT` on business delete, and idempotency including the `COALESCE(provider,'')`
NULL-distinctness case. A also closed the previously-deferred N6: `incoming_payments_provider_txn_uidx`
is a partial unique index on `(business_id, provider, provider_transaction_id)`, so a replayed
webhook cannot double-record even under a different idempotency key.

### PR2 — PASS
P2-B1 and P2-B2 both genuinely closed. The bridge now runs from **both** confirm routes
(`:4134` V1, `:4649` cascade) and a test drives the cascade endpoint that
`client/src/pages/BankImport.jsx:316` actually calls. `.env.example` documents 048+049+050 as one
unit with reasons. Credits only; debits refused without guessing; tenancy checked on row *and*
batch; idempotency keyed on `dedup_hash`. The only two deletions in the entire branch are the two
`res.json` lines replaced to add the bridge summary — no existing behaviour removed.

### PR3 — PASS
Provider-agnostic in the schema, not just the prose: no provider name appears in any DDL, and
there is no new migration at all. `midtrans, doku, xendit, hitpay, duitku, ipaymu, manual_gateway`
are data, not code paths. Zero external calls and zero credentials (verified by grep for
`fetch(`, `axios`, `http(s)://`, `api_key`, `client_secret`, `server_key`). Gross/fee/tax/net
carried separately; net arithmetic exact to the cent — a 0.01 discrepancy is **rejected**, not
rounded away. Currency normalised, validated, `XX` refused, empty defaults to IDR.

### PR4 — BLOCKED
Blocked by **B4-1** above. Everything else in PR4 is sound and worth recording: cross-business
candidates are refused by a **database trigger** validating the payment's, the debt's and the
transaction's `business_id`, on INSERT **and** UPDATE, verified in PGlite. There is deliberately
**no invoice target** — 041 is unapplied in production and the design says so explicitly.
Receivables only; payables and settled debts excluded. Accepting writes the link and
`reconciliation_status='matched'` and provably does not touch the debt or the transaction.

### PR5 — PASS
Both routes flag-gated before any DB access; business-scoped; `PATCH /:id/reconciliation` accepts
only `ignored`, so a match can never be self-declared. **No client file touched**, so there is no
production navigation to leak. A's self-audit fix correctly made `rejected` terminal on its own —
previously a reviewer had to mislabel a rejected receipt as `ignored` to clear it, corrupting the
one signal the queue exists to produce.

---

## Gatekeeper checklist

| Check | Result |
|---|---|
| No production env/secrets changed | ✅ only `.env.example`, a template |
| No deploy config changed | ✅ no `.github`, Railway, Dockerfile, package.json |
| No production flags enabled | ✅ `INCOMING_PAYMENTS_ENABLED=false` |
| No push | ✅ 10 ahead, 0 remote branches contain HEAD |
| No external API calls | ✅ verified by grep |
| No provider credentials | ✅ verified by grep |
| No Telegram identity changes | ✅ no such file in the branch diff |
| No notification-grants changes | ✅ same |
| No cleanup-SQL changes | ✅ same |
| No hardcoded user/business IDs | ✅ no `HF-BIZ-*`, no `-1`, no telegram id in code or tests |
| Provider-agnostic, not Midtrans-only | ✅ no provider name in any DDL |
| `business_id` scoping enforced | ✅ every query filtered; DB trigger on candidates |
| Personal/business money separated | ✅ `businessResolver.js:46` rejects `type='personal'` |
| Helm Care Pay / Indonesia cannot mix | ✅ DB trigger, verified in PGlite on INSERT and UPDATE |
| Wallet/debt/transaction links same-business | ✅ wallet checked in route; debt/tx by trigger |
| Idempotency safe at DB and API level | ✅ two unique indexes + replay returns first row + 23505 handled |
| Gross/fee/tax/net explicit | ✅ four separate columns, exact arithmetic |
| No net settlement treated as gross revenue | ✅ gateway source with unknown fee refuses rather than assuming zero |
| No automatic revenue booking | ✅ no `transactions` write anywhere in the feature |
| No automatic transaction creation | ✅ bridge writes only `incoming_payments` |
| No final accounting without review | ✅ decision-stamp CHECK; approval role required |
| No invoice dependency | ✅ deliberately designed out; 041 unapplied |
| Flag OFF behaviour safe | ✅ 11 routes, 11 gates, 404 before DB access |
| Migrations additive only | ✅ only DROPs are idempotent `DROP TRIGGER IF EXISTS` |
| Tests meaningful and passing | 🟡 636 assertions green — **but see B4-1**: the matcher suite tests a row shape production never produces |
| No unrelated files changed | ✅ 29 files, all feature or spec; 5 deletions total |

---

## Process note

Agent A rewrote `B_STATUS.md` in commit `6531e920` ("sync B review files"). The content was my
own earlier draft rather than altered verdicts, so nothing was falsified — but the reviewer's
files are the one artifact the implementing agent should not touch, precisely so a verdict cannot
be edited by the party being gated. Worth restating for future batches.

Credit where due: A's round-4 self-audit independently hunted the P2-B1/P2-B2 classes and found
three real defects, including two genuine phantom columns (`debts.reference`,
`transactions.reference`) and a silent fallback that reported "no matches found" when a source
read had failed. That audit was the right instinct. B4-1 is the same class, one layer deeper: the
audit checked the columns the *incoming_payments* reads use, but not the columns the *debts* read
uses.

---

Agent B wrote no application code, no migration, and no Agent A file.
