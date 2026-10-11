# raw_sources — MANIFEST

**This directory is intentionally empty.**

No primary documents were downloaded in this pass. Retrieval produced page text, not archived PDFs, and claiming otherwise would make `downloaded_file` a lie. Every registry entry therefore has `downloaded_file: ""`.

## Priority downloads for the next pass

These are the `trust_level: regulation` entries — the primary text a reviewer actually needs:

| source_id | trust | title |
|---|---|---|
| `DJP_PPN_001` | regulation | [Ketentuan Nilai Lain sebagai Dasar Pengenaan Pajak dan Besaran Tertentu PPN (PMK 11/2025)](https://www.pajak.go.id/en/node/113878) |
| `KEMENKEU_PPN_002` | regulation | [PMK Nomor 11 Tahun 2025 (PDF, JDIH Kemenkeu)](https://jdih.kemenkeu.go.id/api/download/52955502-8733-4fdd-98ce-bb03c31cda0b/2025pmkeuangan11.pdf) |
| `BPK_PPN_003` | regulation | [PMK No. 11 Tahun 2025 (peraturan.bpk.go.id)](https://peraturan.bpk.go.id/Details/313574/pmk-no-11-tahun-2025) |
| `DJP_PPN_007` | regulation | [Perubahan atas PMK 11 Tahun 2025 tentang Nilai Lain sebagai DPP dan Besaran Tertentu PPN](https://www.pajak.go.id/en/node/117215) |
| `DJP_PPH23_003` | regulation | [Jenis Jasa Lain yang atas Imbalannya Dipotong PPh Pasal 23 ayat (1) huruf c](https://pajak.go.id/index.php/id/peraturan/jenis-jasa-lain-yang-atas-imbalannya-dipotong-pajak-penghasilan-berdasarkan-pasal-23-0) |
| `KEMENKEU_PPH21_001` | regulation | [PMK Nomor 168 Tahun 2023 — PPh Pasal 21 (PDF, JDIH Kemenkeu)](https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf) |
| `DJP_PPH21_002` | regulation | [PMK 168 Tahun 2023 Tentang PPh Pasal 21 TER (PDF, DJP mirror)](https://pajak.go.id/sites/default/files/2024-02/PMK%20168%20Tahun%202023%20Tentang%20PPh%20Pasal%2021%20TER.pdf) |
| `BPK_PPH21_003` | regulation | [PMK No. 168 Tahun 2023 (peraturan.bpk.go.id)](https://peraturan.bpk.go.id/Details/286951/pmk-no-168-tahun-2023) |
| `BPJSTK_003` | regulation | [Peraturan BPJS Nomor 1 Tahun 2016 (PDF)](https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/16122016_111825_PER%20BPJS%2001%202016.pdf) |

## Still missing entirely

- The PP governing PPh 4(2) land/building rental (**highest priority**)
- PMK-141/PMK.03/2015 (or its current replacement) for the PPh 23 *jasa lain* list
- The PER governing faktur pajak
- The amendment to PMK 11/2025
- UU PPh, UU PPN and UU HPP consolidated texts
- BPJS Kesehatan employer obligations
- PT PMA registration regulation

## Convention when downloading

`raw_sources/<section>/<topic>/<source_id>.<ext>`, then set `downloaded_file` in the registry to that path and record a `content_hash`.
