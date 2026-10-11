# B_STATUS — Final gatekeeper verdict (re-review)

Agent B (independent reviewer / gatekeeper)
Branch: `feature/pr46.2-notification-grants-smoke` — 10 commits ahead of `origin/main`, **nothing pushed**

---

# FINAL VERDICT: **GO**

# INCOMING PAYMENTS FOUNDATION: **READY FOR NEXT PHASE**

| PR | Verdict |
|---|---|
| PR1 — Incoming Payments Foundation | **PASS** |
| PR2 — Bank Import → Incoming Payments bridge | **PASS** |
| PR3 — Provider-agnostic Gateway Settlement Import | **PASS** |
| PR4 — Matching candidates | **PASS** *(was BLOCKED)* |
| PR5 — Minimal review queue | **PASS** |

**Ready for human review: YES.**
**Ready for Codex / MiMo final review: YES.**

---

## B4-1 — FIXED and independently verified

`server/lib/incomingPaymentMatching.js` no longer reads the phantom `debts.remaining_amount`.
A extracted `outstandingAmount(debt)`, which derives the balance from **real columns only**:

```js
const effective = Number(debt.original_amount || debt.amount || 0);
const paid      = Number(debt.paid_amount || 0);
return fromCents(Math.max(0, toCents(effective) - toCents(paid)));
```

All three columns exist in the production schema. Integer-cents arithmetic, consistent with the
rest of the module. `buildCandidates` additionally skips any receivable whose computed
outstanding is `<= 0`, so fully-settled debts are excluded by amount rather than by status flag
alone.

### Verified against a production-shaped row (no computed fields)

Same fixture that previously exposed the defect — 3,000,000 receipt against a 10,000,000
receivable with 7,000,000 paid:

| | Before fix | After fix |
|---|---|---|
| `outstandingAmount` | — (field absent → fell back to 10,000,000) | **3,000,000** ✅ |
| Candidates proposed | **0** | **1, score 1.0** ✅ |
| Fully-paid receivable excluded | — | **yes** ✅ |
| Wrong-amount receivable a false exact match | risk | **no** ✅ |

### The regression is now guarded by a test

`tests/incomingPaymentMatching.test.js:219` asserts `!('remaining_amount' in production)` — the
fixture is forbidden from carrying the computed field. The surviving `remaining_amount` mentions
in the module and the suite are comments explaining why it must not be used, including an explicit
note (`:195`) that the earlier fixtures "supplied `remaining_amount` and therefore asserted the
bug was correct." That is the right way to close this class of defect.

---

## Also verified this pass — the three fixes from `81710e88`

| Fix | Verification |
|---|---|
| Phantom `reference` columns | `matching:153` reads `debt.notes` (real column); `:172` sets transaction `reference: null` explicitly |
| Failed source read no longer reports "no matches" | `index.js:3716` `candidate_sources_unavailable`; `:3559` `candidate_read_failed` — both surface a 500 instead of an empty list |
| Rejected receipt can leave the review queue | `index.js:3546-3549` — `status === 'rejected'` is terminal on its own |

---

## Commits reviewed

```
6531e920 docs: A_STATUS round 4 self-audit; sync B review files
81710e88 fix: close three self-audit findings in PR4/PR5
5e010fdb docs: roadmap phase status and A_STATUS round 3
706f862b fix: bridge the confirm route the bank import UI actually calls
dbc6e3de docs: record PR1-PR5 delivery in spec, roadmap and A_STATUS
821e5c2c feat: add incoming payment review queue                (PR5)
4f6812c1 feat: add incoming payment match candidates            (PR4)
64596e29 feat: add gateway settlement import foundation         (PR3)
e4a72d4d feat: bridge bank import to incoming payments          (PR2)
6edfff3b feat: add incoming payments foundation                 (PR1)
```

Plus the **uncommitted** B4-1 fix in the working tree (`server/lib/incomingPaymentMatching.js`,
`tests/incomingPaymentMatching.test.js`). See non-blocker R5.

---

## Tests run — 641 assertions, 0 failures

**Targeted — incoming payments (146):** `incomingPayments` 38 · `incomingPaymentsMigration` 25 ·
`incomingPaymentsApi` 83

**Targeted — bank import bridge (50):** `incomingPaymentsBridge` 20 ·
`incomingPaymentsBankBridgeApi` 21 · `incomingPaymentsBankProvenanceMigration` 9

**Targeted — matching / review / gateway (74):** `incomingPaymentMatching` **34** (was 29 — five
new tests for the fix) · `incomingPaymentCandidatesMigration` 16 · `gatewaySettlementImport` 24

**Regression (371):** 7 migration-CI suites 133 · 10 unit suites 238 — identical to the pre-PR1
baseline, no regressions.

`node --check` clean on `server/index.js` and the matcher. Run fingerprinted before and after —
**STABLE**, results valid. Client build not run: the branch touches zero files under `client/`.

---

## Gatekeeper confirmations — all pass

| Check | Result |
|---|---|
| No production env/secrets/deploy/CI changed | ✅ only `.env.example`, a template |
| No production flags enabled | ✅ `INCOMING_PAYMENTS_ENABLED=false` |
| No external APIs / credentials | ✅ none in any feature file |
| No Telegram identity changes | ✅ |
| No notification-grants changes | ✅ |
| No cleanup-SQL changes | ✅ |
| No hardcoded business/user IDs | ✅ no `HF-BIZ-*`, `-1`, or telegram id in code or tests |
| Idempotency safe | ✅ two DB unique indexes (idempotency key + provider-transaction, both business-scoped) plus API replay returning the first row and 23505 handling |
| Business scoping safe | ✅ every query filtered by `business_id`; candidates additionally guarded by a DB trigger verified in PGlite on INSERT and UPDATE; matcher proposes **no** cross-business receivable or transaction (verified directly) |
| No revenue booking | ✅ zero `transactions`/`debts` writes in any feature library |
| No final accounting without review | ✅ decision-stamp CHECK; approval role required; accepting a candidate provably does not touch the debt or transaction |
| Nothing pushed | ✅ 10 ahead, 0 remote branches contain HEAD |
| **B4-1 fixed** | ✅ verified with a production-shaped fixture |

---

## Remaining non-blocking risks

| # | Where | Risk |
|---|---|---|
| **R1** (was B4-2) | `server/index.js` accept path | The `incoming_payments` update that writes `reconciliation_status:'matched'` and the link is **not error-checked**, and is a separate statement from the candidate update. If it fails, the candidate reads `accepted` while the payment stays unmatched, and a retry returns `409 already_decided` — not repairable through the API. No money misattributed, nothing booked. |
| **R2** (was B4-3) | same | `already_matched` is a read-then-write check with no DB constraint. Two concurrent accepts of different candidates on one payment could both succeed. Low likelihood (human action). |
| **R3** (was B4-4) | `server/index.js:3750` | The `reconciliation_status:'candidate'` reflection write is also unchecked. Cosmetic next to R1. |
| **R4** | pre-existing | The legacy bank-import path (~980 lines, two ledger-writing sites) still has no characterization tests, so "unchanged when the flag is OFF" rests on diff review. Not introduced by this work. |
| **R5** | working tree | The B4-1 fix is **uncommitted**. It must be committed before this branch goes to human or Codex/MiMo review, or the reviewed state is not the state they receive. |
| **R6** | rollout | Migrations 048, 049 and 050 are one unit. Enabling the flag with only 048 applied returns 500 on every route. `.env.example` documents this; the deploy runbook must carry it too. |

None of these move money, book revenue, or mutate the ledger. The layer remains ledger-inert and
the flag is off.

---

## Process note

Commit `6531e920` ("sync B review files") rewrote `B_STATUS.md`. The content was my own earlier
draft rather than altered verdicts, so nothing was falsified — but the reviewer's files are the
one artifact the implementing agent should not write, precisely so a verdict cannot be edited by
the party being gated.

---

Agent B wrote no application code, no migration, and no Agent A file.
