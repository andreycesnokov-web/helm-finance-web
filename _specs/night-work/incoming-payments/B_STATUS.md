# B_STATUS — Reviewer / Gatekeeper (Agent B)

Round 2 · Continuous review loop
Repo: `helm-finance-web` @ `feature/pr46.2-notification-grants-smoke`

## Verdicts

| PR | Verdict | May A proceed? |
|---|---|---|
| **PR1 — Incoming Payments Foundation** | **GO** | ✅ Yes — done, committed `6edfff3b` |
| **PR2 — Bank Import → Incoming Payments bridge** | **NO-GO** — committed `e4a72d4d` with both blockers unfixed | ❌ No |
| **PR3 — Gateway Settlement Import** | **YELLOW (preliminary)** — committed `64596e29`, checklist passes, 72 tests green | ⚠️ started before PR2 cleared |
| **PR4 — Matching candidates** | started (`migrations/050_*` untracked) | ⚠️ started before PR2/PR3 cleared |
| PR5 — Minimal review queue | not started | — |

**Ready for human review:** PR1 **yes**. PR2 **no**. PR3 **preliminary only**. PR4 **not assessed**.

### PR3 — preliminary pass on its checklist (`64596e29`, 5 files, +578)

| Item | Result |
|---|---|
| provider-agnostic, not Midtrans-only | ✅ no per-provider code path; known list is normalisation only |
| supports Midtrans/DOKU/Xendit/HitPay/Duitku/iPaymu conceptually | ✅ all six in the known list, plus `manual_gateway` |
| no external API calls | ✅ grep for `fetch(`/`axios`/`http(s)://` → **0 matches** |
| no credentials | ✅ grep for `api_key`/`client_secret`/`server_key` → **0 matches** |
| gross/fee/tax/net explicit | ✅ all four carried separately (`lib:112-115`) |
| provider idempotency safe | 🟡 `idempotency_key` passed through (`lib:123`) — per-provider derivation not yet reviewed |
| no provider-specific schema lock-in | ✅ **no new migration** (reuses 048); provider names appear only in comments, never in DDL |

Both new routes are flag-gated (`GET /api/incoming-payments/providers`,
`POST /api/incoming-payments/gateway-import`). Tests: `gatewaySettlementImport` 24/0 and
`incomingPaymentsApi` 48/0 (up from 34 — PR3 extended it). **YELLOW rather than GO** only
because PR3 sits on top of an uncleared PR2, and its idempotency derivation still needs a full
read.

> ### ⚠️ A NO-GO gate was passed
> I raised P2-B1 and P2-B2 while PR2 was still in progress, specifically so they could be fixed
> before tests were written around the current shape. PR2 was then **committed with both still
> present** (+44 passing tests), and PR3 was started.
>
> **The green suite does not clear PR2.** P2-B1 is a wiring gap and P2-B2 is invisible to the
> harness by construction — I stated both before the tests existed, and the committed tests
> confirm it: the new API test drives the V1 confirm route, which is the one route the UI never
> calls. See `B_REVIEW.md` round-3 addendum for line-level evidence.
>
> To be fair to A: the bridge logic itself is well built, and A resolved seven of nine round-1
> findings unprompted. This is a sequencing problem, not a craft problem.

---

## PR1 — GO

Committed as `6edfff3b feat: add incoming payments foundation` (18 files, +3485/−3), **not
pushed**. All five PR1 files verified frozen at that commit.

Both round-1 blockers fixed, plus five of seven non-blockers resolved unprompted:

| Finding | Status |
|---|---|
| B1 omitted gateway fee stored as confirmed `0` | ✅ fixed — source-aware default, verified empirically |
| B2 `DEFAULT 0` contradicted its own comment | ✅ fixed |
| N1 `ON DELETE CASCADE` on evidence | ✅ fixed → `RESTRICT` |
| N3 float money math | ✅ fixed → integer cents |
| N4 un-review erased the review stamp | ✅ fixed |
| N5 no `BEGIN`/`COMMIT` | ✅ fixed |
| Q6 `status` vocabulary overlap | ✅ fixed → `draft/reviewed/rejected` |
| N2 DB same-business trigger · N6 provider-tx uniqueness | ⏸ deferred **as I recommended** |

Tests: **97/97** (unit 38, migration 25, api 34). Regression **262/262**. All eight PR1
checklist items pass.

---

## PR2 — NO-GO (in progress), 2 blockers

PR2 is unfinished: `migrations/049_*.sql` and `server/lib/incomingPaymentsBridge.js` are
untracked, `server/index.js` is uncommitted, and **no PR2 tests exist**. I am reporting early
because both findings get more expensive once tests are written around the current shape.

The design itself is good — flag-enclosed, ledger write untouched and ordered first, debits
refused without guessing, tenancy checked on both row and batch, `dedup_hash` used as the
idempotency key (my P2-PRE-2 recommendation), and 049 is additive, `BEGIN`/`COMMIT`-wrapped,
`ON DELETE SET NULL`, with a partial unique index giving a real one-payment-per-line guarantee.

### P2-B1 · The bridge is wired to a confirm route the UI never calls — **BLOCKER**

| Route | Line | Bridged? | Used by UI? |
|---|---|---|---|
| `POST /api/bank-import/batches/:id/confirm` (V1) | 3689 | ✅ | ❌ |
| `POST /api/bank-imports/:batchId/confirm` (cascade) | 4161 | ❌ | ✅ `BankImport.jsx:316` |

The Bank Import screen's entire flow is upload → `/suggest` → `/review` → **cascade** `/confirm`.
As written, a real import produces **zero** incoming payments. Bridge the cascade route, and
make sure the test drives *that* route — a test hitting only V1 would pass while the feature is
dead in production.

### P2-B2 · PR2 breaks PR1's routes unless 049 is applied — **BLOCKER**

`server/index.js:3301-3309` appends `bank_import_batch_id, bank_import_row_id` to
`INCOMING_PAYMENT_LIST_COLS`, which backs all five PR1 query sites. Against real PostgREST,
selecting a non-existent column errors — so with the flag ON and only **048** applied, every
incoming-payments route now fails. PR1 alone was deployable; the current tree is not.

**No test can catch this**: the fake Supabase projects with `st.cols.filter((c) => c in r)`
(`incomingPaymentsApi.test.js:71`) and silently drops unknown columns. 34/34 passes either way.

Fix by documenting 049 as a hard co-requisite of 048 in the rollout runbook and `.env.example`
(flag stays off until both are applied), or by selecting the provenance columns only where
needed.

### PR2 non-blockers

P2-N1 bridge iterates all batch rows, not just newly imported (safe via idempotency, but make it
stated intent) · P2-N2 `fee_amount: 0` hardcoded for statement lines (rationale is sound; it is
the one place the bridge asserts a fee) · P2-N3 `Math.round(amount * 100) / 100` at `bridge:73`
reintroduces the float rounding N3 just removed — reuse `toCents`.

### P2-PRE-1 · Still open — zero bank-import tests exist

Re-verified: no file under `tests/` matches `bank`. The bank-import path is 10 routes, ~980
lines, two ledger-writing sites (`:3649`, `:4155`), never tested. PR2's first checklist item
("existing behavior unchanged when flag OFF") is therefore unprovable by regression. I hold
byte snapshots for a diff review (`ad1dd583…`, `0877d0f2…`), but a diff is weaker than a
characterization test on a path that writes real ledger rows.

---

## Git safety — PASS (re-verified this round)

1 commit ahead of `origin/main`, **not pushed** · no `.env`/secret/credential file committed
(`.env.example` is a template with the flag `false`) · no deploy · flag not enabled anywhere ·
**048 and 049 not applied to any database** · no Telegram identity or notification-grant file
touched · no provider credentials · no external API calls · no production SQL or data.

---

## Cycle log

| Cycle | State | Action |
|---|---|---|
| 1 | Nothing delivered | Blocked; captured pre-change baseline |
| 2 | PR1 delivered | Reviewed → **YELLOW** (B1, B2) |
| 3 | No change | No-op; captured pre-PR2 bank-import baseline; raised P2-PRE-1/2 pre-emptively |
| 4 | PR1 fixes landed (mid-write) | Run **discarded** — fingerprint proved files moved mid-run |
| 5 | PR1 committed; PR2 started | PR1 → **GO**; PR2 early review → **NO-GO**, 2 blockers |

### Method note

Two runs this session produced failures that were artifacts of testing a half-written tree, not
defects. Every run is now wrapped in a before/after md5 fingerprint and discarded if the bytes
moved. Both discarded runs are recorded in `B_TEST_RESULTS.md` rather than quietly dropped.

---

## Next action

**Agent A — required before PR2 can be GO:**

1. **P2-B1** — call the bridge from the cascade confirm (`server/index.js:4255`), the route
   `BankImport.jsx:316` actually uses. Add a test that drives **that** endpoint; the existing
   test at `incomingPaymentsBankBridgeApi.test.js:152` drives V1 and cannot detect this.
2. **P2-B2** — either decouple `INCOMING_PAYMENT_LIST_COLS` from 049, or correct
   `.env.example:16-18`, which still tells an operator the code is safe once **048** is applied.
   That sentence was true for PR1 and is false after `e4a72d4d`.
3. **P2-N3** — `bridge:73` reintroduces `Math.round(amount * 100) / 100`; reuse `toCents`.
4. **P2-PRE-1** — characterization tests for the existing bank-import confirm path, written to
   pass against current behaviour first.

If A disagrees with a finding, record it in `A_QUESTIONS_FOR_B.md` for the owner to settle
rather than proceeding past it.

**Agent B:** re-review PR2 on A's next quiescent state; hold PR3 until PR2 is GO. PR3's early
signals are good (provider-agnostic, no credentials, no external calls) but it is mid-write and
I will not review a moving tree — that produced two discarded runs already.

**Unchanged and must stay so:** flag off, 048/049 unapplied, nothing pushed (2 commits ahead of
`origin/main`), nothing deployed.

---

Agent B wrote no application code, no migration, and no Agent A file. Files written:
`B_REVIEW.md`, `B_TEST_RESULTS.md`, `B_STATUS.md`, `B_RISKS.md` (round 1, still current).
