# Coretax, faktur pajak and bukti potong - summary

> Orientation note written from official sources on 2026-09-02. **Not a citation and not legal advice.** Every figure is a candidate awaiting licensed review. Go to the primary regulation before relying on anything here.

## What we established

Coretax DJP is the integrated administration platform. Since **1 January 2025**, e-Bupot is accessed
through Coretax rather than as a standalone application (`DJP_BUPOT_002`). Coretax covers
registration, payment, bukti potong, monthly PPh returns, faktur pajak and monthly PPN returns
(`DJP_CORETAX_004`).

DJP publishes downloadable manuals, including a dedicated **Buku Manual Coretax - Seri Bukti Potong
PPh** (`DJP_BUPOT_001`, version 1.0 dated 3 February 2025). That manual is the best operational source
found for what a bukti potong contains and when it is issued.

## What is unresolved

- The manuals were located but **not downloaded or read**.
- **No PER governing faktur pajak content was found.** Required fields for a valid faktur pajak, and
  the conditions for crediting input VAT, are therefore entirely unsourced. We have recorded them as
  `needs official source` rather than invent them.
- No machine-readable interface or export format was identified. Coretax is a human workflow;
  documents reach our product only because a user uploads them.

## Why this matters to the product

Bukti potong is the evidence artifact that closes the withholding loop. If the engine suggests
withholding, it must also tell the user that a bukti potong is required - and that requirement should
be sourced from `DJP_BUPOT_001`, not asserted.
