## Problem and resulting behavior

The prior research prototype ranked Russian/English questions against Indonesian text, omitted controlling
articles under a three-fragment quota and returned whole static tax cards regardless of actual evidence.
For example, a rent payment-deadline question retrieved PMK53's amendment title instead of PMK81 article94.
This isolated module now retrieves versioned provision bundles, returns only individually grounded archived
document explanations, and blocks unsupported numerical or company-specific conclusions.

## Changes

-Multilingual topic/concept routing; contiguous article continuations and explicit paragraph/footnote markers;
  separate Penjelasan, amendment instructions, orphan text and page furniture.
-261 fragments/125 provisions from the existing13-PDF archive; no new source/topic or embeddings.
-33 atomic RU/EN/ID statements bound to exact fragment IDs, document SHA, article/paragraph/page and periods.
  Registry, actual retrieval, claim evidence, official explanations and supplementary reading are separate.
-Contract v2:proof sufficiency, per-claim blockers, localized clarification questions, historical/version
  segregation, amendment dependency paths and hard numerical/TER/company gates. Empty/removed/stale evidence
  cannot fall back to old rates/examples; open-ended dates cannot establish current validity.
-Baseline749937d outputs preserved; full before/after78 rows and primary-text-backed gold corrections.

## Validation and limits

41 Node tests and7 Python tests pass.75 in-scope runs locate primary provisions;72 keep grounded general
explanations. Page-only baseline38/78 improves to75/78 under literally unchanged targets; remaining3 are
the wrong Q07 signature-page8 gold, corrected to operative article7/page7. Stronger provision/text/version/
claim/guard checks pass78/78, including3 out-of-scope checks. Nine new language paraphrases are also tested.
This is technical grounding and gating, not tax-law correctness, licensed sign-off or LLM evaluation.

PMK1/2026 and complete current amendment chains, historical predecessor texts, OCR paragraph/footnote
certainty and TER table fidelity remain gaps. Numerical/company determinations stay blocked. No real model.
The future PR132 adapter is documentation only. No server/index.js, Accountant UI, financial math, PR129–132,
flags/env, migrations/database, active tax rules, merge or deploy changes.
