# Validation record

Research date:2026-10-06, Asia/Shanghai. Branch feature/indonesia-tax-knowledge.

Checks run:

- Node test suite:32 tests, including26 substantive RU/EN/ID fixtures (78 retrieval executions).
- Python ingestion suite:7 tests for URL/redirect restrictions, version dedup, unchanged refresh,
  failure preservation, single-writer lock, unreadable page handling and retained TER table candidates.
- evaluate.cjs:78 executions, no failed expected-status/source/missing-information/non-activation checks.
- Syntax checks for the new module and unchanged server/index.js.
- Index rebuild:188 fragments; exact hashes/locators verified by Node tests.
- Visual spot checks:PP34 page4, PP20 page5, PP58 page11.
- Git scope check:only new KB artifacts, offline tools, an unconnected server library and its tests.

Automated retrieval and arithmetic consistency are checked. There is no LLM answer evaluation,
independent tax translator review or licensed legal-currentness sign-off. Table candidates are
not certified. PMK1/2026 retrieval failed twice. Historical instruments, treaty procedures, special
regimes and current amendment completeness remain gaps.

Business research only. No flag/env change, no migration, no database read/write, no route hookup,
no merge, no deploy, no paid service. Protected code and legacy knowledge collection are unchanged.
The isolated module reduces unsupported applicability claims by returning conditions/gaps and keeping
applicability undetermined; it is not ready to be used as a production tax calculator.
