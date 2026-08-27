# A_STATUS — Incoming Payments Foundation PR1

Agent A (Implementer). Branch `feature/incoming-payments-foundation`. Round 1.

Status: **implementation complete, all tests green, awaiting B_REVIEW.md.**
Nothing pushed, nothing deployed, migration NOT applied anywhere.

---

## 1. Files changed

**New**

| File | What |
|---|---|
| `migrations/048_incoming_payments_foundation.sql` | Additive, idempotent. One table, 1 unique index, 4 lookup indexes, 1 updated_at trigger. |
| `server/lib/incomingPayments.js` | Pure validation/normalisation. No I/O. |
| `tests/incomingPayments.test.js` | 30 unit tests. |
| `tests/integration/incomingPaymentsMigration.test.js` | 20 PGlite constraint tests. |
| `tests/integration/incomingPaymentsApi.test.js` | 32 HTTP route tests. |

**Modified**

| File | What |
|---|---|
| `server/index.js` | +4 routes, flag helper, `IP` require. Inserted immediately before the `/api/bank-import/batches` block. Nothing existing touched. |
| `.env.example` | `INCOMING_PAYMENTS_ENABLED=false` documented. |
| `_specs/incoming-payments-bank-gateway-ingestion.md` | New §13 "PR1 — as built", status line. |
| `_specs/DECISIONS.md` | D22 status block. |
| `_specs/ROADMAP.md` | Phase 1 marked built-not-enabled. |
| `_specs/ARCHITECTURE.md` | Moved to DARK / BEHIND FLAG. |

**Untouched on purpose:** production data, cleanup SQL, Telegram identity, notification
grants, flags in any deployed env, client/, any other migration.

## 2. What is implemented

`incoming_payments` — provider-agnostic, ledger-inert staging for money received.

Routes (all `auth`, all business-scoped, all 404 when the flag is off):

- `GET /api/incoming-payments` — list, validated filters, limit 1–500.
- `POST /api/incoming-payments` — record one receipt.
- `GET /api/incoming-payments/:id` — detail (only route returning `raw_provider_payload`).
- `PATCH /api/incoming-payments/:id/status` — review decision.

Roles reuse existing helpers: read `canViewBusinessFinance`, create
`canCreateConfirmedFinancialRecord`, review `canApproveFinancialRecord`.

### Ledger-inert, enforced not just documented
- No route writes `transactions` or `debts`. Two API tests assert both tables stay empty
  after create and after review.
- `linked_transaction_id` / `linked_debt_id` set to NULL explicitly on insert; a
  client-supplied link is **refused** (`linking_not_supported`), not silently dropped.
- `reconciliation_status` is derived (`unmatched`), never client-chosen.
- `matched` is unreachable from the API — create and PATCH both refuse it.

### Money
- `gross_amount` NOT NULL; `fee_amount` / `tax_or_withholding_amount` nullable (NULL = not
  known yet, `0` = confirmed no fee); `net_amount` NOT NULL.
- DB CHECK `net = gross - fee - withholding` fires **only when all components are known**.
- A supplied net that contradicts the components is a 400 (`net_amount_mismatch`) — never
  silently corrected. Net is derived only when everything is known.

### Idempotency
- UNIQUE `(business_id, source_type, COALESCE(provider,''), idempotency_key)`.
- COALESCE is load-bearing: Postgres NULLs are distinct, so a plain UNIQUE would let
  unlimited duplicate manual entries (provider NULL) through. Test covers it.
- Route pre-checks and returns the first row with `200 { idempotent_replay: true }`; a
  23505 race falls back to re-select, else `409 duplicate_payment`.
- Fallback key derives from provider ids, else the economic shape of the receipt.

### Isolation
- `business_id` always from the ACTIVE workspace, never the body (test asserts a
  body-supplied `business_id` is ignored).
- Wallet from another business → `403 wallet_not_in_business`.
- Another business's payment by id → **404**, not 403 (no cross-tenant existence oracle).
- Personal workspace → `403 business_workspace_required` (existing resolver).

## 3. Tests run

| Suite | Result |
|---|---|
| `tests/incomingPayments.test.js` | **30/30 pass** |
| `tests/integration/incomingPaymentsMigration.test.js` | **20/20 pass** |
| `tests/integration/incomingPaymentsApi.test.js` | **32/32 pass** |
| Regression: `notificationGrantsApi`, `businessResolver`, `businessIsolation` | **26/26 pass** |
| Regression: `businessAccess`, `transactionClass`, `taxGate` | pass (71 assertions in transactionClass) |

Commands:
```
node --test tests/incomingPayments.test.js
node --test tests/integration/incomingPaymentsMigration.test.js
node --test tests/integration/incomingPaymentsApi.test.js
node --test tests/integration/notificationGrantsApi.test.js tests/integration/businessResolver.test.js tests/integration/businessIsolation.test.js
```

Covers every item on the brief's test list, including "no automatic transaction created",
"idempotency duplicate behavior", "cannot use wallet from another business", and "user_id -1
/ canonical business scope assumptions not hardcoded" (fixtures use arbitrary ids 7001–7004
and `aaaa…`/`bbbb…` UUIDs; no `HF-BIZ-*` code or `-1` appears in src or tests).

## 4. Known risks

1. **Pre-check + insert are two statements.** The unique index still prevents the duplicate
   row, but the loser of a genuine race gets 409 rather than the winning row. Acceptable for
   a staging table; an upsert/RPC is the fix when volume justifies it.
2. **`recordAudit` is best-effort** (existing project behaviour) — the payment write and its
   audit row are not one transaction. The grants work solved this with an RPC. Worth doing
   here if incoming payments ever become approval-bearing.
3. **`wallet_id` same-business ownership is API-enforced, not DB-enforced.** A composite FK
   needs `wallets.business_id` NOT NULL, which needs a backfill first
   (`migrations/audit_null_business_ids.sql`).
4. **`raw_provider_payload` may carry payer PII.** Excluded from list responses, returned on
   detail. No redaction or retention policy exists yet.
5. **The API test uses a hand-written fake Supabase**, same as `notificationGrantsApi.test.js`.
   It now models column projection, but it is not PostgREST. The SQL truth is the PGlite
   migration test.
6. **`provider` is free text.** Deliberate (a new Indonesian provider must not need a
   migration), but it means typos create new providers. Normalised to lowercase only.

## 5. Questions for reviewer

See `A_QUESTIONS_FOR_B.md` — the substantive ones are Q1 (is 409-on-race acceptable, or must
PR1 ship an idempotent upsert RPC), Q2 (should `manual_gateway_import` be allowed in PR1 at
all, or manual-bank-entry only), and Q3 (is API-level wallet tenancy enough for now).

---

## 6. Reply to B_STATUS.md (B round 1)

B's `B_STATUS.md` (23:47) reports "BLOCKED — NOTHING TO REVIEW". That was accurate **when it
was written**: my implementation landed at 23:59–00:00, after B's scan. B also inspected
`feature/pr46.2-notification-grants-smoke`.

**The work is on a different branch: `feature/incoming-payments-foundation`.** B needs to
check that branch out; `git status` on the old branch will keep showing docs only.

Every artefact B listed as missing now exists:

| B expected | Now |
|---|---|
| `_specs/night-work/incoming-payments/A_STATUS.md` | this file |
| `migrations/048_*.sql` | `migrations/048_incoming_payments_foundation.sql` |
| route module | `server/lib/incomingPayments.js` + routes in `server/index.js` (see §9 of A_IMPLEMENTATION_NOTES for why not `server/routes/`) |
| `INCOMING_PAYMENTS_ENABLED` gate | `server/index.js`, `isIncomingPaymentsEnabled()`, default OFF |
| tests naming incoming payments | 3 files, 82 tests |

### On B's Q4 point (wallet mapping)

B is right that spec §11 Q4 gates Phases 1–3, and B named the correct escape hatch. I took
exactly it, explicitly: **`wallet_id` is nullable and unresolved in PR1.** No wallet mapping
is guessed, no receiving account list is assumed, no `counterparty_id` column was added
(`counterparties` is still `user_id`-scoped). Q4 stays open and blocks Phase 2/3, not PR1.

### On B's test-tooling note

Confirmed — there is no `npm test`. My suites run under `node --test` (the newer convention
used by `companyGrantsMigration.test.js` / `notificationGrantsApi.test.js`), not the manual
pass/fail counter style of the older unit files:

```
node --test tests/incomingPayments.test.js
node --test tests/integration/incomingPaymentsMigration.test.js
node --test tests/integration/incomingPaymentsApi.test.js
```

All three are **fully offline** — PGlite for the migration, a hand-written fake Supabase for
the routes. No `BASE_URL`, no Supabase env, no credentials, no live server. B can run them as-is.

### B's checklist items 1–9 — where each is covered

| B item | Covered by |
|---|---|
| 1. Flag OFF → 404 | API: `flag OFF: every route is 404…` + `flag OFF: nothing is written…` |
| 2. Create happy path | API: `an owner records a receipt…` |
| 3. Non-member business rejected | API: `a user cannot create a payment for a business they do not belong to` (403) |
| 4. Cross-business `wallet_id` rejected | API: `a wallet from ANOTHER business cannot be attached` (403) |
| 5. Cross-business debt/transaction link | Stronger: **all** client-supplied links refused — unit `a client may NOT attach a ledger transaction or debt`, API `a client cannot create a payment already linked to the ledger` |
| 6. Idempotency → one row | Migration: 4 unique-index tests incl. the COALESCE/NULL-provider case. API: replay returns first row, `dbState.incoming_payments.length === 1` |
| 7. Gross/fee/net incl. "unknown is NULL, never 0" | Unit: `an explicitly UNKNOWN fee (null) is preserved…`, `an omitted fee means zero, which is not the same as unknown`. Migration: `an UNKNOWN fee (NULL) is allowed and does not force net = gross` |
| 8. No `transactions` row created | API: `THE core guarantee: recording a payment creates NO transaction and NO debt` + `review does NOT book anything to the ledger` |
| 9. No final accounting state without review | Unit + API: `matched` unreachable, `reconciliation_status` derived, links refused |

## 7. Baseline re-verified after my change

Reran B's exact pre-change baseline on `feature/incoming-payments-foundation`:

- Migration CI: 28 + 12 + 6 + 19 + 22 + 9 + 37 = **133 assertions, 0 failures**
- Unit: 18 + 16 + 29 + 27 + 16 + 8 + 11 + 23 + 71 + 19 = **238 assertions, 0 failures**
- `node --check server/index.js` and all `server/lib/*.js` + `server/routes/*.js`: **PASS**

**371/371 — identical to B's baseline. No regression.** Plus 82 new tests, all passing.

One note for B's records: `tests/migrations/ci_030.js` prints a libuv
`UV_HANDLE_CLOSING` assertion *after* its `ALL PASS — 12 passed, 0 failed` line and still
exits 0. It is a Windows PGlite teardown artifact, present independently of this change.

## 8. Still awaiting

`B_REVIEW.md` with a GO / NO-GO / YELLOW verdict. I have made no further changes pending it.
Open decisions that could still change the code are in `A_QUESTIONS_FOR_B.md` (Q1 race
handling, Q2 which source types PR1 accepts, Q3 DB-level wallet tenancy, Q4 the net CHECK).
