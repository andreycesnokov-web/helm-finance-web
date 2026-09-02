# Invoice Review Matrix V1

> **This is a review matrix, not a tax advice engine.**

Generated **2026-09-02** from `rule_candidates/invoice_transaction_candidates.json`. The two are
generated together so they cannot drift; the candidates file is the working record, this is the
review-facing view.

Every row: `status: under_review` · `legal_verified: false` · `active: false` ·
`accountant_review_required: true`. A rate or base appears **only** where archived official bytes
support it. Nothing here is wired into the product, and nothing here may be activated.

## The matrix

| # | Transaction type | Possible treatment | Rate | Base | Conf. | Sources |
|---|---|---|---|---|---|---|
| 1 | **Rent** | PPh 4(2) final | **10%** | `jumlah_bruto_nilai_persewaan_including_service_and_facility_charges` | medium | `DJP_PPH42_PP34_004` `BPK_PPH42_PP34_001` `DJP_PPH42_002` |
| 2 | **Service fee** | PPh 23 | **2%** | `jumlah_bruto_excluding_ppn` | medium | `DJP_PPH23_PMK141_003` `KEMENKEU_PPH23_PMK141_001` `DJP_PPH23_002` |
| 3 | **Management service** | PPh 23 | **2%** | `jumlah_bruto_excluding_ppn` | low | `DJP_PPH42_006` `DJP_PPH23_PMK141_003` |
| 4 | **Building service / service charge** | PPh 4(2) final, PPh 23 | `null` | `needs_reviewer` | low | `DJP_PPH42_PP34_004` `DJP_PPH42_006` |
| 5 | **Contractor / freelancer** | PPh 23, PPh 21 | `null` | `needs_reviewer` | low | `DJP_PPH23_005` `DJP_PPH23_PMK141_003` |
| 6 | **Salary / payroll** | PPh 21 | `null` | `needs_reviewer` | low | `KEMENKEU_PPH21_001` |
| 7 | **Marketing / advertising** | PPh 23 | `null` | `needs_reviewer` | low | `DJP_PPH23_PMK141_003` |
| 8 | **Software subscription** | PPh 23, PPh 26, PPN | `null` | `needs_reviewer` | low | `DJP_PPH23_PMK141_003` |
| 9 | **Equipment / CAPEX** | PPN | `null` | `needs_reviewer` | low | _none_ |
| 10 | **Import-related invoice** | PPh 22, PPN Impor, bea masuk | `null` | `needs_reviewer` | low | _none_ |
| 11 | **Loan interest** | PPh 23, PPh 26 | `null` | `needs_reviewer` | low | _none_ |
| 12 | **Intercompany payment** | PPh 23, PPh 26, transfer pricing | `null` | `needs_reviewer` | low | _none_ |
| 13 | **Mixed invoice** | multiple | `null` | `needs_reviewer` | high | `DJP_PPH42_PP34_004` `DJP_PPH42_006` `DJP_PPH23_PMK141_003` |

## What is actually source-supported

Only **three** rows carry a rate, and each is cited to operative regulation text read from archived bytes:

| Row | Rate | Base | Citation |
|---|---|---|---|
| Rent | 10% **final** | gross **incl.** service/facility charges | PP 34/2017 Pasal 4(1)–(2) — `DJP_PPH42_PP34_004` |
| Service fee | 2% | gross **excl. PPN** | PMK 141/2015 Pasal 1(1) — `DJP_PPH23_PMK141_003` |
| Management service | 2% | gross **excl. PPN** | same PMK, but see the boundary risk below |

The other ten rows are deliberately `null` / `needs_reviewer`. Four (`equipment_capex`,
`import_related_invoice`, `loan_interest`, `intercompany_payment`) have **no collected source at all** and are
marked `source_verification_status: not_sourced`.

## High-risk rows

Three rows must always route to a human, and the matrix records why:

- **Building service / service charge** — `engine_behaviour: always_review`. PP 34/2017 Pasal 4(2) pulls a
  landlord-billed service charge *into* the 10% rental base even when separately contracted, while
  `DJP_PPH42_006` puts *third-party* building services at 2% under Pasal 23. Both are archived and read.
  Our reading is that the test is **who pays whom** — that reading is ours, not the regulation's.
- **Mixed invoice** — a single invoice can legitimately carry two treatments. The engine must say
  *"This invoice may contain mixed tax treatments. Accountant review required."* and must **not** apply one
  rate to the whole invoice.
- **Software subscription** — PMK 141 item (u) covers software/hardware/system services *including*
  maintenance, but a pure licence may instead be a royalty, and a non-resident supplier may be PPh 26.

## What this matrix does NOT do

- It does not decide anything. Every row requires an accountant.
- It does not assert a rate the archived bytes do not support.
- It is not connected to AI Invoice Review, and must not be until rules are activated through
  `taxGate` with a licensed reviewer.
- It carries no legal verification. `currentness_result: berlaku` on some rows records what an official
  status page *said* on the checked date — publication status only.

## Open questions carried by the matrix

- _Rent_ — Is the tenant a Pemotong under PP 34/2017 Pasal 3(2)?
- _Rent_ — Does the invoice include charges billed by a THIRD PARTY rather than the landlord?
- _Rent_ — Is any part of this lodging/accommodation (excluded from the final regime)?
- _Service fee_ — Is the supplier an ENTITY (badan) or an individual? Individual may be PPh 21, not PPh 23.
- _Service fee_ — Does the supplier have an NPWP? (uplift may apply)
- _Service fee_ — Which enumerated jasa lain item does this service fall under?
- _Management service_ — Who pays whom? Landlord->third party differs from tenant->landlord.
- _Management service_ — Is this billed as part of rent by the landlord (then PPh 4(2)) or separately by a manager (then PPh 23)?
- _Building service / service charge_ — Is this charge billed by the landlord or by a separate manager?
- _Building service / service charge_ — Is it contracted separately from the lease?
- _Building service / service charge_ — Does the tenant pay the manager directly?
- _Contractor / freelancer_ — Is the provider an individual (PPh 21) or an entity (PPh 23)?
- _Contractor / freelancer_ — If an entity, which jasa lain item applies?
- _Salary / payroll_ — Is the employee permanent or non-permanent?
- _Salary / payroll_ — Which TER category applies?
- _Marketing / advertising_ — Which enumerated jasa lain item covers this?
- _Marketing / advertising_ — Is any part media placement rather than a service?
- _Software subscription_ — Is the supplier resident or non-resident? Non-resident may be PPh 26, not PPh 23.
- _Software subscription_ — Is this a licence/royalty or a service?
- _Software subscription_ — Is PPN-PMSE charged by a foreign provider?
- _Equipment / CAPEX_ — Is this goods only, or goods plus installation service?
- _Equipment / CAPEX_ — Is the supplier PKP?
- _Import-related invoice_ — Which customs document evidences this?
- _Import-related invoice_ — Is PPh 22 import collected at the border?
- _Loan interest_ — Is the lender a domestic entity, a bank, or non-resident?
- _Loan interest_ — Is a tax treaty in play?
- _Intercompany payment_ — Is the counterparty domestic or foreign?
- _Intercompany payment_ — Is this a service, a royalty, interest, or a capital movement?
- _Intercompany payment_ — Are the parties related for transfer-pricing purposes?
- _Mixed invoice_ — Which invoice lines belong to which component?
- _Mixed invoice_ — Is there one agreement or several?
- _Mixed invoice_ — Who is the counterparty for each component?

Answers belong in `../reviewer_notes.md` against the relevant `source_id`s.
