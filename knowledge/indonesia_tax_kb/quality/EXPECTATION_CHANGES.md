# Independent provision checks, not runtime routing data

Baseline files at baseline_749937d/ remain unchanged. The old acceptance measured page presence
(38 PASS /40 FAIL). The new gold file requires identified operative provisions/instructions and literal
text anchors from the primary extraction. The runtime never reads this file, question IDs or gold pages.

Q07: the previous target page8 was wrong for commencement. PP34 Pasal7 says2January2018 on physical
PDF page7; page8 holds promulgation/signatures. New check requires Pasal7 as historical material for
the2017 question and no applicable claims; it does not pretend to know the missing prior regime.
Primary: https://jdih.kemenkeu.go.id/api/download/fulltext/2017/34TAHUN2017PP.pdf#page=7

Q11: a change deleting Pasal59 is an amendment instruction in PP20 Pasal I angka6 on page8,
immediately before Pasal II, not part of the preceding Pasal58. The checker identifies that role.
Primary: https://jdih.kemenkeu.go.id/api/download/d057ff82-50e7-4127-b66b-f704a36f071d/2026pp020.pdf#page=8

Q18: input credit in PMK131 is Pasal3(4), on page4. Merely returning an unrelated segment of page4
is insufficient. The new target requires the phrase 'dapat dikreditkan sesuai' inside article3.
Primary: https://jdih.kemenkeu.go.id/api/download/ad276b82-94bd-4197-b409-af33e2842cd6/2024pmkeuangan131.pdf#page=4

Q19: last-period reconciliation is PMK168 Pasal15(1), continued into paragraphs2–3 on page16;
Pasal13 only names methods. Both provisions must be found, with the continuation attached explicitly.
Primary: https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf#page=15

Q23/Q26: payment is PMK81 Pasal94(2), filing is Pasal171(1) with listed exceptions and continuations.
Presence of PMK53's amendment title or the PMK81 registry link cannot pass this check.
Primary: https://jdih.kemenkeu.go.id/api/download/637047be-3dba-4347-aba1-98fa7fd5ab3f/2024pmkeuangan081.pdf#page=78
and #page=139. The baseline is retrieved for reading; PMK1 unavailability still blocks a current due date.

Other fixture semantics are retained. Needles check text binding and provision retrieval; they are not
an automated tax-law judgement or professional translation review. The main assertions also verify
every returned claim's exact fragment IDs, source SHA, article/role, full provision and text anchor.
