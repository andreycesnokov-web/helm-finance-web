# CFO AI — Document Extraction & OCR Improvement Roadmap

**Date:** October 19, 2026  
**Component:** Document Extraction & OCR Pipeline  
**Target:** Match and exceed commercial OCR capabilities while preserving native Indonesian accounting intelligence  

---

## 1. Roadmap Architecture & Phasing

```mermaid
graph TD
    subgraph Phase0A[Phase 0A: Benchmark Preparation - CURRENT STAGE]
        P0A_1[Verify Model Identifiers\nValidate claude-sonnet-4-5 in Anthropic catalog]
        P0A_2[Verify Pricing Claims\nOfficial rates + token-based estimates]
        P0A_3[Define Ground Truth Schemas\nStrict entity separation: Subtotal, DPP, PPN, Receipt]
        P0A_4[Read-Only Benchmark Runner\nZero paid API calls, 100% offline evaluation]
    end

    subgraph Phase0[Phase 0: Quick Wins - Code & Prompt Only]
        P0_1[Environment Model Override\nSupport ANTHROPIC_OCR_MODEL with claude-sonnet-4-5 default]
        P0_2[Structured Line Items Prompt\nExtract items array: description, qty, unit_price, total]
        P0_3[Preserve PDF Layout in pdfText.js\nRetain newlines between text blocks]
        P0_4[Multi-Page Priority Merge\nMerge branch 8085655 to active codebase]
    end

    subgraph Phase1[Phase 1: Multi-Page Segmentation & Hybrid Routing]
        P1_1[Logical Document Segmentation\nSplit 3-page package into Invoice + Agreement + Tax Invoice]
        P1_2[Source Page Provenance\nMap extracted fields to originating page number]
        P1_3[Deterministic Indonesian Tax Engine\n12% VAT validation & multi-tier lease math]
    end

    subgraph Phase2[Phase 2: Visual Bounding Boxes & Dual-Model Architecture]
        P2_1[Normalized Spatial Bounding Boxes\nExtract [ymin, xmin, ymax, xmax] coordinates]
        P2_2[Dual-Model Adapter\nAnthropic Claude Sonnet + Google Gemini 1.5/2.0 Flash/Pro]
        P2_3[Interactive Verification UI\nSplit-screen sidecar with document coordinate highlights]
        P2_4[Prompt Caching & Cost Optimization\nReduce recurring vision cost by 70-80%]
    end

    Phase0A --> Phase0 --> Phase1 --> Phase2
```

---

## 2. Phase 0: Immediate Quick Wins (Code & Prompts Only — Zero External Dependencies)

| Task ID | Item | Expected Benefit | Engineering Effort | Risk / Disruption | Estimated Cost |
|---|---|---|---|---|---|
| **P0-1** | **Support `ANTHROPIC_OCR_MODEL` Env Var** in `server/lib/documentOcr.js:30` | Allows runtime configuration of frontier models while keeping `claude-sonnet-4-5` as default without hardcoding risks. | 0.5 hours | None | $0 |
| **P0-2** | **Add Line-Item Schema to Vision Prompt** | Extracts tabular rows (`items: [{ description, qty, unit_price, total }]`), closing table extraction gap. | 3 hours | Low (schema extension) | $0 |
| **P0-3** | **Structured PDF Layout Text Extractor** | Modifies `server/lib/pdfText.js` to preserve line breaks (`\n`) and column gaps instead of `parts.join(' ')`. Allows regex to read tables. | 4 hours | Low | $0 |
| **P0-4** | **Merge P0 Package Prioritization** | Merges commit `8085655` (`subtotal_dpp_variance`, package prioritization) into active codebase after owner approval. | 2 hours | Low | $0 |
| **P0-5** | **Alfamart & Kwitansi Direction Rules** | Hardens `documentExtraction.js` and `documentIntakeOrchestrator.js` to recognize multi-document retail lease math. | 3 hours | Low | $0 |

**Total Phase 0 Effort:** ~12.5 engineering hours (~1.5 days).  
**Direct Cost:** $0.

---

## 3. Phase 1: Multi-Page Segmentation & Two-Tier Routing

| Task ID | Item | Expected Benefit | Engineering Effort | Risk / Disruption | Estimated Cost |
|---|---|---|---|---|---|
| **P1-1** | **Logical Document Segmentation** | Splits multi-page packages into discrete sub-documents (Page 1: Commercial Bill, Page 2: Agreement, Page 3: Faktur Pajak). Prevents date and amount collisions. | 8 hours | Medium (affects `ai_intake_v2` schema) | $0 |
| **P1-2** | **Source-Page Provenance Engine** | Records `source_page: 1` per field, enabling UI to show exactly which page contributed each value. | 4 hours | Low | $0 |
| **P1-3** | **Alfamart Lease & Withholding Engine** | Implements automated separation for PPh 4(2) final rental withholding vs statutory 12% PPN. | 6 hours | Low | $0 |

**Total Phase 1 Effort:** ~18 engineering hours (~2.5 days).  
**Direct Cost:** $0.

---

## 4. Phase 2: Visual Bounding Boxes & Dual-Model Architecture

| Task ID | Item | Expected Benefit | Engineering Effort | Risk / Disruption | Estimated Cost |
|---|---|---|---|---|---|
| **P2-1** | **Spatial Coordinate Extraction** | Prompts model for `[ymin, xmin, ymax, xmax]` normalized coordinates (0–1000) for every header and line-item row. | 6 hours | Low | $0 |
| **P2-2** | **Multi-Provider Fallback Adapter** | Seamless fallback between Anthropic Claude Sonnet 4.5 and Google Gemini 1.5/2.0 Flash for maximum reliability and cost control. | 8 hours | Medium | $0 |
| **P2-3** | **Interactive UI Verification Sidecar** | Integrates interactive canvas in Document Center (`Documents.jsx`) with click-to-highlight source bounding boxes. | 16 hours | Medium (frontend UI) | $0 |
| **P2-4** | **Anthropic Prompt Caching Optimization** | Caches standard accounting schema and instructions, reducing input token costs from $3.00/M to $0.30/M. | 4 hours | Low | $0 |

**Total Phase 2 Effort:** ~34 engineering hours (~4.5 days).  
**Direct Cost:** $0.
