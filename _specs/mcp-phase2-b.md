# MCP Phase 2 · Batch B — documents through the connector

Workspace: **Business**. No migrations, no auth change, no Railway env, no new flags (write tools
use the existing `MCP_WRITE_TOOLS_ENABLED`; the upload-link route uses it too).

## Tools (8 in total now — budget ≤ 15)
| Tool | Kind | Gate (same as the web route) |
|---|---|---|
| `list_documents` | READ | `canViewBusinessFinance` OR `canUploadDocument`; Document Center; web visibility (manager/employee: own uploads or linked to own requests) |
| `upload_document` | WRITE (flag) | `canUploadDocument`; Document Center; storage ready |
| `link_document` | WRITE (flag) | `canManageDocuments`; Document Center |
| `submit_invoice_draft` | (existing) | + attaches its source `document_id` to the new draft |

### list_documents
Filters: `status` (`needs_review` = not attached and intake not `ready_to_confirm` / type unconfirmed;
`unlinked`; `linked`; `archived`), `period` YYYY-MM (document date, else upload date),
`counterparty_id`, `document_id`, `uploaded_after` (ISO), `limit` ≤ 50. Returns metadata + the
intake summary only — never document text (`notes`), storage paths, hashes or uploader ids.
`include_download_url` issues 10-minute signed links through the same audited path as the web
(`signed_url_issued`, channel `mcp`), for at most 5 documents per call.

### upload_document
1. **Inline**: `file_base64` + `file_name` + `mime_type`, ≤ 7 MB (the JSON body limit is 10 MB and
   base64 is 4/3 of the bytes). The server writes the bytes to storage and finalises exactly like
   the web upload (`finalizeDocumentUpload`, extracted from `upload-complete`): server-side SHA-256,
   business-scoped dedup (an identical file returns `duplicate` + `existing_document_id`, nothing
   stored), atomic create + audit (`rpc_document_finalize_upload`, `upload_channel`/`channel` =
   `mcp`), optional link, intake run. Same MIME/size/name validation (`docV.validateUpload`).
2. **Link** (no bytes): a 15-minute upload link — owner decisions 2026-10-02:
   * signed token, no table (`server/lib/uploadLink.js`): one user + one company + optional
     document type / link target; key derived from `JWT_SECRET` with its own audience, so it can
     never verify as a CFO session token and vice versa; cannot be revoked before expiry
     (accepted);
   * the token travels in the URL **fragment** (`/upload#t=…`) — never sent to a server, so not in
     access logs or Referer;
   * the `/upload` page **requires sign-in as the same CFO user** (`link_for_another_account`
     otherwise) and re-checks the link before every upload; it uploads through the ordinary
     `upload-init` / `upload-complete` routes with their own role/plan/membership gates, scoped to
     the link's company (`uploadDocument(..., { businessId })`). The token grants nothing the user
     could not do in the app. `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `no-store`.
   * `POST /api/upload-link/session` (auth) answers what the link is for; 404 while
     `MCP_SERVER_ENABLED`/`MCP_WRITE_TOOLS_ENABLED` are off.
   The tool returns `upload_url`, `expires_at` and a `next_step` telling the model to call
   `list_documents` with `uploaded_after=<issued_at>` once the user says it is uploaded.
- `link_to {type: payable|receivable|transaction, id}`: the target must exist in this company with
  that type; a submit-only role may only attach to a request it created; transactions need the
  manage role.

### link_document
Attach a stored document to a payable / receivable / transaction (`linkDocument`, the web's own
RPC with its cross-business check), or `unlink: true` to remove exactly that link. Evidence only —
never approves, pays or settles. Audited by the document RPCs (channel `mcp`).

### submit_invoice_draft
When built from `document_id`, the document is attached to the new draft (best effort; the reply
carries `document_attached`). Pasted text has no stored document → `null`.

## Shared code (web and MCP through one path)
- `finalizeDocumentUpload` — the second half of `upload-complete` (verification, dedup, atomic
  create, link, intake). The web route now calls it; behaviour unchanged.
- `storeDocumentBytes` — MCP: storage readiness, validation, hash pre-check, storage write, then
  `finalizeDocumentUpload`.
- `listDocumentsForUser` — body of `GET /api/documents` (unchanged for the web) + MCP-only filters.
- `signedDocumentUrl` — body of `POST /api/documents/:id/signed-url`.
- `linkDocument(..., channel)` — channel parameter (default `web`).

## Fix carried in this batch
Orchestrator `financial_record.date` now falls back to the dates module (`documentDates`) — a
read invoice date no longer produced "No date could be read; the draft will need one." (seen live
on the PT. PARA LEGALS invoice). Web and MCP both pass `dates` through `analyzeDocumentReading`.

## Tests
- `tests/integration/mcpDocuments.test.js` (18): flag OFF registration; tool budget; list
  metadata without text; status/period mapping; download-link cap; unknown/foreign/Document
  Center off; inline upload; duplicate; bad base64 / missing name / > 7 MB / foreign company →
  nothing stored; auditor; link mode (user+company bound, nothing written); link target type &
  ownership; manager link_to; link/unlink; refusals write nothing; submit attaches its document;
  draft stands when attaching fails.
- `tests/uploadLink.test.js` (6): round trip, 15-minute expiry, tampering, other secret, not
  interchangeable with session tokens, missing claims.
- `documentIntakeOrchestrator` +1 (date fix). Tool-list assertions updated in mcpOAuth,
  mcpReadTools, mcpRoles, mcpSubmitInvoiceDraft for the new tools.

## Not in this batch
Counterparties (C — owner chose option B: propose only, no migration), draft editing / receivable
direction (D), period readiness / accountant package with storage and withholding documents in the
invoice checklist (E — package storage needs a migration, ask first), prompts / language (F).
