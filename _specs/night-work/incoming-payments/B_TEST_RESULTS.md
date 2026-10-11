# B_TEST_RESULTS — Final gatekeeper run

Reviewer: Agent B · Branch 10 commits ahead of `origin/main`, nothing pushed.
All tests local and offline. No production credentials, no production SQL, no external API calls.
Migrations 048/049/050 were never applied to any database — verified in PGlite only.

Every run is wrapped in a before/after md5 fingerprint of the feature file set and **discarded if
the bytes moved**. The results below are from runs marked STABLE.

## Feature suites — 265 assertions, 0 failures

| Suite | PR | Result |
|---|---|---|
| `tests/incomingPayments.test.js` | 1 | 38 / 0 |
| `tests/integration/incomingPaymentsMigration.test.js` | 1 | 25 / 0 |
| `tests/integration/incomingPaymentsApi.test.js` | 1,3,5 | 83 / 0 |
| `tests/incomingPaymentsBridge.test.js` | 2 | 20 / 0 |
| `tests/integration/incomingPaymentsBankBridgeApi.test.js` | 2 | 21 / 0 |
| `tests/integration/incomingPaymentsBankProvenanceMigration.test.js` | 2 | 9 / 0 |
| `tests/gatewaySettlementImport.test.js` | 3 | 24 / 0 |
| `tests/incomingPaymentMatching.test.js` | 4 | 29 / 0 |
| `tests/integration/incomingPaymentCandidatesMigration.test.js` | 4 | 16 / 0 |

## Regression — 371 assertions, 0 failures

Migration CI (PGlite): `ci` 28 · `ci_030` 12 · `ci_035` 6 · `ci_036` 19 · `ci_037` 22 ·
`ci_038` 9 · `ci_039` 37 → **133 / 0**

Unit: `transactionClass` 71 · `documentValidation` 29 · `documentsNoCashImpact` 27 ·
`taxGate` 23 · `money` 19 · `businessAccess` 18 · `documentAccess` 16 · `dueDate` 16 ·
`taxDocMath` 11 · `orphanCleanup` 8 → **238 / 0**

Identical to the pre-change baseline captured before PR1. No regressions at any point.

`node --check server/index.js` PASS.

Client build **not run** — the branch touches zero files under `client/` (`git diff --name-only
origin/main..HEAD` confirms), so `npm ci` + build has no review value here.

## Total: 636 assertions, 0 failures

---

## The green suite does not clear PR4

**636 passing assertions do not detect B4-1.** They cannot, by construction.

`server/lib/incomingPaymentMatching.js` → `receivableTarget()` reads `debt.remaining_amount`.
That column does not exist in `debts` — verified against the production `pg_dump` (which has
`amount`, `paid_amount`, `original_amount`) and against every migration. It is computed by
`computeDebtStatus()` at `server/index.js:1198`, and the candidate route feeds the matcher with
`supabase.from('debts').select('*')`, which returns raw database columns only.

Every matcher fixture sets the field explicitly —
`tests/incomingPaymentMatching.test.js:16, 67, 75, 81, 85, 86` — so the suite exercises a row
shape production never produces.

### Direct comparison, run against the real `buildCandidates`

Payment IDR 3,000,000. Receivable: 10,000,000 invoice, 7,000,000 paid, 3,000,000 outstanding,
same counterparty, same currency, due one day earlier.

| Row shape | Candidates | Score |
|---|---|---|
| **Production** — `select('*')` output, no `remaining_amount` | **0** | — |
| **Test** — `remaining_amount: 3000000` added | **1** | **1.0** |

The correct match is invisible in production and perfect in the tests.

### Independent verification performed (not tests A wrote)

| Check | Method | Result |
|---|---|---|
| Selected columns exist | diff `INCOMING_PAYMENT_LIST_COLS` against 048+049 schema | ✅ 33/33 valid |
| Insert payload keys exist | executed `validateCreate`, `buildPaymentFromBankRow`, `validateSettlementBatch`, compared keys to schema | ✅ 22 / 23 / 22 all valid |
| `debts` read columns exist | compared `receivableTarget` reads to production dump | ❌ **`remaining_amount` does not exist** |
| `transactions` read columns exist | compared `transactionTarget` reads to production dump | ✅ all valid |
| Flag gates | counted routes vs 404 guards | ✅ 11 / 11 |
| Currency determinism | `idr`/`IDR`/`usd`/`" Idr "`/`XX`/`""` through the validator | ✅ normalised; `XX` rejected; empty → IDR |
| Net arithmetic exactness | 100.10 − 0.03 − 0.02 vs stated 100.06 and 100.05 | ✅ 100.06 rejected, 100.05 accepted |
| Idempotency key determinism | repeated `bridgeIdempotencyKey` calls | ✅ stable; `dedup_hash` preferred, row-id fallback |
| Unchecked writes | grep every `supabase.from('incoming_payments')` write | ⚠️ two unchecked: `:3750`, `:3813` |
| Cross-business rejection | 050 migration test in PGlite | ✅ refused on INSERT and UPDATE, for debt and transaction targets |

## Discarded runs

| Run | Reported | Why discarded |
|---|---|---|
| Round 1 first pass | api 29/3 | files changed mid-run (A mid-write) |
| Round 2 first pass | unit 28/3, migration 18/2, api 31/1 | files changed mid-run |
| This session, first pass | 260 green | fingerprint moved — A resumed editing at 13:09 |

Recorded rather than dropped. Each was an artifact of testing a moving tree, not a defect.

## Standing gap (pre-existing, not introduced here)

The legacy bank-import path (`server/index.js` ~3257-4240, two ledger-writing sites) still has no
characterization tests. PR2's bridge is well covered at both confirm routes, but "existing
behaviour unchanged when the flag is OFF" rests on diff review. Not a blocker for this work;
should be docketed, since that path writes real ledger transactions.
