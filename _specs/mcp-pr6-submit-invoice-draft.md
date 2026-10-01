# MCP PR6a — `submit_invoice_draft` (invoice → pending payable draft)

Workspace type: **Business** (company workspaces only; personal workspaces are refused by the
existing company resolver). No Personal or Telegram-linking changes.

## Why
Founder flow: give an invoice to the AI assistant → it is analysed by CFO → it lands in CFO AI
as a payable **draft** → the founder gives the final confirmation inside CFO AI. Until now the
connector was read-only (Phase 1), so the last step was manual re-entry.

## Contract
- New MCP tool `submit_invoice_draft`, registered **only** when `MCP_WRITE_TOOLS_ENABLED=true`
  (read per request; default OFF → connector unchanged, still 4 read-only tools).
- Input: exactly one of `invoice_text` / `document_id` (same as `analyze_invoice`), plus optional
  model readings `counterparty`, `amount`, `currency`, `due_date`, `description`.
- The invoice is run through the same CFO pipeline as `analyze_invoice`. **CFO's reading wins**:
  model values only fill gaps CFO could not read. A model amount that differs from CFO's total
  by more than max(1, 0.5%) → `amount_mismatch`, nothing written.
- Currency: IDR only (same rule and same helper as the Telegram channel). Any non-IDR currency
  from either source → `currency_not_supported`.
- Persistence (`createPendingPayableDraft`, server/index.js): inserts into `debts` with
  `type='payable'`, `approval_status='pending_approval'` **regardless of role**,
  `source_channel='mcp'`, `last_action_channel='mcp'`.
  - plan limit `max_invoices_per_month` (same as `POST /api/debts`);
  - duplicate guard: open, non-rejected payable with same supplier (case-insensitive) + amount
    → `duplicate_payable`, returns the existing id;
  - audit: `audit_events` `mcp_payable_draft_created`, channel `mcp`;
  - Telegram approval request to approvers (`team_approvals` category) with the existing
    Approve / Reject / View impact callbacks.
- Approval uses the **existing, unchanged** endpoints (`/api/debts/:id/approve`, Telegram
  `/api/telegram/debts/:id/approve`). Pending drafts are already excluded from cash,
  payables, runway and Radar (Pulse builder `openDebts` filter).
- Payables UI: drafts from the connector show an "✦ AI assistant" badge.

## Not changed
No migrations (uses columns from 013/016/017). No auth changes. No payments/billing. No change
to approval rules or role gates. No Railway env changed.

## Risks
- A write path from an AI client (prompt injection from invoice content). Mitigated: draft-only,
  server-side pending status, CFO-extracted amounts, human approval required, audit row.
- Duplicate guard is heuristic (supplier + amount); a re-issued invoice with a different total
  is a new draft — the approver sees it in Payables.
- `source_channel='mcp'` is a new value for a text column (no DB constraint).

## Rollout
1. Merge with flag OFF (no production change).
2. Set `MCP_WRITE_TOOLS_ENABLED=true` on Railway when approved; reconnect the connector in
   Claude so the client refreshes its tool list.
3. Smoke: analyse a test invoice → submit → see draft in Payables + Telegram → approve → numbers
   appear in Pulse; reject path leaves numbers unchanged.

Tests: `tests/integration/mcpSubmitInvoiceDraft.test.js` (11) + existing MCP suites.
