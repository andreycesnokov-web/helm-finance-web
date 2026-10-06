# Before / after78 scenarios

Baseline SHA749937d1df368302e4f05480504445db0eea08d1 is preserved in baseline_749937d/.
Runtime uses no question IDs or gold pages. New checks require provision identity, literal text anchors and exact bound versions. PASS is technical grounding/guard evidence, not tax correctness, translator review or licensed sign-off. No model calls.

| Case | Language | Before page/safety check | After same page/safety check | After provision/text binding | Returned document claims | Answer |
|---|---|---|---|---|---:|---|
| Q01 | ru | PASS | PASS | PASS | 4 | partial |
| Q01 | en | PASS | PASS | PASS | 4 | partial |
| Q01 | id | PASS | PASS | PASS | 4 | partial |
| Q02 | ru | FAIL | PASS | PASS | 4 | partial |
| Q02 | en | FAIL | PASS | PASS | 4 | partial |
| Q02 | id | PASS | PASS | PASS | 4 | partial |
| Q03 | ru | PASS | PASS | PASS | 4 | partial |
| Q03 | en | PASS | PASS | PASS | 4 | partial |
| Q03 | id | PASS | PASS | PASS | 4 | partial |
| Q04 | ru | PASS | PASS | PASS | 8 | partial |
| Q04 | en | PASS | PASS | PASS | 8 | partial |
| Q04 | id | PASS | PASS | PASS | 8 | partial |
| Q05 | ru | FAIL | PASS | PASS | 4 | partial |
| Q05 | en | FAIL | PASS | PASS | 4 | partial |
| Q05 | id | FAIL | PASS | PASS | 4 | partial |
| Q06 | ru | PASS | PASS | PASS | 8 | partial |
| Q06 | en | PASS | PASS | PASS | 8 | partial |
| Q06 | id | PASS | PASS | PASS | 8 | partial |
| Q07 | ru | FAIL | FAIL | PASS | 0 | blocked |
| Q07 | en | FAIL | FAIL | PASS | 0 | blocked |
| Q07 | id | FAIL | FAIL | PASS | 0 | blocked |
| Q08 | ru | PASS | PASS | PASS | 4 | partial |
| Q08 | en | PASS | PASS | PASS | 4 | partial |
| Q08 | id | PASS | PASS | PASS | 4 | partial |
| Q09 | ru | FAIL | PASS | PASS | 8 | partial |
| Q09 | en | FAIL | PASS | PASS | 8 | partial |
| Q09 | id | FAIL | PASS | PASS | 8 | partial |
| Q10 | ru | FAIL | PASS | PASS | 3 | partial |
| Q10 | en | FAIL | PASS | PASS | 3 | partial |
| Q10 | id | FAIL | PASS | PASS | 3 | partial |
| Q11 | ru | FAIL | PASS | PASS | 3 | partial |
| Q11 | en | FAIL | PASS | PASS | 3 | partial |
| Q11 | id | FAIL | PASS | PASS | 3 | partial |
| Q12 | ru | FAIL | PASS | PASS | 2 | partial |
| Q12 | en | FAIL | PASS | PASS | 2 | partial |
| Q12 | id | FAIL | PASS | PASS | 2 | partial |
| Q13 | ru | FAIL | PASS | PASS | 7 | partial |
| Q13 | en | FAIL | PASS | PASS | 7 | partial |
| Q13 | id | FAIL | PASS | PASS | 7 | partial |
| Q14 | ru | FAIL | PASS | PASS | 4 | partial |
| Q14 | en | PASS | PASS | PASS | 4 | partial |
| Q14 | id | PASS | PASS | PASS | 4 | partial |
| Q15 | ru | PASS | PASS | PASS | 4 | partial |
| Q15 | en | PASS | PASS | PASS | 4 | partial |
| Q15 | id | PASS | PASS | PASS | 4 | partial |
| Q16 | ru | FAIL | PASS | PASS | 5 | partial |
| Q16 | en | FAIL | PASS | PASS | 5 | partial |
| Q16 | id | FAIL | PASS | PASS | 5 | partial |
| Q17 | ru | PASS | PASS | PASS | 6 | partial |
| Q17 | en | FAIL | PASS | PASS | 6 | partial |
| Q17 | id | PASS | PASS | PASS | 6 | partial |
| Q18 | ru | FAIL | PASS | PASS | 5 | partial |
| Q18 | en | FAIL | PASS | PASS | 5 | partial |
| Q18 | id | PASS | PASS | PASS | 5 | partial |
| Q19 | ru | FAIL | PASS | PASS | 3 | partial |
| Q19 | en | PASS | PASS | PASS | 3 | partial |
| Q19 | id | PASS | PASS | PASS | 3 | partial |
| Q20 | ru | PASS | PASS | PASS | 3 | partial |
| Q20 | en | PASS | PASS | PASS | 3 | partial |
| Q20 | id | PASS | PASS | PASS | 3 | partial |
| Q21 | ru | PASS | PASS | PASS | 5 | partial |
| Q21 | en | PASS | PASS | PASS | 5 | partial |
| Q21 | id | FAIL | PASS | PASS | 5 | partial |
| Q22 | ru | FAIL | PASS | PASS | 3 | partial |
| Q22 | en | FAIL | PASS | PASS | 3 | partial |
| Q22 | id | PASS | PASS | PASS | 3 | partial |
| Q23 | ru | FAIL | PASS | PASS | 6 | partial |
| Q23 | en | FAIL | PASS | PASS | 6 | partial |
| Q23 | id | FAIL | PASS | PASS | 6 | partial |
| Q24 | ru | PASS | PASS | PASS | 0 | blocked |
| Q24 | en | PASS | PASS | PASS | 0 | blocked |
| Q24 | id | PASS | PASS | PASS | 0 | blocked |
| Q25 | ru | PASS | PASS | PASS | 4 | partial |
| Q25 | en | PASS | PASS | PASS | 4 | partial |
| Q25 | id | PASS | PASS | PASS | 4 | partial |
| Q26 | ru | FAIL | PASS | PASS | 6 | partial |
| Q26 | en | FAIL | PASS | PASS | 6 | partial |
| Q26 | id | FAIL | PASS | PASS | 6 | partial |

## Counts and interpretation

```json
{
  "baseline_sha": "749937d1df368302e4f05480504445db0eea08d1",
  "runs": 78,
  "before_page_pass": 38,
  "before_page_fail": 40,
  "after_same_page_pass": 75,
  "after_same_page_fail": 3,
  "after_provision_pass": 78,
  "after_claim_binding_pass": 78,
  "after_guards_pass": 78,
  "substantive_explanations": 72,
  "nonempty_scope_runs": 75,
  "model_calls": 0,
  "professional_review": null,
  "semantic_tax_review": "NOT_PERFORMED"
}
```

75 in-scope runs check actual provisions;3 out-of-scope runs check handling rather than source recall. The2017 rent cases correctly return historical evidence without pretending it was operative in2017. See EXPECTATION_CHANGES.md for corrections to flawed page-only gold. Refusal alone cannot pass: every other in-scope case must return supported general explanations in the Node suite.

## Failure groups fixed

The40 previous FAILs: tied Cyrillic/English words against Indonesian text and three arbitrary slices; document-registry membership mistaken for proof; page continuity and note/amendment boundaries lost. Topic/concept routing now resolves complete identified provision bundles; claims bind exact fragments/SHA/text anchors; gates remove unsupported, outside-period, stale-version and unverified numeric outputs. Topic dictionaries are generic and new paraphrases are tested. Retrieval currently favors recall within the small eight-topic corpus; precision/latency across a much larger corpus remain future evaluation work.
