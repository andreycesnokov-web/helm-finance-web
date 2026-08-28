# B_TEST_RESULTS — Incoming Payments (Round 2)

Reviewer: Agent B
PR1 state: committed `6edfff3b`, all PR1 files **frozen** (verified `git diff HEAD` per file).
PR2 state: in progress, uncommitted, **no tests yet**.

All tests run locally and offline. No production credentials, no production SQL, no external
API calls. Migrations 048/049 were never applied to any database — their behaviour is verified
entirely in PGlite.

## Methodology note — why results are fingerprinted

Twice during this session I ran suites while Agent A was mid-write and got failures that were
artifacts of a half-written tree, not defects. I now wrap every run in a before/after md5
fingerprint of the file set and **discard any result where the bytes moved during the run**.

Discarded runs, recorded for honesty:

| Run | Reported | Disposition |
|---|---|---|
| Round 1, first pass | api 29/3 | **Discarded** — files changed mid-run; each test passed in isolation; settled tree 32/32 |
| Round 2, first pass | unit 28/3, migration 18/2, api 31/1 | **Discarded** — files changed mid-run (A was landing the B1/B2 fixes) |

Nothing below is from a discarded run.

---

## A. PR1 — **97 / 97 PASS**

| Suite | Round 1 | Round 2 |
|---|---|---|
| `tests/incomingPayments.test.js` | 30 / 0 | **38 / 0** |
| `tests/integration/incomingPaymentsMigration.test.js` | 20 / 0 | **25 / 0** |
| `tests/integration/incomingPaymentsApi.test.js` | 32 / 0 | **34 / 0** |
| **Total** | 82 | **97** |

Assertion count rose by 15: A added coverage for the B1/B2 fixes and for the narrowed `status`
vocabulary. Reproduced twice with identical results.

### PR1 file freeze — verified

```
FROZEN: server/lib/incomingPayments.js
FROZEN: migrations/048_incoming_payments_foundation.sql
FROZEN: tests/incomingPayments.test.js
FROZEN: tests/integration/incomingPaymentsApi.test.js
FROZEN: tests/integration/incomingPaymentsMigration.test.js
```

Only `server/index.js` differs from the commit, and solely because of in-flight **PR2** bridge
code. PR1's own routes (`3285-3479`) are unchanged apart from the `INCOMING_PAYMENT_LIST_COLS`
edit, which is itself finding **P2-B2**.

### Independent verification (not tests A wrote)

Re-ran my round-1 probe directly against the validator to confirm B1 is genuinely fixed rather
than merely re-described:

| Input | Round 1 | Round 2 |
|---|---|---|
| `gateway_settlement`, gross 1,000,000, fee omitted, net omitted | `fee=0, net=1000000` ❌ | `REJECTED missing_net_amount` ✅ |
| same + true net 967,810 | `REJECTED net_amount_mismatch` ❌ | `fee=null, tax=null, net=967810` ✅ |
| same + fee 29,000, tax 3,190 | — | `net=967810` ✅ |
| `manual_gateway_import`, gross only | — | `REJECTED missing_net_amount` ✅ |
| `manual_bank_entry`, gross only | `fee=0` ✅ | `fee=0` ✅ |
| `bank_statement_import`, gross only | — | `fee=0` ✅ |

---

## B. Regression — **262 / 262 PASS, no regressions**

### Migration CI (PGlite, offline)

| Suite | Baseline | Now |
|---|---|---|
| `ci.js` | 28 / 0 | **28 / 0** |
| `ci_035.js` | 6 / 0 | **6 / 0** |
| `ci_036.js` | 19 / 0 | **19 / 0** |
| `ci_037.js` | 22 / 0 | **22 / 0** |
| `ci_038.js` | 9 / 0 | **9 / 0** |
| `ci_039.js` | 37 / 0 | **37 / 0** |

**121 assertions, 0 failures.** (`ci_030.js` not re-run this round — see §D.)

### Unit

| Suite | Baseline | Now |
|---|---|---|
| `transactionClass` | 71 / 0 | **71 / 0** |
| `documentValidation` | 29 / 0 | **29 / 0** |
| `businessAccess` | 18 / 0 | **18 / 0** |
| `taxGate` | 23 / 0 | **23 / 0** |

**141 assertions, 0 failures.**

### Syntax / CI gate

`node --check server/index.js` PASS · `node --check server/lib/incomingPayments.js` PASS ·
`node --check server/lib/incomingPaymentsBridge.js` PASS.

Client build not run — PR1 and PR2 touch **zero** files under `client/`.

---

## FINAL — all five PRs, 565 assertions, 0 failures

Run under the before/after md5 fingerprint guard; bytes stable across the run.

### Feature suites (257)

| Suite | PR | Result |
|---|---|---|
| `tests/incomingPayments.test.js` | 1 | **38 / 0** |
| `tests/integration/incomingPaymentsMigration.test.js` | 1 | **25 / 0** |
| `tests/integration/incomingPaymentsApi.test.js` | 1,3,5 | **80 / 0** |
| `tests/incomingPaymentsBridge.test.js` | 2 | **20 / 0** |
| `tests/integration/incomingPaymentsBankBridgeApi.test.js` | 2 | **21 / 0** |
| `tests/integration/incomingPaymentsBankProvenanceMigration.test.js` | 2 | **9 / 0** |
| `tests/gatewaySettlementImport.test.js` | 3 | **24 / 0** |
| `tests/incomingPaymentMatching.test.js` | 4 | **24 / 0** |
| `tests/integration/incomingPaymentCandidatesMigration.test.js` | 4 | **16 / 0** |

Growth across the session: 82 → 97 → 141 → **257**.

### Regression (308) — no regressions at any point

6 migration-CI suites (`ci`, `ci_035`–`ci_039`): **121 / 0**, identical to baseline.
6 unit suites (`transactionClass` 71, `documentValidation` 29, `documentsNoCashImpact` 27,
`taxGate` 23, `money` 19, `businessAccess` 18): **187 / 0**, identical to baseline.
`node --check server/index.js` PASS.

Client build not run — PR1–PR5 touch **zero** files under `client/`.

### The P2-B1 fix, verified at the right endpoint

`incomingPaymentsBankBridgeApi.test.js:290` now posts to `/api/bank-imports/${batch}/confirm` —
the cascade route `client/src/pages/BankImport.jsx:316` actually calls — and the file carries a
comment naming that file as the reason. Suite grew 15 → 21. Before the fix, the only bridge test
drove the V1 route at `:152`.

---

## C-bis. PR2 as committed (`e4a72d4d`, superseded by `706f862b`) — **44 / 44 PASS, and that was not enough**

| Suite | Result |
|---|---|
| `tests/incomingPaymentsBridge.test.js` | **20 / 0** |
| `tests/integration/incomingPaymentsBankBridgeApi.test.js` | **15 / 0** |
| `tests/integration/incomingPaymentsBankProvenanceMigration.test.js` | **9 / 0** |

Run with the fingerprint guard; bytes stable across the run, so these results are valid.

**Both blockers survive a fully green suite.** This is the clearest example in this session of
why a passing run is not by itself evidence:

- **P2-B1** — `incomingPaymentsBankBridgeApi.test.js:152` drives
  `/api/bank-import/batches/:id/confirm` (V1). The UI calls
  `/api/bank-imports/:batchId/confirm` (cascade, `server/index.js:4255`), which is still
  unbridged. The suite and production exercise different endpoints, so the suite passes while a
  real import produces zero incoming payments.
- **P2-B2** — the fake Supabase projects with `st.cols.filter((c) => c in r)`
  (`incomingPaymentsApi.test.js:71`), silently dropping unknown columns. Selecting the 049
  columns without 049 applied is therefore untestable here and would only surface against real
  PostgREST, as a 500 on every incoming-payments route.

Neither is a test-quality complaint about what A wrote — the 44 assertions are well constructed.
The gap is that both defects live precisely where this harness cannot see.

## C. PR2 — original assessment (superseded by C-bis; retained for the record)

`migrations/049_*.sql` and `server/lib/incomingPaymentsBridge.js` are untracked and have no
coverage. Nothing under `tests/` references the bridge, 049, or either confirm route.

### What PR2 must add before it can be graded

1. **Migration CI for 049** (PGlite): additive + idempotent re-apply; the partial unique index
   rejects a second payment for the same `bank_import_row_id`; the same row id is allowed in a
   different business; `ON DELETE SET NULL` preserves the payment when a batch is deleted.
2. **Bridge unit tests** (`buildPaymentFromBankRow` is pure and trivially testable): credit
   accepted; debit rejected; unrecognised direction rejected; unconfirmed/excluded rejected;
   cross-business row rejected; cross-business batch rejected; row/batch mismatch rejected;
   gross = net with fee 0; idempotency key derived from `dedup_hash` with row-id fallback.
3. **Route tests driving the CASCADE confirm** (`/api/bank-imports/:batchId/confirm`) — the
   route the UI actually calls. A test that drives only the V1 route would pass while the
   feature is dead in production. This is finding **P2-B1**.
4. **Flag-OFF characterization of the existing bank-import confirm** — see §E.

---

## D. Known environment artifact — unchanged, not caused by this work

`tests/migrations/ci_030.js` prints `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
(libuv/Windows) **after** reporting `ALL PASS — 12 passed, 0 failed`, exit code 0. Reproduced
3/3 in round 1 on files this work does not touch. Excluded from this round's run to keep the
signal clean; its status is unchanged.

---

## E. Standing gap — the repo has ZERO bank-import tests

Verified again this round: no file under `tests/`, `tests/integration/`, or `tests/migrations/`
matches `bank`. The bank-import path is 10 routes across roughly 980 lines
(`server/index.js:3257-4240`) with two ledger-writing sites (`:3649`, `:4155`) and has never had
a test.

PR2's first checklist item — *"existing bank import behavior unchanged when flag OFF"* — cannot
be regression-proven against a suite that does not exist. I have snapshotted the pre-PR2 code so
I can diff it byte-for-byte on my side (`:3257-3688` md5 `ad1dd583…`, `:3689-4240` md5
`0877d0f2…`), but a diff review is weaker than a passing characterization test, and this path
writes real ledger transactions.

---

## Totals this round

| Group | Assertions | Failures |
|---|---|---|
| PR1 suites | 97 | 0 |
| Regression | 262 | 0 |
| PR2 | 0 | — (no tests exist) |
| **Verified** | **359** | **0** |

PR1's test evidence supports its **GO**. PR2's two blockers are **not** test failures — P2-B1 is
a wiring gap no current test covers, and P2-B2 is provably invisible to the test suite because
the fake Supabase silently drops unknown columns. Both are cases where a green run is not
evidence of correctness.
