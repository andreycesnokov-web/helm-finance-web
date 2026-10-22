# Validation and reproducibility

**22 October focused UI review:** see FINAL_REVIEW_20261022.md. Its final RC, 46 Node
tests, four mobile widths plus desktop, CSV precision, evidence disclosures and
keyboard/overlap results supersede the 21 October UI evidence below. The older
native read probe remains a separate historical layer, not a new end-to-end claim.

All test data is fictional. Exact results and final commit/tree are recorded in the
external `reports/interactive-pnl-20261021/RC_MANIFEST.json` and implementation report.

## Verified layers

1. Exact model: metric/category/record equality, refunds, partial cash payments,
   paid/unpaid bills, settlement allocations, payroll references, transfers, loans,
   asset purchases, mixed repayments, missing dates/currency, ambiguous categories,
   unsafe numbers, tenant isolation, no input mutation, 20,000 contributions.
2. Real Express HTTP + installed supabase-js with synthetic REST transport:
   finance-read roles, missing auth/revocation/personal denial before reads,
   resolved-company scoping, validated filters, safe errors, caps, 1,501-row paging,
   short pages, duplicate pages and count changes. This does **not** prove real JWT
   membership resolution or PostgreSQL RLS end-to-end.
3. SQL contract: embedded PostgreSQL 18.3/PGlite against committed schema-table DDL
   plus existing baseline column additions. All 13 SELECT field lists validated.
   This is not the native PG17 engine.
4. Native read probe: existing isolated PG17.6 cluster
   `7698928172490620963`, real PostgREST, 13 table reads per business, actual text
   numeric decoding. Two nonempty synthetic companies have no confirmed P&L mapping;
   their cash records correctly remain exceptions. **Zero classified native entries**;
   populated numerical totals are proved in layer 1, not claimed from this probe.
   Transaction/wallet/debt state hashes match before/after. No server files, schema,
   app deployment or container lifecycle was changed by the in-memory read probe.
5. Built V2 browser tests, desktop 1440×1100 and mobile 390×844, with explicit
   synthetic API transport: preserved five blocks/two charts, chart keyboard/table
   modes, six clickable rows, exact signed panel totals, document/source routes,
   Escape/focus return, reload context, currency/company stale-response guards,
   comparison, CSV download, no overflow, error/empty, 20,000-record rendering pages,
   zero financial-write requests. **Not full native application acceptance.**
6. Before screenshots use exact baseline Performance and BarChart Git blobs via a
   build-time test plugin, with original React configuration. After screenshots use
   the final candidate and the same synthetic source set. No RC checkout was modified.
7. Targeted existing P&L, Performance, mapping, exact-money and design-token tests;
   V2 OFF/ON builds. No general financial-load/profile/import suite was repeated.

## Commands (repository root, existing dependencies)

```powershell
node --test tests/profitLoss.test.cjs tests/profitLossRoutes.test.cjs tests/profitLossSchema.test.cjs tests/design/v2ProfitLossView.test.mjs tests/design/v2Pnl.test.mjs tests/design/v2Performance.test.mjs tests/design/v2AiLinks.test.mjs tests/pnlMapping.test.js tests/transactionClass.test.js tests/design/tokenOwnership.test.mjs
$env:VITE_DESIGN_V2='true'
node client/node_modules/vite/bin/vite.js build client --config tests/design/v2/pnlBefore.config.mjs
node client/node_modules/vite/bin/vite.js build client --outDir ../reports/interactive-pnl-20261021/after-dist
$env:PNL_BEFORE='true'; node tests/design/v2/profitLossBrowser.mjs
$env:PNL_BEFORE='false'; node tests/design/v2/profitLossBrowser.mjs
$env:VITE_DESIGN_V2='false'
node client/node_modules/vite/bin/vite.js build client --outDir ../reports/interactive-pnl-20261021/off-dist
```

On this Windows sandbox, ordinary HTTP loopback returned EACCES and the first Chrome
download was cancelled. The same local synthetic tests passed outside the sandbox;
Defender, firewall, proxy, hosts and system settings were not changed.

## Still blocked / not claimed

- Reliable accrual P&L / confirmed Net Profit / GL / Trial Balance / tax filing readiness.
- A populated, fully authenticated **combined RC** native browser/API/RLS acceptance.
- Production-scale query plans, consistent DB snapshots, legacy null-business coverage.
- Payroll gross/employer accrual and VAT/withholding/inventory/depreciation recognition.
- Production deployment or owner live access to this new RC; no promotion performed.
