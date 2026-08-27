# B_STATUS — Reviewer / Gatekeeper (Agent B)

Target: **Incoming Payments Foundation PR1**
Reviewer: Agent B · Round 1 complete
Supersedes the earlier "BLOCKED — nothing to review" status: Agent A delivered mid-session.

## Verdict

# **YELLOW**

**Ready for human review: NOT YET.** Two blocking fixes first. After those, this is a GO.

Full reasoning in `B_REVIEW.md`; risk register in `B_RISKS.md`; evidence in `B_TEST_RESULTS.md`.

## One-paragraph summary

PR1 delivers the right thing. It is provider-agnostic in the schema and not just the docs
(free-text `provider`, no `midtrans_*` column anywhere), ledger-inert and tested to be so,
business-scoped with the personal workspace explicitly rejected, gated so that with the flag off
the feature does not exist, and covered by 82 assertions across three genuinely different layers.
It also closes two standing gaps in this codebase: it is the first money path to write
`audit_events`, and the first ingestion path with a real DB-level uniqueness guard. The two
blockers are both in gross/fee/net handling — the one principle the PR exists to protect — and
both are cheap to fix while the migration is still unapplied.

## Blocking (Agent A fixes; B does not touch code)

| # | Where | What |
|---|---|---|
| **B1** | `server/lib/incomingPayments.js:125-127` | An omitted fee on a **gateway** receipt is stored as a confirmed `0`, setting `net = gross` — a zero-fee claim the caller never made. Contradicts spec §4.2 and the hazard named in `A_IMPLEMENTATION_NOTES.md:43`. It also refuses the honest gross+net-known-fee-unknown caller with a message that never mentions the `fee_amount: null` escape hatch. Verified empirically. |
| **B2** | `migrations/048:47-49` | `DEFAULT 0` on `fee_amount` and `tax_or_withholding_amount` contradicts the comment three lines above it. Dead through the API, live for the Phase 3 feeder and any backfill. |

## Non-blocking (fix now or docket explicitly)

N1 `ON DELETE CASCADE` vs 031's evidence-RESTRICT convention · N2 same-business link guard is
API-only, no DB trigger · N3 float money math vs `transactionClass.js` · N4 un-review erases the
review stamp in-row · N5 no `BEGIN`/`COMMIT` wrapper · N6 no uniqueness on
`provider_transaction_id` · Q6 `status`/`reconciliation_status` vocabulary overlap — **cheapest
to fix now, while 048 is unapplied**.

## Questions answered

All seven in `A_QUESTIONS_FOR_B.md` are answered in `B_REVIEW.md` §6. Short form: **agree** with
A's recommendation on Q1 (409-on-race is fine for PR1), Q2 (keep all four source types), Q3
(keep the wallets backfill out of scope — but note a *trigger* was always available where a
composite FK was not), and Q4 (keep the hard CHECK; IDR has no sub-rupiah settlement so the
rounding worry is not yet real). Q5: keep the gate, expect to split internal approval from
accountant sign-off by Phase 4. Q6: narrow `status` now. Q7: granularity is right — **do not**
add `payer_reference` to an append-only log; add `idempotency_key` instead.

## Tests run

**453 assertions, 0 failures.**

- Agent A's suites: 82/82 (unit 30, migration 20, API 32 — API run 4× consecutively).
- Regression: 133 migration-CI + 238 unit assertions, identical to the pre-change baseline.
- `node --check` clean across `server/index.js` and all `server/lib`, `server/routes`.
- Client build not run (PR touches zero client files); credential-dependent integration suites
  not run (would require production credentials — barred).

Two things deliberately recorded rather than omitted: transient API-test failures I saw while A
was mid-write (resolved — pass in isolation and 4/4 on the settled tree), and a pre-existing
`ci_030.js` libuv teardown assertion on Windows that exits 0 and is unrelated to this PR.

## Git safety — PASS

No env or secret touched (`.env.example` gains a documented `INCOMING_PAYMENTS_ENABLED=false`
with no secret values) · 0 commits ahead of `origin/main`, nothing pushed · no deploy · flag not
enabled anywhere · migration **not applied** (confirmed against the local 2026-08-27 pg_dump,
not by querying production) · no Telegram identity or notification-grant file touched · no
provider credentials · no external API calls · no production SQL or data.

## Did Agent A incorporate fixes?

**Not applicable this round.** This is round 1 — A's first delivery, reviewed as submitted. No
fixes have been requested before now. Code fingerprints (md5) were identical before and after A
posted `A_STATUS.md`, confirming I reviewed the final state and not a partial write.

Process note: `A_STATUS.md` arrived only after implementation was complete, so B could not tell
whether A was mid-flight or finished and had to detect completion by fingerprinting files. That
cost a review cycle and produced the transient failures noted above. Posting `A_STATUS.md` at
the *start* of work, updated on completion, would avoid this.

## Next action

**Agent A:** fix B1 and B2; decide-and-record N1–N6 and Q6; update `A_STATUS.md` to round 2.
**Agent B:** on A's update, re-run all three suites plus the regression baseline, re-verify git
safety, and re-issue the verdict. Expected outcome is GO.

**Nothing is promotable until B1 and B2 are closed.** Flag stays off, 048 stays unapplied,
nothing pushed or deployed — all three are correct as they stand and must not change as part of
the fix round.

---

## Cycle log

| Cycle | Time | State | Action |
|---|---|---|---|
| 1 | 2026-08-27 23:47 | Nothing delivered | BLOCKED; captured pre-change test baseline |
| 2 | 2026-08-28 00:00–00:05 | PR1 delivered | Reviewed → **YELLOW** (B1, B2) |
| 3 | 2026-08-28 ~00:2x | **No change** — md5 of 048/lib/index identical to cycle 2; B1 and B2 both still present; PR2 not started | Captured pre-PR2 bank-import baseline; armed change-watch |

Cycle 3 was a no-op review: re-reviewing byte-identical code would produce a byte-identical
verdict. The round-1 verdict stands unchanged.

---

## PR2 pre-conditions — raised BEFORE A starts, deliberately

Two things about PR2 ("Bank Import → Incoming Payments bridge") are much cheaper to settle now
than after the code exists.

### P2-PRE-1 · There are **zero** bank-import tests in this repo — **this blocks PR2's first checklist item**

Verified: no file under `tests/`, `tests/integration/`, or `tests/migrations/` matches `bank`.
The bank-import path (10 routes, ~980 lines across `server/index.js:3257-4240`) has never had a
test.

PR2's checklist opens with *"existing bank import behavior unchanged when flag OFF."* With no
existing suite, that claim cannot be regression-proven — only asserted by reading the diff.
That is not good enough for a path that writes real ledger transactions.

**Required before or with PR2:** characterization tests over the two confirm handlers that
capture *current* behaviour — at minimum that a confirm with the flag OFF produces exactly the
transactions it produces today, and that no `incoming_payments` row appears. Write them so they
pass against the code **as it is now**, then show them still passing after the bridge lands.
That is the only construction that actually proves "unchanged".

I have snapshotted the pre-PR2 code for an exact diff on my side:
`server/index.js:3257-3688` (V1 import) md5 `ad1dd583…`, `:3689-4240` (cascade) md5 `0877d0f2…`.

### P2-PRE-2 · The two ledger-writing sites PR2 must not disturb

`server/index.js:3649` (V1 confirm) and `:4155` (cascade confirm) are the only two
`transactions.insert` calls in the bank-import block. PR2 must leave both untouched and add the
`incoming_payments` write alongside, gated. If either line moves semantically, that is a
blocker regardless of what the tests say.

Related, and worth deciding before writing code: `bank_import_rows.dedup_hash` is backed by a
**non-unique** index (`bank_import_rows_dedup_idx`). So the bridge cannot rely on bank-import
row uniqueness to prevent duplicate `incoming_payments`. Derive the `idempotency_key` from
`dedup_hash` (or from the row id) and let `incoming_payments_idempotency_uidx` be the guard —
it is the only real uniqueness constraint in the chain.

---

Agent B wrote no application code, no migration, and no Agent A file. Files written this round:
`B_REVIEW.md`, `B_RISKS.md`, `B_TEST_RESULTS.md`, `B_STATUS.md`.
