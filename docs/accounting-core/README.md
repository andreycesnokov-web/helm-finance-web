# Accounting Core — Phase 1 (architecture audit and design)

Status: **PROPOSAL — waiting for the owner's architecture approval.** Nothing in this folder is implemented.
No migration, table, function, route or screen described here exists yet. Phase 1 changed no code, no schema
and no production data.

| | |
|---|---|
| Date | 24 October 2026 |
| Branch | `claude/accounting-core-phase1-20261024` |
| Baseline | `64746eb` = `integration/cfo-v2-production-ready` = production (Railway deployment `70d20a49`, app.cfo-ai.site) |
| Production database | Supabase `ihvciomcvadjdtskcekb` (105 public tables, migration ledger 28) |
| Previous blueprint | 22 Oct 2026 "Accounting Engine Blueprint" on `a55876d` (claude.ai artifact Bs3qHFSEmxJzRNJspK4Xmu); this package re-verifies it on `64746eb` and supersedes it |

## Documents

| # | Document | Deliverable |
|---|---|---|
| 01 | [Finance Engine audit](01-finance-engine-audit.md) | A — source-of-truth map, data flow, calculations, duplicates, inconsistencies |
| 02 | [Gap matrix](02-gap-matrix.md) | B — EXISTING / REUSE / MODIFY / MISSING for 22 capabilities |
| 03 | [Chart of accounts](03-chart-of-accounts.md) | C — Indonesian frameworks, schema, default chart, category mapping |
| 04 | [Posting contract](04-posting-contract.md) | D — journal schema, invariants, lifecycle, permissions, idempotency, FX |
| 05 | [Posting scenarios](05-posting-scenarios.md) | D — 15 required scenarios + advances, FX, refunds, accruals |
| 06 | [Reporting architecture](06-reporting-architecture.md) | E — GL, TB, BS, P&L, cash flow, reconciliations |
| 07 | [Integrity and security](07-integrity-security.md) | Section 8 controls |
| 08 | [Migration and backfill](08-migration-backfill.md) | Section 9 — additive transition, shadow validation |
| 09 | [Testing strategy](09-testing-strategy.md) | Section 10 — invariants and synthetic companies |
| 10 | [Roadmap](10-roadmap.md) | F — phases, smallest safe milestone |
| ADR | [Architecture decisions](adr/README.md) | ADR-AC-001 … ADR-AC-010 (proposed) |

## How the evidence was gathered

- Code: `64746eb` source (`server/index.js`, `server/lib/*`, `client/src/v2/*`, `supabase/migrations`,
  `migrations`, `scripts/migrate-v2.mjs`). Every remote branch and the Codex clones were searched for journal,
  chart-of-accounts, trial-balance and ledger identifiers: none exist outside the P&L capability flags
  (`server/lib/profitLoss.js:135`, `general_ledger:false`).
- Schema: the local runner database built from the same migration manifest (fingerprints matched production at
  the 24 Oct deploy) and read-only metadata queries on production (table list, grants, RLS, aggregate row counts,
  tax-rule status). No production row content was read; nothing was written.
- Graphify: index is `main fb03df5` (15 Oct, 9 days old, far behind production). Used only to locate symbols;
  every conclusion was re-checked in `64746eb` source.
- Obsidian vault "CFO AI OBSIDIAN": CURRENT_STATE, decisions, P&L architecture/lineage/formulas, Known Issues,
  the 24 Oct release note.
- Indonesian requirements: official IAI and DJP pages (links in 03).

## Approved decisions this design keeps

One transaction = one original record. No shadow cash ledger. Management and statutory accounting are two views of
the same events. Cash balances stay consistent. A missing receipt does not remove a management expense. A document
does not make an expense deductible. Accountant review ≠ tax filing. Existing V2 functions keep working.
