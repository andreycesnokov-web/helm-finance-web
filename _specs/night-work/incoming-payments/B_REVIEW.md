# B_REVIEW — Incoming Payments Foundation PR1

Reviewer: Agent B (Reviewer / Gatekeeper) · Round 1
Target: Incoming Payments Foundation PR1
Tree reviewed: working tree, uncommitted. Code fingerprints verified stable across the whole
review (md5 identical before and after Agent A posted `A_STATUS.md`), so everything below
refers to the settled implementation.

# VERDICT: **YELLOW**

The PR ships the right shape. It is genuinely provider-agnostic, genuinely ledger-inert,
correctly business-scoped, flag-gated on every route, and tested at three independent layers
(82 assertions, all green). It is also the first feature in this repo to write `audit_events`
rows on a money path.

Two blocking defects stop it short of GO. Both sit in gross/fee/net handling — the exact
principle this PR exists to protect. Neither carries production risk today (flag off
everywhere, migration unapplied, nothing pushed), and both are small, surgical fixes.

**Ready for human review: NOT YET.** After B1 and B2 are fixed, yes.

---

## Files reviewed

| File | Size | Status |
|---|---|---|
| `migrations/048_incoming_payments_foundation.sql` | 128 L | new, **not applied** anywhere |
| `server/lib/incomingPayments.js` | 254 L | new, pure validator, no I/O |
| `server/index.js` | +195 L (3285–3479) | modified — 4 routes, flag helper, `IP` require |
| `tests/incomingPayments.test.js` | 30 assertions | new |
| `tests/integration/incomingPaymentsMigration.test.js` | 219 L / 20 assertions | new |
| `tests/integration/incomingPaymentsApi.test.js` | 411 L / 32 assertions | new |
| `.env.example` | +7 L | flag documented, default `false` |
| `_specs/DECISIONS.md` · `ROADMAP.md` · `ARCHITECTURE.md` · spec §13 | docs | reviewed |

---

## 1. Git safety — **PASS**

- **No env or secret touched.** The only env change is `.env.example` (a tracked template):
  it adds `INCOMING_PAYMENTS_ENABLED=false` with a comment. Scanned for secret-shaped values —
  none. This is the documented-flag practice AGENTS.md asks for.
- **Nothing pushed.** `git rev-list --count origin/main..HEAD` = **0**.
- **No deploy.** No workflow or deploy config modified.
- **Flag not enabled anywhere.** `INCOMING_PAYMENTS_ENABLED` appears only in
  `server/index.js:3297` (the reader), `.env.example` as `false`, a migration comment, and test
  setup. It defaults off (`=== 'true'`).
- **Migration not applied.** `incoming_payments` is absent from the production schema —
  verified against the local 2026-08-27 `pg_dump` artifact, never by querying production.
- **No Telegram identity or notification-grant file touched. No provider credentials. No
  external API call. No production SQL. No production data.**

One safety property worth naming: with the flag off, every route returns 404 *before* touching
Supabase, so the code is deployable before 048 is applied. A's test *"flag OFF: nothing is
written even on a well-formed create"* proves it rather than asserting it.

---

## 2. Migration — **PASS with 1 blocker, 3 non-blockers**

Additive only: one `CREATE TABLE IF NOT EXISTS`, one unique index, four lookup indexes, one
`updated_at` trigger. No `DROP`, no `ALTER` of an existing table, no backfill, no seed, no
hardcoded business or user id. FK types check out against the real schema. Naming is
provider-neutral throughout — there is no `midtrans_*` column anywhere.

The `COALESCE(provider, '')` in `incoming_payments_idempotency_uidx` (048:104-105) is the
sharpest thing in this PR. A plain multi-column UNIQUE treats NULLs as distinct, so manual
entries — which have no provider — would have deduplicated against nothing at all. A caught it
and tested it.

### BLOCKING · B2 — `DEFAULT 0` contradicts the migration's own stated intent

`migrations/048_incoming_payments_foundation.sql:47-49`

Lines 45-46 state the rule:

> `NULL` means "not known yet", which is NOT the same as a confirmed zero fee. Defaulting to 0
> would silently claim a gateway charged nothing.

Lines 47-49 then do exactly that:

```sql
fee_amount                NUMERIC(20,2) NULL DEFAULT 0 CHECK (...),
tax_or_withholding_amount NUMERIC(20,2) NULL DEFAULT 0 CHECK (...),
```

The API always supplies both columns explicitly, so the default is dead code *through that
path*. It is live for every other writer — the Phase 3 bank-import feeder A describes in the
implementation notes, any backfill, any direct SQL. Those all inherit a silent "confirmed zero
fee".

**Fix:** drop `DEFAULT 0` from both columns. The migration is unapplied, so this costs nothing.

### Non-blocking

**N1 · `ON DELETE CASCADE` on `business_id` conflicts with the repo's evidence convention.**
048:22. Migration 031 chose the opposite for evidence and said why in its header: *"Evidence =
RESTRICT; businesses are soft-deleted in the app (hard purge = separate admin procedure)."*
048 also argues the RESTRICT case itself at lines 68-69 — *"deleting a ledger row must not
delete the evidence that money arrived"* — then cascades on business deletion, and the test at
`incomingPaymentsMigration.test.js:204` locks that in. Recommend `RESTRICT` to match 031, or a
documented rationale for why receipts are less durable than documents.

**N5 · No `BEGIN`/`COMMIT` wrapper**, unlike 031/033/038. DDL is idempotent so risk is low, but
a partial apply would leave the table without its unique index — which is the entire safety
mechanism. Recommend wrapping.

**N2 · No DB-level same-business guard on the link columns.** See §3 and Q3 below.

---

## 3. Backend — **PASS with 1 blocker, 3 non-blockers**

All four routes check `isIncomingPaymentsEnabled()` **before** `requireBusiness`, so with the
flag off the feature leaks nothing — not even whether a workspace is accessible. Correct
ordering, and tested.

Verified good:

- `business_id` always from the resolved active workspace; a `business_id` planted in the body
  is provably ignored.
- Personal workspaces rejected — `server/lib/businessResolver.js:46` throws
  `business_workspace_required`, and A tested it. Personal and business money cannot mix here.
- Role gates differentiated rather than copy-pasted: view `canViewBusinessFinance`, create
  `canCreateConfirmedFinancialRecord`, review `canApproveFinancialRecord`. Tested both ways.
- Cross-business wallet attach refused with 403 `wallet_not_in_business` (`index.js:3357-3366`).
- Detail route filters by `business_id` **in the query**, so another workspace's row is a 404,
  never a 403 — no cross-tenant existence oracle. Tested.
- `raw_provider_payload` excluded from list responses, returned only on detail.
- Idempotent replay returns `200 { idempotent_replay: true }` with the first row; the 23505
  race path re-reads and returns the winner rather than a 500.
- Client-supplied ledger links are **refused** (400), not silently dropped.
- `recordAudit` on create and on status change with `entityType: 'incoming_payment'`. Prior to
  this PR, `audit_events` covered only tax-rule/profile/source and identity entities — no money
  path wrote audit rows at all. This is a real improvement to the codebase.

### BLOCKING · B1 — An omitted gateway fee is silently recorded as a confirmed zero fee

`server/lib/incomingPayments.js:125-127`

```js
// Absent → 0 (the common case: no fee charged). Explicit null → unknown, preserved as null.
const fee_amount = fee.present ? fee.value : 0;
const tax_or_withholding_amount = tax.present ? tax.value : 0;
```

Spec §4.2 legislates the opposite: *"`0` means 'confirmed zero'; unknown must be `NULL`, never
coerced to 0."* The rule is applied identically to every source type, and a gateway settlement
is where it does damage.

`A_IMPLEMENTATION_NOTES.md:39-46` names the hazard precisely — *"coercing unknown to `0`
silently asserts 'no fee was charged', which inflates net and, downstream, revenue"* — and then
lists `absent from the request — treated as 0` as intended behaviour. The defence is that
"absent" is a deliberate third state meaning confirmed-zero. But nothing in the API makes a
caller distinguish, and for a gateway settlement the natural omission is *"I don't know yet."*

Verified empirically against the real validator:

| Request | Result |
|---|---|
| `gateway_settlement` / `midtrans`, `gross 1,000,000`, fee omitted, net omitted | `fee=0, tax=0, net=1000000` — **records "Midtrans charged zero fee"** |
| same, plus the true `net 967,810` | **REJECTED** `net_amount_mismatch` |
| same, plus explicit `fee_amount: null` | `fee=null, net=967810` — correct |
| `manual_bank_entry`, `gross 500,000`, fee omitted | `fee=0, net=500000` — correct for this source |

Two distinct problems:

1. **Row 1 is a false accounting assertion.** The caller never claimed the fee was zero; the
   validator claimed it for them and set `net = gross`. That is the mirror image of NO-GO #3.
2. **Row 2 blocks the honest caller.** Someone who knows gross and net but not the fee split —
   the normal state before a settlement report is parsed — is refused, and the error text never
   mentions that `fee_amount: null` is the way through. The escape hatch works but is
   undiscoverable.

**Fix — either is acceptable, but code and spec must agree:**
- *Preferred:* make the default source-aware. For `gateway_settlement` and
  `manual_gateway_import`, absent fee → `null` (unknown) **and** require an explicit
  `net_amount`. Keep absent → `0` for `manual_bank_entry`, where it is genuinely right.
- *Minimum:* keep the behaviour, amend spec §4.2 to define "absent ≠ unknown", and widen the
  `net_amount_mismatch` message to name `fee_amount: null`.

### Non-blocking

**N2 · Same-business link enforcement is API-only** (`index.js:3357-3366`). Spec §4.6 and NO-GO
#5 call a cross-business link *"a hard constraint violation, not a warning"*, and 031/033
enforce it in the DB (`fn_ic_funding_guard`). See Q3 for my answer on scope.

**N3 · Float money math.** `parseAmount` uses `Math.round(n * 100) / 100` (`lib:48`), and the
net derivation does the same (`lib:141,148`). `server/lib/transactionClass.js` opens with *"No
floating point: monetary values are strings; arithmetic uses BigInt scaled to 18 decimals."*
At IDR magnitudes float64 is safe in practice, so this is a consistency defect rather than a
live bug — but it is the one module in the repo written to prevent exactly this.

**N4 · Un-reviewing erases the review stamp.** `index.js:3461-3464`: moving a payment back to
`draft`/`unmatched` nulls `reviewed_by_user_id` and `reviewed_at`. The audit row preserves who
reviewed it, so history is recoverable, but the row no longer shows it. Spec §7 prefers
compensating records over erasure.

**N6 · Dedup depends on a caller-supplied key.** Spec §6 names `(business_id, source,
external_reference)`. `buildIdempotencyKey` derives from provider ids when present (good — a
replayed webhook collides), but a caller supplying a *different* explicit `idempotency_key` for
the same `provider_transaction_id` still double-records. Suggest a partial unique index on
`(business_id, provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL`
when the Phase 2 feeder lands.

---

## 4. Tests — **PASS**

Three layers testing genuinely different things: DDL constraints in PGlite, the pure validator
directly, and route guard logic over real HTTP against a fake Supabase that models column
projection (so a route forgetting to exclude a sensitive column actually fails).

| Suite | Result |
|---|---|
| `tests/incomingPayments.test.js` | **30 / 30** |
| `tests/integration/incomingPaymentsMigration.test.js` | **20 / 20** |
| `tests/integration/incomingPaymentsApi.test.js` | **32 / 32** (4 consecutive full-file runs) |

Every item on the brief's checklist is present and passing — flag OFF (including "nothing
written"), valid create, unauthorized business, cross-business wallet, cross-business
transaction/debt (refused by design), idempotency duplicate, gross/fee/net validation, no auto
transaction, no final accounting state. Extras beyond the checklist: personal-workspace
rejection, no-existence-oracle on cross-tenant fetch, audit rows written, list-filter
validation, PII payload excluded from lists.

**Transient failures I observed, and why they are not defects.** My first pass showed 2–3 API
test failures. They were an artifact of reviewing a moving target — Agent A was still writing
the files. Each failing test passed in isolation, and once the tree settled (md5-verified) the
full file passed 4/4. Recording it rather than omitting it: the suite shares module-level
`dbState` and one Express instance, so it is order-sensitive by construction and could
resurface under a parallel runner.

**Pre-existing environment artifact, not caused by this PR.** `tests/migrations/ci_030.js`
prints `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` (libuv, Windows) *after*
reporting `ALL PASS — 12 passed, 0 failed`, exit code 0. Flagged so it is not later
misattributed to this PR.

**Regression: clean.** All pre-existing suites still pass — 7 migration CI suites (133
assertions), 10 unit suites (238 assertions), `node --check` across `server/index.js` and every
`server/lib` and `server/routes` file. Detail in `B_TEST_RESULTS.md`.

---

## 5. Docs — **PASS**

D22 added to `DECISIONS.md` and referenced from both the migration header and the route header.
Roadmap updated. `ARCHITECTURE.md` moves the feature to DARK / BEHIND FLAG. Spec §13 "PR1 — as
built" added. NO-GO rules preserved and honoured in code: `future_bank_api` and
`future_gateway_api` are reserved in the DDL vocabulary but **refused at the API**
(`lib:22, 111-113`), so no direct bank API path exists in v0.

---

## 6. Answers to `A_QUESTIONS_FOR_B.md`

**Q1 — 409 on a genuine race: acceptable for PR1?** **Agree with your (a), then (b).** The
unique index already guarantees no duplicate money, which is the property that matters; a 409
to the loser is a worse error message, not worse data. Manual entry will not race. Do (b)
(`INSERT … ON CONFLICT DO NOTHING RETURNING` + re-select) when the first webhook feed lands,
because that is where retries actually collide. Not a PR1 blocker.

**Q2 — Should `manual_gateway_import` be creatable in PR1?** **Agree — keep all four.** A human
reconciling a Midtrans or DOKU report by hand is a real Phase-1 workflow, and it is the only
thing that exercises fee/net separation before an integration exists. Restricting to
`manual_bank_entry` would leave the gross/fee/net path untested against real data until Phase 2.
Note this interacts with B1: gateway source types are exactly where the absent-fee default is
wrong, so fixing B1 matters more *because* you keep these open.

**Q3 — Is API-level wallet tenancy enough for PR1?** **Yes — keep the backfill out of scope.**
You are right that `NOT NULL` + composite FK touches a table every financial route reads, which
is far more than a foundation PR should risk. But your stated reason rules out a *composite
FK*, not a *trigger*: `fn_ic_funding_guard` in 033 does exactly this check against nullable
columns and works. Since PR1 never populates `linked_transaction_id`/`linked_debt_id`, a
trigger is not needed now — but it should land no later than the matching PR, and it does not
require the wallets backfill.

**Q4 — Keep `net = gross − fee − withholding` as a hard DB constraint?** **Agree — keep it.**
Your reasoning is right and the NULL-skip already handles the unknown case. On the rounding
worry: the constraint compares `NUMERIC(20,2)` values, and IDR has no sub-rupiah settlement, so
cent-drift is a currency risk you do not currently have. Re-evaluate only if a real settlement
sample (spec Q2) shows otherwise, or when a non-IDR currency arrives — at which point the wider
`amount_reporting`/FX gap (037/038, unapplied) is the bigger problem anyway.

**Q5 — Is `canApproveFinancialRecord` the right review gate?** **Keep it, but rename the state
later.** Your instinct is right that reusing existing approval semantics beats inventing new
ones. The friction is vocabulary, not permissions: `reviewed` reads like "the accountant signed
off" when it means "an approver accepted it internally". Since the product framing is
"accountant-reviewable", expect to need a second axis (internal approval vs. external
accountant sign-off) by Phase 4 — spec §4.5 already anticipates three axes. Not a PR1 change.

**Q6 — `status` vs `reconciliation_status` overlap.** The duplication is real and worth removing
**before** the table has production rows. `status` carrying `matched`/`unmatched` while
`reconciliation_status` is the actual match axis means two columns can disagree, and the API
only prevents that by refusing `matched` today. Since 048 is unapplied, narrowing `status` to
`draft/reviewed/rejected` now is free; doing it later is a migration plus a backfill. Not a
blocker, but this is the cheapest it will ever be.

**Q7 — Audit granularity.** Current granularity is right. **Do not add `payer_reference`** —
`audit_events` is append-only with a DB guard, so anything written there cannot be corrected or
erased, and payer identifiers are the payload most likely to need redaction later. Keeping PII
out of an immutable log is the correct default. If you want more trail, add the
`idempotency_key` (non-PII, and the thing you would actually search on during a duplicate
investigation).

---

## Required actions

**Blocking — Agent A to fix. B does not fix code.**

1. **B1** — `server/lib/incomingPayments.js:125-127`. Stop coercing an omitted fee to `0` for
   gateway source types; require an explicit `net_amount` there. Reconcile with spec §4.2 (or
   amend the spec) and widen the `net_amount_mismatch` message.
2. **B2** — `migrations/048_incoming_payments_foundation.sql:47-49`. Remove `DEFAULT 0` from
   `fee_amount` and `tax_or_withholding_amount`.

**Non-blocking — fix now or docket explicitly:** N1 cascade-vs-restrict · N2 DB-level
same-business trigger · N3 float money math · N4 review-stamp erasure · N5 `BEGIN`/`COMMIT` ·
N6 provider-transaction-id uniqueness · Q6 status-vocabulary narrowing (cheapest now).

**Do not change:** flag stays off, migration stays unapplied, nothing pushed or deployed.

---

Agent B wrote no application code, no migration, and no Agent A file.
