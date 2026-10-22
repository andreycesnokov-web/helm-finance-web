# Interactive P&L V2 — completion review, 22 October 2026

Continuation of `codex/interactive-pnl-20261021`, starting at
`3dea4c8a1ac4b904f826805b673a6cb240c20e41`. No replacement P&L engine.
Release base: `a55876d09103fc888b42935b4bd801074089efaf`.

## Existing work retained

Performance keeps both charts, KPI cards, waterfall, expense breakdown and method
block. Existing exact server contributions feed categories, transactions, document
evidence, comparison and CSV. Shared Modal/BarChart options remain opt-in; Cash
and Forecast calculations are unchanged. Category → source → actual V2 document
drawer remains the journey. No General Ledger, accrual, depreciation or Net Profit
is claimed; their values stay unavailable.

## Completion fixes

- Invalid/missing transaction dates become explicit exceptions. Legacy
  `bank_import_opening` is excluded even without the newer boolean marker.
- Profit reads no longer depend on unused legacy financial endpoints. Refresh
  makes a real read; mismatched company/period/currency responses fail visibly.
- Historical month selection no longer silently falls back to recent months.
  Invalid filters fail explicitly; history stays inside the server period window.
- Coverage and detail CSV follow the selected month/comparison. Metric CSV uses
  signed contributions and preserves raw decimal strings. Sorting/comparison use
  exact arithmetic; approximate whole percentage and chart axes are labelled.
- The existing cash-result total is accessible with signed evidence; it is
  explicitly not Net Profit. Method bullets now describe the actual cash model,
  replacing retained accrual descriptions. Unknown-date exceptions are explained.
- ProfitGroups reuses the existing audited writer with immutable business
  identity; late completion after a company switch cannot show success.
- Existing transaction/bill GET routes accept an optional validated bigint `id`.
  This is a bounded, explicit-company read after existing role checks, with exact
  numeric/ID text aliases. Normal list contracts remain unchanged. Existing V2
  source screens use this read when an older record is absent from the list.
  There is no new writer, route family, RPC, migration or permission grant.

Relevant files: `server/lib/profitLoss.js`, `server/lib/sourceRecordRead.js`,
`server/index.js`, `client/src/v2/lib/profitLossView.js`,
`client/src/v2/components/ProfitLossDetail.jsx`, and V2 pages `Performance.jsx`,
`ProfitGroups.jsx`, `Transactions.jsx`, `BillDetail.jsx`.

## Fresh verification

- Focused Node run: **61 passed, 0 failed, 0 skipped**. Includes model/refunds,
  transfer/capital/financing exclusions, date boundaries, huge fractional decimals,
  signed lineage, 13-source tenant isolation, current membership/role denials,
  pagination completeness, actual GET-handler contracts, embedded SQL select
  compatibility, workspace request and retained formatting regressions.
- V2 OFF and ON builds pass. Existing large-chunk warning remains.
- Built Chrome UI: original 40 grouped checks; focused 129 grouped checks over
  1440/320/375/390/430 px; completion 75 grouped checks over the same widths;
  category-switch test 4 checks. These are **248 named browser checks**, not 248
  independent database integration tests. Keyboard/focus, scrolling, closing,
  navigation overlap, exact money, actual V2 source panels, CSV, historical filters,
  foreign-response rejection and retained charts are covered.
- Browser transport is synthetic. Mapping PATCH is intercepted synthetic-only;
  the report/source browser suites send no API writes. HTTP tests run actual
  handlers with synthetic REST transport. Embedded PostgreSQL validates columns
  and casts, **not deployed RLS/Auth**. No paid provider is called.
- Additional Documents/Bills regression: 72 internal checks pass, 2 fail in one
  test file. Its WRITE_ALLOW omits the already-existing AI-assistant grant-revoke
  action (83 entries / 84 writes). Exactly the same failure is reproduced from
  `3dea4c8` blobs. Actions and security allow-list are unchanged here. This is an
  explicit outstanding common gate, not a new P&L regression or waived PASS.

Reproduce focused checks:

```powershell
node --test tests/sourceRecordRead.test.cjs tests/profitLoss.test.cjs tests/profitLossRoutes.test.cjs tests/profitLossSchema.test.cjs tests/design/v2ProfitLossView.test.mjs tests/design/v2Pnl.test.mjs tests/design/v2Performance.test.mjs tests/design/v2AiLinks.test.mjs tests/pnlMapping.test.js tests/transactionClass.test.js tests/design/tokenOwnership.test.mjs tests/design/v2ChartScale.test.mjs tests/design/v2Format.test.mjs tests/v2BusinessRequest.test.mjs
```

Browser scripts in `tests/design/v2/`: `profitLossBrowser.mjs`,
`profitLossFinalReview.mjs`, `profitLossCompletion.mjs`,
`pnlMappingScopeBrowser.mjs`. Set `PNL_BUILD_ROOT` and `PNL_BROWSER_OUT`; build
with `VITE_DESIGN_V2=true` first. Chrome is a local test browser. Do not use these
fixtures as native acceptance or real financial data.

## Integration review — no integration performed

Fresh GitHub API branch metadata confirms main `fb03df57...` and release-base
branch `a55876d...`. Git fetch fails with `getaddrinfo() thread failed to start`,
including an elevated attempt; no checkout changes. Available matching Git objects
were used. Main is not a descendant of the release base and lacks its financial
guards: **do not apply this feature directly onto that old main** or mistake main
for a verified production runtime.

Exact candidates: Picker `1a9cb3ad44bcda51ac39993b125ad5270f673f22`, Payroll
`a4cbffc69519e640d0876fe3b897b5b7c70c6322`, OCR RC1
`c5c7295507c02b4224bc634488df3e4d29361ad9`. Payroll is confirmed descendant of
Picker. The OCR research checkout `1580de74...` is not the OCR RC and is untouched.

| File | Intersection / risk | Required resolution |
|---|---|---|
| `server/index.js` GET transactions | P&L ID/exact-read hunk conflicts with Picker pagination/status enrichment; also present in Payroll ancestry | Preserve both: current role gate, paged array contract/order/cursor/status enrichment, plus bounded explicit-company ID read and exact decoding. Explicitly reject ambiguous ID+pagination queries. Retest both contracts; no whole-file ours/theirs. |
| `tests/design/v2/fixtureTransport.mjs` | Add/add: Picker fixed build root versus P&L optional root | Keep P&L's backward-compatible `{root=dist}` option and identical fixture dispatch. Retest Picker/Payroll UI with default root and P&L with explicit root. |
| `server/index.js` OCR RC | Shared file, disjoint readiness/extraction/metadata hunks | P&L patch check applies cleanly to exact OCR RC. Preserve OCR helpers and P&L installer/GET reads; shared runtime still needs combined validation. |
| `.gitignore` OCR RC | Independent additions | Patch check passes; retain both. |

P&L has **no migration or RPC changes**. Picker/OCR have no migration in their
candidate deltas. Payroll owns `20261020163121_payroll_runs_no_cash.sql`; do not
replay it or alter its receipt/audit constraints. Existing `balance_version` and
`bill_version` columns are required by the approved release baseline. P&L reads
only posted cash transactions and linked payroll evidence; draft payroll adds no
cash, and no payroll-run writer is invoked.

Suggested separately approved integration sequence: establish an approved current
release-base candidate; take Picker once, then only its Payroll delta; preserve
exact OCR RC; integrate full base-to-P&L change with the two resolutions above.
Run syntax/duplicate-route checks, both builds, Picker pagination/link contracts,
Payroll no-cash receipts/recovery, OCR mocked/flag-OFF/key contracts, and P&L tests.
Then populated isolated native Auth/RLS/PostgREST/browser verification with two
synthetic tenants. No paid OCR or production mutation for these gates. Roll back
an unpublished local assembly by discarding that assembly, not by reverting DB
schema or restoring into existing databases. Any future deployed rollback needs
its own approved binary/DB plan and must retain Payroll's no-cash protection.

## Limits and recommendation

**P&L code is ready for controlled local integration review; automatic merge and
deployment remain NO-GO.** The exact shared hunks, outstanding common allow-list
gate, current release-base confirmation and combined native validation must be
closed first. No production release/migration approval is inferred from this task.

This is classified cash, not accounting profit: unpaid invoices, accruals,
inventory, gross payroll, VAT/withholding splits, depreciation, journals and final
tax expense remain unsupported. Duplicate read IDs fail closed; economically
duplicate transactions with distinct IDs require upstream review, not guessed
deduplication. Unmapped/ambiguous categories and unverified repayment splits are
exceptions. No FX conversion or fabricated counterparty is used. Multi-query
reads are not a locked accounting snapshot; per-source 25,000-row cap/20-second
timeout fail without partial totals. Native populated acceptance is still a
separate gate; historical zero-entry native probes are not substituted for it.

Graphify was actually called. Its index is `fb03df57...`, built 15 October, so it
helps identify older dependencies but cannot verify this unpublished RC. All
critical conclusions above use actual code, Git deltas and fresh tests.

Evidence and updated RC manifest are delivered separately in
`reports/pnl-completion-20261022/`. Earlier screenshots remain immutable: release
base component snapshots, earlier cash RC and current cash RC are labelled in
the gallery. All use synthetic transport; an older Accrual screenshot does not
prove implemented accrual functionality.
