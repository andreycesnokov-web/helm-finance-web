# Indonesia Tax Knowledge Base

Business AI Accountant research module, isolated from tax calculations and production.
Baseline: origin/main `867209e5`; research date: 2026-10-06 (Asia/Shanghai).

Run ingestion with Python 3 and pdfplumber/pypdf (existing bundled runtime):
`python tools/indonesia_tax_kb/ingest.py --registry knowledge/indonesia_tax_kb/sources.json --store knowledge/indonesia_tax_kb/store`

Rebuild the article index and explicit statement bindings before evaluating changed source/structure data:
`python tools/indonesia_tax_kb/build_index.py --root knowledge/indonesia_tax_kb`
`python tools/indonesia_tax_kb/bind_claims.py`

Run retrieval and tests with the repository's Node runtime:
`node tools/indonesia_tax_kb/cli.cjs --question "Explain PPh 23" --language en --period 2026-10-01`
`node --test tests/indonesiaTaxKnowledge.test.cjs`
`python tests/indonesia_tax_ingestion_test.py`

Rebuild the selected index: `python tools/indonesia_tax_kb/build_index.py --root knowledge/indonesia_tax_kb`.
Regenerate inventories: `python tools/indonesia_tax_kb/report_inventory.py`.
Regenerate cards, evaluations and example answers: `node tools/indonesia_tax_kb/evaluate.cjs`.
Read-scope records in report_inventory.py are research evidence for this pass, not automatic certification
of future files or versions; update them manually after reading a new exact SHA.

Contract v2 is in INTEGRATION.md. Atomic claim proofs replace unbound card explanations.
See REPAIR_REVIEW.md and quality/RESULTS.md for the before/after acceptance comparison.
Baseline outputs for SHA749937d remain under quality/baseline_749937d/.

No embeddings, new service, database migration, credentials, model calls, flags or route changes.
Downloads are content-addressed, immutable and versioned; metadata and extraction are separate.
The offline extractor preserves PDF pages and layout text, tables with cell matrices and bounding boxes.
Automatic extraction is a candidate: table fidelity, scans and corrupted text must be reviewed.
Curated fragments only quote reviewed extraction ranges and carry precise locators.
Retrieval never determines an amount payable or activates a tax rule.
See INVENTORY.md, INTEGRATION.md, REVIEW_GAPS.md and quality/ for evidence and limits.

## Reproducible handoff and cards

Read ANTIGRAVITY_HANDOFF.md, TOOLTIPS_RU_EN_ID.md and PMK1_REVIEW.md. getCard uses the live retrieval gate; snapshots are review artifacts. package_reproducible.py builds an exact committed archive with source, tests, data and PDFs. REPRODUCE.md inside the package gives exact installation/run commands and checksum verification. Node uses no npm dependencies; Python requires pdfplumber0.11.9/pypdf6.10.0. No model/route/production activation.
