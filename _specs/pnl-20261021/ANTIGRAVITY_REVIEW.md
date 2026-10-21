# Ownership and read-only review of 51b6de6

**Owner instruction, 21 October:** Codex is the sole responsible implementer for
Interactive P&L V2. AntiGravity's `feat/v2-interactive-pnl` is not an agreed integration
or the new primary branch. Continue this isolated RC with existing Performance intact.

Reviewed commit: `51b6de6aaa21bda20364d4c4c3ccaf8ec0a25d31`, parent `a55876d`.
13 changed files. Immutable blobs were read using `git show`; no checkout, merge,
cherry-pick, branch edit, execution of its tests or deployment was performed.
Source HEAD before/after the inspection was identical; proof is in the external
`ANTIGRAVITY_REVIEW_INPUT.json`.

## Findings confirmed in that commit's source

| Location | Finding | Decision |
|---|---|---|
| `server/index.js`, `loadPnlDataForBusiness` | Selects debt `category`/`issue_date` and transaction `counterparty`/`recipient`/`sender`/`status`, absent from checked baseline DDL. Failed reads become `data || []`; no error or source pagination barrier. | Do not port loader/routes; they can turn read failures into apparent empty totals. |
| `server/lib/pnlEngine.js`, numeric helpers and net calculation | Number/rounding-based sums, default `basis='accrual'`, date fallback to created/due, unavailable depreciation becomes zero and a numeric Net Profit is returned. | Do not port engine; conflicts with exact arithmetic and explicit accounting gaps. |
| Same engine, drill `groupTotalAmount` | Adds absolute record magnitudes; e.g. a revenue refund reduces the waterfall but is added in the record total. | Do not port this total/identity mechanism. Current RC has signed composite tests. |
| Same engine, transaction DTO | Supplies `status || 'confirmed'` and `approval_status:'approved'` without an actual approval observation; uses legacy `category_id`, not current `cashflow_category_id`. | Do not port status/classification assumptions. |
| `PnlDrillDownDrawer.jsx`, fetch effect | Raw fetch supplies bearer token but no selected-business header/context; effect dependencies omit active-company selection. | Do not port request lifecycle; current scoped V2 reader and render guard are retained. |
| Document link loader | One document per target Map key, unpaged reads, failures degrade to no links. | Do not replace current multi-document, scoped, fail-closed lineage. |

## Useful work without duplicating this RC

- Drawer search interaction and its tests separate an unfiltered total from filtered
  results. These are reasonable candidates for a **later bounded search enhancement**,
  adapted to the current exact contribution selector and workspace guard.
- Translation vocabulary and synthetic test narratives (partial payments, category
  totals, document provenance) are useful review references. Core scenarios are
  already covered here; they do not justify a second engine or component copy.
- Its file organization reinforces separating report math, request wiring and UI;
  this RC already does that.

**No source code was ported in this pass.** A broad cherry-pick would duplicate the
working model and introduce the verified risks above. No correction of AntiGravity's
branch was attempted. OCR, Picker and Payroll responsibilities/RCs remain separate;
their integration status is not cleared by this report.
