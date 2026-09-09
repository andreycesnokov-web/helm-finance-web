# Document regression seed (offline only)

Run from repo root:
```sh
node tests/document-benchmark/run.js --baseline-current
node --test tests/document-benchmark/scoring.test.js
node tests/document-benchmark/cost-model.js
node tests/document-benchmark/run.js --candidate path/to/results.jsonl
```

No network, SDK calls, uploaded customer files or DB writes.

## Fixture inventory and honest scope

12 descriptions remain. No actual PDF, image, XLS/XLSX or CSV files are present.
Five cases contain complete synthetic parser-input text. A sixth bank statement text
is partial: its expected rows are absent, so it is excluded pending ground-truth repair.
Six other cases have descriptions only. Seven unverified cases are listed explicitly.
No original-file test exists. This is not engine accuracy and not a provider comparison.

Baseline invokes only extractFromText + findDuplicateDocument on five text strings.
It excludes byte ingestion, PDF decoding, storage, Vision, UI and product-purpose routing.
Review-first means a human confirms every document; parser confidence does not mean
an automatic accounting write. Timings use a monotonic clock around parser/duplicate
calls, not network or full-pipeline latency.

## Scoring

Missing answers fail all expected scalar checks and retain item recall denominators.
Numeric null, blank, false and missing are not zero. Expected null requires explicit null.
Extra populated fields are reported as unadjudicated (expected JSON is partial); they
block fully-verified status. Forbidden fields are additionally identified.
Items match one-to-one by all supplied expected columns; duplicate/extra rows lower
precision, absent rows lower recall, unexpected populated columns reject the row.
Duplicate decisions require an explicit ID or null. There is no usable duplicate-positive
fixture, so recall is UNKNOWN, not inflated by true negatives. Unknown/duplicate result
IDs are input errors. Missing cost/latency stays null, never coerced to zero.

Document type + product purpose are separate from an allowed set of technical routes.
Purpose labels are proposed test taxonomy, not claims that the baseline implements it.
Manual review is a permissible fallback, not proof of extraction correctness.

Evidence requires a quote present in actual source content and a supporting scalar value.
A matching expected quote alone is insufficient. Page/cell checks need separately loaded
source maps; parser-only text cannot verify them. The scoring unit tests exercise these
checks with synthetic maps, NOT real PDF/spreadsheet extraction. Null/absence, derived dates,
formula evaluation, line arrays and semantic context still require human adjudication.
Candidate JSON cannot supply its own authoritative source. All manifest page/cell examples
remain unverified. Correct-looking numeric coincidence is not proof of semantic correctness.

No threshold, 99% claim or cost-per-correct estimate is justified by this seed.
Add permissioned originals, independently reviewed field/item truth and deterministic
page/cell extraction before a paid benchmark. Keep customer files and raw recordings out
of Git. Externally provided candidate outputs are claims, not proof they came from a model.

## Economics

model-catalog.json records exact API IDs, official source links, price verification date
and documentation-level availability. Account access is untested for ALL candidates.
cost-model.js separates first attempts, retries, parser, storage, external OCR, quick
confirmation of every document and additional correction time. All workload/labor inputs
are assumptions. API prices alone do not establish quality or economic benefit.
