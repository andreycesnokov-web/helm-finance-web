# AI Accountant evidence contract v2 (unconnected)

Business research only. No route, model, database, rule activation or calculator is connected.
The adapter after PR132 remains a separate reviewed change. This PR does not modify server/index.js,
Accountant UI, company financial facts, balances, obligations, payments, flags or migrations.

## Input

`retrieve({question, language, period, company, topics?})` in server/lib/indonesiaTaxKnowledge.cjs.
Question:1–4000 chars; language:ru/en/id; period:ISO date or missing. Missing period never defaults to today.
Company:declared attributes only; null/unknown allowed. Non-Indonesian country returns out_of_scope.
Topics:optional known codes for a future classifier. Default routing is shared multilingual tax vocabulary.
No question IDs, expected pages, URLs, instructions, company IDs or model/tool commands are interpreted.

```json
{"question":"Explain rental withholding","language":"en","period":"2026-10-01",
 "company":{"country":"ID","rental_object":"unknown","payer_withholder_status":"unknown"}}
```

## Output and trust boundaries

| Field | Meaning / required handling |
|---|---|
|schema_version|2; replaces unbound v1 explanations/sources; consumers must not silently read legacy fields|
|status|research_only or out_of_scope; never means legally verified|
|answer_status|document_explanation, partial or blocked; separate from company applicability|
|evidence_sufficiency|Sufficient only for the returned archived-document claims, or insufficient; company-tax-conclusion sufficiency explicitly insufficient|
|document_registry|Metadata and review statuses of relevant documents; registry presence is NOT evidence|
|retrieval|Matched fragment/provision IDs and method; research discovery, NOT applicability|
|fragments|Actual version-matching archived operative/instruction text within recorded dates; current legal currency remains unconfirmed|
|reference_fragments|Undated/missing-period text or explicit historical reading dependencies; NOT applicable-period basis|
|historical_materials|Outside-period or superseded-version text, clearly labelled; NEVER used as returned period/company basis|
|claims|Only text-grounded atomic document explanations; ID, localized text, evidence IDs, period restrictions, scope and quality. No unbound whole card|
|claim_evidence|Exact fragment IDs, source and SHA, article, paragraph locator, pages, original links, literal text anchor, editorial review and quality limitations|
|associated_explanations|Only explicitly labelled Penjelasan linked to the same article/context/version. Official explanatory context, not added claim authority|
|additional_reading|Original document-card links; NOT citations proving an assertion|
|blocked_claims|IDs/kinds and reasons; blocked tax-rate/deadline/TER assertions are not returned as text or examples|
|blockers|Machine-readable codes, dependent claim/source, graph path, scope and affected topics. Missing amendment content is never guessed|
|clarifying_questions|Concrete RU/EN/ID questions with field codes; for company-specific determination only|
|missing_information|Codes for missing declared characteristics; completeness does NOT confirm applicability|
|applicability|blocked / needs_clarification / not_established_professional_review_required; eligible basis list empty in this research pass|
|numerical_use|blocked, calculations=[], TER=blocked_unverified_table. No exact rate selection from unverified TER matrices|
|trust / production_rule_activation|Document contents untrusted data, professional_review=null, activation=false|

For each returned statement the consumer may follow:
`claims[].evidence_ids → claim_evidence.provision_id → fragment_ids → exact PDF/source SHA + article/paragraph/page`.
All translations of one claim share the same evidence and conditions; they are explanations, not official translations.

## Blocking rules implemented

- Empty/missing supporting index, removed fragment, wrong article/role/version or missing text anchor suppresses
  the dependent claim. Registry links or another fragment are not substituted. No old rate/example card fallback.
- A changed current document SHA loses the old card binding. The editorial reviewed-version snapshot is not
  automatically updated by ingestion or a successful hash check. Rebinding a new edition needs explicit editorial review.
- Outside-period provisions go to historical_materials. Missing/undated dates go to reference_fragments.
  `effective_to:null` never certifies current law. Explicit transitions are tracked as distinct claims; historical
  reading references do not become current normative grounds. Automatic transition applicability is not implemented.
- All numerical/company conclusions in this pass lack established legal currency. They are blocked; no numeric
  examples are returned. Confirmed text-level explanations of what a primary archived document says may remain,
  separately scoped and never asserting current company applicability.
- Known amended_by chains are followed to missing texts or incomplete reviews. PMK81→PMK1 propagates to administrative conclusions
  of PPh21/23/26, final rent, PPh25/29 and PPN, even without a deadline keyword. This does not assert that PMK1
  changes any particular underlying rate or TER row. Rates also remain blocked by currency/quality limits.
- TER numerical conclusions always have TER_table_not_verified. Original candidate matrices remain archived
  for inspection but are not used for lookup. General methodology is linked to PMK168 articles13/15.
- Source/extraction byte mismatch throws source_integrity_failure / extraction_integrity_failure. A future
  adapter must return knowledge unavailable, never a normal model answer with invented citations.

## Stable structure and period limitations

Fragment ID depends on source SHA, physical page and exact character span. Provision ID additionally includes
context, role and explicit article identity. Contiguous page continuations retain previous/next links. Initial
orphan text is unassigned; explicit Penjelasan is separate; numbered amendment instructions do not inherit the
preceding article. Paragraph markers/footnote markers remain raw; OCR-confused labels and footnote meanings
are not silently corrected or certified. The original PDF and layout text remain the visual reference.

The indexed corpus is261 fragments /125 identified provisions across the existing scope.67 atomic statement
definitions are bound by article/role/text anchor to exact reviewed source SHAs. This is a small corpus:
topic/concept search returns complete relevant provision bundles to avoid arbitrary top-three page loss;
precision and bounded caching should be reevaluated before a large corpus or a live request path.

## Connection after PR132 — documentation only

Reinspect the final PR132 branch state and facts shape. Preserve auth, active Business resolution, membership,
isolation and its financial answer flow. Use a separately loaded checked snapshot; never fetch/parse arbitrary
documents inside ask. Pass whitelisted profile data and an explicit period. Keep research context separate
from applicable_rules, financial facts and obligations. The interface must display claim evidence and blockers,
ask the returned clarification questions and suppress blocked conclusions. A populated registry or a partial
general answer cannot authorize payment calculations. Keep system instructions separate from untrusted source
text. No model is connected or evaluated here; model grounding/injection and business-isolation integration
need separate tests before any adapter is enabled. No flags were added/enabled or deployment performed.

## Additive v2.1 / tooltip v1

See ANTIGRAVITY_HANDOFF.md for explicit explanation/company_determination intent, prioritized relevant questions, stable card topics and the exact rendering contract. PMK1 text is now archived: its chain blocker is incomplete review, not download failure. Numeric/current applicability remains blocked.

## Tooltip v2 editorial update

ANTIGRAVITY_HANDOFF.md now specifies tooltip schema2, explicit definition/mechanism/condition roles, object-shaped abbreviation with availability, and complete supporting-provision anchors. Retrieval schema2 adds presentation_roles/text_anchors without changing numeric/company blockers. Source PDFs/index are unchanged.
