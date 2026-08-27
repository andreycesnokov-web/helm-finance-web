# B_TEST_RESULTS — Incoming Payments Foundation PR1

Reviewer: Agent B · Round 1
Tree: working tree, uncommitted. Code fingerprints (md5) verified identical before and after
Agent A posted `A_STATUS.md`, so all results below refer to the settled implementation.

All tests were run **locally and offline**. No production credentials were supplied, no
production SQL was run, no external API was called.

## Test tooling — note for the record

**There is no `npm test` script in this repo.** `package.json` defines only `dev`, `server`,
`client`, `build`, `start`. The reviewer brief suggested `npm test -- --runInBand`; that command
does not exist here and was not used. Tests are standalone Node files:

- Unit / new suites: `node --test tests/<name>.test.js`
- Legacy unit suites: `node tests/<name>.test.js` (own runner, prints `ALL PASS`)
- Migration CI (PGlite, no DB): `node tests/migrations/ci_0NN.js`

---

## A. Agent A's new suites — **82 / 82 PASS**

| Suite | Result |
|---|---|
| `tests/incomingPayments.test.js` | **30 pass / 0 fail** |
| `tests/integration/incomingPaymentsMigration.test.js` | **20 pass / 0 fail** |
| `tests/integration/incomingPaymentsApi.test.js` | **32 pass / 0 fail** |

`incomingPaymentsApi.test.js` was run **4 consecutive times on the settled tree — 32/32 every
run.**

### Checklist item 4 coverage

| Required by brief | Covered | Where |
|---|---|---|
| flag OFF | ✅ | all 4 routes 404; **plus** "nothing is written even on a well-formed create" |
| create valid incoming payment | ✅ | owner records receipt, 201, status `draft`/`unmatched` |
| reject unauthorized business | ✅ | non-member refused; body `business_id` provably ignored |
| reject cross-business wallet | ✅ | 403 `wallet_not_in_business`; same-business wallet accepted |
| reject cross-business transaction/debt | ✅ | client linking refused `linking_not_supported` (links not implemented by design) |
| idempotency duplicate | ✅ | replay → 200 + first row; explicit key; cross-business no collision; 23505 race returns winner not 500 |
| gross/fee/net validation | ✅ | separation, derivation, contradiction → 400, unknown-fee (NULL) path |
| no auto transaction created | ✅ | "THE core guarantee" asserts `transactions` and `debts` stay empty after create **and** after review |
| no final accounting state | ✅ | cannot create as `matched`/`reviewed`; cannot self-declare `matched` |

Beyond the checklist: personal-workspace rejection, no cross-tenant existence oracle (404 not
403), audit rows written on create and review, list-filter validation, `raw_provider_payload`
excluded from list responses.

### Transient failures observed during the review — resolved, not defects

My first pass reported failures in three API tests:

- `THE core guarantee: recording a payment creates NO transaction and NO debt`
- `a replayed submission returns the FIRST row instead of duplicating the money`
- `the list response omits the raw provider payload; the detail route returns it`

**Cause: I was reading a moving target.** Agent A was still writing the files when I ran them.
Evidence: each failing test passed when run in isolation via `--test-name-pattern`, and once the
tree settled (md5-verified stable) the full file passed 32/32 on four consecutive runs.

Recording rather than omitting, because one structural observation survives: the suite shares
module-level `dbState` and a single Express instance across tests. It is order-sensitive by
construction and could resurface under a parallel runner or `--test-concurrency > 1`. Not a
defect in the current state.

### Independent verification of a finding (not a test A wrote)

To evidence blocker **B1** rather than assert it, I called the real validator directly
(`server/lib/incomingPayments.js`, pure, no I/O):

| Input | Output |
|---|---|
| `gateway_settlement` / `midtrans`, `gross 1,000,000`, fee omitted, net omitted | `fee=0, tax=0, net=1000000` |
| same + true `net 967,810` | REJECTED `net_amount_mismatch` |
| same + explicit `fee_amount: null` | `fee=null, net=967810` ✅ |
| `manual_bank_entry`, `gross 500,000`, fee omitted | `fee=0, net=500000` ✅ |

Row 1 is the blocking behaviour: a stored claim that the gateway charged nothing. Row 2 shows
the honest caller is refused. See `B_REVIEW.md` §3 B1.

---

## B. Regression — **371 / 371 PASS, no regressions**

### Migration CI (PGlite, offline)

| Suite | Baseline | After PR1 |
|---|---|---|
| `ci.js` | 28 / 0 | **28 / 0** |
| `ci_030.js` | 12 / 0 | **12 / 0** (see note) |
| `ci_035.js` | 6 / 0 | **6 / 0** |
| `ci_036.js` | 19 / 0 | **19 / 0** |
| `ci_037.js` | 22 / 0 | **22 / 0** |
| `ci_038.js` | 9 / 0 | **9 / 0** |
| `ci_039.js` | 37 / 0 | **37 / 0** |

**133 assertions, 0 failures — identical to baseline.**

### Unit suites

| Suite | Baseline | After PR1 |
|---|---|---|
| `businessAccess` | 18 / 0 | **18 / 0** |
| `documentAccess` | 16 / 0 | **16 / 0** |
| `documentValidation` | 29 / 0 | **29 / 0** |
| `documentsNoCashImpact` | 27 / 0 | **27 / 0** |
| `dueDate` | 16 / 0 | **16 / 0** |
| `orphanCleanup` | 8 / 0 | **8 / 0** |
| `taxDocMath` | 11 / 0 | **11 / 0** |
| `taxGate` | 23 / 0 | **23 / 0** |
| `transactionClass` | 71 / 0 | **71 / 0** |
| `money.mjs` | 19 / 0 | **19 / 0** |

**238 assertions, 0 failures — identical to baseline.**

### CI gate (mirrors `.github/workflows/ci.yml`)

| Check | Result |
|---|---|
| `node --check server/index.js` | **PASS** |
| `node --check server/lib/incomingPayments.js` | **PASS** |
| `node --check` all `server/lib/*.js`, `server/routes/*.js` | **PASS** |
| `cd client && npm run build` | **NOT RUN** — see below |

The client build was skipped deliberately. `npm run build` runs `npm ci`, which deletes and
reinstalls `client/node_modules`. PR1 touches **no** client file (`git status` confirms zero
changes under `client/`), so the build has no review value here and the mutation is not worth
it. It remains a CI gate on the eventual PR.

---

## C. Pre-existing environment artifact — not caused by this PR

`tests/migrations/ci_030.js` prints, on every run:

```
ALL PASS — 12 passed, 0 failed
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```

exit code **0**. All 12 assertions pass; the libuv assertion fires at process teardown after
the run completes. It is a PGlite/libuv/Windows artifact, reproduced 3/3 times, on a file this
PR does not touch (`migrations/030_*` and `tests/migrations/ci_030.js` are both unmodified).
Recorded so it is not later misattributed to this PR.

---

## D. Not run, and why

- **Integration suites requiring live infrastructure** (`businessIsolation`, `httpE2E`,
  `emailAuthHttp`, and similar) need `BASE_URL`, `JWT_SECRET`, `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY` and a running server. Supplying those means handling production
  credentials, which the hard restrictions bar. They self-skip cleanly without env, which is not
  a meaningful signal, so they are recorded as **not run** rather than as passing.

  Note: Agent A reports running `businessResolver`, `businessIsolation` and
  `notificationGrantsApi` (26/26). I could not independently reproduce the credential-dependent
  ones and am not vouching for them.
- **Any production SQL.** Not run. Schema facts in this review come from a local `pg_dump`
  artifact dated 2026-08-27, never from a live query.
- **Migration 048 was never applied** to any database. Its behaviour was verified entirely in
  PGlite.

---

## Totals

| Group | Assertions | Failures |
|---|---|---|
| Agent A's new suites | 82 | 0 |
| Pre-existing regression | 371 | 0 |
| **Total verified** | **453** | **0** |

Test evidence supports a GO. The YELLOW verdict in `B_REVIEW.md` rests on two code findings
(B1, B2), not on any failing test — and B1 is precisely the kind of defect a green suite does
not catch, because A's tests encode the current behaviour as intended.
