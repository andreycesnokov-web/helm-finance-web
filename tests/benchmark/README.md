# CFO AI — Document Extraction Benchmark Suite (Phase 0A)

This directory contains the automated, read-only benchmark evaluation suite for CFO AI's document extraction and OCR pipeline.

## 1. Principles & Constraints
1. **100% Read-Only & Offline:** Zero external paid API calls. All evaluations run against sanitized local fixtures.
2. **Strict Invariant Validation:**
   - **Zero-Posting Guard:** Documents remain as suggestions (`suggested` / `needs_manual_review`); no automatic approval or ledger posting.
   - **Entity Separation:** Commercial invoice subtotal, Faktur Pajak DPP, PPN, and receipt totals are strictly kept distinct and never auto-equated.
   - **Direction Inversion:** Kwitansi receipts record outflow vouchers, inverting parties from payee to payer.
3. **Evidence-Based Scoring:** Separates implemented deterministic domain logic from measured empirical benchmark accuracy.

## 2. Directory Structure
```
tests/benchmark/
├── README.md                                     # Benchmark suite documentation
├── runner.cjs                                    # Deterministic evaluation runner
├── schemas/
│   └── ground_truth_schema.json                  # Canonical JSON schema for ground truth
├── fixtures/
│   ├── circleka_fixture.cjs                      # Case A: Circle K 3-page package text
│   ├── lmx_fixture.cjs                           # Case B1: LMX 1-page USD invoice text
│   ├── bca_payment_confirmation_fixture.cjs      # Case B2: BCA remittance confirmation text
│   └── alfamart_fixture.cjs                      # Case C: Alfamart 3-page retail package text
└── ground_truth/
    ├── circleka_ground_truth.json                # Verified production ground truth
    ├── lmx_ground_truth.json                     # Synthetic candidate pending raw files
    ├── bca_payment_confirmation_ground_truth.json# Synthetic candidate pending raw files
    └── alfamart_ground_truth.json                # Synthetic candidate pending raw files
```

## 3. Running the Benchmark
Execute the deterministic runner:
```bash
node tests/benchmark/runner.cjs
```

The runner evaluates both the current repository branch baseline and the Release Candidate P0 worktree (`feature/doc-extraction-reliability-p0 @ 8085655`) if present, providing an exact side-by-side delta.
