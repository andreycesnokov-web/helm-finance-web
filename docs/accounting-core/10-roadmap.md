# 10 — Implementation roadmap (proposal; each phase needs owner approval)

Small phases, each independently testable and reversible. Hours are active engineering estimates; accountant
review time is separate.

| Phase | Scope | Modules | Migration | Acceptance | Tests | Depends on | Rollback / isolation | Hours |
|---|---|---|---|---|---|---|---|---|
| **AC-0** Integrity hardening | fixes I-1, I-5, I-6, I-7, I-11 (FK NOT VALID), I-12 (reconciliation query) | `financialInsights.js`, `server/index.js` (patch, funding), new migration | M0 | patch writes before/after audit; funding create is one RPC; anon/authenticated have no grants on financial objects; "TRANSFER … INV" with a confirmed revenue group stays revenue | golden strings, grants catalog test, funding atomicity test, existing suites green | — | `_down.sql`; no new tables | 10–14 |
| **AC-1** Ledger schema | 10 tables of 04, invariant triggers P1–P9, grants | new migration only | M1 | all invariant tests pass on the native runner DB; tables empty and unreachable from the API | DB invariant suite (T1, T5–T7), grants | — | drop empty tables | 12–16 |
| **AC-2** Chart of accounts | template `id_pt_default` v1 (ID/EN/RU), provisioning, wallet → bank account, category → account mapping with confirmation, company framework + functional currency settings | `server/lib/accounting/chart.js`, `rpc_gl_chart_action`, `/api/accounting/chart` | M2 | a synthetic company gets a chart; mapping suggestions need confirmation; accounts with postings cannot be deleted | chart rules, cross-tenant, roles | AC-1 | `_down.sql`; API behind `ACCOUNTING_CORE_ENABLED` | 10–14 |
| **AC-3** Posting engine (core events) | rules for income/expense, transfers, opening anchors, corrections, personal/capital marks; manual journals with approval | `server/lib/accounting/postingRules.js`, `rpc_gl_post_event`, `rpc_gl_journal_action` | M3 | 05 scenarios 1, 4, 7, 8, 9 and reversal produce the expected lines; JS/SQL parity | golden + property (T1–T3, T5) + races | AC-2 | `_down.sql` | 16–22 |
| **AC-4** Shadow posting | outbox inserts in writers, poster job, cash-vs-GL report | writer RPC bodies (one insert each), `server/lib/accounting/poster.js` | M4 | synthetic companies: T3 holds daily; Pulse/Radar/P&L identical (T11) | T3, T11, concurrency | AC-3 | restore writer bodies; poster off | 12–16 |
| **AC-5** Bills, payroll, funding, assets, tax lines | rules for scenarios 2, 3, 5, 6, 10–15 and the extra cases; tax lines only from reviewed treatments | posting rules, `debtWithholding`/`payrollRuns` references | rules in M3 update | all 05 scenarios pass; AR/AP, payroll, tax reconciliations pass | golden, T4 | AC-4 | per-rule version | 18–26 |
| **AC-6** Reports | GL, TB, BS, accounting P&L, cash flow, reconciliations; read-only accountant view | `rpc_gl_*` readers, `/api/accounting/reports/*`, AI Accountant tab | readers in a migration | T2, T8, T9; reports match the 05 hand calculations | report golden tests, roles | AC-5 | read-only; flag | 14–20 |
| **AC-7** Adjustments | accruals, prepayments, depreciation by company policy, adjusting-entry workflow | `server/lib/accounting/adjustments.js` | small | scenario 11, 12, accrued/prepaid cases | golden | AC-6 | per-entry reversal | 12–16 |
| **AC-8** Periods and FX | close/reopen with checklist and snapshots, FX snapshots, revaluation | `rpc_gl_period_action`, `fxProvider` adapter | M5 | closed period refuses posting; reopen audited; revaluation reverses next day | T7, races close vs post | AC-6 | reopen | 14–20 |
| **AC-9** Backfill + validation month | opening TB entry, dry run, approved run, one real month reviewed by an accountant | backfill script, reconciliation | none (data, approved) | 08 §4 steps pass; accountant signs off one closed month | backfill idempotency | AC-8 | backfill entries reversible as a batch while in shadow | 10–14 + accountant |
| **AC-10** Live posting | synchronous posting in writers per company | writer RPCs | M6 | live company: every cash write has its entry in the same transaction | full suite + native acceptance | AC-9 sign-off | per-company flag back to shadow | 8–12 |

Total ≈ 136–190 engineering hours, plus accountant review for the chart template, the posting rules and one closed
month.

## Recommendation: the smallest safe milestone

**M1 = AC-1 + the chart part of AC-2, on a branch, local and synthetic only.**

- Adds the ledger tables, the database invariants (balance, immutability, tenant, period lock, grants) and the
  `id_pt_default` chart template, with the invariant test suite — and nothing that the current product calls.
- Zero coupling to existing writers, screens or calculations: the beta (26 Oct – 1 Nov) cannot be affected even if
  the migration were applied, and it is not applied to production in this milestone.
- It turns the contract's riskiest promises (P1–P9) into executable checks first, so every later phase builds on a
  floor that refuses bad data by itself.
- Output for approval: migration file + `_down.sql`, test results on the native runner DB, the chart for accountant
  review.

**In parallel, as a separate decision:** AC-0 is not accounting work but beta protection (unaudited edits, anon
grants, the transfer keyword). It can ship as a small hotfix release after review, independent of the Accounting Core.

## Decisions needed from the owner

1. Approve the architecture (ADR-AC-001 … 010) and M1 as the first implementation step.
2. Approve AC-0 as a separate beta hotfix (yes/no, and when).
3. Name the accountant who reviews the chart template and the posting rules.
4. Confirm the default framework assumption for new companies (`not_confirmed` until the accountant sets it).
5. Confirm the default treatment of owner personal purchases (1-1350 Due from shareholders, accountant may reclassify).
