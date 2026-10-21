# Interactive P&L audit and lineage — 21 October 2026

Workspace: **Business only**. Baseline: `a55876d09103fc888b42935b4bd801074089efaf`.
Branch: `codex/interactive-pnl-20261021`. Production data was not examined or changed.

## Verified existing implementation

| Area | Existing source | Finding / reuse |
|---|---|---|
| Performance | `client/src/v2/pages/Performance.jsx` | Two charts, waterfall, expense breakdown, methodology, KPIs and period filter exist. Their composition is retained. Six waterfall rows open a V2 modal. |
| Old estimates | `/api/pulse/advanced-insights`, `server/lib/financialInsights.js` | Keyword-based cash estimate; source explicitly says it is not a chart of accounts. Existing endpoint and calculations remain unchanged for existing callers. |
| Old accrual view | `client/src/v2/lib/pnl.js` | Activated when any category is mapped. Bill date falls back to created/due date; settlement dedupe uses only `debts.linked_transaction_id`; missing depreciation becomes zero. This does not establish reliable accrual accounting. |
| Bill classification | Existing DDL and `/api/debts` enrichment | `debts.category`, assumed by the old client accrual helper, is absent from the checked baseline schema/migrations. Debt enrichment supplies withholding/document links, not a category. No production impact was quantified. |
| Categories | Migration 062, `/api/pnl-mapping`, `pnlMapping.js` | Company-owned confirmed `pnl_group` is reusable. Templates are suggestions only. No category is confirmed automatically. |
| Transactions | `transactions`, migration 070, `transactionClass.js` | Cash source, native decimal amount, date, account, category ID/name, debt-payment/transfer/opening references. Reuse decimal arithmetic and economic type classification. |
| Bills / invoices | `debts`, `debt_settlement_allocations` | Sources/evidence only in this cash view. Full bill totals and non-cash allocations never add another expense. |
| Payroll | `payroll_payments.transaction_id` | Reuse references to paid cash. Draft and saved payroll do not add gross salary or create cash. Payroll RC is untouched. |
| Evidence | `financial_documents`, direct/debt document links | Return logical document metadata and review state; reuse V2 document deep links. Do not read file bytes, extraction text, paths or credentials. |
| Assets / funding | `assets`, `business_funding_records`, repayments | Explicit asset purchases and financing are excluded. Mixed principal/interest and mixed asset allocations become review exceptions. |
| GL / CoA / Trial Balance | Bounded source/schema search | No genuine account-master, journal posting and balanced trial-balance engine found in the reviewed baseline. “Ledger writer” lock is cash-write serialization, not a General Ledger. No fake journal added. |

## One reporting path

```text
existing Performance / charts / waterfall / expense breakdown
  → GET /api/pulse/profit-loss
  → existing auth + current business resolver + finance-read role
  → scoped, paged, exact-text reads (13 existing tables)
  → profitLoss.buildReport: unique transaction contributions
  → totals + actual company category groups + entry keys + evidence
  → click waterfall row → ProfitLossDetail (existing V2 Modal)
  → category → signed contributing records → existing source/document routes
```

`profitLossView.js` is a presentation selector over these contributions, not another
accounting engine. It supplies chart rows, signed composite drill-down, expense
breakdown, comparison and CSV. No RPC or SQL writer is invoked by the report.

## Metric lineage and formulas

Let `C(g)` be the exact sum of native-currency cash contributions in confirmed group
`g`. Revenue/other-income groups use signed cash; cost groups use negative cash
impact as a positive cost. Opposite-direction refunds reduce their original group.

| Performance measure | Formula | Detail / evidence |
|---|---|---|
| Revenue | `C(revenue)` | Matching company categories → cash records → direct/bill-linked documents |
| Direct costs | `−C(direct_cost)` in waterfall | Cost records shown with negative contribution |
| Gross profit, cash estimate | `C(revenue) − C(direct_cost)` | Both groups; signed records sum exactly to the clicked value |
| OPEX | `−C(operating_cost)` in waterfall | Actual mapped categories, including salary/rent when present |
| EBITDA, cash estimate | `Gross − C(operating_cost)` | Revenue, direct costs and OPEX with formula signs |
| Other income | `C(other_income)` | Same model, no separate calculation source |
| Interest paid | `−C(interest)` | Confirmed cash category; mixed principal/interest excluded for review |
| Tax payments | `−C(tax)` | Cash out, explicitly **not** a calculated tax expense/liability |
| Classified cash result | `EBITDA + Other − Interest − Tax payments` | Available in the reporting model/CSV; not renamed accounting Net Profit |
| Depreciation / Net Profit | `null` | Explicit unavailable state; no fabricated records or zero depreciation |

Bills/invoices are reached through `transactions.debt_payment_id`,
`debts.linked_transaction_id` and transaction settlement allocations. Documents are
collected from both direct transaction links and bill links, deduplicated and
restricted to the same business. Bank-row and document review states are shown as
observations; a link does not constitute reconciliation or accountant approval.

## Confirmed boundaries and remaining accounting gaps

- **VERIFIED:** Cash view only. No change to balances, journals, matching, approvals,
  OCR, billing, or production schemas. Existing Cash/Forecast implementations remain.
- **VERIFIED:** Currency is native and separate. No implicit FX conversion. Amounts
  are requested as `numeric::text`; arithmetic uses the existing 18-decimal helper.
- **VERIFIED:** Only explicit `business_id` rows; no owner-name or null-business
  fallback. Historical legacy rows without an explicit company are outside coverage.
- **BLOCKED:** Accrual recognition, inventory/COGS timing, verified depreciation,
  gross payroll/employer costs, VAT/withholding split and journal posting are not
  sufficiently supported to claim accounting profit. Net Profit remains unavailable.
- **BLOCKED:** General Ledger / Trial Balance need real accounts and balanced journal
  entries. This cash contribution model can supply source/evidence adapters only.
- **REPORTED:** Confirmed category assignments still require human correctness;
  ambiguous/unmapped category names are never guessed by keywords in this report.
- **VERIFIED limitation:** Multi-query reads are not a locked DB snapshot. Count
  changes, duplicate pages, truncation, errors, missing count and caps fail closed;
  equal-count concurrent edits are not guaranteed to be detected.
- **VERIFIED limitation:** Per-source cap 25,000 rows, 500-row pages, 20-second request
  timeout. Production-scale query plans and snapshot/export consistency remain open.

## Graphify and references

Actual `mcp__graphify__query_graph` calls retrieved `accrualRows`, Performance,
performance helpers and accounting-module references. Promoted index commit:
`fb03df57c0cb7f89e45d879c2d4c635359a45408`, indexed 15 October. Query hash for the
follow-up: `7bbebdc25b1369cabe6be831633048134d81772580148a1e7703120fd7b257c5`.
This is not the unpublished RC. Critical findings above were checked in local
baseline code/DDL and tests; Graphify alone does not establish absence of a GL.

API syntax checked against the installed Supabase client and real isolated
PostgREST, plus [select docs](https://supabase.com/docs/reference/javascript/select),
[range docs](https://supabase.com/docs/reference/javascript/range) and
[PostgREST column casts](https://docs.postgrest.org/en/stable/references/api/tables_views.html#casting-columns).
The web fetch of changelog.md was rejected for its content type; no dependency or
platform feature was upgraded. No regulatory, tax-ready or filing-ready claim.
