# PMK1/2026 primary-text acquisition and instruction map

2026-10-06: retry succeeded from the full-text link on the official JDIH files page (not the abstract). `store/manifest.json` retains both earlier timeout attempts and this successful attempt; current PDF/extraction are archived, 35 pages.

SHA256: `d2a1ffe926a020c178e88348e974a9199e6fc746ef7884bb72e12a5cbc29a2af`.

[Full official PDF](https://jdih.kemenkeu.go.id/api/download/b5f99bff-f689-4e4f-ae3a-7c6a9a4cfe8a/2026pmkeuangan001.pdf). [Official metadata](https://jdih.kemenkeu.go.id/dok/pmk-1-tahun-2026/overview).

The primary amendment instructions identify these precise changes to PMK81/2024:

|Instruction|Changed provision|PDF page|
|---|---|---|
|Pasal I angka1|Pasal1 definitions135 (BUMN) and222 (Menteri)|3; replacement definitions17/25|
|angka2|Pasal392(7),(8)|25; text27–28|
|angka3|Pasal393(2)|28; text29|
|angka4|Pasal394(4),(5)|30–31|
|angka5|new Pasal405(4)|31; text33|
|angka6|inserted Pasal406A|33|
|Pasal II angka1|existing decisions and pending book-value applications, conditional transition|33–34|
|Pasal II angka2|commencement on promulgation|34|

These instructions concern specified definitions and book-value business restructuring provisions. The list does not directly change Pasal94/171 deadlines or TER. This observation is an instruction-level scope finding, not certification of all current administrative law. No new restructuring topic or calculator is activated. `amendments/PMK1_2026.json` records exact archived substrings, offsets, SHA, pages and links; they are amendment-map data, not newly exposed tax-rule claims.

Pasal I page3 identifies PMK11/2025, PMK53/2025 and PMK54/2025 as previous amendments of PMK81. Their citation is not evidence that PMK1 directly replaces each separate document. PMK1's direct `amends` edge to PMK81 is primary-confirmed; other outgoing edges are `prior_amendment_cited`. Existing inbound registry relationships derived from JDIH remain broad navigation/dependency warnings, not precise clause proof.

The JDIH metadata gives enactment/publication/commencement22January2026. PasalII(2) ties commencement to promulgation. The archived PDF's page35 has blank/unrendered promulgation-date and BN-number fields: extraction gives stray Cyrillic glyphs, and visual rendering does not recover values. Accordingly the date is recorded with an explicit metadata basis and unresolved PDF gap. No inferred repair was written into original extraction. Signature validation was not performed.

Read scope: amendment instructions p3, definition135 p17, replacement definitions222 and operative/transition provisions p25–35. The repeated definitions p4–24 were not exhaustively compared to prior editions. Full old/new consolidated comparison, later amendments, scope exceptions and legal currency remain unreviewed. Download/check timestamps are separate; `checked_at` records this editorial reading only, not a licensed/current-law check.

Machine consequence: `amendment_text_unavailable` for PMK1 becomes `amendment_review_incomplete`. Source-chain gaps still propagate; `current_provision_currency_unconfirmed` and numeric/TER blockers remain. Regression tests accept either the unavailable-text or incomplete-review blocker, and still require PMK1/PMK81 dependency paths. This change reflects actual acquisition, not a relaxed tax answer standard.
