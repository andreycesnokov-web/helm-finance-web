# MCP PR3 — real read-only tools

Status: implemented on `claude/mcp-pr3-read-tools`, stacked on PR1 (#88). Read-only. No migrations.

## Tools and the CFO services they call
| Tool | CFO service (same code the web app runs) | Gate (same as the web route) |
|---|---|---|
| `get_company_context` | `workspaceAccess.listAccessibleWorkspaces` + `findDefaultBusiness` | authenticated user |
| `get_financial_summary` | `buildAiCfoContext` — cash/burn/runway/debts engine shared by Pulse, AI CFO, Radar | `canViewBusinessFinance` |
| `get_missing_documents` | `buildRequiredDocuments` (body of `GET /api/ai-accountant/required-documents`) | `canViewBusinessFinance \|\| canUploadDocument` + `hasDocumentsAccess` |
| `analyze_invoice` | `readDocumentForIntake` / `readTextForIntake` → `analyzeDocumentReading` (→ `documentIntakeOrchestrator.processDocument`) + `findDocumentDuplicate` + `linkedInvoiceSettlement` / `invoiceReadinessPreview` (→ `invoiceSettlement.settlementOf` + `closeoutState`) | `canViewBusinessFinance` + `hasDocumentsAccess` (same as zero-write `/api/documents/:id/extract`) |

The services are injected into `attachMcp` from `server/index.js`; `server/mcp/*` never queries the
database itself.

## Decisions (and why)
1. **No `get_period_readiness`.** CFO has no period-readiness engine — only per-invoice `closeoutState`
   and the company checklist. A month rollup built in MCP would be a second engine. Needs a CFO service.
2. **No readiness percentage.** `closeoutState` returns state, `can_close`, blockers, the required/present
   checklist and missing documents. MCP returns those plus `required_documents_present / _total`
   (a count of the engine's own checklist). A % belongs in `closeoutState` if wanted, so web and MCP agree.
3. **Company resolution is read-only.** `ensureDefaultBusiness` auto-creates a business for positive-id
   users with none; MCP uses the extracted read-half `findDefaultBusiness`, so a lookup can never write.
4. **`get_financial_summary` is current-month only** (what `buildAiCfoContext` computes); no `period` arg.
5. **No `file_url`.** Fetching a model-supplied URL server-side is an SSRF vector. Inputs are
   `document_id` (stored in CFO) or `invoice_text` (text the AI client read). Upload is Phase 2.
6. **Client text is a model reading.** `readTextForIntake` tags it `client_model_text`; `assessTax` now
   treats that like `ocr_vision` — a PPN figure is only "detected" with evidence on the page and is always
   `tax_needs_review`. Without this, a tax figure an AI client inferred would be reported as "stated on
   the document". (One-line engine change, unit-tested; OCR/Vision wording unchanged.)
7. **Readiness basis is explicit.** A stored document already attached to an invoice gets that invoice's
   REAL settlement + closeout (`basis: linked_invoice`); anything else gets the engine's verdict for the
   invoice as if entered now with nothing paid (`basis: preview_as_new_invoice`).

## Behavior-preserving extractions in `server/index.js`
`findDefaultBusiness` (from `ensureDefaultBusiness`), `readTextForIntake` (new, same shape as
`readDocumentForIntake`), `analyzeDocumentReading` (post-read half of `runDocumentIntake`),
`buildRequiredDocuments` (route body), `findDocumentDuplicate` (from `/extract`), `buildInvoiceSettlement`
(settlement route body), plus `linkedInvoiceSettlement` and `invoiceReadinessPreview`. The routes now
call these functions; responses are unchanged.

## Production facts that affect the first demo (read-only check, 2026-10-01)
- **Helm Care Indonesia (HF-BIZ-000002)** — `admin_override_plan = enterprise` (open-ended): Document
  Center ON; 30 documents, 29 invoices. It is the earliest business, so it is also the default company.
  **Use it for the demo.**
- **Helm Care Pay (HF-BIZ-000004)** — trial ended 2026-07-02, no override, no add-on: effective plan
  `free`, Document Center OFF. `analyze_invoice` / `get_missing_documents` correctly return
  `document_center_not_enabled` — the same answer the web app gives. Enabling it is a plan decision.

## Known issue found while testing (not fixed here)
The CFO invoice extractor reads the invoice number as the word "Invoice" when an `INVOICE` title line
precedes `Invoice No:` (`documentExtraction.extractInvoiceFields`). Duplicate detection keys on that
number. Tracked as a separate task; affects the web app equally.

## Tests
`tests/integration/mcpReadTools.test.js` — 16 tests through a real MCP client: registry/annotations,
unauthenticated refusal, server-side company resolution (foreign company refused, id is a selector only),
generic errors, role and Document Center gates, curated summary, exactly-one-input validation,
cross-company document not found, archived refused, client-text pipeline with no writes, tax provenance,
real vs preview readiness, and the `assessTax` change itself.
