# Source

- **source_id:** `DJP_PPH42_PP34_004`
- **title:** Pajak Penghasilan atas Penghasilan dari Persewaan Tanah dan/atau Bangunan (teks PP 34/2017 di DJP)
- **authority:** DJP
- **official_url:** https://www.pajak.go.id/index.php/en/node/59057
- **source_type:** regulation
- **trust_level:** regulation
- **verification_status:** `fetch_verified`
- **document_number:** PP 34 Tahun 2017
- **effective_from:** 2018-01-02
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/pph_4_2/DJP_PPH42_PP34_004.html`
- **sha256:** `c0da95b7cf5c2408ea9241ef702d436a33dabb3c9073eaca851e3ba0bd4d0e33`

> **Status: `under_review`. Not legally verified.** Quotations below are from the archived bytes named above. Nothing here is tax advice and no rule may be activated on this document alone.

# What this source proves

This is the **operative text of PP 34/2017**, rendered as HTML by DJP and read from archived bytes.
It closes the Phase-1 blocker "PPh 4(2) governing source not retrieved".

**The source states:**

- **Pasal 2(1)** — income from renting land and/or a Bangunan, whole or part, received by an
  individual or an entity, is subject to income tax that is **final**.
- **Pasal 4(1)** — the tax is *"10% (sepuluh persen) dari jumlah bruto nilai persewaan tanah
  dan/atau Bangunan"*.
- **Pasal 4(2)** — *jumlah bruto* is **all** amounts paid or acknowledged as owed by the Penyewa, in
  any name or form, relating to the rented land/building, **including** *biaya perawatan, biaya
  pemeliharaan, biaya keamanan, biaya layanan, dan biaya fasilitas lainnya* — and expressly
  *"baik yang perjanjiannya dibuat secara terpisah maupun yang disatukan"* (whether contracted
  separately or combined).
- **Pasal 3(1)–(2)** — the **Penyewa withholds** where it acts as, or is appointed, a Pemotong;
  Pemotong includes *badan pemerintah* and *subjek pajak badan dalam negeri*.
- Income from *jasa pelayanan penginapan beserta akomodasinya* is **excluded** from this final regime.

# Extracted facts

| Fact | Article | Confidence | needs_reviewer |
|---|---|---|---|
| Rental of land/building is FINAL income tax | Pasal 2(1) | high | true |
| Rate 10% of *jumlah bruto nilai persewaan* | Pasal 4(1) | high | true |
| Gross **includes** maintenance, security, service and facility charges | Pasal 4(2) | high | true |
| Gross includes them **whether contracted separately or combined** | Pasal 4(2) | high | true |
| Tenant withholds when acting/appointed as Pemotong | Pasal 3(1) | high | true |
| Pemotong includes domestic corporate taxpayers | Pasal 3(2) | high | true |
| Lodging services with accommodation excluded | Pasal 2 | high | true |
| Effective 2 January 2018 | promulgation | high | false |

# Tax Engine relevance

- **Directly answers the Phase-1 mixed-invoice question for the landlord leg.** A service charge
  billed by the landlord in connection with the rented property is inside the 10% rental base, even
  when it sits on a separate contract or a separate invoice line.
- **This does NOT dissolve the mixed-invoice risk.** `DJP_PPH42_006` describes a *different leg*:
  fees paid by the **building owner to a third-party provider** are *jasa manajemen* under PPh 23.
  Reading the two together suggests the test is **who pays whom**, not what the line is called —
  but that reading is ours, not the regulation's, and must be confirmed.
- Because the tax is **final**, it is not a creditable withholding and must not be modelled as a
  simple deduction.

# What this source does NOT prove

- It does **not** address a tenant paying a third party directly for services at the premises.
- It does **not** state the PPN treatment of rent.
- It does **not** give the complete list of appointed Pemotong (Pasal 3(2) continues beyond what we
  quote, and the appointment of individual taxpayers is delegated to a PMK).
- It does not tell us whether later instruments have amended it.

# Reviewer questions

1. Confirm PP 34/2017 is still in force and unamended.
2. Where a tenant pays a **third-party** manager directly, is that PPh 23 (jasa manajemen) rather
   than rental — i.e. is "who pays whom" the correct test?
3. Which PMK appoints individual taxpayers as Pemotong?
4. Given the tax is final, should our payable record gross or net?

# Currentness evidence

- **currentness_status_source:** `BPK_PPH42_PP34_002`, `KEMENKEU_PPH42_PP34_003`
- **currentness_checked_at:** 2026-09-02
- **currentness_result:** `berlaku`

BPK details page records **"Status Berlaku"**, Tanggal Berlaku 02 Januari 2018, and under
"STATUS PERATURAN" only **outgoing** relations — PP 34/2017 *mencabut* PP 5/2002 and PP 29/1996.
JDIH Kemenkeu records **"Tanggal Berlaku 06 Sep 2017 – s.d. Dicabut"** (in force *until revoked*)
and a "Riwayat Dokumen (2)" in which both entries are outgoing *Mencabut*.

**No incoming amendment or revocation is recorded on either page** as of the retrieval date.

Still `under_review`. **Not** `legally_verified`. Accountant/legal reviewer confirmation required
before activation.
