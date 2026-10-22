# CFO AI — OCR Pipeline Gap Analysis

**Date:** October 19, 2026  
**Component:** Document Extraction & OCR Pipeline  
**Comparison Target:** Commercial OCR Engines (e.g. Nanonets) vs. CFO AI Native Pipeline  
**Baseline Commit:** `8085655` (`feature/doc-extraction-reliability-p0`) / Baseline `a55876d`  

---

## 1. Summary Matrix: Existing / Reuse / Modify / Missing

| Capability Area | Status | Existing Assets & Files | Required Modifications / Missing Components |
|---|---|---|---|
| **1. Scanned PDF & Image Intake** | **MODIFY** | `server/lib/documentOcr.js:201-209` handles base64 image/PDF buffers. | Ingestion only sends raw PDF; lacks multi-page image rasterization (`pdf2pic` / `mupdf`). Fails on complex scans. |
| **2. Digital PDF Text Layer** | **MODIFY** | `server/lib/pdfText.js` extracts embedded text without dependencies. | Parser flattens text streams with spaces (`parts.join(' ')`), stripping line breaks and destroying tabular alignment. |
| **3. Multi-Page Package Segmentation** | **MISSING** | `documentOcr.js:64-69` detects `supporting_documents` flags. | Multi-page bundles (Invoice + TAC + Faktur Pajak) are processed as one flat blob without logical sub-document splitting. |
| **4. Table & Line-Item Extraction** | **MISSING** | `documentExtraction.js:237-248` extracts single `description` string. | Schema (`FIELD_KEYS`) lacks structured line-item support (`items: [{ description, qty, unit_price, total }]`). |
| **5. Bounding Box & Coordinates** | **MISSING** | None. | No spatial coordinate extraction (`[ymin, xmin, ymax, xmax]`). Unable to overlay interactive text highlights on document canvas. |
| **6. Source-Page Provenance** | **MODIFY** | Manual notes in fixtures. | Runtime does not link extracted fields to their originating page number. |
| **7. Indonesian Tax Entities** | **REUSE & EXTEND** | `documentExtraction.js:310-370` supports 15/16 NPWP, NSFP, DPP, PPN. | Validated on Circle K; needs extension for Alfamart multi-tier DPP and Coretax 2026 16-digit entity rules. |
| **8. Foreign Currency & Remittances** | **REUSE & EXTEND** | `telegramCurrency.js`, `invoiceSettlement.js:348-352`. | Extracts ISO currencies (USD, SGD, EUR). Needs cross-currency settlement date sequence validation (e.g. advance remittance). |
| **9. Arithmetic Reconciliation** | **REUSE & EXTEND** | `documentExtraction.js:359-385` calculates DPP vs Subtotal variance. | In commit `8085655`, records neutral variance `subtotal_dpp_variance`. Needs merge to main and extension to retail lease fees. |
| **10. Confidence & HITL Routing** | **REUSE** | `documentIntakeOrchestrator.js:29-37` closed state machine. | Sound architectural design. Confidence is safely capped at `medium` for OCR, routing ambiguous documents to human review. |
| **11. Model & Provider Abstraction** | **MODIFY** | `documentOcr.js:30` uses Anthropic `claude-sonnet-4-5`. | Valid Anthropic model ID; needs runtime environment override (`ANTHROPIC_OCR_MODEL`) and optional Gemini fallback. |
| **12. Zero-Posting Financial Safety** | **REUSE** | `documentIntakeOrchestrator.js:8-13` zero-write invariant. | Guarantees zero unverified financial ledger mutations or automated payable creation. |
| **13. Visual Verification Sidecar** | **MISSING** | Document Center UI (`client/src/v2/pages/Documents.jsx`). | Lacks side-by-side interactive document canvas with click-to-highlight source bounding boxes. |
| **14. Extraction Cost & Observability** | **MODIFY** | `documentOcr.js:27-29` byte and timeout limits. | Lacks token tracking, latency metrics, and prompt caching to minimize recurring API costs. |

---

## 2. Implemented Functionality vs. Measured Accuracy

> [!IMPORTANT]
> **Separation of Implemented Rules and Empirical Accuracy:**  
> CFO AI has implemented deterministic Indonesian accounting logic in code (e.g. `subtotal_dpp_variance` in branch `8085655`, NPWP 15/16 format normalization, Kwitansi direction inversion).  
> **However, CFO AI does NOT currently have measured benchmark superiority over Nanonets.**  
> A formal benchmark against real ground-truth documents is required before making accuracy claims.

| Accounting / Extraction Capability | Nanonets Document Agents | CFO AI Native (Current Baseline) | CFO AI Native (Branch `8085655`) | Status & Action |
|---|---|---|---|---|
| **Multi-row Line Items** | **Available** (Extracts multi-row tables cleanly) | **Not Implemented** (Scalar description only) | **Not Implemented** (Scalar description only) | High priority gap for Phase 0 schema |
| **Bounding Box Coordinates** | **Available** (Visual bounding box overlay) | **Not Implemented** | **Not Implemented** | High priority gap for Phase 2 UI |
| **Subtotal vs DPP Math** | **Observed Failure Risk** (Often conflates DPP with subtotal) | **Not Implemented** in baseline | **Implemented in Code** (`subtotal_dpp_variance: 10800000`) | Measured 100% on Circle K text; pending benchmark on PDF |
| **Kwitansi Outflow Classification** | **Observed Failure Risk** (Files as incoming bill) | **Implemented in Code** (Inverts direction) | **Implemented in Code** (Inverts direction) | Pending benchmark on multi-page bundles |
| **Zero-Posting Safety Guard** | **Dependent on External Webhook** | **Enforced by Invariant** | **Enforced by Invariant** | Verified in core architecture |

---

## 3. Deep-Dive Gaps

### Gap 1: Embedded Text Flattening
In `server/lib/pdfText.js:71`:
```javascript
return parts.join(' ');
```
By concatenating PDF text operators with spaces, newlines are lost and multi-column tables are collapsed into single strings.  
**Required Fix (Phase 0):** Track vertical positioning (`y` coordinates) to emit `\n` line delimiters between rows.

### Gap 2: Line-Item Array Schema
`server/lib/documentOcr.js` currently asks the model for scalar summary fields (`amount`, `commercial_base_amount`, `description`).  
**Required Fix (Phase 0):** Extend JSON prompt to request:
```json
"items": [
  {
    "description": "string",
    "quantity": 1,
    "unit_price": 0.0,
    "total_price": 0.0,
    "is_taxable": true
  }
]
```

### Gap 3: Model Configuration & Redundancy
While `claude-sonnet-4-5` is an official, valid model identifier, hardcoding it directly in source code prevents operators from toggling models dynamically during outages or testing lighter models (such as `gemini-1.5-flash` or `claude-3-5-sonnet-20241022`).  
**Required Fix (Phase 0):** Honor `process.env.ANTHROPIC_OCR_MODEL` and prepare multi-provider adapter interfaces.
