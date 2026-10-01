# Source

- **source_id:** `KEMENKEU_PPN_002`
- **title:** PMK Nomor 11 Tahun 2025 (PDF, JDIH Kemenkeu)
- **authority:** JDIH Kemenkeu
- **official_url:** https://jdih.kemenkeu.go.id/api/download/52955502-8733-4fdd-98ce-bb03c31cda0b/2025pmkeuangan11.pdf
- **source_type:** regulation
- **trust_level:** regulation
- **verification_status:** `fetch_verified`
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/ppn_vat/KEMENKEU_PPN_002.pdf`
- **sha256:** `373a13e091cc697145b6624aa450c3dc60c8594501e900685964584152b35b6c`

# What this source supports

**This is primary regulation text**, retrieved as a PDF and text-extracted locally (103,878
characters) using the repository's own `server/lib/pdfText.js`. It is the strongest source in the
knowledge base.

**The source states** it is *Peraturan Menteri Keuangan Republik Indonesia Nomor 11 Tahun 2025
tentang Ketentuan Nilai Lain sebagai Dasar Pengenaan Pajak dan Besaran Tertentu Pajak Pertambahan
Nilai*.

# Extracted facts

| Fact | Where | Confidence | needs_reviewer |
|---|---|---|---|
| Instrument is PMK Nomor 11 Tahun 2025 | title block | high | false |
| Recitals reference PMK 131/2024 | Menimbang (b) | high | false |
| The 11/12 (*sebelas per dua belas*) construction appears 48 times | full text | high | false |
| 11/12 is applied **per transaction category**, not as a blanket rate | Pasal listing self-use, gratuitous transfer, film, inventory, intermediary sales | high | **true** |
| The rate itself is referenced to Pasal 7 ayat (1) of the VAT Law (18 references) | throughout | high | true |
| Contains BAB IV *Ketentuan Peralihan*, Pasal 22 | body | high | false |

# Tax Engine relevance

- **Transaction types:** any PKP supply where VAT appears on a faktur pajak.
- **Rule candidates:** `TAX_ID_PPN_OUTPUT_001`, `TAX_ID_PPN_INPUT_002`.
- **Risk — important:** this regulation is a *nilai lain* instrument enumerating **specific
  categories**. It is **not** a general statement that every supply is taxed at 12% × 11/12.
  Treating it as a blanket effective rate would over-generalise the primary text.

# What this source does NOT prove

- **It does not state a rate percentage itself.** It refers to the rate in the VAT Law.
- It does not establish that an ordinary commercial **service** invoice uses the 11/12 base — the
  categories enumerated are specific, and an ordinary taxable service supply is not obviously one of
  them.
- It does not cover input VAT creditability or faktur pajak content.
- **It is superseded in part:** see `DJP_PPN_007` (PMK 53/2025, effective 1 August 2025).

# Reviewer questions

1. For an ordinary commercial service invoice, what is the correct DPP and rate today?
2. Which parts of PMK 11/2025 survive PMK 53/2025?
3. Is our seeded `{"rate":0.11}` defensible, or must it be replaced?
