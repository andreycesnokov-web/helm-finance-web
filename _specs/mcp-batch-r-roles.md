# MCP Batch R — manager / employee access through the connector

Workspace: **Business**. No migrations, no auth change, no Railway env, no new flags.
Web routes, Telegram and the approve rules (incl. the self-approval guard) are unchanged.

## Problem
`analyze_invoice` and `submit_invoice_draft` required `canViewBusinessFinance`, so a manager or
employee could not file a payment through the AI connector although they can in the web app and
Telegram (`canCreateFinancialRequest`).

## Contract
| Tool | owner / ceo / admin / cfo / accountant | auditor | manager / employee |
|---|---|---|---|
| get_company_context | ✓ | ✓ | ✓ |
| get_financial_summary | ✓ | ✓ | ✗ `forbidden_role` (unchanged) |
| get_missing_documents | ✓ | ✓ | ✓ (unchanged gate) |
| analyze_invoice | full | full | **limited**: invoice fields, currency, total, extraction warnings |
| submit_invoice_draft | ✓ pending draft | ✗ | ✓ pending draft = **request** |

- Gates reuse the injected role helpers: submit = `canCreateFinancialRequest` +
  `canUploadDocument` + `hasDocumentsAccess`; analyze = `canViewBusinessFinance` OR the submit
  roles.
- **Limited view** (`view: 'limited_for_role'`) omits everything derived from the company's
  other records: `package_readiness`, `counterparty` (directory matches), `suggested_record`,
  `duplicate`, `tax`, `blockers`, `next_actions`. Warnings come from the extraction only; a
  duplicate document becomes a generic line.
- **Duplicate payable** for a submit-only role: `{ error, message }` only — no id, amount or
  counterparty of the existing record. Finance roles keep `existing`.
- **Requests**: when the caller cannot approve (`canApproveFinancialRecord` false) the reply
  carries `submitted_as: 'request'` and a note that owner/admin/CFO must approve; the tool
  description says the same. No separate logic — the draft is the same pending payable.
- **Stored documents**: `document_id` now follows the web visibility rule for manager/employee
  (own upload, or linked to a debt they created — `canAccessDocument` service = `attachLinks` +
  `userCanAccessDoc`). Otherwise `document_not_found`; fails closed if the service is missing.
  Before this batch business scoping was the only check (finance roles only, so not reachable
  by managers until now).
- **Tool list**: `buildServer` registers only tools usable in at least one of the user's company
  memberships (personal workspaces ignored). UX only — every call re-checks the role in the
  company it acts in. A manager-everywhere user therefore gets "tool not found" for
  `get_financial_summary`; a user who is owner in A and manager in B sees it and gets
  `forbidden_role` in B. Memberships are fetched once per request (shared with
  `get_company_context`); an unevaluable predicate keeps the tool listed (the filter can never
  fail a request).

## Notifications
`notifyRequestCreatorViaTelegram` resolves the creator from `created_by_user_id`, which
`createPendingPayableDraft` sets to the caller via `bizWriteFields`. It is called by both approve
and reject paths (web and Telegram) regardless of `source_channel`, so an MCP request's author is
already notified. No new send site; `notificationPolicy` inventory untouched.

## Tests
`tests/integration/mcpRoles.test.js` (14): manager/employee submit → pending request; limited
analyze; manager summary refused (hidden / forbidden in mixed); duplicate without details;
owner duplicate keeps details; auditor refused; owner/cfo regression; tools/list per role;
owner-in-A + manager-in-B; foreign company; document visibility incl. fail-closed.
MCP suites + documentsNoCashImpact + notificationPolicy 121/121. Full suite 1464/1465 (only the
pre-existing `telegramActorWiring › no migration was added by PR2.5`, also failing on main).

## Note on open PR #93
`submit_receivable_draft` (#93, not merged) gates on `canCreateFinancialRequest` only and returns
full analysis warnings. If it is kept, it needs the same limited-view treatment; Phase 2 batch D
proposes folding it into `submit_invoice_draft` as `direction: 'receivable'`, which would inherit
this batch's rules.
