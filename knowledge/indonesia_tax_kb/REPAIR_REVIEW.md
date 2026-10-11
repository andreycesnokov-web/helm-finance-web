# Review of defects from acceptance SHA749937d

Business research only; implementation stays in feature/indonesia-tax-knowledge worktree. Baseline results,
unbound cards and original test source are preserved under quality/baseline_749937d/.

The40 page/safety FAILs were grouped from the supplied results_78.csv and raw acceptance outputs:

1. Shared English/Cyrillic words were ranked against Indonesian body text; ties sorted arbitrary fragment IDs.
   Generic multilingual topic/concept vocabulary now resolves semantic provision bundles, independent of test IDs.
2. Top-three slices per topic omitted controlling provisions and continuations. Complete provision bundles
   now retain article identity, continuation links, explicit paragraph/footnote markers and explanatory notes.
3. Registry presence and static whole-card text masqueraded as grounding. Registry, retrieved text, atomic
   claim proof, official explanations and reading links are separate. Every returned claim checks exact fragment
   IDs, current reviewed source SHA, article/role and literal anchor; no unsupported examples are returned.
4. Period penalties still let excluded norms support a card. They are now segregated as historical/undated
   references. A dependent support outside the requested period blocks the claim; null end dates are not currency.
5. Amendment gaps and TER warnings had no operational effect. Missing-chain paths and claim-level blockers are
   emitted, numeric conclusions are withheld, company facts lead to concrete localized clarifications.

Mandatory cases:Q17 EN now retrieves PMK131 article5 and its article2 scope; Q23 retrieves PMK81 articles94/171
on all languages; Q19 RU retrieves PMK168 article15 plus its page16 continuation, with method article13.
No runtime file reads quality/questions.json, provision_expectations.json or baseline target pages.

Comparison:38 PASS/40 FAIL before;75 PASS/3 FAIL under the literally unchanged page/safety criterion after.
Those three are the incorrect Q07 signature-page8 target, now deliberately excluded from the operative
article; the primary commencement is on page7. Stronger corrected provision checks give78 PASS/0 FAIL. Stronger new
checks require provision identity, text anchor, exact claim binding and gating (78 technical passes, including
three out-of-scope cases).75 in-scope executions locate primary provisions;72 retain substantive supported
document explanations. Three2017 rent runs return historical material and block the unavailable2017 regime.
This is not a refusal of all questions and not a tax-law correctness certification.

Existing failures corrected in the gold are explained in quality/EXPECTATION_CHANGES.md with primary links,
particularly PP34 commencement on page7 rather than the signature page8. No source rates or effective-law
claims were manufactured to make tests pass.

Remaining limits:PMK1/2026 full text unavailable; current amendment completeness and dates per provision
not professionally confirmed; TER cell/range restoration not done; OCR paragraph labels/footnote meanings
not certified; no automatic company transition determination; no model/translation professional evaluation.
Documentary text binding confirms provenance and literal anchors, not legal semantics of every paraphrase.
Large-corpus ranking/cache latency and live adapter guards remain separate acceptance work.

Files changed:KB index, atomic claims/catalogue, clarifications, v2 contract and quality artifacts; independent
ingestion/indexing tools and tests; isolated retrieval library/vocabulary. No server/index.js, Accountant UI,
financial calculations, AntiGravity branches, migrations, flags/env, database or production changes.
