# Design v2 — implementation plan (batch 0)

Owner approval: 3 Oct 2026. Source of truth: `_specs/design-v2/` (prototype, `designs/*.dc.html`,
`specs/DESIGN_SPEC.md`, `specs/PERFORMANCE_METRICS.md`). This plan is the contract for batches 1–7.

Workspace: **Business** for batches 1–6, **Platform admin** for batch 7. Personal is not
restyled in this programme (no batch lists it); "Switch to Personal" reuses the existing switch
logic and leaves the business shell, so no Personal screen ever calls a business API.

## 1. How the flag keeps production unchanged

- New build-time flag **`VITE_DESIGN_V2`** (default OFF), documented in `.env.example` and
  `client/.env.example`. No Railway env is touched.
- All v2 code lives under `client/src/v2/` (plus its dictionaries in `client/src/i18n/v2/`) and
  is reached through **one** guarded dynamic import in `App.jsx`:
  `const V2 = DESIGN_V2 ? lazy(() => import('./v2/...')) : null`. This is the pattern
  `DesignPreview` already uses; with the flag OFF Rollup drops the import, so no v2 JS, CSS or
  string reaches the bundle and no new API call can happen.
- With the flag ON the `/business/*` route block and `/admin/dashboard`, `/admin/businesses(/:id)`
  and the new `/admin/system` render the v2 app; every other route (login, `/account`, `/personal`,
  legacy `/`-level routes, `/admin/users…`, tax rules…) is untouched. Existing `/business/*`
  routes that v2 does not redraw (bank import, incoming payments, payment connections,
  intercompany, tax split, settlement, new business) are kept and rendered with their existing
  component inside the v2 shell, so nothing is removed or renamed.
- Verification per batch: build OFF and ON; OFF output compared file-by-file (sha256) with a
  build of `main`; bundle grep for v2 markers (`v2-shell`, `/admin/system`, v2 i18n keys) must be 0
  in the OFF bundle. Expected exception: `tokens.css` gains a few new custom properties (below),
  which changes the OFF CSS file by those unused declarations only — reported, never hidden.

## 2. Design values → `client/src/brand/tokens.css`

| Design value | Token |
|---|---|
| Navy `#003366` | `--brand-navy` / `--text-primary` |
| Electric `#3399FF` | `--brand-electric-blue` (focus/accent only) |
| Primary button `#1565C0` | `--action-primary` (hover `--action-primary-hover`) |
| Page `#F4F6F8` · card `#FFFFFF` | `--surface-page` · `--surface-card` |
| Card border `#DDE5EC` · divider `#EDF1F5` | `--border-default` · `--border-subtle` |
| Secondary `#3D556E` · muted `#5A6E82` | `--text-secondary` · `--text-muted` |
| Good `#0F7A52/#E5F4EE` | `--success` / `--success-soft` |
| Warning `#8B5A08/#FBF1DF`, dot `#B5740B` | `--warning-ink` / `--warning-soft`, dot `--warning` |
| Critical `#C62828/#FBEAEA` | `--danger` / `--danger-soft` |
| Info `#1565C0/#E6F1FB` | `--info` / `--info-soft` |
| Hero radius 24px | `--radius-xl` |
| Button radius 10px · chip pill | **new** `--radius-button: 10px` · **new** `--radius-pill: 999px` |
| Card radius 20px | **new** `--radius-card: 20px` |
| Chart series `#2A6FD1 #D98A1C #16A085` | **new** `--chart-1`, `--chart-2`, `--chart-3` |
| Sidebar 248px · content 1120px | **new** `--layout-sidebar`, `--layout-content-max` |
| Overlay shadow | `--shadow-lg` (shadows only on overlays) |
| Fonts | `--font-display` (Archivo Black), `--font-ui` (Manrope) — already self-hosted |
| Money numerals | `--font-num` (JetBrains Mono, tabular) is **kept** — open question Q1 |

`tokens.css` stays the only declaration site; `tests/design/tokenOwnership.test.mjs` keeps passing.
`client/src/v2/v2.css` only consumes tokens (class names prefixed `v2-`).

## 3. Code layout

```
client/src/v2/
  BusinessApp.jsx        nested routes for /business/* (lazy chunk)
  AdminApp.jsx           v2 admin routes (lazy chunk)
  routes.js              screen → path table (single place; DESIGN_SPEC §3)
  shell/                 V2Shell, Sidebar, PhoneTopBar, TabBar, WorkspaceMenu
  ui/                    Card, Button, Chip, Status, Money, Tabs, Table, Empty, NotYet, ChartTable
  lib/                   format, useV2Data (scoped + cached fetch), forecast (pure), keyDates (pure),
                         aiLinks (clickable phrase format, pure), i18n (useV2T)
  pages/                 one file per screen
  v2.css
client/src/i18n/v2/{en,ru,id}.js   v2 strings (EN from the designs; RU/ID where known)
tests/design/v2/                    pure-module tests, route-table test, flag-OFF bundle test,
                                    mock-API screenshot run (1440 / 390)
```

Copy goes through `useV2T()`, which reads the existing `getLang()` / `langchange` mechanism of
`client/src/i18n` and falls back to EN. A key with no RU/ID translation falls back to EN and is
listed in the batch report.

## 4. Batches, files and data

Every row: existing endpoint used, or the gap.

### Batch 1 — Shell and navigation (`design-v2/b1-shell`)
- Files: `App.jsx` (flag + 2 lazy imports), `tokens.css` (new tokens), `.env.example`,
  `client/.env.example`, `client/src/v2/{BusinessApp,routes}.js(x)`, `v2/shell/*`, `v2/ui/*`,
  `v2/lib/*`, `v2/pages/{More,Placeholder}.jsx`, `i18n/v2/*`, tests.
- Sidebar groups Overview / Money / Obligations / Accounting; Settings, Platform admin, Switch to
  Personal at the bottom. Phone top bar + tab bar (Pulse · Radar · + Add · AI CFO · More) + More.
- Data: workspaces `GET /api/workspaces` (existing provider); admin link `GET /api/admin/status`
  (existing check, shown only when `is_admin === true`); badges from one cached
  `GET /api/pulse?scope=business` (needs-category count, late bills, pending approvals) —
  hidden silently for roles that get 403.
- Every DESIGN_SPEC §3 route registered; not-yet-built screens show a designed placeholder with a
  link back, never a dead click.

### Batch 2 — Pulse and Radar (`design-v2/b2-pulse-radar`)
- Pulse: `GET /api/pulse?scope=business` (cash, runway, burn, debts, net position, pending),
  `GET /api/accountant/calendar` (tax decision row, if available). Hero status line derived
  from `aiStatus`; runway target — **gap**: no stored target → "Set a runway target" (Settings
  link) instead of a number (proposal).
- Next 7 days: open debts due in 7 days; daily averages from the existing burn rate.
- Radar: same `/api/pulse` data. Expected / best / worst use the existing Radar scenario
  formulas (`lib/radarFigures.js`) applied day by day by due date (`v2/lib/forecast.js`, pure,
  tested so the end points equal the existing scenarios). Key dates: items ≥ `KEY_DATE_MIN = 1_000_000`,
  All/In/Out filter, "Show N of M" footer, "Show all" → Transactions. What-if chips: only the
  ones the existing formulas support are live; the rest show "not available yet".

### Batch 3 — Obligations and money (`design-v2/b3-obligations`)
- Bills & invoices: one page, tabs To collect / To pay / Invoices, reached from `/business/payables`,
  `/receivables`, `/invoices` (tab preset by route). `GET /api/debts`. Actions reuse existing
  flows only (DebtPaymentModal for "Mark paid", approve/reject endpoints already used by
  `Payables.jsx`). Unmatched payment banner — **gap** unless bank-import data exposes it.
- Bill detail `/business/payables/:id` (and `/receivables/:id`): `GET /api/debts`,
  `GET /api/invoices/:id/settlement` (documents checklist), tax split from existing tax-split /
  rule engine only.
- Approvals: pending debts from `GET /api/debts` (`approval_status='pending_approval'`);
  approve / reject / request-info = existing endpoints.
- Counterparties + Add counterparty: `GET/POST /api/counterparties` (existing). Duplicate
  suggestions only if the existing intelligence returns them; never auto-merge.
- Accounts `GET /api/wallets`, Transactions `GET /api/transactions`, Payroll
  `GET /api/payroll/overview|employees|payments`, Funding (existing page logic; equity/loans
  table — **gap**, proposal).

### Batch 4 — Accounting (`design-v2/b4-accounting`)
- AI Accountant tabs Month close · Documents by transaction · Tax calendar · Tax profile:
  `/api/accountant/status|summary|obligations|calendar|profile`,
  `/api/ai-accountant/required-documents`, `/api/documents`. Rates/dates only from the engine.
- Company profile `/business/accountant/tax-profile` on `/api/accountant/profile`.
- Documents, Settings (+ `/business/team`), First day (`/business/onboarding`, existing
  onboarding API) restyled on existing data.

### Batch 5 — AI CFO (`design-v2/b5-ai-cfo`)
- Page on `GET /api/ai-cfo/context`; ask box and panel on `POST /api/ai-cfo/ask` (existing).
- Panel: desktop 440px drawer / phone sheet, opened by every "Ask AI CFO", "Why?" and chip;
  passes page + period as context and shows "Looking at: …". It never approves or pays; action
  buttons are links.
- Clickable phrases: `v2/lib/aiLinks.js` — a link format `[[label|page?month=…&compare=…&focus=…]]`
  parsed into in-app links (whitelisted pages only). Whether the backend emits it is a backend
  change — not made; the client renders it when present.

### Batch 6 — New read-only screens (`design-v2/b6-performance-assets`)
- Performance Cash tab: monthly money in/out from `GET /api/pulse/advanced-insights` (existing,
  cash basis). Forecast tab reuses the Radar module. Profit (accrual) tab: **gap** — needs the
  category→group mapping; honest empty state + proposal. Drill-down `?month&compare&focus`.
- Assets & balance, Add asset: **gap** — no asset table; empty state + proposal.

### Batch 7 — Platform admin (`design-v2/b7-admin`)
- Overview `GET /api/admin/dashboard`; Companies `GET /api/admin/businesses(/:id|/usage|/members)`;
  `/admin/system` = flags (read-only booleans from the dashboard payload) and health.
- Balances, transactions and documents stay closed; "Request support access" is UI only.

## 5. Known gaps (proposals go to `PROPOSALS.md`, never code)

Runway target · asset register · category→group (P&L class) · funding records (equity/loans) ·
counterparty tax fields · support-access grants · admin metrics tables · unmatched-payment
inbox if not derivable · AI answer link format on the backend.

## 6. Open questions (carried into every report until answered)

- **Q1 Money numerals:** designs use Manrope tabular; tokens use JetBrains Mono. Kept mono.
- **Q2 Radar scenarios:** the existing Radar sums every debt (including settled and
  pending-approval) into its scenarios. v2 forecasts only open, approved items (the same rule
  Pulse already uses for receivables/payables) and shows pending items as "Waiting for approval"
  without counting them. Confirm with owner/Codex.
- **Q3 Desktop Add:** not drawn; v2 opens the existing Add screen inside the shell.
