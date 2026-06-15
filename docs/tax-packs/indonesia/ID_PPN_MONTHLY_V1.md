# Rule Card — ID_PPN_MONTHLY (PPN monthly compliance)

> **STATUS: DRAFT — Ready for professional verification.** Nothing here is a
> verified legal interpretation. The rule must NOT be activated until a licensed
> Indonesian tax professional reviews and approves it and its official source is
> verified. AI must not present any value below as confirmed law.

| Field | Value |
|---|---|
| rule_code | `ID_PPN_MONTHLY` |
| version (draft) | 2 (supersedes v1 `a99c8945…`) |
| obligation_type | `vat` |
| country / jurisdiction | Indonesia / ID |
| title | PPN — monthly VAT compliance obligation (PKP) |
| filing_frequency / payment_frequency | monthly / monthly |
| status | draft (not active) |

## Two separated concepts (per owner decision)

### A. PPN Monthly Compliance Obligation — *this rule*
Covers **only**: applicability (business is PKP), monthly period, payment + SPT
Masa PPN filing timing, compliance-event generation, reminders, source + version
display. This is the pilot end-to-end object.

### B. PPN Calculation Treatment — *NOT this rule, NOT activated*
Statutory rate, DPP method, luxury/non-luxury, special VAT bases, exceptions.
The legacy `{ "rate": 0.11 }` parameter is kept as **draft / verification
required** (`parameters_status = draft`) and must NOT be used by the Tax Draft
Engine until professionally reviewed. Treatment B is out of scope for the pilot.

## Structured applicability (deterministic — no LLM)
```json
{ "applies_when": { "vat_status": "pkp" }, "required_profile_fields": ["vat_status"] }
```
Verdict logic: applicable if the business tax profile `vat_status = pkp`;
excluded if non-PKP; undetermined if `vat_status` is missing.

## Structured due date (to be confirmed by reviewer)
```json
{ "type": "end_of_next_month" }
```
Working interpretation: SPT Masa PPN / payment by the end of the following month.
**This timing requires professional confirmation against the official source.**

## Draft parameters (verification required — NOT for calculation)
```json
{ "parameters": { "rate": 0.11 }, "parameters_status": "draft" }
```
`rate 0.11` is the legacy draft value (UU HPP general rate). Not confirmed here;
treatment B owns the real calculation.

## Official source (to be verified)
- Authority: Direktorat Jenderal Pajak (DJP)
- Title: DJP — Pajak Pertambahan Nilai (PPN)
- URL: https://www.pajak.go.id/id/pajak-pertambahan-nilai-ppn
- `effective_from`, `document_number`, `content_hash`, `relevant_sections`,
  `quoted_section_reference` → **to be filled and verified by the platform
  editor / professional**. Source status stays `draft` until verified.

## Activation blockers (current, expected)
`source_not_verified`, `rule_not_professionally_reviewed`,
`effective_dates_missing` (until set), `due_date_*` (until the draft is saved).
The rule cannot be activated while any blocker remains.

## Known limitations
No calculation treatment, no DPP logic, no exceptions/luxury handling, no filing
integration. Due date and effective date are working drafts pending official
source verification and licensed professional review.
