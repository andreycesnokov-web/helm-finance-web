# Source

- **source_id:** `DJP_PPH42_002`
- **title:** Pemotongan Pajak Penghasilan - Pasal 4 Ayat (2)
- **authority:** DJP
- **official_url:** https://pajak.go.id/en/node/35022
- **source_type:** official_guidance
- **trust_level:** official_guidance
- **verification_status:** `fetch_verified`
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/pph_4_2/DJP_PPH42_002.html`
- **sha256:** `42de5946abca061c98b7fbb41111e9166326acb5af1abfd44775543408a9b189`

# What this source supports

This source appears to support a PPh 4(2) final-tax candidate for land and building rental.
**The source states** that a Wajib Pajak Badan renting land/buildings must withhold
**10% of the *jumlah bruto* of the rental value**, issue a bukti potong via e-SPT PPh 4(2), and
deposit using billing code **MAP-KJS 411128-403**.

# Extracted facts

| Fact | Where | Confidence | needs_reviewer |
|---|---|---|---|
| Rental of land/buildings: 10% of *jumlah bruto nilai persewaan* | archived page, sewa section | medium | true |
| The tenant (Wajib Pajak Badan) performs the withholding | same | medium | true |
| Where the counterparty is an Orang Pribadi, the recipient self-deposits 10% | same page | medium | true |
| Bukti potong via e-SPT PPh 4(2) | procedure | medium | true |
| Billing code MAP-KJS 411128-403 | procedure | medium | true |
| Treated as PPh **Final** | page framing ("PPh Final Pasal 4 Ayat 2") | medium | true |

# Tax Engine relevance

- **Transaction types:** rental / sewa tempat (`vendor_invoice` → payable).
- **Rule candidate:** `TAX_ID_PPH42_RENTAL_001`.
- **Evidence:** rental agreement, invoice/kwitansi, faktur pajak if the landlord is PKP, bukti
  potong, payment proof.
- **Risk:** because it is **final**, it is not an ordinary creditable withholding and the accounting
  treatment differs. The engine must not model it as a simple deduction.

# What this source does NOT prove

- **It does not define what *jumlah bruto* includes.** Specifically it does **not** confirm whether
  service charges, maintenance or security fees are inside the rental base. This is the central
  open question for Test Case 2 and remains unresolved.
- It does not state the governing **PP** — the primary regulation was not retrieved.
- It does not give the full test for which tenants are designated withholders.
- It is guidance, not regulation.

# Reviewer questions

1. Which PP governs this, and is 10% current?
2. Does *jumlah bruto* include service/maintenance charges billed alongside rent?
3. What is the exact test for "tenant must withhold"?
4. Given it is final, should our payable record gross or net?
