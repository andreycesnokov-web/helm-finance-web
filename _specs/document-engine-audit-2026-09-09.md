# CFO AI document engine audit
Date: 2026-09-09. Baseline main: eb10e3ad. Business document-reading path only.
PR79 reviewed independently at 1c23bbcdd2dda7415a59026a03d56de165e8d3f4.
No paid calls, upload, production mutation, migration or flag change.

## Decision
Measure the existing path and fix cancellation first. Follow with atomic financial
confirmation + audit. Keep the current model/router and human confirmation.
Do not merge PR79 wholesale or choose a provider from price alone.

## A. Code observations (not production measurements)
- Upload-complete verifies bytes and SHA, then finalizes through an atomic procedure.
  Client hash alone is not authoritative. Intake downloads the same bytes again.
- /extract, /counterparty-suggestion and /intake share readDocumentForIntake. Each can
  repeat storage/model work. sameIntake avoids a DB write only AFTER that work.
- pdfText.js is a bounded custom embedded-stream reader, not OCR or a full layout parser.
- CSV/XLS/XLSX are accepted/previewable but not extracted in Document Center. Bank Import
  has a separate first-sheet/manual-column flow, not this document extraction engine.
- Text extraction runs first. Only textless PDF/images use Vision, behind
  DOCUMENT_OCR_VISION_ENABLED. Unsupported files remain manual-review cases.
- documentOcr.js requests claude-sonnet-4-5, max_tokens 1500, plain JSON. No strict schema,
  line-item contract or original-page/cell evidence. Whitelisting is not value validation.
- Baseline 45-second Promise.race leaves requests in flight and does not clear the timer.
  SDK 0.20.9 supports per-request AbortSignal and defaults to two retries. Baseline does
  not record attempts, returned usage/model, duration or estimated cost.
- No durable result cache or single-flight exists in this baseline document reader.
- OCR merging keeps parser values first and caps confidence. Extraction produces suggestions,
  not payable/receivable/transaction postings. Confirmation remains separate.
- Evidence Inbox and Company Vault share financial_documents. Human-confirmed classification,
  not filename suggestion alone, controls Company Vault.
- Financial-fields confirmation updates financial_documents before best-effort document_audit.
  Audit failure can leave the financial mutation committed. Archive/version is not rechecked
  atomically. This is the highest correctness priority for the NEXT separate PR.
- The route checks auth, business and canManageDocuments. A future RPC must independently
  enforce active membership/role and business scope under locks.
- SHA/reference+amount duplicate checks do not prove fuzzy/rescan recall.
- Current Vision has no tools. Document instructions must remain untrusted in future readers;
  this audit did not demonstrate an injection exploit.

## B. Tests actually executed and scope
Earlier audit: 21 test files attempted, 20 passed, one storage integration file skipped.
That was not 21 passing suites or a live production test.
One authorized local 143,947-byte invoice was read without upload/API transmission.
The parser returned text_not_legible / manual review. No visual field-ground-truth check
was performed. This single result does not diagnose OCR or estimate engine accuracy.
No company document is included in this commit.

The old 3/12 result is superseded: it came from a flawed PARSER-ONLY evaluator, with no
Vision or original-file decoding. It conflated confidence with auto-acceptance and scored
missing fixtures/weak evidence incorrectly. It is not engine accuracy.
Corrected inventory: five complete synthetic text inputs, one partial bank transcript whose
expected rows are absent, six description-only cases. All 12 case descriptions remain.
ZERO original PDF/image/Excel/CSV fixtures and ZERO original-file tests exist.
The partial transcript and descriptions are explicitly unverified, not simulated failures.

See tests/document-benchmark/README.md and scoring.test.js. Missing answers retain denominators;
null/blank/false are not numeric zero. Extra populated fields require adjudication because
expected JSON is partial; they block full verification. Missing cost remains unknown.
Product type/purpose is separate from permitted technical routes. Baseline has no purpose router.
Human confirmation applies to every document, independently of extraction confidence.
Evidence requires source-contained quote AND scalar-value support. Unavailable page/cell maps
and compound values are unverifiable. Lexical matching is not semantic proof of the right field.
No usable duplicate-positive fixture exists, so recall is unknown. This seed cannot establish 99%.

## C. Calculated assumptions (not demonstrated savings)
cost-model.js separates API first attempts, retries, parser, storage, external OCR, quick
confirmation and additional correction. Inputs: 6000 input / 600 output tokens, 5% extra
attempts, $8/hour, 15-second confirmation for EVERY document, plus 3-minute correction on
an assumed 10%. A-C assume 20% reusable results and different route shares: not implemented.
The current-reader example assumes 55% Vision and no cache; that route share is unknown.
$0.001 parser + $0.002 storage + $0 external OCR are planning allowances, not measured invoices.
Retry cost assumes full billing of each additional attempt. Timeout billing may be unknown.
Old $808 -> $401 and cost-per-correct figures are withdrawn as decision evidence.
No measured quality rate exists; cost per correct document remains null.

## D. Unverified hypotheses
Native PDF/spreadsheet parsers may reduce model calls. Cheap-first/strong-escalation routing
may reduce cost. Durable cache/distributed coordination may reduce repeated work.
No comparative model quality, Indonesian small-print accuracy, retention approval or account
entitlement was tested. No default model change is justified yet.
Recheck lifecycle before rollout; this audit makes no verified retirement-date claim.

## Official candidate catalog
tests/document-benchmark/model-catalog.json records exact IDs, official sources, verification
date, standard input/output price and availability notes. Checked 2026-09-09:
gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol, gpt-6-astra;
gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.1-pro-preview;
claude-haiku-4-5-20251001, claude-sonnet-5, claude-opus-5;
current alias target claude-sonnet-4-5-20250929.
Sol/Flash promotional limits, long-context tiers and preview status are documented there.
Actual account access is UNKNOWN for ALL candidates; official documentation is not an API test.
Consumer subscriptions are not API credits. No provider benchmark keys/calls were used.

## PR79 correction and reusable work
At the reviewed head, server/index.js DOES persist validated results in extracted_json.
Reuse can survive process restarts. The previous blanket in-process-only cache claim was wrong.
visionCache.singleFlight remains process-local: simultaneous misses across replicas are not
coordinated by that mechanism. Review current head again before any later selective transfer.

Useful files at 1c23bbcdd2dda7415a59026a03d56de165e8d3f4 (not cherry-picked):
- server/lib/documentExtractionValidator.js: validation; review evidence semantics separately.
- server/lib/documentBundle.js: bundle detection.
- server/lib/documentVisionV3.js: original input/structured reader mechanics, not default policy.
- server/lib/visionCache.js + server/index.js persistence: versioned result reuse.
- server/lib/documentPublicView.js: bounded provenance; recheck privacy.
- server/lib/modelPolicy.js: reference only; do not import universal Opus policy.
- tests/integration/visionCacheDurability.test.js: durable-cache regression ideas.

PR79 remains open and untouched. It mixes about 33 files / 5700 lines and routes every financial
document to claude-opus-5 without comparative evidence. Eval defaults $15/$75 per million differ
from checked Opus5 $5/$25. Correcting prices is not a measured saving or quality result.

## Next small PRs
1. Document telemetry + supported timeout cancellation, no routing or model changes.
2. Atomic confirmation RPC: verified business/active member/role, document lock and archive
   recheck, atomic financial fields + audit, optimistic version, idempotent repeated confirms.
3. Native PDF and server spreadsheet extraction, bounded resources and source geometry.
4. Durable scoped cache and cross-replica coordination/invalidation.
5. Strict extraction contract, evidence/bundle/duplicate validators.
6. Authorized comparison on permissioned originals with budget and retention controls.
7. Limited review-first canary with spend/error limits and existing flag rollback.

Telemetry is not an audit ledger or provider invoice. Abort does not guarantee work/billing stops.
Never log document content, prompt, filename, bank details or NPWP. Financial writes must not
depend on operational logging success. No production changes are authorized by this audit.
