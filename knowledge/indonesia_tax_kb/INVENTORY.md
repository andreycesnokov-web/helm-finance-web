# Inventory and provenance

As of 2026-10-06, Business AI Accountant research; no live database inspection.

## Repository and boundary

The ChatGPT project mirror contains AGENTS.md and an empty sources directory; it is not Git.
The actual repository was located at `C:/Users/HUAWEI/Desktop/helm-finance-web`.
Its checkout was clean on `integration/qa-acceptance-129-132`, ten commits ahead of origin/main.
Origin is `andreycesnokov-web/helm-finance-web`; origin/main was `867209e5`.
Created a separate Git worktree and `feature/indonesia-tax-knowledge` from that baseline.
Read AGENTS.md, AI_WORKING_MEMORY.md, PROJECT_STATE.md, ARCHITECTURE.md and RISKS_AND_TESTS.md.
Read current Accountant ask flow and taxGate; inspected schema references and PR132 metadata.
PR132 was OPEN, `feature/ai-accountant-company-context`, changing server/index.js and two tests.
No AntiGravity branch or shared code has been changed. Managed-worktree attachment is unsupported
for this ordinary Git worktree; Git isolation itself works.

## Available legacy material

46 files under knowledge/indonesia_official_kb; 66 registry entries in JSON/CSV.
Tax, compliance and evidence candidates remain under review. Raw sources contains MANIFEST.md only;
there are no PDFs or ZIP/TAR/GZ archives in that tree, and no downloaded_file entries.
The priority archive mentioned in the request was not present in this knowledge tree.
An archive elsewhere on the computer has not been exhaustively searched.
Prior hashes, if supplied elsewhere, would prove identity, not legal currency.

Read the main README, ingestion plan, raw manifest, reviewer notes, four tax summaries and the three
candidate registries. Per-topic README excerpts were inspected, not all underlying URLs.
The JSON/CSV registries were parsed; legacy linked web pages were not all fetched.
Other legacy summaries were listed only. `inventory.json` records each actual inspection level,
file size and independently computed SHA-256; these local hashes are not archived primary documents.

## New archive

14 sources selected, 13 downloaded PDF originals; PMK1/2026 failed twice with download timeouts.
Content-addressed originals and page/layout/table extractions live under store/.
188 semantic article/page fragments selected for the first index.
Full automatic extraction is not full human reading. sources.json records the pages actually read,
the broader selected index ranges, dates, SHA-256 and unresolved issues separately.
PMK11/2025 was downloaded/extracted but its substantive provisions have not yet been read in full.
The DJP SDSN2023 archive is an official consolidated statutory text, not an archive of each promulgated
amending law; individual instruments and subsequent amendments remain a gap.

Visual spot checks: PP34/2017 PDF page4 (10% and payer roles), PP20/2026 page5 (eligible entity types),
PP58/2023 page11 (TER category A table). Text extraction has errors such as `10olo`, distorted paragraph
labels and rupiah digits. The visual checks do not certify all pages or tables. Table cells retain
needs_visual_review; no OCR correction or machine rate lookup was introduced.
Ruled-line detection initially found no TER tables because the rules were raster images. A text-column
fallback now retains15 candidate matrices with bounding boxes; wrapped rows and spurious columns
remain unresolved and must not be treated as faithful legal tables. Original page and layout text are retained.

## Existing integration and schema

Migrations020,023,024,025 define/extend official_sources, tax_rules, tax_rule_reviews and audit_events.
Their applied production state was not checked. No knowledge_chunks/embedding table is assumed.
Existing source admin routes support create/patch/verify/outdated/replaced/amendment; taxGate requires
source verification plus effective approved review for the exact rule version. No candidate was imported
into those tables. The old migration's seeded tax percentages were not adopted as authority.
The new module uses local immutable JSON/PDF artifacts and has no database client.

Legacy scan and archive metadata can be regenerated with report_inventory.py. A future inventory must
update actual read-pages evidence explicitly; extraction alone must not be reported as reading.
