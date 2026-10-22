# CFO AI — Benchmark Suite Specification (Phase 0A)

**Date:** October 19, 2026  
**Status:** Implemented & Verified Offline  
**Runner:** `tests/benchmark/runner.cjs`  
**Schema:** `tests/benchmark/schemas/ground_truth_schema.json`  

---

## 1. Objective

Provide an automated, reproducible, read-only benchmark suite to evaluate CFO AI's document extraction accuracy against human-verified accounting ground truth without incurring third-party API costs.

---

## 2. Invariants Enforced

1. **Zero External Paid API Calls:** The runner operates 100% offline using local fixtures.
2. **Zero-Posting Financial Invariant:** Every extraction must result in an advisory status (`suggested` or `needs_manual_review`), never auto-approving or posting to the ledger.
3. **Distinct Accounting Entity Separation:** 
   - `invoice_subtotal` (Commercial invoice line sum)
   - `faktur_pajak_dpp` (Official DJP tax base)
   - `subtotal_dpp_variance` (Calculated difference)
   - `ppn_amount` (Statutory VAT)
   - `receipt_total` (Kwitansi / POS receipt total)
   - `settled_amount` (Bank remittance payment proof)
4. **Direction Inversion:** Kwitansi receipts must be classified as outflow vouchers (`receipt`), inverting party roles from payee to payer.

---

## 3. Case Inventory

| Case ID | Document Title | Document Type | Verification Status | Missing User Artifacts |
|---|---|---|---|---|
| **CASE_A_CIRCLEKA** | Circle K Indonesia 3-Page Commercial Invoice & Tax Package | `multi_document_package` | Verified Production Ground Truth | Original PDF, Nanonets JSON |
| **CASE_B_LMX** | Location Media Xchange (LMX) 1-Page International SaaS Invoice | `commercial_invoice` | Synthetic Candidate Pending Raw Files | Original PDF, Nanonets JSON |
| **CASE_B_BCA_CONFIRMATION** | BCA Outward Remittance / Payment Confirmation | `payment_proof` | Synthetic Candidate Pending Raw Files | Original PDF, Nanonets JSON |
| **CASE_C_ALFAMART** | Alfamart 3-Page Retail Lease & Tax Package | `multi_document_package` | Synthetic Candidate Pending Raw Files | Original PDF, Nanonets JSON |

---

## 4. Benchmark Execution Command

```bash
node tests/benchmark/runner.cjs
```
