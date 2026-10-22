# Focused final review — 22 October 2026

Business workspace only. Parent RC: `ee37d3349acafdbd1ef8917db664734761074079`.
Keep the existing Performance architecture/composition. No backend, SQL, migration,
auth, Picker, Payroll, OCR, production, runtime flag or dependency changes.

## Verified fixes

Baseline root cause: `.v2-dl-tight` lets the label column grow to max-content while
the amount column can shrink to zero, and `.v2-dl dd` uses overflow-wrap:anywhere.
Captured baseline mobile amount cells reached zero width and 199px height. The final
cash waterfall uses its own bounded rows; no unsupported Accrual screen is re-enabled.

- P&L mobile KPI cards get adequate width; waterfall rows allocate a full line to
  money. Amounts never use character wrapping. Extremely long exact decimals retain
  local horizontal scrolling rather than clipping precision or widening the page.
- KPI, waterfall, expense breakdown, drill totals and source records show full
  native-currency amounts, comma thousands and dot decimals. No implicit K/M rounding.
  Chart tooltips and table use the same exact formatter. Only SVG geometry/axes are
  approximate; each axis declares `≈ IDR × divisor (K/M/B/T)` (or its native currency).
- Monthly and detail CSV preserve source decimal strings, including
  `9007199254740993.000000000000000001`, without Number conversion. Monthly CSV includes
  currency and `provisional_cash` basis; unavailable net/depreciation cells stay blank.
  Spreadsheet software can itself coerce long decimals: import as text to preserve
  precision there. That is not rounding in the generated CSV bytes.
- Compact records show date, actual counterparty, exact amount, account/category,
  source links and supporting-document/review/missing status. Native expandable
  details retain full description, source type, missing journal observation,
  reconciliation/bank review observations and payroll period/status when available.
  Methodology remains accessible in its own disclosure.
- P&L-only modal overlay covers bottom navigation and recovery control, backgrounds
  become inert, body scroll is restored on unmount. Visible controls trap Tab both
  directions. Escape, close button and backdrop restore opener focus after inert is
  removed; backdrop prevents the later default mouse focus from stealing it.
- Recovery is positioned above the phone navigation only while this P&L page is
  present. Other recovery/Picker/Payroll behavior is unchanged. Shared Modal and
  BarChart additions are optional presentation props with unchanged default behavior.

## Screenshot identity — do not conflate layers

All new screenshots use the actual built React V2 with **synthetic API transport**.
They are not live production captures or native authenticated DB acceptance.

| Folder | What it shows | Accounting interpretation |
|---|---|---|
| `baseline/` | Frozen `a55876d` Performance + BarChart component blobs inside the fixture shell | Historical old UI says Accrual and can show a computed Net Profit. This is evidence of prior behavior, not an implemented/verified feature of this RC. |
| `before/` | Frozen `ee37d33` built cash RC before these fixes | Already provisional cash, Net Profit unavailable; long/full amounts and verbose detail still cause UX problems. |
| `after/` | Final reviewed candidate build | Provisional cash only. Net Profit and depreciation unavailable. Full-money UI, compact evidence, accessible mobile modal. |
| `browser-regression/` | Existing browser suite re-run against final candidate | Same synthetic transport, small fictional amounts; separate from the scaled screenshot dataset. |

The earlier 21 October `*-before-*` images likewise use baseline component blobs;
`*-after-*` use `ee37d33` with synthetic transport. The earlier standalone-table
preview was abandoned and is not a final screen. AntiGravity `51b6de6` is not a
primary candidate, was not merged, and supplies none of these after screenshots.

Fixtures are shared across screenshot stages, but old baseline calculations differ
from the exact cash model. A difference in baseline totals is **not** a new accrual
capability, an accounting reconciliation claim or a production balance comparison.

## Results and commands

- 46 Node tests, 46 PASS, zero fail/skip. Existing self-counting harness assertions
  are not counted again as separate Node tests.
- Final focused browser: desktop 1440×1100, 25 named checks; mobile widths 320, 375,
  390, 430 ×844, 26 each, all PASS. Verifies monetary single-line geometry/overflow,
  source/document/audit reachability, exact CSV downloads, focus cycles/restoration,
  all close methods, modal scroll to end and navigation/recovery overlap.
- Existing P&L browser regressions: 20 named checks each at desktop and 390 mobile,
  all PASS, including tenant/currency response guards, empty/error and 20k pagination.
- V2 OFF and ON builds PASS; existing chunk/import warnings remain.
- CashTab/ForecastTab bodies and all backend P&L code unchanged from `ee37d33`.
- No fresh native DB test claimed or needed for this presentation-only patch. Prior
  native read probe remains a separate historical layer; full populated combined-RC
  native Auth/RLS/browser acceptance remains pending.

```powershell
node --test tests/profitLoss.test.cjs tests/profitLossRoutes.test.cjs tests/profitLossSchema.test.cjs tests/design/v2ProfitLossView.test.mjs tests/design/v2Pnl.test.mjs tests/design/v2Performance.test.mjs tests/design/v2AiLinks.test.mjs tests/pnlMapping.test.js tests/transactionClass.test.js tests/design/tokenOwnership.test.mjs tests/design/v2ChartScale.test.mjs tests/design/v2Format.test.mjs
$env:VITE_DESIGN_V2='true'
node client/node_modules/vite/bin/vite.js build client --outDir ../reports/pnl-final-review-20261022/after-dist
$env:PNL_REVIEW_STAGE='after'
node tests/design/v2/profitLossFinalReview.mjs
$env:PNL_BEFORE='false'
$env:PNL_BUILD_ROOT='reports/pnl-final-review-20261022/after-dist'
$env:PNL_BROWSER_OUT='reports/pnl-final-review-20261022/browser-regression'
node tests/design/v2/profitLossBrowser.mjs
$env:VITE_DESIGN_V2='false'
node client/node_modules/vite/bin/vite.js build client --outDir ../reports/pnl-final-review-20261022/off-dist
```

Windows sandbox initially denied synthetic HTTP loopback (EACCES); the same scoped
suite passed outside the sandbox. No firewall/proxy/hosts/Defender changes.

## Recommendation

**GO: this P&L presentation RC may enter controlled integration review.**
**NO-GO: combined release/deployment is not approved or proved here.** The previously
recorded OCR MCP request-key blocker is not revalidated or cleared by this UI review.
Use an exact-SHA combined candidate, review shared route/component hunks and run
populated native Auth/RLS/API/browser acceptance before promotion. No merge, push,
deployment, actual accrual/GL/Trial Balance or tax-ready claim.

Final SHA/tree and artifact hashes are in the external RC_MANIFEST.json and review
package under reports/pnl-final-review-20261022. The prior review ZIP stays immutable.
