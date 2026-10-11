# Reviewer notes — questions for the Indonesian tax consultant / accountant

Prepared 2026-09-02 from the first collection pass. Nothing below is a claim; every item is a
question. Answers should be recorded against the `source_id`s listed, and only then may a candidate
move out of `under_review`.

**Please answer against the primary regulation text (UU / PP / PMK / PER), not a DJP explanatory
page.** Where a DJP page is the only thing we found, that is flagged.

---

## 0. Before anything else — who are you, formally?

The database will not accept an approved rule review without these, and the licence must be verified
by a different person than the reviewer:

- Reviewer full name
- Licence number and licence type
- Issuing authority
- Scope you are willing to sign off (e.g. PPh 23 only? PPN too?)
- Any expiry date on that sign-off

---

## 1. PPh 23 — services (Test Case 1: paralegal / legal invoice)

Candidates: `TAX_ID_PPH23_LEGAL_001`, `TAX_ID_PPH23_PROFESSIONAL_002`

1. Is **2%** of DPP correct for legal / paralegal / professional services today, and under which
   PMK? DJP pages cite PMK-141/PMK.03/2015 — is that still the operative list?
2. Is the DPP **the invoice value excluding PPN**? Confirm precisely — this decides whether we
   compute withholding on gross or on the ex-VAT base.
3. Does a supplier **without NPWP** attract a 100% higher rate (4%)? Does that apply to all PPh 23
   objects or only some?
4. Do "legal" and "paralegal" services actually fall inside the *jasa lain* list, or are they taxed
   under a different article? (`DJP_PPH23_003`)
5. **Entity vs individual:** if the supplier is an individual rather than a company, does this
   become PPh 21 instead? (`DJP_PPH23_005` suggests this is commonly confused.) What test should the
   engine apply — and can it even be applied from data we hold?
6. Is there any minimum transaction threshold? (`DJP_PPH23_007` implies not — confirm.)
7. Who issues the bukti potong, in what timeframe, and via Coretax e-Bupot?

## 2. PPh 4(2) — rental (Test Case 2: Alfamart / sewa tempat)

Candidate: `TAX_ID_PPH42_RENTAL_001`

1. Is **10% final** correct for land/building rental, and under which PP?
   **We did not retrieve the governing PP — this is our single biggest gap.**
2. Confirm the **gross** definition. DJP guidance suggests it includes maintenance, security and
   service charges. This is material: a tenant invoice often separates base rent from service
   charge.
3. `DJP_PPH42_006` warns about mis-rating building service charges. **When does a service charge
   fall under PPh 4(2) rental versus PPh 23 services?** This is the highest-value question in this
   document for our product.
4. **Who withholds?** Guidance says the tenant withholds if it is a designated withholder, otherwise
   the landlord self-remits. What is the exact test, and does a PT tenant always qualify?
5. Because this tax is **final**, how should it appear in the payable? It is not a creditable
   withholding, so the accounting differs — should net-to-landlord be the recorded payable, or gross
   with a separate remittance liability?
6. What evidence must the tenant hold and what must it issue? (bukti potong, payment proof, SSP?)

## 3. PPN / VAT

Candidates: `TAX_ID_PPN_OUTPUT_001`, `TAX_ID_PPN_INPUT_002`

1. **What is the current position?** PMK 11/2025 (verified, effective 2025-02-04) sets a 11/12 DPP
   nilai lain, giving 12% × 11/12 for non-luxury. But `DJP_PPN_007` is an **amendment** we have not
   read. Which instrument governs today, and what is the effective rate on an ordinary commercial
   service invoice?
2. Does the 11/12 construction apply to **services** as well as goods?
3. For a rental invoice from a PKP landlord, what is the correct PPN treatment and DPP?
4. **Input VAT creditability:** what conditions must be met, and which PER governs faktur pajak? We
   found no faktur pajak PER — please point us at it.
5. Our codebase has `{"rate":0.11}` hardcoded from 2026. Is that value defensible today, or must it
   be replaced?

## 4. PPh 21 — payroll

Candidate: `TAX_ID_PPH21_PAYROLL_001`

1. Is PMK 168/2023 (TER) still current?
2. We have deliberately set `rate: null` because TER is a lookup table. **Do you agree PPh 21 should
   be out of scope for automated calculation in v1**, and handled as an evidence/compliance
   requirement only?
3. What payroll documents must an employer retain as evidence?

## 5. PPh Badan

Candidates: `TAX_ID_PPHBADAN_UMKM_001`, `TAX_ID_PPHBADAN_GENERAL_002`

1. UMKM final **0.5%** — confirm rate, the Rp4.8bn threshold, and the eligibility period.
2. How do PP 55/2022 and **PP 20/2026** (`DJP_PPHBADAN_003`) interact? The latter is described as
   making 0.5% permanent for individuals — does anything change for a PT?
3. **General corporate rate:** we collected no source. Our codebase seeds 22%. Is that current, and
   what facilities (e.g. small-turnover reductions) apply?

## 6. Evidence requirements

Candidates in `rule_candidates/evidence_rule_candidates.json`

For each of: faktur pajak, bukti potong, kwitansi, payment proof, bank statement —

1. Is there an **official** required-field list, or are these accounting practice rather than law?
2. Which are legally required to be *held* by the taxpayer, and for how long?
3. What is the actual consequence of a missing bukti potong for (a) the withholder, (b) the
   counterparty?

We have marked several as `"needs official source"` rather than invent requirements. Please tell us
which are genuinely legal obligations.

## 7. Compliance

Candidates in `rule_candidates/compliance_rule_candidates.json`

1. **LKPM:** is the Rp500,000,000 threshold and the 10th-of-month deadline current? Ours come from a
   2021 period-specific announcement and we have explicitly refused to generalise them.
2. **BPJS:** we collected Ketenagakerjaan only. What are the employer obligations and thresholds for
   **BPJS Kesehatan**?
3. **PT PMA:** we found no PMA-specific registration source. What should we be reading?
4. Does KBLI selection alone determine the licence set, or are there sectoral permits outside OSS?

## 8. Process questions for us, not tax questions

1. Which **one** rule should we activate first? Our recommendation is PPh 23 services, because it
   drives Test Case 1 and is the most common supplier situation.
2. Are you willing to be recorded as the reviewer for that rule, with licence details stored?
3. How often should activated rules be re-verified, and what should trigger a re-review?
