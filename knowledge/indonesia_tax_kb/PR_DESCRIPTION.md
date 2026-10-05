## Problem and result

AI Accountant lacks a source-grounded Indonesian tax research module. The existing66-source
collection contains no archived originals and all rule candidates remain under review. This adds
an isolated, read-only knowledge module with immutable official PDF archives, page/table extraction,
semantic fragments, multilingual research cards and an explicit Accountant retrieval contract.
For example, a rent question returns PP34 provisions, payer conditions and missing facts; it never
determines company net payable or activates a tax rule from a retrieved rate.

## Deliverables

- Inventory: `knowledge/indonesia_tax_kb/INVENTORY.md` and `inventory.json`.
- Official source registry: `sources.json`;14 selected sources,13 downloaded originals, SHA/version history,
  actual read scopes, amendment/repeal relationships and unresolved issues.
- Working offline ingestion/indexing tools and unconnected read-only retrieval library;188 fragments,
  exact source-page links and retained candidate table matrices/layout.
- Eight research cards in RU/EN/ID: `CARDS.md` and `cards.json`.
-26 substantive questions in three languages, results and example sourced answers under `quality/`.
- Post-PR132 integration contract: `INTEGRATION.md`.
- Professional review queue: `REVIEW_GAPS.md`.

## Validation and limits

32 Node tests,7 Python tests,78 deterministic retrieval evaluations, module/server syntax checks and
three visual PDF spot checks. This is retrieval/policy testing, not an LLM evaluation or licensed review.
PMK1/2026 failed to download twice; current amendment completeness, historic applicability, treaty
procedure and TER table fidelity remain explicit gaps. Official consolidated statutory text is archived,
but individual promulgated amending statutes still need archival verification.

Business AI Accountant research only. PR132 was OPEN when inspected; integration is documentation only.
No server/index.js, Accountant UI, financial math, AntiGravity branches, flags/env, migrations or database
changes. No production connection, merge, deploy, paid service or active tax rules.
