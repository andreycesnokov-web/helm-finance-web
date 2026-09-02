# Indonesia Knowledge Graph V1

> **This graph is a review structure, not legal advice and not a tax advice engine.**

Generated **2026-09-02** from the existing KB — the registry, the rule candidates and the
Invoice Review Matrix. It is regenerated from those files, so it cannot drift from them.

**207 nodes · 320 edges.** Every node and every edge is
`status: under_review`, `active: false`, `legal_verified: false`.

---

## 1. What this graph is

A machine-readable map of how official Indonesian sources connect to transaction types, the
documents they need, the questions they raise, and the company-profile facts that decide which
apply. It exists so a later product can *ask the right question*, not so it can answer a tax
question by itself.

It is the data layer intended to feed, later and only after review: an internal Knowledge Atlas,
AI Invoice Review, company-profile suggestions, document checklists, the accountant review queue,
and a due-diligence snapshot.

## 2. What this graph is NOT

- **Not legal advice.** No node or edge is legally verified. Nothing may be activated from it.
- **Not a rate engine.** Only 3 of 18 transaction types carry a rate at all,
  and each is cited to operative regulation text.
- **Not connected to anything.** No frontend, no backend, no RAG index, no Supabase.
- **Not a source of truth.** `source_ids` point at registry sources; the authoritative bytes live in
  `raw_sources/` with SHA-256 in `MANIFEST.json`. Derived text in `summaries/_extracted/` is never
  cited here.
- **Not complete.** 23 of 27 document nodes have
  **no official source yet** and say so.

## 3. Node types

| type | count |
|---|---|
| `accountant_review_flag` | 1 |
| `company_profile_field` | 14 |
| `compliance_rule_candidate` | 5 |
| `evidence_requirement` | 8 |
| `filing_package_field` | 5 |
| `missing_data_question` | 32 |
| `official_source` | 75 |
| `required_document` | 27 |
| `risk_flag` | 4 |
| `tax_rule_candidate` | 18 |
| `transaction_type` | 18 |

## 4. Edge types

| type | count |
|---|---|
| `amends` | 1 |
| `cannot_prove` | 4 |
| `currentness_supported_by` | 6 |
| `derives_from` | 44 |
| `feeds_filing_package` | 10 |
| `has_risk` | 26 |
| `may_apply_to` | 22 |
| `needs_reviewer` | 14 |
| `raises_missing_question` | 32 |
| `related_to` | 30 |
| `requires_accountant_review` | 18 |
| `requires_company_profile_field` | 19 |
| `requires_document` | 74 |
| `supports` | 20 |

Every edge carries `relationship_basis`:

- **`official_source`** — the link is supported by archived official bytes, with `source_ids`.
- **`product_interpretation`** — the link is our product design, not something a regulation says.

Both still carry `review_required: true` and neither sets `legal_verified`.

## 5. High-value paths

```
Rent invoice
  → txn:rent --may_apply_to--> tax:TAX_ID_PPH42_RENTAL_001   (10% final)
                             --derives_from--> src:DJP_PPH42_PP34_004   (PP 34/2017 Pasal 4(1)-(2))
  → --requires_document--> doc:rental_agreement, doc:bukti_potong, doc:payment_proof
  → --requires_company_profile_field--> cpf:pkp_status, cpf:tax_id_npwp
  → --has_risk--> risk:mixed_treatment
  → --requires_accountant_review--> flag:accountant_review
```

```
Service fee
  → txn:service_fee --may_apply_to--> tax:TAX_ID_PPH23_LEGAL_001   (2%, gross excl. PPN)
                                    --derives_from--> src:DJP_PPH23_PMK141_003   (PMK 141/2015 Pasal 1(1))
  → --requires_document--> doc:vendor_npwp, doc:bukti_potong
  → --has_risk--> risk:entity_vs_individual        (PPh 21 vs PPh 23 — src:DJP_PPH23_005)
  → --requires_accountant_review--> flag:accountant_review
```

```
Equipment / CAPEX
  → txn:equipment_capex --may_apply_to--> tax:unmapped:ppn   (no source-backed candidate)
  → --requires_document--> doc:asset_purchase_invoice, doc:delivery_note_goods_receipt
  → --cannot_prove--> risk:rate_unsourced          (no official source collected at all)
  → --requires_accountant_review--> flag:accountant_review
```

Currentness and amendment are modelled where evidenced:

```
src:DJP_PPN_007 --amends--> src:DJP_PPN_001        (PMK 53/2025 amends PMK 11/2025, eff. 2025-08-01)
src:DJP_PPH42_PP34_004 --currentness_supported_by--> src:BPK_PPH42_PP34_002   (status "Berlaku")
```

> `revokes` edges are **deliberately absent**. PP 34/2017 revokes PP 5/2002 and PP 29/1996, and
> PMK 141/2015 revokes PMK 244/2008 — but those revoked instruments are not registry sources, and an
> edge may not point at a node that does not exist. The facts are recorded in the summaries instead.

## 6. Invoice Review examples

| Invoice | Graph answer | What it must NOT do |
|---|---|---|
| Landlord invoice, rent + service charge on one line | `txn:mixed:rent_plus_service_charge` → `risk:mixed_treatment` → accountant review | Apply 10% to the whole invoice |
| Paralegal fee from a PT | `txn:service_fee` → PPh 23 candidate 2% excl. PPN → needs `doc:vendor_npwp` | Assume 2% before knowing the vendor is an entity |
| Paralegal fee from an individual | `risk:entity_vs_individual` fires | Treat it as PPh 23 |
| SaaS subscription from abroad | `txn:software_subscription`, rate `null` | Guess PPh 23 vs PPh 26 vs royalty |
| Import invoice | `cannot_prove` → `risk:rate_unsourced` | Suggest any rate |

## 7. Company Profile examples

14 profile fields are modelled. They are *inputs that decide which branch
of the graph applies* — the graph shows the dependency, nothing more.

```
cpf:employees_yes_no        → txn:salary_payroll        → comp:COMP_ID_BPJS_001
cpf:pkp_status              → txn:service_fee, txn:rent, txn:equipment_capex
cpf:kbli_code               → comp:COMP_ID_KBLI_001, comp:COMP_ID_LICENCE_RISK_001
cpf:foreign_ownership_yes_no→ txn:intercompany_payment  → comp:COMP_ID_LKPM_001
cpf:tax_id_npwp             → txn:service_fee, txn:rent
```

None of these is wired to a backend field. `counterparties` still has **no NPWP column**, which is
why `doc:vendor_npwp` is `missing_source` and why `risk:entity_vs_individual` cannot be resolved
from data we hold.

## 8. Known gaps

- **23 of 27 document nodes have no official source.**
  Sourced: `bukti potong`, `faktur pajak`, `payroll docs`, `rental agreement`.
  Everything else is `source_status: missing_source`, `needs_reviewer: true`.
- **10
  transaction types carry no rate**, four of them with no collected source whatsoever
  (equipment/CAPEX, import, loan interest, intercompany).
- **Filing package fields are placeholders** (`source_status: not_designed`). Nothing about filing
  has been designed or sourced.
- The rent-vs-service-charge boundary remains **unresolved** — see `../gap_register.md` gap 9.

## 9. Rules that must stay under_review

Everything. Concretely, the graph must keep these invariants, and
`../tools/validate_kb.py` enforces them:

1. Every node has a unique id; every edge resolves to existing nodes.
2. Every `source_ids` entry exists in the registry, and none points at `_extracted`.
3. Every edge has `status: under_review`, `active: false`, `legal_verified: false`.
4. Every edge declares a `relationship_basis` and `review_required: true`.
5. The counts stated in this file match the JSON.

## 10. Future UI: Internal Knowledge Atlas

Not built, and deliberately out of scope. When it is built, the intended reading is that a node's
colour encodes `relationship_basis` and `source_status`, so an atlas view shows at a glance how much
of the map rests on archived law versus product interpretation. On today's data that view would be
mostly interpretation — which is the honest picture and the reason the graph exists before the UI.
