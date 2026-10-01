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

---

# Verification pass v1 — 2026-09-02

22 of 23 priority sources were downloaded, SHA-256 hashed and title-confirmed. Three findings
change what we previously believed. **Please read this section before the questions above.**

## Corrections we made to ourselves

1. **PPh 23 base was wrong in our draft.** We had recorded `gross_excluding_vat`. The archived DJP
   page says only *"2% dari jumlah bruto nilai jasa"* — it does **not** say excluding PPN. The
   candidate is now `base: "needs_reviewer"`. **Q: is the DPP gross, or gross excluding PPN?**

2. **PPN had no supportable rate.** We had `rate: 0.12` with an 11% effective variant, taken from DJP
   explanatory pages. We then retrieved and text-extracted the **primary regulation** (PMK 11/2025).
   It does **not state a rate at all** — it refers to Pasal 7(1) of the VAT Law — and it applies the
   11/12 construction only to **enumerated categories** (self-use, gratuitous transfer, film,
   inventory, intermediary sales). We have set `rate: null`.
   **Q: for an ordinary commercial service invoice, what is the correct DPP and rate today?**

3. **The PPN amendment is identified.** It is **PMK Nomor 53 Tahun 2025**, and Pasal II states it
   *"mulai berlaku pada tanggal 1 Agustus 2025"*. **Q: what is the consolidated position after
   1 August 2025, and is anything newer than PMK 53/2025 in force?**

## Gap register

| # | Gap | Status after this pass | Severity | Why it matters | Next step |
|---|---|---|---|---|---|
| 1 | PPh 4(2) rental **PP** not retrieved | **still open** | **blocker** | 10% final drives Test Case 2; guidance alone cannot activate a rule | Search `peraturan.bpk.go.id` for the PP on *persewaan tanah dan/atau bangunan* |
| 2 | Faktur pajak required fields | **still open** | **important** | Blocks input-VAT creditability and evidence rules | Look for a **PER** (Peraturan Dirjen Pajak) on faktur pajak on `pajak.go.id/peraturan` |
| 3 | PPN current treatment | **partly closed** | important | Amendment now identified as PMK 53/2025 eff. 2025-08-01 | Retrieve the full PMK 53/2025 text from `jdih.kemenkeu.go.id` |
| 4 | PMK-141/PMK.03/2015 *jasa lain* list | **still open** | **blocker** | Decides whether legal/paralegal is even a PPh 23 object | `jdih.kemenkeu.go.id` search for PMK 141/PMK.03/2015 and any replacement |
| 5 | PT PMA sources | **still open** | later | Company Vault context only; no tax effect modelled | `bkpm.go.id` / `oss.go.id/regulasi` |
| 6 | BPJS Kesehatan sources | **still open** | later | Employer obligation completeness | `bpjs-kesehatan.go.id` (note: this domain was **not** in our allowlist; confirm the correct official host) |
| 7 | General PPh Badan rate | **still open** | important | Our code seeds 22% with no source | `peraturan.bpk.go.id` for UU PPh consolidated + current PP/PMK |
| 8 | NPWP / no-NPWP variants | **partly closed** | important | Doubles the rate; we still have no counterparty NPWP field | Confirm against PMK-141 text (gap 4) |
| 9 | Rent vs service-charge classification | **partly closed** | **blocker for Test Case 2** | A mixed invoice may carry two different taxes | See below |

## New question, and it is the important one

`DJP_PPH42_006` (fetch-verified) states that building services supplied by a **third-party provider**
are *jasa manajemen*, taxed at **2% under Pasal 23** — not as rental under PPh 4(2).

So a rental invoice that bundles base rent and a service charge may carry **two different taxes**.

**Q9a.** What is the general test for rent versus service charge?
**Q9b.** If a single invoice contains both, must they be split, and on what basis?
**Q9c.** Does the answer change when the landlord provides the services directly rather than through
a third party?

We have flagged this in the candidate as `related_risk.severity: high` and the engine must not apply
a single rate to a mixed rental invoice.

## Two files we hold but cannot read

Both were downloaded and hashed, but have **no embedded text layer**, so nothing in this KB is
derived from them:

- `DJP_BUPOT_001` — Coretax bukti potong manual (2.8 MB)
- `KEMENKEU_PPH21_001` — PMK 168/2023 (5.4 MB)

**Q: can you read these and confirm the bukti potong required fields?** They are in
`raw_sources/tax/` with hashes recorded.

---

# Phase 2 — 2026-09-02

Both Phase-1 blockers are closed with **operative regulation text read from archived bytes**.

## What changed

1. **PPh 4(2) — PP 34/2017 obtained and read.** Pasal 4(1): 10% of *jumlah bruto nilai persewaan*.
   Pasal 4(2): gross **includes** maintenance, upkeep, security, service and facility charges,
   *"baik yang perjanjiannya dibuat secara terpisah maupun yang disatukan"*. Pasal 3: the tenant
   withholds where it is a Pemotong. Lodging with accommodation is excluded.

2. **PPh 23 — PMK 141/PMK.03/2015 obtained and read.** *"2% dari jumlah bruto **tidak termasuk Pajak
   Pertambahan Nilai**"*, and the enumerated list includes **(d) Jasa hukum**.

3. **We corrected our own correction.** Phase 1 downgraded the PPh 23 base to `needs_reviewer`
   because the DJP guidance page said only *jumlah bruto*. The regulation is explicit that PPN is
   excluded. The base is now cited to primary text — still `under_review`.

## The one question everything now rests on

**Q: Is PMK 141/PMK.03/2015 still current, and is PP 34/2017 unamended?**

Both candidates are now cited to these two instruments. If either has been superseded, both
candidates fall. We could not establish currency from the archived pages.

## Other new questions

- **Q:** Where does the no-NPWP 100% uplift come from? It is **not** in PMK 141/2015 — DJP guidance
  attributes it to the UU. Which article?
- **Q:** Does a paralegal engagement fall within *jasa hukum* (item d)? The PMK does not define it.
- **Q:** Mixed invoices — is "who pays whom" the correct boundary between PP 34/2017 rental gross and
  PPh 23 *jasa manajemen*? See `gap_register.md` gap 9.
- **Q:** Software subscriptions — PMK 141 item (u) covers software/hardware/system services including
  maintenance. Is a pure SaaS licence a service under (u), or a royalty?
- **Q:** Confirm the interlock: rent taxed finally under PP 34/2017 is excluded from PPh 23 by the
  final-PPh exemption in PMK 141 Pasal 1(2)?

## Still unreadable

`DJP_BUPOT_001` and `KEMENKEU_PPH21_001` remain archived, hashed and **not readable here**. Diagnostics
are recorded in `raw_sources/MANIFEST.json` under `not_chunkable`. OCR was **not** attempted: no OCR
tooling is available in this environment, and hand-rolling a font decoder risks producing
plausible-looking garbage in a legal KB. **Q: can you read these two and confirm the bukti potong
required fields?**

## BPJS

`BPJS source target` is now **confirmed**: `www.bpjs-kesehatan.go.id`. The allowlisted
`bpjskesehatan.go.id` does not resolve. No content collected yet.
