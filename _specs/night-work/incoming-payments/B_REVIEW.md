# B_REVIEW — Incoming Payments (PR1 final · PR2 in progress)

Reviewer: Agent B (Reviewer / Gatekeeper) · Round 2
Repo: `helm-finance-web`, branch `feature/pr46.2-notification-grants-smoke`

---

# PR1 — Incoming Payments Foundation

# VERDICT: **GO**

**Agent A may proceed to PR2.** (A already has — see the PR2 section, which has findings.)

PR1 is committed as `6edfff3b feat: add incoming payments foundation` (18 files, +3485/−3).
All five PR1-specific files are **frozen at that commit** — verified by `git diff HEAD` per
file. Both round-1 blockers are fixed, and A resolved five of the seven non-blockers unprompted.

## Round-1 findings — disposition

| # | Finding | Status |
|---|---|---|
| **B1** | Omitted gateway fee stored as confirmed `0` | ✅ **FIXED** — source-aware default (`lib:28,146-149`) |
| **B2** | `DEFAULT 0` contradicted the migration's own comment | ✅ **FIXED** — removed from both columns (`048:57-59`) |
| N1 | `ON DELETE CASCADE` on `business_id` vs 031's evidence convention | ✅ **FIXED** — now `ON DELETE RESTRICT` (`048:30`) |
| N3 | Float money math | ✅ **FIXED** — integer cents via `toCents`/`fromCents` |
| N4 | Un-review erased the review stamp | ✅ **FIXED** — stamp always written, never cleared |
| N5 | No `BEGIN`/`COMMIT` wrapper | ✅ **FIXED** |
| Q6 | `status`/`reconciliation_status` vocabulary overlap | ✅ **FIXED** — `status` narrowed to `draft/reviewed/rejected` |
| N2 | DB-level same-business link trigger | ⏸ Deferred to the matching PR — **as I recommended** |
| N6 | No uniqueness on `provider_transaction_id` | ⏸ Deferred to Phase 2 — **as I recommended** |

### B1 fix — verified empirically, not just read

| Probe | Round 1 | Round 2 |
|---|---|---|
| `gateway_settlement`/`midtrans`, gross only | `fee=0, net=gross` (false zero-fee claim) | **`REJECTED missing_net_amount`** ✅ |
| gateway, gross + true net `967,810` | `REJECTED net_amount_mismatch` | **`fee=null, tax=null, net=967810`** ✅ |
| gateway, explicit fee 29,000 + tax 3,190 | — | `net=967810` ✅ |
| `manual_gateway_import`, gross only | — | `REJECTED missing_net_amount` ✅ |
| `manual_bank_entry`, gross only | `fee=0` | `fee=0` ✅ (correct for this source) |
| `bank_statement_import`, gross only | — | `fee=0` ✅ (correct — see PR2 rationale) |

The reasoning A wrote into `lib:139-145` is the right one: on a bank transfer the recorder sees
the whole movement so an omitted fee *is* a statement of zero; on a gateway settlement the fee
is deducted by a third party and is simply not knowable from the receipt. The error messages now
name `fee_amount: null` explicitly, closing the discoverability gap.

## PR1 checklist

| Item | Result |
|---|---|
| `incoming_payments` provider-agnostic | ✅ free-text `provider`, `KNOWN_PROVIDERS` is a normalisation aid not an allow-list; no `midtrans_*` column anywhere |
| flag OFF works | ✅ all 4 routes 404 **before** `requireBusiness`; test also asserts nothing is written |
| business scope enforced | ✅ `business_id` from active workspace only; body value provably ignored; personal workspace rejected; cross-tenant detail returns 404 not 403 |
| no hardcoded user/business IDs | ✅ fixtures use `7001-7004` and `aaaa…`/`bbbb…`; no `HF-BIZ-*` or `-1` in src or tests |
| no auto transaction | ✅ "THE core guarantee" asserts `transactions` and `debts` stay empty after create *and* review |
| no final revenue/accounting | ✅ cannot create as `reviewed`; `matched` unreachable; `reconciliation_status` derived |
| idempotency present | ✅ UNIQUE `(business_id, source_type, COALESCE(provider,''), idempotency_key)`; replay → 200 + first row; 23505 race handled |
| tests pass | ✅ **97/97** |

## Tests run — PR1

| Suite | Result |
|---|---|
| `tests/incomingPayments.test.js` | **38 / 0** |
| `tests/integration/incomingPaymentsMigration.test.js` | **25 / 0** |
| `tests/integration/incomingPaymentsApi.test.js` | **34 / 0** |

97 assertions, up from 82 in round 1 — A added coverage for the fixes. Regression clean: 121
migration-CI + 141 unit assertions across 10 pre-existing suites, 0 failures. `node --check`
clean.

## Git safety — PASS

1 commit ahead of `origin/main`, **not pushed**. No `.env`/secret/credential file in the
commit (`.env.example` is a template carrying `INCOMING_PAYMENTS_ENABLED=false`). No deploy.
Flag not enabled anywhere. Migrations 048/049 **not applied** to any database. No Telegram
identity or notification-grant file touched. No provider credentials, no external API calls,
no production SQL.

## Files reviewed — PR1

`migrations/048_incoming_payments_foundation.sql` · `server/lib/incomingPayments.js` ·
`server/index.js:3285-3479` · `tests/incomingPayments.test.js` ·
`tests/integration/incomingPaymentsApi.test.js` ·
`tests/integration/incomingPaymentsMigration.test.js` · `.env.example` ·
`_specs/DECISIONS.md` (D22) · `_specs/ROADMAP.md` · `_specs/ARCHITECTURE.md`

---

# PR2 — Bank Import → Incoming Payments bridge

# VERDICT: **NO-GO** — committed as `e4a72d4d` with both blockers unfixed

> **Round-3 update.** When first reviewed, PR2 was in progress and I raised P2-B1 and P2-B2
> early, specifically so they could be fixed before tests were written around the current
> shape. Agent A has since **committed PR2** (`e4a72d4d feat: bridge bank import to incoming
> payments`, 7 files, +841/−2) with **both blockers still present**, added 44 tests that pass,
> and moved on to PR3.
>
> The tests being green does not change the verdict. P2-B1 is a wiring gap and P2-B2 is
> invisible to the harness by construction — I said so before the tests existed, and the
> committed tests confirm it: `incomingPaymentsBankBridgeApi.test.js:152` drives
> `/api/bank-import/batches/${batch}/confirm`, the V1 route, which is the one route the UI
> never calls.
>
> **PR2 is not ready for human review, and PR3 should not have been started.**

## What is already right

The design is sound and several round-1 lessons were carried forward:

- **Migration 049** is additive, idempotent, `BEGIN`/`COMMIT`-wrapped, uses `ON DELETE SET
  NULL` so deleting a batch never destroys evidence, and adds a **partial unique index** on
  `(business_id, bank_import_row_id)` — a real DB guarantee of one payment per statement line.
- **Bridge is fully inside the flag.** `if (!isIncomingPaymentsEnabled()) return null`, and the
  confirm response spreads `...(incoming_payments ? {...} : {})` so the response is byte-identical
  when off.
- **Ledger write untouched and ordered first.** The bridge runs after, and is wrapped so a
  bridge failure can never fail an import that already succeeded.
- **Debits are skipped**, and `isCreditRow` refuses to guess — an unrecognised direction is not
  treated as a credit. Guessing permissively would book an expense as incoming revenue.
- **Tenancy checked on both row and batch**, not inferred from the caller; a batch carrying
  another workspace's wallet yields a payment with `wallet_id = null` rather than a
  cross-company link.
- **Idempotency keyed on `dedup_hash`** — exactly the P2-PRE-2 recommendation, so an
  overlapping re-upload collides on content rather than row identity.
- Payments land `draft`/`unmatched` with `linked_transaction_id` NULL, so no match is asserted.

## BLOCKER · P2-B1 — The bridge is wired to a confirm route the UI never calls

`server/index.js:3763` (bridge call) vs `client/src/pages/BankImport.jsx:316`

There are two confirm endpoints:

| Route | Line | Bridged? | Used by UI? |
|---|---|---|---|
| `POST /api/bank-import/batches/:id/confirm` (V1) | 3689 | ✅ yes | ❌ no |
| `POST /api/bank-imports/:batchId/confirm` (review-queue cascade) | 4161 | ❌ **no** | ✅ **yes** |

`BankImport.jsx:316` calls `` `/bank-imports/${batch.id}/confirm` `` — the cascade route. That is
the only confirm the Bank Import screen uses; the whole UI flow is upload → `/suggest` →
`/review` → cascade `/confirm`.

**As written, a real user importing a statement produces zero incoming payments.** The bridge
is dead code on the only path that matters, and PR2's checklist item *"confirmed credit rows
create incoming_payment when flag ON"* is not actually satisfied end to end.

*Fix:* call `bridgeBankBatchToIncomingPayments` from the cascade confirm at 4161 as well (or
instead). Whichever path is chosen, a test must drive the **cascade** route, because that is
what production exercises.

## BLOCKER · P2-B2 — PR2 breaks PR1's routes unless 049 is applied

`server/index.js:3301-3309`

PR2 appended the two provenance columns to `INCOMING_PAYMENT_LIST_COLS`:

```js
'reviewed_by_user_id, reviewed_at, created_at, updated_at, ' +
'bank_import_batch_id, bank_import_row_id';
```

That constant backs **all five** PR1 query sites (`3320, 3377, 3397, 3436, 3474`). Against real
PostgREST, selecting a column that does not exist is an error — so with the flag ON and only
**048** applied, every incoming-payments route now fails. PR1 alone was deployable; the current
working tree is not.

**No test can catch this.** The API suite's fake Supabase projects with
`st.cols.filter((c) => c in r)` (`incomingPaymentsApi.test.js:71`), which silently drops unknown
columns. The suite passes 34/34 either way. This is a case where green tests are not evidence.

*Fix:* either make 049 a hard prerequisite documented alongside 048 in the rollout runbook and
`.env.example` (flag must not be enabled until **both** are applied), or select the provenance
columns only in the routes that need them. The first is simpler; the second removes the coupling.

## PR2 checklist — status so far

| Item | Status |
|---|---|
| existing bank import behavior unchanged when flag OFF | 🟡 code reads correct, **but unprovable — no bank-import tests exist** (see P2-PRE-1) |
| confirmed credit rows create incoming_payment when flag ON | ❌ **P2-B1** — not on the route the UI uses |
| debit/outgoing rows ignored | ✅ `isCreditRow` refuses non-credits and refuses to guess |
| duplicate bank rows do not duplicate incoming_payment | ✅ partial unique index + pre-check + 23505 handling |
| provenance preserved | ✅ `bank_import_batch_id` + `bank_import_row_id`, `ON DELETE SET NULL` |
| business/wallet scoping enforced | ✅ both row and batch checked; bad wallet → NULL, not cross-link |
| no auto transaction | ✅ bridge writes only `incoming_payments`; ledger write untouched |
| no final accounting | ✅ `draft`/`unmatched`, links NULL |

## Non-blocking observations — PR2

- **P2-N1 · The bridge iterates all batch rows, not just newly imported ones.** Re-confirming a
  batch backfills payments for previously imported rows. Idempotency makes this safe and it is
  probably desirable, but it should be a stated intent rather than a side effect.
- **P2-N2 · `fee_amount: 0` hardcoded for bank statement lines** (`bridge:88`). The rationale in
  the comment is good — a statement credit shows what actually landed and has no itemised fee.
  Worth noting it is the one place the bridge asserts a fee value on the caller's behalf; it is
  consistent with `bank_statement_import` being excluded from `GATEWAY_SOURCE_TYPES`.
- **P2-N3 · `Math.round(amount * 100) / 100` at `bridge:73`** reintroduces the float rounding
  that N3 just removed from `incomingPayments.js`. Use the same `toCents` helper.
- **P2-PRE-1 still open · zero bank-import tests exist.** No file under `tests/` matches `bank`.
  The claim "existing bank import behavior unchanged" cannot be regression-proven. Characterization
  tests over both confirm handlers, written to pass against current behaviour first, are the only
  construction that actually demonstrates it.

## Files reviewed — PR2 (in progress)

`migrations/049_incoming_payments_bank_import_provenance.sql` (40 L) ·
`server/lib/incomingPaymentsBridge.js` (121 L) · `server/index.js` diff (+78/−2) ·
`client/src/pages/BankImport.jsx` (call-site confirmation only — not modified by A)

## May Agent A proceed?

- **PR1 → PR2: YES.** PR1 is GO and committed.
- **PR2 → PR3: NO.** P2-B1 and P2-B2 are still open in the committed code.

---

# Round-3 addendum — PR2 committed unfixed, PR3 started

## Evidence that both blockers survive in `e4a72d4d`

**P2-B1 — bridge still on the wrong route.**

```
bridge defined      server/index.js:3594
bridge called       server/index.js:3857   (inside V1 confirm at :3783)
V1 confirm          server/index.js:3783   POST /api/bank-import/batches/:id/confirm
cascade confirm     server/index.js:4255   POST /api/bank-imports/:batchId/confirm   ← NOT bridged
UI calls            client/src/pages/BankImport.jsx:316  →  /bank-imports/:id/confirm
new API test drives tests/integration/incomingPaymentsBankBridgeApi.test.js:152
                    →  /api/bank-import/batches/:id/confirm   ← the V1 route
```

The test suite and the production UI exercise **different endpoints**. 44/44 passes while a real
statement import still produces zero incoming payments.

**P2-B2 — the 048/049 coupling is now shipped, and the documentation is actively wrong.**

`INCOMING_PAYMENT_LIST_COLS` (`server/index.js:3301-3309`) still ends with
`bank_import_batch_id, bank_import_row_id`, and still backs all five PR1 query sites. Meanwhile
`.env.example:16-18` still reads:

> `# Incoming Payments Foundation (migration 048). Default OFF. … the code is safe to deploy
> before 048 is applied.`

That guidance was true for PR1 and is false now. It names only 048. An operator following it —
apply 048, enable the flag — gets a 500 on every incoming-payments route, because 049's columns
are being selected and do not exist. The spec mentions 049 at line 551; the file an operator
actually reads does not.

## PR3 — Gateway Settlement Import (in flight, not reviewable yet)

`server/lib/gatewaySettlementImport.js` (153 L) and `tests/gatewaySettlementImport.test.js` are
untracked; `server/index.js` and `tests/integration/incomingPaymentsApi.test.js` are modified.

Early signals against the PR3 checklist are **good**:

- **Provider-agnostic** — `lib:7-8` states no provider is privileged; the known list at `:19`
  carries `midtrans, doku, xendit, hitpay, duitku, ipaymu, manual_gateway` with no per-provider
  code path.
- **No external API calls, no credentials** — `lib:13` states it, and a grep for
  `api_key|secret|token|fetch(|axios|https?://|credential` returns only that comment line.

I am not issuing a PR3 verdict: it is mid-write, and reviewing a moving tree is what produced
two discarded test runs earlier in this session.

## Process finding — a NO-GO gate was passed

The batch flow in `AGENTS.md` is: one scoped task → one implementing agent → one commit/report →
review → **owner go/no-go** → next batch. PR2 was committed and PR3 begun without the PR2
blockers being closed or contested.

To be fair to Agent A: neither blocker is a defect in code A wrote carelessly — the bridge logic
itself is well built, and A resolved seven of nine round-1 findings unprompted, several without
being asked twice. P2-B1 is a wiring choice and P2-B2 is an integration seam; both are exactly
the class of problem a reviewer exists to catch, and both were raised **before** the commit.
The issue is sequencing, not craft.

If A disagrees with either finding, the right move is to say so in `A_QUESTIONS_FOR_B.md` and
let the owner decide — not to proceed. I have not changed any code, and will not.

---

Agent B wrote no application code, no migration, and no Agent A file.
