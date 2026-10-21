# Performance preserved + P&L drill-down RC

**Status: isolated review candidate, provisional cash reporting. Not deployed.**

The owner's UX correction supersedes the early standalone-table preview. The final
candidate preserves the existing Performance structure: Revenue/Gross Profit chart,
EBITDA/Net Profit chart, From revenue to profit, Where the money went, How profit is
counted, tabs, period filter, monthly CSV and financial explanations.

Revenue, direct costs, gross profit, OPEX, EBITDA and Net Profit are keyboard-accessible
buttons in the existing waterfall. They open the existing V2 Modal with category and
record detail, document/source links, coverage, exceptions, comparison, native-currency
filter and detail CSV. The main page has no expanded P&L table. Closing restores focus;
Escape, focus cycling, reload and URL context are supported. Source links use another
tab to preserve the report. Record rendering pages in batches of 50.

## Calculation choice

The UI composition is preserved; the old unreliable accrual claim is not preserved.
Profit-chart values, waterfall rows and expense breakdown now use the same read-only
contribution model, with confirmed company mappings. Historical months use the same
model. Existing financial endpoint bodies, cash/forecast helpers, write APIs and RPCs
are not replaced. Existing chart currency formatting gains an optional currency prop;
its default remains IDR. Charts retain their keyboard, tooltip and table modes.

Net Profit is null/“unavailable” in KPIs, chart values and its detail panel. The chart
card and legend remain; no invented Net Profit series is plotted. The original accrual
principles remain in “How profit is counted”, labelled as not yet supported, alongside
the actual cash-view limitations. Tax cash is not labelled a calculated tax expense.

## Scope / integration

- New modules: `server/lib/profitLoss.js`, `profitLossRoutes.js`,
  `client/src/v2/lib/profitLossView.js`, `components/ProfitLossDetail.jsx`, scoped CSS.
- Existing changes: Performance, optional BarChart currency, three-line route install.
- Schema/migrations: **none**. Runtime configuration changes: **none**.
- V2 feature flag: existing `VITE_DESIGN_V2`; OFF/ON builds checked.
- No changes to OCR, Picker or Payroll RC branches; no push, merge or deployment.
- Baseline dependency remains `a55876d09103fc888b42935b4bd801074089efaf`.
- No new receipt mechanism, accounting writer, paid AI request or external document upload.

## Review / next gate

Review the before/after screenshots and signed-record tests. Before any promotion,
integrate through a separately approved candidate containing the corrected OCR,
Picker and Payroll RCs, inspect the shared route-registration hunk, and run a full
authenticated native application test with synthetic mapped categories and evidence.
No migration is needed or to be applied by this RC. Do not restore or bootstrap the
existing native test database again. Rollback would restore the prior application
artifact; this change has no financial/schema state to reverse.

The earlier OCR MCP request-key regression remains a separate integration blocker;
this reporting task does not fix or clear it.
