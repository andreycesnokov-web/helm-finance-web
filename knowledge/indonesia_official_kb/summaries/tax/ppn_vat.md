# PPN / VAT - summary

> Orientation note written from official sources on 2026-09-02. **Not a citation and not legal advice.** Every figure is a candidate awaiting licensed review. Go to the primary regulation before relying on anything here.

## What we established

PMK 11 Tahun 2025 (`DJP_PPN_001`, fetch-verified) is titled *Ketentuan Nilai Lain sebagai Dasar
Pengenaan Pajak dan Besaran Tertentu Pajak Pertambahan Nilai* and was enacted 4 February 2025. Its
mechanism is a **DPP *nilai lain* of 11/12** of the ordinary base, applied across several transaction
categories. DJP guidance describes the combined effect for non-luxury goods and services as
12% x 11/12, i.e. an effective 11%.

The regulation page itself does not state a rate percentage; it refers to the rate in the PPN Law.
The 12% figure comes from DJP's own explanatory material (`DJP_PPN_004`, `DJP_PPN_009`).

## What is unresolved

- `DJP_PPN_007` is an **amendment** to PMK 11/2025. It has not been read. **The current position is
  therefore not established**, and no PPN rate should be activated until it is.
- Whether the 11/12 construction covers services identically to goods.
- Input VAT creditability conditions - no faktur pajak PER was found.

## Why this matters to the product

Migration 020 seeds `ID_PPN_MONTHLY` with `parameters {"rate":0.11}`. That number happens to
coincide with the described effective rate, but it was written before PMK 11/2025 existed and has no
verified source. It must be re-derived, not reused.

For Test Case 2 (rental), PPN on the faktur is a **separate question** from withholding. The engine
must never net them together.
