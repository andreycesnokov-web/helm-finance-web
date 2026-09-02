# _extracted — derived text, not sources

Plain-text extractions produced **from the archived bytes** in `../../raw_sources/`, so every
statement in a grounded summary is traceable to a file whose SHA-256 is recorded in
`raw_sources/MANIFEST.json`.

- HTML → tags stripped locally (no re-fetch, so the text matches the hashed bytes exactly).
- PDF → `server/lib/pdfText.js`, the repo's own dependency-free extractor. Embedded text only;
  it is **not OCR**, so a scanned PDF yields nothing.

**These are derived artifacts, not sources.** Never cite an `_extracted` file — cite the
`source_id` and the URL. When RAG ingestion happens, embed the primary document from
`raw_sources/`, not these.

Two archived PDFs produced no text at all (`DJP_BUPOT_001`, `KEMENKEU_PPH21_001`): they have no
embedded text layer. Their bytes are preserved; their content has not been read by anyone here.
