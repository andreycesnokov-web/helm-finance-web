# CFO AI Platform: Integration Capability & Verification Matrix

**Document Date:** October 18, 2026  
**Auditor:** CFO AI Engineering Agent  
**Repository:** `andreycesnokov-web/helm-finance-web`  
**Branch:** `feat/cfo-ai-website-cms-hub`  
**Governance Principle:** Strict Truthfulness — Zero fabricated or exaggerated automation claims.

---

## 1. Overview & Verification Standards

To uphold compliance with Indonesian data protection and statutory accounting laws (UU PDP No. 27/2022, UU KUP, PMK 81/2024 CoreTax), every integration channel and capability displayed on the CFO AI public platform page is classified into three strict operational statuses:

- **Available:** Fully implemented, tested, and operational end-to-end in application code.
- **In Development:** Implementation exists in the codebase (e.g., protocol handlers, route handlers, schema migrations) but is gated behind feature flags or pending final production release.
- **Planned:** Architected on the technical roadmap with conceptual specifications, but lacking an active server-side bot or webhook.

---

## 2. Channel-by-Channel Capability Matrix

| Channel | Advertised Functionality | Actual Verified Codebase Reality | Status | Supporting Code & Evidence | Operational Boundaries & Guardrails |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **WhatsApp** | Direct receipt and invoice submission from chat conversations | `server/index.js` line 1523 specifies `const ACTION_CHANNELS = ['web', 'telegram', 'mobile', 'api', 'whatsapp_future'];`. No WhatsApp bot, webhook, or BSP integration exists. | **Planned** | `server/index.js:1523`<br>`client/src/v2/i18n/` contact label only | **Strict Rule:** Displayed strictly as a conceptual roadmap feature. No claims of active WhatsApp photo parsing. |
| **Telegram** | 1. Query financial metrics, cash runway, and pending approvals.<br>2. One-tap inline expense approval/rejection.<br>3. Receipt photo intake. | Bot routes for authentication (`/api/auth/telegram`), workspace resolution (`server/lib/telegramWorkspace.js`), user actor resolution (`server/lib/telegramActor.js`), and bot approvals (`POST /api/telegram/debts/:id/approve` and `reject`) are fully implemented and tested. Photo/PDF OCR intake via Telegram bot is not implemented. | **Available** *(Text Queries & Inline Approvals)*<br><br>**Planned** *(Photo/PDF OCR Ingestion)* | `server/lib/telegramActor.js`<br>`server/lib/telegramLink.js`<br>`server/lib/telegramWorkspace.js`<br>`tests/integration/botSecret.test.js`<br>`tests/integration/telegramActorWiring.test.js` | Bot secret (`x-bot-secret`) + cryptographic token verification. Inline buttons enforce role-based limits (CEO/Owner self-approval rules). |
| **ChatGPT** | Natural language financial queries and runway analysis via connected AI assistant | Model Context Protocol (MCP) Streamable HTTP server implemented (`server/mcp/server.js`). RFC 9728 OAuth endpoints implemented (`server/mcp/oauth/`). Supports ChatGPT connector callbacks. Read-only tools (`get_ai_cfo_context`, `list_documents`, `get_document_details`). Gated by `MCP_SERVER_ENABLED` and `MCP_OAUTH_ENABLED`. | **In Development (MCP)** | `server/mcp/server.js`<br>`server/mcp/tools.js`<br>`server/mcp/oauth/provider.js`<br>`migrations/057_mcp_oauth.sql` | **Strict Rule:** Read-only ledger queries and runway analysis. No automatic posting or money movement. Write actions restricted to pending drafts requiring human review. |
| **Claude** | Contextual ledger analysis, burn rate evaluation, and voucher citation via MCP | MCP server with Anthropic/Claude callback integration (`https://claude.ai/api/mcp/auth_callback`, Claude Code, and Claude Desktop). Exposes tools for financial synthesis with verified voucher citations. Gated behind `MCP_SERVER_ENABLED` and `MCP_OAUTH_ENABLED`. | **In Development (MCP)** | `server/mcp/server.js`<br>`server/mcp/tools.js`<br>`server/mcp/oauth/provider.js`<br>`server/mcp/oauth/consent.js` | Scoped token isolation per tenant. AI suggests analysis; cannot execute payments or bypass segregation of duties. |
| **CFO AI Web App** | Direct document upload (PDF, JPG, PNG, WEBP), bank statement reconciliation (CSV, MT940), approval queue, and multi-currency billing | Full-featured responsive web application. Implements Document Intake OCR with verification drawer, automated bank matching engine, and multi-currency invoicing. | **Available** | `client/src/v2/pages/Documents.jsx`<br>`server/lib/documentValidation.js`<br>`server/lib/bankParser.js`<br>`server/lib/incomingPaymentMatching.js` | Enforces 15MB file size limit, MIME validation, tenant data isolation, and human-in-the-loop confirmation workbench. |

---

## 3. Central Intelligence Core Capabilities

| Capability | Application Code Reference | Implementation Status | Human-in-the-Loop Safeguard |
| :--- | :--- | :--- | :--- |
| **Document Intelligence** | `server/lib/documentExtraction.js`<br>`server/lib/documentOcr.js` | **Available** | Text parser & Claude Sonnet 4.5 Vision OCR extracts fields into pending intake state. |
| **Data Validation & Review** | `server/lib/documentIntakeOrchestrator.js`<br>`client/src/v2/components/DocumentReviewDrawer.jsx` | **Available** | "AI suggests. User confirms." User must verify vendor, DPP, and PPN 11% before posting. |
| **Approvals & Governance** | `client/src/v2/pages/Approvals.jsx`<br>`client/src/v2/lib/decisions.js` | **Available** | Threshold routing. Self-approval blocked unless user is Owner/CEO. Complete audit log. |
| **Reconciliation & Insights** | `server/lib/incomingPaymentMatching.js`<br>`server/lib/burnRunway.js` | **Available** | Deterministic multi-signal bank scoring. 30/60/90-day cash trajectory and runway alerts. |

---

## 4. Destination Operational Domains

All incoming data streams resolve into isolated, audit-ready operational domains:
1. **Transactions:** Reconciled bank records, live balances, and multi-currency feeds.
2. **Documents:** Digital archive of receipts, tax invoices (Faktur Pajak), and Bukti Potong P-05 slips.
3. **Invoices & Bills:** Accounts Receivable aging buckets and Accounts Payable payment queues.
4. **Approvals:** Immutable management authorization history with threshold enforcement.
5. **Financial Reports:** Balanced General Ledger, P&L, balance sheets, and statutory tax schedules.
6. **Audit Trail:** Tamper-evident operational activity logs and user action stamps.

---

## 5. Architectural Guardrails & Security

1. **Tenant Isolation:** Every request from any channel is scoped strictly to the authenticated `business_id` (via `channelIdentity.js`, `telegramActor.js`, or `mcpUser`).
2. **Read-Only by Default:** MCP integrations for Claude and ChatGPT are strictly read-only for ledger analysis. Draft writes (`create_pending_payable_draft`) create unposted staging records that require manual human approval in the Web App.
3. **No Direct File Ingestion via MCP:** File uploads require the Web App or authorized signed upload links (`issueUploadLink`), enforcing MIME verification and antivirus/size limits.
4. **No Customer Financial Data in Model Training:** Zero-data-sharing policy enforced per UU PDP Law No. 27/2022.
