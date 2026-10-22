# CFO AI — Current Document Extraction & OCR Architecture

**Date:** October 19, 2026  
**Component:** Document Extraction, OCR & Multi-Page Reconciliation  
**Primary Engine:** Embedded Text Regex (`server/lib/documentExtraction.js`) + Vision Fallback (`server/lib/documentOcr.js`)  
**Active Production Baseline:** `a55876d` (`integration/cfo-v2-production-ready`)  
**Release Candidate Branch:** `feature/doc-extraction-reliability-p0` (`8085655`)  

---

## 1. High-Level Architecture Overview

CFO AI processes incoming accounting documents (commercial supplier bills, tax invoices, bank transfer receipts, and rental packages) through a two-tier extraction pipeline:

```mermaid
graph TD
    Upload[Document Upload\nPDF / JPEG / PNG] --> Dedup[SHA-256 Hash Deduplication\nStorage bucket 'documents']
    Dedup --> InvariantCheck[Zero-Posting Guard Invariant\nStatus: 'suggested' | 'needs_manual_review']
    
    InvariantCheck --> Tier1Text[Tier 1: Embedded Text Parser\nserver/lib/pdfText.js + documentExtraction.js]
    
    Tier1Text -->|Text Present & Valid| RuleEngine[Deterministic Accounting Rules\nDPP vs Subtotal, NPWP, Kwitansi Inversion]
    Tier1Text -->|No Text / Corrupted| FlagCheck{DOCUMENT_OCR_VISION_ENABLED\nis true?}
    
    FlagCheck -->|true| Tier2Vision[Tier 2: Frontier Vision Fallback\nserver/lib/documentOcr.js\nDefault: claude-sonnet-4-5]
    FlagCheck -->|false / Default| FallbackManual[No API Call\nstatus: 'needs_manual_review']
    
    Tier2Vision --> Merge[Merge Vision Result into Base Extraction\nserver/lib/documentOcr.js:mergeIntoExtraction]
    Merge --> RuleEngine
    
    RuleEngine --> Output[Structured Extraction Payload\nPresented to Accountant UI for Confirmation]
```

---

## 2. Core Modules & Responsibilities

| File Path | Core Responsibility | Current Operational State |
|---|---|---|
| [`server/lib/pdfText.js`](file:///server/lib/pdfText.js) | Pure JS extraction of raw text streams (`Tj`/`TJ` operators) from PDF files. | Active in baseline; flattens text streams with spaces (`parts.join(' ')`), which strips tabular structure. |
| [`server/lib/documentExtraction.js`](file:///server/lib/documentExtraction.js) | Label-driven regex parser for Indonesian documents, NPWP format normalization, and anchor classification. | Active in baseline. In RC `8085655`, extended with `subtotal_dpp_variance` and package priority rules. |
| [`server/lib/documentDates.js`](file:///server/lib/documentDates.js) | Parses and disambiguates Indonesian and international date formats (`dd/mm/yyyy` vs `yyyy-mm-dd`). | Active in baseline; separates `document_date`, `due_date`, and `payment_date`. |
| [`server/lib/documentParties.js`](file:///server/lib/documentParties.js) | Extracts issuer and buyer legal names, addresses, and Coretax NPWP (15 and 16 digits). | Active in baseline. |
| [`server/lib/documentOcr.js`](file:///server/lib/documentOcr.js) | Anthropic Vision API caller for image and scanned PDF buffers. | Gated by `DOCUMENT_OCR_VISION_ENABLED=false` (disabled in production runtime). Default model configured as `claude-sonnet-4-5`. |
| [`server/lib/documentIntakeOrchestrator.js`](file:///server/lib/documentIntakeOrchestrator.js) | Coordinates SHA-256 deduplication, pipeline execution, and database state transitions. | Enforces the Zero-Posting Guard invariant. |

---

## 3. Frontier Model Configuration & Official Status

In [`server/lib/documentOcr.js:30`](file:///server/lib/documentOcr.js#L30):
```javascript
const MODEL = process.env.ANTHROPIC_OCR_MODEL || 'claude-sonnet-4-5';
```

- **Official Model Verification:**
  - `claude-sonnet-4-5` (versioned `claude-sonnet-4-5-20250929`) is an official Anthropic frontier model released on September 29, 2025, specifically optimized for agentic coding, multi-step document reasoning, and computer use.
  - Anthropic has scheduled first-party retirement for this model on November 30, 2026.
  - **Verdict:** `claude-sonnet-4-5` is an active, valid API model identifier. It should NOT be downgraded to an older model (such as `claude-3-5-sonnet`) without evidence.
  - **Enhancement Recommendation:** Support `ANTHROPIC_OCR_MODEL` environment override in all call sites to permit seamless model switching without code deployments.

---

## 4. Provider Pricing & Unit Economics

| Provider & Model | Official API Pricing (Input / Output per 1M Tokens) | Prompt Caching Discount | Estimated Cost Per Document Extraction | Pricing Verification Status |
|---|---|---|---|---|
| **Anthropic Claude Sonnet 4.5** | **$3.00** / MTok in<br>**$15.00** / MTok out | **$0.30** / MTok read<br>**$3.75** / MTok write | **~$0.009 – $0.0165** / doc *(Single-page)*<br>**~$0.024** / doc *(3-page package)* | **Verified Official Pricing** *(Per-document figure is an engineering estimate based on ~1,500–2,500 input and ~300–600 output tokens)* |
| **Google Gemini 1.5 / 2.0 Flash** | **$0.075** / MTok in<br>**$0.30** / MTok out | N/A (Standard tier) | **~$0.0003 – $0.0005** / doc | **Verified Official Pricing** *(Per-document figure is an engineering estimate)* |
| **Google Gemini 1.5 / 2.5 Pro** | **$1.25** / MTok in<br>**$5.00** / MTok out | Context caching available | **~$0.004 – $0.006** / doc | **Verified Official Pricing** *(Per-document figure is an engineering estimate)* |
| **Nanonets Commercial SaaS** | ~$0.10 – $0.30 / page<br>(Plans: $499–$999/mo) | N/A | **~$0.10 – $0.30** / page | **Estimated from Public Marketing Plans** *(Subject to enterprise volume commitments and custom model fees)* |

---

## 5. Architectural Invariants

1. **Zero-Posting Financial Invariant:**  
   Extraction results are purely advisory (`suggested` or `needs_manual_review`). No transaction, journal entry, or approved payable is ever written to the ledger automatically.
2. **Entity Separation Invariant:**  
   Commercial subtotal (`invoice_subtotal`), Faktur Pajak tax base (`dpp`), statutory VAT (`ppn`), and receipt total (`receipt_total`) are stored in distinct database fields and are never auto-equated.
3. **Fail-Open Resilience:**  
   Any OCR or parsing error returns `{ ok: false, reason }` without throwing unhandled exceptions or disrupting customer uploads.
