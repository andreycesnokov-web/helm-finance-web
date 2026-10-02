# MCP PR7 — `submit_receivable_draft` (a client owes us)

Owner request (2026-10-02): "I invoiced someone and need to collect — record it as a receivable
through the CFO AI connector."

## Contract
- Creates a `debts` row with `type='receivable'`, `approval_status='pending_approval'` —
  always, whatever the caller's role. Pending receivables are already excluded from
  receivables, net position and the AI CFO context (the same filter Telegram submissions use)
  until a human approves them in Receivables or via the Telegram Approve button. No money moves.
- Same gates as `submit_invoice_draft`: server flag `MCP_WRITE_TOOLS_ENABLED` **and**, for OAuth
  callers, the `cfo:drafts` consent scope (PR6). Role: `canCreateFinancialRequest`.
- Two inputs:
  1. **From the user's words** — `customer` + `amount` required, optional `due_date`,
     `invoice_number`, `description`. Stored with `amount_source='user_statement'` and a warning
     to attach the invoice.
  2. **From an issued invoice** — `invoice_text` or `document_id` (at most one). Runs the CFO
     analysis (Document Center gate applies); the client is the invoice's *buyer*, CFO's total
     wins and a conflicting model amount is refused (`amount_mismatch`).
- An invoice whose buyer is this company is refused as `looks_like_payable` (that is a bill to
  pay → `submit_invoice_draft`). An issuer that is not this company adds a warning.
- IDR only (receivable display/payment/aggregation do not read currency yet — same reason as
  the Telegram/PR6 rule). Never reinterpret an amount across currencies.
- Duplicate guard: open receivable with the same client + amount → `duplicate_receivable`.
- Plan limit (`max_invoices_per_month`), audit `mcp_receivable_draft_created`, Telegram
  approval request `mcp_receivable_submitted` (RU/EN/ID) with Approve / Reject / View impact /
  Open → `/receivables`.

## Code
- `server/index.js`: `createPendingPayableDraft` generalised to
  `createPendingDebtDraft(biz, userId, draft, type)` (payable wrapper kept).
- `server/mcp/tools.js`: `submitReceivableDraft` + registry entry; `server/mcp/server.js`:
  write instructions mention both tools.
- `client/src/pages/Receivables.jsx`: "✦ AI assistant" badge for `source_channel='mcp'`.
- Tests: `tests/integration/mcpSubmitReceivableDraft.test.js` (9).

No migrations, no env changes (uses the PR6 flag), no change to approval endpoints.
After deploy the connector needs no reconnect if it already holds `cfo:drafts` — Claude picks the
new tool up on its next tool-list refresh (reconnect if it does not appear).
