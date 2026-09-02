# Source

- **source_id:** `DJP_PPN_007`
- **title:** Perubahan atas PMK 11 Tahun 2025 tentang Nilai Lain sebagai DPP dan Besaran Tertentu PPN
- **authority:** DJP
- **official_url:** https://www.pajak.go.id/en/node/117215
- **source_type:** regulation
- **trust_level:** regulation
- **verification_status:** `fetch_verified`
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/ppn_vat/DJP_PPN_007.html`
- **sha256:** `42d17e4cedca56a151ad6381f1bf5f3b54aa68696295009d8a1e12fbe5ce40e4`

# What this source supports

**This closes a previously-open gap.** The prior pass recorded that "an amendment to PMK 11/2025
exists but has not been read". It has now been retrieved and read.

**The source states** it is *Perubahan atas Peraturan Menteri Keuangan Nomor 11 Tahun 2025 tentang
Ketentuan Nilai Lain sebagai Dasar Pengenaan Pajak dan Besaran Tertentu Pajak Pertambahan Nilai*,
and the archived text identifies the amending instrument as **PMK Nomor 53 Tahun 2025**.

# Extracted facts

| Fact | Where | Confidence | needs_reviewer |
|---|---|---|---|
| Amending instrument is **PMK 53 Tahun 2025** | archived page text | high | false |
| It amends PMK 11 Tahun 2025 | title | high | false |
| **Pasal II: "mulai berlaku pada tanggal 1 Agustus 2025"** | Pasal II | high | false |
| Deletes Pasal 343 and Pasal 354 | amendment body | medium | true |
| Adjusts a building-construction DPP provision | amendment body | medium | true |

# Tax Engine relevance

- Any PPN rule candidate must now cite **both** PMK 11/2025 **and** PMK 53/2025, with effective
  dating: PMK 11/2025 from 2025-02-04, as amended from 2025-08-01.
- `official_sources.effective_from` / `effective_to` and `supersedes_rule_id` in `tax_rules` exist
  precisely for this and should be used.

# What this source does NOT prove

- This is the **DJP page about** the amendment, not the full PMK 53/2025 text. The complete amending
  text was not retrieved.
- It does not tell us the net effect on an ordinary service invoice.
- It does not confirm whether further amendments exist after August 2025.

# Reviewer questions

1. Please supply/confirm the full PMK 53/2025 text.
2. What is the consolidated position after 1 August 2025?
3. Is there anything more recent than PMK 53/2025?
