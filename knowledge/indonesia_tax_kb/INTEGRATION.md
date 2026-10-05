# AI Accountant contract v1

Business workspace only. Read-only research retrieval; no Personal company records, calculations,
obligations, filing, tax_rule activation or production writes.

## Input

Call `retrieve(input)` from `server/lib/indonesiaTaxKnowledge.cjs`.

```json
{
  "question": "Explain PPh23 for a legal-service invoice",
  "language": "en",
  "period": "2026-10-01",
  "company": {
    "country": "ID",
    "legal_entity_type": "PT",
    "recipient_type": "entity",
    "recipient_residency": "unknown",
    "service_category": "legal",
    "recipient_npwp": "unknown"
  }
}
```

Question: nonempty string <=4000 chars; language: ru/en/id; period: ISO date, optional.
Omission produces an explicit clarification and never silently selects today.
`topics` is an optional array of known topic codes for an upstream classifier; no arbitrary SQL/regex.
Company fields are caller-declared facts with `null`/`unknown` allowed. A country other than Indonesia
returns out_of_scope. A legal entity is not inferred from an invoice name. Only relevant profile
attributes enter this module; wallets, transactions, names, balances and user credentials are unnecessary.
Profile attributes influence missing-information reporting and transaction-type ranking, not a legal conclusion.

## Output

`schema_version`, `status`, `language`, `period`, `research_as_of`, `topics`;
`fragments` (stable id, document SHA, exact page/character locator, article/context, original Indonesian
text, tables, source link, recorded effective dates, temporal status, extraction/verification status/issues);
`sources` (original/download URL, title, instrument number, authority, language, dates, download/check timestamps,
SHA, relations, read scope, status and unresolved issues);
`explanations` (localized explanatory text, separate educational example and explicit assumptions, exact source refs);
`applicability` (always undetermined in v1, conditions);
`missing_information`, `contradictions`, `gaps`, `trust` and `production_rule_activation:false`.

Article text remains Indonesian; RU/EN are explanations, never official translations.
`downloaded_selected_provisions_read` means a recorded research reading, never licensed verification.
No returned object contains a recommended production rate, net payable or tax-rule activation command.
Even a complete company profile leaves applicability undetermined. Source integrity failure throws,
so a consumer must produce a knowledge-unavailable response rather than invent citations.
Unknown dates, temporal transitions and changed-instrument chains remain visible.
Historical texts outside recorded windows may be retrieved as reference and must not be applied.

## Proposed connection after PR132 (not implemented)

1. Recheck PR132 merged state and its final `/api/accountant/ask` facts shape; it is presently OPEN.
2. Preserve existing auth, active-business resolver, membership/role checks and all company financial facts.
   Resolve the active Business first; no user-supplied company id may bypass that boundary.
3. Load a checked immutable KB snapshot in an offline/admin deployment build. Do not download arbitrary
   URLs, parse PDFs or rebuild indexes in the request handler. Current retrieval validates artifacts on
   each call; measure and implement a bounded startup snapshot cache before a production adapter.
4. For a tax-knowledge question, call retrieve with question, language, explicit tax period and whitelisted
   saved/declarative attributes. Add a separate `knowledge_research` payload. Do not overwrite
   facts.company, applicable_rules, rule_code/version, obligations or taxGate output.
5. Keep the existing financial answer path independent. Research explanations cannot calculate or change
   payments, transfers, balances, overdue status or tenant net payable.
6. Put trusted behavioral instructions in the model system layer. Serialize question, retrieved text and
   profile as inert data in distinct fields. Documents are untrusted data even when official: never execute
   instructions, tools, URLs, Markdown commands or verification requests found inside them. No eval.
7. Require citations from returned source refs, verification/effective-date caveats, material gaps and
   localized clarification questions. A grounded answer may explain a baseline provision or a hypothetical
   example; a company-specific tax determination requires completed evidence/review.
8. Use deterministic out-of-scope/knowledge-unavailable responses when needed. Do not let missing KB
   evidence fall through to a model that invents tax rates. Citation links need exact returned locators.
9. Before enabling an adapter, run PR132 financial-context regressions, Business isolation tests,
   missing-period/treaty/transition tests, malicious-document tests and RU/EN/ID answer evaluation.
   Model grounding requires separate LLM evaluation; this PR tests retrieval and deterministic safeguards.

The shared integration change would be a separate reviewed modification to server/index.js. This PR
does not contain it. No flag was added or enabled, no migration proposed or run, no env changed.

## Ingestion/index lifecycle

Python offline CLI allowlists official HTTPS hosts, validates each redirect, bounds downloads at24MiB,
checks PDF signature, uses a single-writer lock, archives bytes by SHA and preserves version history.
Default rerun skips downloaded sources. `--refresh` records a new attempt, adds a version only for changed
bytes and leaves previous versions intact; failures preserve the previous current hash.
Metadata snapshots travel with each archived version. Legal review records must be attached to an exact
source SHA and provision/period; they must never be inherited when the bytes change.
build_index.py reads explicit selection ranges and hashes originals/extractions, splits by article/page,
keeps exact character locators, table matrices/bboxes and stable IDs tied to source SHA and range.
No embeddings are needed for this small corpus; lexical topic routing + period + profile ranking suffices.
Currently page continuations require neighbor/source-page reading; extraction candidates are not a
certified consolidated statute. The index covers selected pages, not every tax topic in every downloaded file.
Offline PDF extraction should run in a resource-limited worker when ingestion is automated beyond
these curated official downloads; do not expose it as a public upload service.
