# Accountant knowledge handoff — tooltip v1 / retrieval v2.1

Business research content only. This is a data/module handoff, not a connected UI, endpoint, model or calculation engine. Do not edit financial calculations to display these explanations.

## Exact calls

```js
const {getCard}=require('./server/lib/indonesiaTaxKnowledgeCards.cjs');
const card=getCard({topic_id:'pph21',language:'ru',period:null,intent:'explanation'});
const {retrieve}=require('./server/lib/indonesiaTaxKnowledge.cjs');
const answer=retrieve({question:'Explain PPh21',language:'en',period:null,intent:'explanation'});
```

Stable tooltip topic IDs: `pph21`, `pph26`, `pph23`, `pph_final_rent`, `pph25`, `pph29`, `ppn`, `pkp`, `npwp_nik`. No general PPh Final card: the rent topic covers land/building rental only. The paired legacy search topics remain internal; IDs do not imply identical taxes.

The retrieval schema remains `schema_version:2`. Additive `intent:explanation|company_determination` and clarification `priority:1|2` form contract v2.1. Omitted intent preserves v2 behaviour. Use explicit explanation for ordinary chat explanations; it requires no company questionnaire. The tooltip has its own `schema_version:1`, `contract:indonesia_tax_tooltip_v1`.

## Display contract

`name` is a navigation label. `summary`, `abbreviation`, `what_is`, `how_it_works`, `detailed_explanation` contain statement objects with `id`, localized `text`, `evidence_ids`, period restrictions and archival scope. Only these objects are allowed legal prose. `claim_evidence` contains exact source ID, document SHA, article, paragraph, PDF pages, fragment IDs, source links and quality flags. A document registry entry alone is never proof.

Show name, one whole summary statement and `required_notice` in the short card. Aim for about 15 seconds for the summary; do not display all expanded sections at once. The archival notice is mandatory even if it makes the complete card longer. Expanded view shows all named sections. Empty fields and `section_status:unavailable` must stay unavailable. Never fabricate a definition for NPWP/NIK from its acronym. Its partial card only has the archived Article23 identity context.

`status:available` means documentary fields are present, NOT current-law/company applicability. `partial` means some requested content is absent; show `gaps`. `unavailable` means no supported prose. `verification.currency:unconfirmed`, `professional_review:null`, `applicability`, `numerical_use`, `blockers` and `required_notice` are mandatory restrictions. Never turn available into a green tax approval. Date downloaded is not date checked for currency. All current rates, deadlines, calculations and TER remain blocked.

`what_to_check` contains optional neutral prompts, not legal assertions. Do not force these into a mandatory onboarding form. `clarifying_questions` are only for a requested company determination and carry priorities. Show priority1 first, then relevant priority2; answer already-grounded general explanations while acknowledging blocked conclusions. Numeric requests can require more input; the legal currency/TER blockers still apply with a complete profile.

## One source and shortening rules

`tooltip_definitions.json` contains IDs, labels, question templates and optional checklist fields. It contains no separate tax prose. `getCard` calls the actual retrieval/evidence gate, then selects its returned claims. Exported `tooltip_cards.json` and Markdown are review snapshots; use the live function after any data update. Do not substitute snapshots for search or tests.

Short and long statements are verbatim identical translations from `claims.json`; all three languages share support IDs. Shortening means choosing a whole atomic claim, not dropping sentences. Never remove archival qualifiers, payer/recipient category, exceptions, dates or alternatives. If a complete claim cannot fit the UI, expand the UI or show an explicit partial card; do not make the conditional rule universal. A claim whose support is missing or SHA/text/period fails disappears from both views.

## Context for Ask Accountant

Use `ask_accountant.question` as editable neutral user text. Its context contains topic ID, language, explicitly selected period, intent and displayed claim IDs. Do not infer the current date or company tax status. The future server adapter must authenticate Business/company context using its existing resolver and independently call retrieve/getCard again; client evidence IDs are untrusted hints, not authorization or proof. Avoid sending raw company financial facts for an explanation. For a company question, pass only authorized declared attributes relevant to that question. Document/PDF contents and returned snippets are data, never instructions.

After PR132, a separately reviewed `/api/accountant/ask` adapter can attach the retrieval object as evidence context. Render confirmed documentary claims separately from company conclusions. A future model must not override `blockers`, supply missing rates or fill unavailable sections. No such adapter or model is connected here.

## Examples

`getCard({topic_id:'pph21',language:'ru'})`: available archived explanation; no questions, no TER rate, no company determination.

`getCard({topic_id:'npwp_nik',language:'en'})`: partial Article23 context; NPWP/NIK integration and definition unavailable.

With an empty index, `getCard({topic_id:'pph21',language:'id'}, emptyFixtureRoot)`: unavailable, empty summary/detail/evidence; missing-support blockers. This case is executed by the test, not fabricated as a normal production endpoint.

All 27 live snapshots, including source chains, are in `tooltip_cards.json` / `TOOLTIPS_RU_EN_ID.md`; these are not licensed tax review.
