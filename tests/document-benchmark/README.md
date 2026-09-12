# CFO AI document benchmark

This is an offline, provider-neutral evaluator for document-routing and extraction
results. It never calls a model, uploads a file, or writes to the application database.

## Run the current deterministic baseline

```powershell
node tests/document-benchmark/run.js --baseline-current
```

## Score a candidate reader

Create a JSON Lines file with one object per case:

```json
{"id":"id_faktur_pajak_clean","route":"deterministic_text","document_type":"faktur_pajak","fields":{"document_number":"INV-ID-001"},"line_items":[],"evidence":{"document_number":{"page":1,"quote":"No. Invoice INV-ID-001"}},"review_required":false,"latency_ms":120,"retries":0,"cost_usd":0.001}
```

Then run:

```powershell
node tests/document-benchmark/run.js --candidate path/to/results.jsonl
```

The runner reads only local files. Candidate generation is deliberately outside the
runner so a benchmark cannot accidentally spend money or transmit fixtures. Live runs
must be implemented as a separate, explicitly approved tool.

Candidate keys:

- `id`: benchmark case id.
- `route`: `deterministic_text`, `spreadsheet_parser`, `vision_cheap`,
  `vision_strong`, `bundle_split`, or `manual_review`.
- `document_type`: normalized document type.
- `fields`: extracted scalar fields. Use `null` for unknown values.
- `line_items`: array of `{description, quantity, unit_price, amount}`.
- `evidence`: field/line evidence containing `page` or `cell`, plus a short `quote`.
- `review_required`: whether a person must review the result.
- `duplicate_of`: matched case id, or `null`.
- `latency_ms`, `retries`, `cost_usd`: measured operational values.

The manifest contains synthetic Indonesian and English cases only. It includes clean
text, poor scans, contradictory filenames, multipage tables, bundles, spreadsheets,
ambiguous documents, and duplicates. Ground truth records page or cell provenance.

## Cost model

```powershell
node tests/document-benchmark/cost-model.js
```

The model prints 100 / 1,000 / 10,000-document projections for three architectures.
All assumptions are visible at the top of the script and must be replaced with measured
traffic, token, review-time, OCR, storage, and error data before a purchasing decision.
