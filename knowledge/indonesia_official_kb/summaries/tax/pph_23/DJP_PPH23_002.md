# Source

- **source_id:** `DJP_PPH23_002`
- **title:** Pemotongan Pajak Penghasilan - Pasal 23
- **authority:** DJP
- **official_url:** https://www.pajak.go.id/en/node/35004
- **source_type:** official_guidance
- **trust_level:** official_guidance
- **verification_status:** `fetch_verified`
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/pph_23/DJP_PPH23_002.html`
- **sha256:** `7cf184691b72f0d69401fda511af0c9a89a39258253b04ad492fc15854268143`

# What this source supports

This source appears to support a PPh 23 withholding candidate for services. **The source states**
that a payer of service fees should check whether the service is a PPh 23 object under
**PMK-141/PMK.03/2015**, withhold **2% of the *jumlah bruto* of the service value**, issue a bukti
potong through e-bupot, and report by the 20th of the following month.

Needs reviewer confirmation before any of this drives a calculation.

# Extracted facts

| Fact | Where | Confidence | needs_reviewer |
|---|---|---|---|
| Services: withhold 2% of *jumlah bruto nilai jasa* | archived page, PPh 23 procedure section | medium | true |
| Object list determined by PMK-141/PMK.03/2015 | same | medium | true |
| Royalti: 15% of *jumlah bruto* | rate table | medium | true |
| No NPWP → rate 100% higher, since 1 Jan 2009 | rate table note | medium | true |
| Bukti potong issued via e-bupot | procedure | medium | true |
| Reporting by the 20th of the following month | procedure | medium | true |
| Finance lease with option right excluded per Pasal 23(4)(b) UU 36/2008 | rate table | medium | true |

# Tax Engine relevance

- **Transaction types:** service purchases from entities (`vendor_invoice` → payable).
- **Rule candidates:** `TAX_ID_PPH23_LEGAL_001`, `TAX_ID_PPH23_PROFESSIONAL_002`.
- **Evidence:** supplier invoice, bukti potong, payment proof.
- **Risk:** the no-NPWP variant doubles the rate, and our `counterparties` table has no NPWP field.

# What this source does NOT prove

- **It does not say the base excludes PPN.** The page says *jumlah bruto*. A previous draft of our
  candidate recorded `gross_excluding_vat`; that was not supported by this page and has been
  corrected to `needs_reviewer`.
- It does not confirm that **legal or paralegal** services are in the *jasa lain* list — that list
  lives in PMK-141/PMK.03/2015, which was **not retrieved**.
- It is DJP **guidance**, not the regulation. It cannot be the sole basis for activating a rule.
- It does not state which party is the withholder in every arrangement.

# Reviewer questions

1. Is the DPP the gross invoice value, or the value excluding PPN?
2. Are legal/paralegal services inside the PMK-141 *jasa lain* list?
3. Is the no-NPWP 100% uplift still current, and does it apply to all PPh 23 objects?
