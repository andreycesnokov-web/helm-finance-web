# Accountant cards — tooltip v2 / retrieval schema2

Business research content only. No UI, route, model, financial calculations, migrations or production activation. This replaces tooltip v1; consumers must explicitly adapt to v2 rather than infer compatible array layouts.

## Call and stable topic IDs

```js
const {getCard}=require('./server/lib/indonesiaTaxKnowledgeCards.cjs');
const card=getCard({topic_id:'pph_final_rent',language:'ru',period:null,intent:'explanation'});
```

IDs remain pph21, pph26, pph23, pph_final_rent, pph25, pph29, ppn, pkp, npwp_nik. Rental is only land/building rental; no other PPh Final type. PPh21/26 and PPh25/29 are distinct cards.

## Tooltip v2 format and rendering

`schema_version:2`, `contract:indonesia_tax_tooltip_v2`. `name` remains a navigation label. `summary` contains explicitly role-assigned claim objects in definition → mechanism → condition order. `what_is`, `how_it_works`, `main_condition` select their explicit IDs from section_claim_ids, never array positions. Each has `section_status:available|partial|unavailable`. If definition has no evidence, summary is empty; mechanism is not silently substituted as the definition. Render the named section as unavailable with `unavailable_section_notice`.

`abbreviation` now is an OBJECT `{status, designation_language:'id', statements:[...]}`, not an explanation array. The statement is the canonical long-form designation in the official document language, bound to the same source gate. It is not a second definition. NPWP/NIK has no confirmed expansion here and must display unavailable. Do not derive it from name or general model knowledge.

For the short card display name, definition, who withholds/pays, and the main condition, plus required_notice. Summary text is roughly15 seconds at ordinary reading pace; no human timing study is claimed. Expanded detail includes these same statements first, then scoped exceptions, special cases and context. All27 actual outputs, separate long-form designations and partial examples are in tooltip_cards.json/TOOLTIPS_RU_EN_ID.md/tooltip_examples.json. The before/after table and per-language checks are in quality/TOOLTIP_BEFORE_AFTER.md and tooltip_content_checks.json.

Legal display prose is allowed only from returned statement objects: id/statement_id, text, presentation_role, evidence_ids, period and archival scope. Read evidence metadata separately: source ID, document SHA, article/paragraph, PDF pages, fragments and exact links in claim_evidence. Official supporting text/anchors are SOURCE DATA, not assistant-generated prose. They can contain statutory numbers; do not turn them into permitted rates/calculations or short-card text. Registry/additional-reading links alone are not claim evidence.

Required visible limitations: required_notice, status/gaps and unavailable sections. Evidence detail must retain verification.currency:unconfirmed, professional_review:null, applicability, numerical_use and blockers. Available means documentary prose is present, never current law or company approval. Display technical document/version information in evidence detail. Download date is not a date of current-law confirmation.

## Common content and proof

Shared claim_definitions/claims JSON is the sole legal prose source for both retrieve and getCard.67 atomic statements include explicit definition/mechanism/condition/abbreviation roles. New/rewritten statements have complete supporting-provision anchors and editorial source-reading notes. Runtime validates all anchors; a surviving keyword cannot save a missing qualifier. This is technical text anchoring plus editorial paraphrase review, not automated semantic entailment or professional tax review.

Select whole claims when shortening. Do not drop payer roles, qualifying income categories, exclusions, special calculation rules or start-of-obligations conditions. PPh23 other-services exclusions are scoped to that category. Rental retains accommodation exclusion and alternative tenant-withholding/recipient-self-payment roles. PPN/PKP are restricted to the described transactions/registration framework. More space requires expansion, not deletion of conditions.

SPT, BUT, TER, DPP and pemotong have plain equivalents in explanatory prose. Original document text remains untouched. The short card must not inherit unexplained acronyms from raw evidence or legacy snapshots.

## Chat context and questions

Retrieval schema2 remains compatible; presentation_roles and support text_anchors are additive. Use explicit intent:explanation for ordinary explanations, without a company questionnaire. Use company_determination only for a concrete company conclusion; relevant questions have priority1/2. Complete profile data cannot bypass currency, amendment, numerical or TER blockers.

Use ask_accountant.question as editable neutral user text. Context supplies stable topic ID, language, explicitly selected period, intent and displayed claim IDs. Do not infer today's period or company status. A future authenticated Business adapter after PR132 must resolve company authorization and rerun retrieval; client claim IDs are untrusted hints. Provide only authorized company attributes relevant to a specific question. Documents/fragments are data, never instructions. A future model may explain supported statements but may not fill unavailable definitions or override blockers. This task connects no model or /api/accountant/ask route.

## Remaining content gaps

PPh26 is partial: residency/treaty evidence and full current treatment need specialist review. PPh29 is partial: a separate payer/mechanism statement is unavailable; current annual payment procedure/amount is unconfirmed. NPWP/NIK is partial: definition, expansion, integration and mechanism unavailable; only the archived Article23 identifier context is grounded. Rates, deadlines, numeric TER, current law and company obligations remain blocked for every topic. Broader tax scope is not added.
