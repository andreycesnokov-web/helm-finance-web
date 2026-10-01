# Source

- **source_id:** `DJP_PPH23_PMK141_003`
- **title:** Jenis Jasa Lain sebagaimana dimaksud dalam Pasal 23 ayat (1) huruf c angka 2 UU PPh (teks PMK 141/2015 di DJP)
- **authority:** DJP
- **official_url:** https://www.pajak.go.id/en/node/63200
- **source_type:** regulation
- **trust_level:** regulation
- **verification_status:** `fetch_verified`
- **document_number:** 141/PMK.03/2015
- **effective_from:** 2015-07-24
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/pph_23/DJP_PPH23_PMK141_003.html`
- **sha256:** `21ce9d3d7991b109aad027a53b8c0c1e30bee3c95013faa74c50f0e4f41a10d1`

> **Status: `under_review`. Not legally verified.** Quotations below are from the archived bytes named above. Nothing here is tax advice and no rule may be activated on this document alone.

# What this source proves

This is the **operative text of PMK 141/PMK.03/2015**, rendered as HTML by DJP and read from
archived bytes. It closes the Phase-1 blocker "PMK-141 *jasa lain* list missing" **and** resolves
the Phase-1 base question.

**The source states:**

- Imbalan for *jasa lain* not already withheld under Pasal 21 is withheld at
  *"2% (dua persen) dari jumlah bruto **tidak termasuk Pajak Pertambahan Nilai**"*.
- It is **exempted** where the imbalan is already subject to **final** PPh.
- The enumerated *jenis jasa lain* list includes, in order: *a. Jasa penilai (appraisal); b. Jasa
  aktuaris; c. Jasa akuntansi, pembukuan, dan atestasi laporan keuangan;* **d. Jasa hukum**;
  *e. Jasa arsitektur; f. Jasa perencanaan kota dan arsitektur landscape; g. Jasa perancang
  (design); … n. Jasa penyedia tenaga kerja dan/atau tenaga ahli (outsourcing services); o. Jasa
  perantara dan/atau keagenan; … u. Jasa sehubungan dengan software atau hardware atau sistem
  komputer, termasuk perawatan, pemeliharaan dan perbaikan; …*

# Extracted facts

| Fact | Article | Confidence | needs_reviewer |
|---|---|---|---|
| Rate 2% of *jumlah bruto* | Pasal 1(1) | high | true |
| **Base EXCLUDES PPN** (*tidak termasuk Pajak Pertambahan Nilai*) | Pasal 1(1) | high | true |
| Exempt where already subject to final PPh | Pasal 1(2) | high | true |
| **Jasa hukum is item (d)** in the enumerated list | Pasal 1(6)(d) | high | true |
| Jasa akuntansi/pembukuan is item (c) | Pasal 1(6)(c) | high | true |
| Outsourcing services is item (n) | Pasal 1(6)(n) | high | true |
| Software/hardware/computer-system services incl. maintenance is item (u) | Pasal 1(6)(u) | high | true |

# Tax Engine relevance

- **Test Case 1 (paralegal/legal invoice) is now categorically supported**: *jasa hukum* is an
  enumerated *jasa lain*. It remains for a reviewer to confirm that a given paralegal engagement
  falls within *jasa hukum*.
- **Corrects our own correction.** Phase 1 downgraded the PPh 23 base to `needs_reviewer` because
  the DJP guidance page said only *jumlah bruto*. The regulation says *jumlah bruto tidak termasuk
  PPN*. The base is now cited to primary text — while remaining `under_review`.
- The exemption for income already taxed finally is the **interlock with PP 34/2017**: rent taxed
  finally under PPh 4(2) is not then also PPh 23.
- Item (u) matters for the "software subscription" and "software + implementation" transaction types.

# What this source does NOT prove

- It does **not** define *jasa hukum*, so whether a specific paralegal service qualifies is a
  judgement.
- The list continues past the letters we quote; **we have not reproduced or verified every item**.
- It does **not** address the no-NPWP uplift — that sits in the UU, not this PMK.
- It does not confirm whether PMK 141/2015 has since been amended or replaced. **This is now the
  single most important open question**, because the whole PPh 23 candidate rests on it.

# Reviewer questions

1. **Is PMK 141/PMK.03/2015 still current, or has it been replaced?**
2. Does a paralegal engagement fall within *jasa hukum* (d)?
3. Where does the no-NPWP 100% uplift come from, and does it apply to all *jasa lain*?
4. Confirm the interlock: rent under PP 34/2017 is excluded from PPh 23 via the final-PPh exemption?

# Currentness evidence

- **currentness_status_source:** `BPK_PPH23_PMK141_002`, `KEMENKEU_PPH23_PMK141_004`
- **currentness_checked_at:** 2026-09-02
- **currentness_result:** `berlaku`

JDIH Kemenkeu details page records status **"Berlaku"**, **"Tanggal Berlaku 24 Jul 2015 – s.d.
Dicabut"** (in force *until revoked*), and a **"Riwayat Dokumen (1)"** whose single entry is
**outgoing** — this PMK *mencabut* PMK 244/PMK.03/2008. BPK records **"Status Berlaku"**.

**Caveat, recorded honestly:** BPK's "STATUS PERATURAN" section for this PMK reads
**"Belum Tersedia"** — BPK holds no relationship data for it. Absence of a recorded amendment there
is *not* evidence of absence.

**False-positive note:** the string *"Diubah"* appears three times on these pages, but it belongs to
the **title of UU PPh** (*"…Nomor 7 Tahun 1983 … Sebagaimana Telah Beberapa Kali Diubah Terakhir
Dengan Undang-Undang Nomor 36 Tahun 2008"*). It does **not** indicate the PMK itself was amended.

Still `under_review`. **Not** `legally_verified`. Accountant/legal reviewer confirmation required
before activation.
