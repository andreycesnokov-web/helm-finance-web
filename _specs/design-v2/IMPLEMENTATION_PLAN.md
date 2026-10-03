# Design v2 — implementation plan (batch 0)

Status: plan, written before any code. Owner approved the design on 3 Oct 2026.
Source of truth: `specs/DESIGN_SPEC.md`, `specs/PERFORMANCE_METRICS.md`, `designs/*.dc.html`,
`prototype/CFO-AI-prototype.html`. Rules: `AGENTS.md`, `PROMPT_FOR_CLAUDE_CODE.md`.

Workspaces: **Business** (batches 1–6) and **Platform admin** (batch 7). **Personal is not
changed** — "Switch to Personal" uses the existing workspace switch (`/account`), and no v2
screen calls a `/api/personal/*` endpoint. No v2 screen creates a business record from Personal.

## 1. How the flag works

- New build-time flag `VITE_DESIGN_V2`, default OFF, read once in `client/src/v2/flag.js`
  and in `App.jsx` (`import.meta.env.VITE_DESIGN_V2 === 'true'`). Documented in
  `client/.env.example` and `.env.example`.
- **One lazy boundary.** With the flag ON, `App.jsx` routes `/business/*` to a lazily
  loaded `client/src/v2/BusinessApp.jsx` (its own nested `<Routes>`), and — from batch 7 —
  the admin pages to `client/src/v2/admin/*`. With the flag OFF the lazy `import()` sits in a
  dead branch, so Rollup never emits the chunk and the legacy `<Route>` tree is exactly what
  ships today.
- All v2 code and CSS live under `client/src/v2/`. The v2 stylesheet is imported only by v2
  modules, so it is emitted only inside the lazy chunk.
- **Verification per batch** (scripted in `scripts/design-v2-verify.sh`):
  1. Build flag OFF and compare every file in `client/dist` with a baseline build of `main`
     (the build is deterministic — two builds of `main` are byte-identical). The only
     permitted difference is the CSS for new design tokens added to `brand/tokens.css`
     (unused custom properties, no visual change); the JS must be byte-identical.
  2. Grep the OFF bundle for v2 markers (`v2-shell`, `data-v2`, `/api/v2`) → 0 hits.
  3. Build flag ON → exit 0, v2 chunk present.
  4. Run every existing test plus the new ones.
- Legacy routes (`/`, `/radar`, `/cfo`, `/accounts`, …, `/admin/*`) are untouched in both
  modes. With the flag ON every existing `/business/*` path still resolves (redesigned
  screen, or the existing page rendered inside the new shell).

## 2. Token mapping (`client/src/brand/tokens.css`)

| Design value | Token |
|---|---|
| Navy `#003366` | `--brand-navy` / `--text-primary` |
| Electric `#3399FF` | `--brand-electric-blue` (focus accents, chart highlights) |
| Primary button `#1565C0` | `--action-primary` (`--brand-electric-blue-ink`) |
| Page `#F4F6F8` | `--surface-page` |
| Card `#FFFFFF` | `--surface-card` |
| Card border `#DDE5EC` | `--border-default` |
| Row divider `#EDF1F5` | `--border-subtle` |
| Secondary text `#3D556E` | `--text-secondary` |
| Muted `#5A6E82` | `--text-muted` |
| Good `#0F7A52` on `#E5F4EE` | `--success` / `--success-soft` |
| Warning `#8B5A08` on `#FBF1DF`, dot `#B5740B` | `--warning-ink` / `--warning-soft`, dot `--warning` |
| Critical `#C62828` on `#FBEAEA` | `--danger` / `--danger-soft` |
| Info `#1565C0` on `#E6F1FB` | `--info` / `--info-soft` |
| Hero radius 24px | `--radius-xl` |
| Fonts | `--font-display` (Archivo Black), `--font-ui` (Manrope) — already self-hosted |
| Money numerals | **kept** on `--font-num` (JetBrains Mono, tabular). Open question for the owner: designs use Manrope tabular figures. |

**New tokens** (added in batch 1, only in `tokens.css`; no existing token changes value):
`--radius-card: 20px`, `--radius-control: 10px`, `--radius-pill: 999px`,
`--chart-1: #2A6FD1`, `--chart-2: #D98A1C`, `--chart-3: #16A085`,
`--v2-sidebar-width: 248px`, `--v2-content-max: 1120px`, `--touch-min: 44px`.
Navy-hero tints (`#AFC6DE` labels, `#7FE3B6`/`#FFB4A8` amounts) already appear in shell.css;
v2 adds `--on-navy-muted`, `--on-navy-pos`, `--on-navy-neg` so they are named once.

## 3. Batches, files and data

Each batch = branch `design-v2/bN-…` stacked on the previous one, one PR against `main`.

### Batch 1 — shell and navigation (`design-v2/b1-shell`)
Files: `client/src/v2/{flag.js,BusinessApp.jsx,v2.css,i18n.js,nav.js}`,
`client/src/v2/shell/{V2Shell.jsx,Sidebar.jsx,MobileBars.jsx,WorkspaceCard.jsx}`,
`client/src/v2/pages/{More.jsx,Placeholder.jsx}`, `client/src/v2/ui.jsx` (v2 primitives),
`client/src/App.jsx` (flag branch only), `client/src/brand/tokens.css` (new tokens),
`.env.example`, `client/.env.example`, tests under `tests/design/v2*.test.mjs`.
Data: `GET /api/workspaces` (existing provider), `GET /api/admin/status` (existing admin
check → "Platform admin" link), `GET /api/pulse` (sidebar badges: needs-category count,
late bills, pending approvals — omitted when the role cannot read finance).
Routes: every §3 route exists; unbuilt screens render a designed placeholder that links
to the existing page where one exists (so nothing is lost).

### Batch 2 — Pulse and Radar (`design-v2/b2-pulse-radar`)
Files: `client/src/v2/pages/{Pulse.jsx,Radar.jsx}`, `client/src/v2/lib/{radarSeries.js,pulseModel.js}`,
`client/src/v2/charts/LineBand.jsx` (+ "Show as table"), tests for the pure modules.
Data: `GET /api/pulse?scope=business` (balance, burn, runway, debts with due dates,
`pendingPayables/Receivables`, `needs_review_count`, `recentTxs`),
`GET /api/pulse/advanced-insights` (30-day in/out), `GET /api/accountant/calendar` (tax rows in
"Needs your decision"), `GET /api/business/financial-counts`.
Radar: key dates = debts ≥ `KEY_DATE_MIN_IDR = 1_000_000`, All/In/Out filter,
"Show N of M · smaller payments are in the line", "Show all" → Transactions.
Lines: the existing forecast logic (`radarFigures`) defines expected / best / worst end
states. The daily series applies those same rules day by day over the debts' due dates;
no new forecasting rule. If a rule cannot be expressed per day it is reported as a gap.
Pending-approval items: tagged "Waiting for approval" on Radar; Pulse totals unchanged
(DESIGN_SPEC rule 2 — needs owner + Codex confirmation before changing).

### Batch 3 — obligations and money (`design-v2/b3-obligations-money`)
Screens → data:
- Bills & invoices (tabs Bills to pay / Invoices to collect / All), routes
  `/business/payables|receivables|invoices` preset the tab → `GET /api/debts`.
  Create still uses the existing `DebtFormModal`.
- Bill detail `/business/payables/:id` → `GET /api/debts` (filter by id), `GET /api/documents`
  links, withholding rule from `findWithholdingRule` (existing verified engine). Approve via
  the existing `POST /api/debts/:id/approve` only for roles the server already allows.
- Approvals → `GET /api/debts` (pending_approval) + existing approve/reject endpoints.
- Counterparties + Add counterparty → `GET/POST /api/counterparties` (existing). Duplicate
  suggestions are computed client-side from the existing list (never auto-merge).
  Counterparty tax type / holder-match fields that need columns → PROPOSALS.md.
- Accounts → `GET /api/wallets`; statement freshness from the newest transaction per wallet
  (`/api/wallets/:id/transactions` exists) — if not derivable cheaply, a gap.
- Transactions → `GET /api/transactions` (+ "Needs a category" from uncategorised rows).
- Payroll → `GET /api/payroll/overview`; PPh 21 TER only where the overview returns it.
- Funding → existing `BusinessFunding` data; funding records table → PROPOSALS.md.

### Batch 4 — accounting (`design-v2/b4-accounting`)
- AI Accountant tabs: Month close (`/api/accountant/summary`, `/api/ai-accountant/required-documents`),
  Documents by transaction (`/api/documents` + links), Tax calendar (`/api/accountant/calendar`,
  `/api/accountant/obligations`), Tax profile (`/api/accountant/profile`, `/applicability`).
- Company profile at `/business/accountant/tax-profile` (legacy `/accountant/tax-profile`
  untouched) → `/api/accountant/profile` (existing save path).
- Documents → `/api/documents`; Settings → existing Settings/Team data; First day →
  `/api/onboarding/*` (existing, flag-gated server-side).

### Batch 5 — AI CFO (`design-v2/b5-ai-cfo`)
- Page → `GET /api/ai-cfo/context`, `POST /api/ai-cfo/ask` (existing; read-only answers).
- Panel: `client/src/v2/ai/{AskPanel.jsx,askContext.js,aiLinks.js}`. Context ("Looking at: page ·
  period") is prepended to the question text — no backend change. Answers never execute
  payments/approvals; action buttons are links to the screen where a human acts.
- Clickable phrases (rule 6): one link format `cfo://<page>?month=YYYY-MM&compare=YYYY-MM&focus=<key>`
  (also accepts markdown `[text](/business/…?…)` restricted to an allow-list of internal
  routes), parsed by `aiLinks.js` and rendered as router links. Tested.

### Batch 6 — new read-only screens (`design-v2/b6-performance-assets`)
- Performance Profit/Cash/Forecast + drill-down (`?month=&compare=&focus=`).
  Data: `GET /api/pulse/advanced-insights?from=&to=` (cash basis, existing classifier),
  `GET /api/debts` (accrual: invoiced/billed month). The category→group (P&L class)
  mapping does not exist → profit view shows "Estimate" with coverage, and anything
  needing the mapping renders the empty state + PROPOSALS.md entry.
  A read-only, business-scoped endpoint may be added if month aggregation cannot be done
  from existing responses (listed in the batch report, with tests).
- Assets & balance, Add asset: no asset register → designed empty state; PROPOSALS.md.

### Batch 7 — platform admin (`design-v2/b7-admin`)
- Overview → `GET /api/admin/dashboard`; Companies + detail panel → `GET /api/admin/businesses`,
  `/:id`, `/:id/usage`, `/:id/members` (counts only); Flags & system at new `/admin/system`
  → `system` block of the dashboard (read-only booleans).
- Client balances, transactions and documents stay closed. "Request support access" is a
  disabled button with an explanation until the grant design is approved (PROPOSALS.md).

## 4. Gaps known before coding

- No category→P&L-group mapping, no asset register, no funding records table, no counterparty
  tax fields, no support-access grants, no admin metrics tables → empty states + PROPOSALS.md.
- `/api/ai-cfo/ask` has no structured context field → context is sent inside the question text.
- Radar has no per-day forecast endpoint → daily series derived client-side from the
  existing scenario rules (documented in the batch report).
- CFO score, weekly brief and "three decisions" exist only as far as `/api/ai-cfo/context`
  returns them; anything else is an honest empty state.
- Desktop "Add" modal is not drawn → the v2 Add route renders the existing Add flow inside
  the new shell.

## 5. Open questions for the owner

1. Money numerals: keep JetBrains Mono (current token) or switch to Manrope tabular as drawn?
2. Should Pulse totals include `pending_approval` items (rule 2)? Implemented: excluded, tagged.
3. Approve buttons outside Approvals (Pulse, Bill detail) reuse the existing approve endpoint
   and role check — confirm that is wanted, or keep them as links to Approvals only.

## 6. Status (3 Oct 2026)

All seven batches are implemented behind `VITE_DESIGN_V2` (OFF build byte-identical JS).
Branches are `design-v2-r2/bN-…` because an earlier, stopped session had already used
`design-v2/bN-…` (its PRs #98–#101 are superseded by #102–#108; the owner closes them).

Deviations from the plan above, each explained in its PR:
- Approvals, Bill detail and Transactions reuse existing write endpoints (approve/reject/
  request-info, transaction category, counterparty create) — all in `v2/lib/actions.js`,
  enforced by `tests/design/v2Guards.test.mjs`.
- The tax calendar reads `/api/accountant/summary`, not `/api/accountant/calendar`
  (the latter writes `compliance_events` on every call).
- Profit is an Estimate from the existing classifier until P-10; no new read-only
  endpoint was needed in batch 6.
- Every existing `/business` page stays reachable inside the v2 shell under `…/classic`,
  `…/manage` or `…/tools`.

## 7. Batch 8 — owner decisions applied (3 Oct 2026)

The answers are in `DECISIONS.md`, which overrides section 5.

- **Open questions.**
  - Money numerals keep the tokens (JetBrains Mono).
  - `pending_approval` items are counted nowhere:
    - not in the Pulse forecast, "Next 7 days", or the Performance forecast;
    - not in the Radar lines or cash-after.
  - Radar lists pending items with the "Waiting for approval" tag. It also offers an on-screen "If you approve …" what-if; nothing is saved.
  - Approvals and Bill detail count one pending item as if approved, because that is their question.
  - Approve and reject still use the existing endpoints only.
- **P-01 and P-08: targets.**
  - Migrations 058 and 059 add the targets. They are read with `GET /api/business/targets` and written with `PATCH /api/business/targets`.
  - The write path is for Business workspaces only, needs owner, ceo, admin or cfo, and is audited.
  - Pulse uses the runway target, or 60 when it is null, and warns below the minimum cash.
  - The targets are edited in Settings → Targets & alerts.
  - The weekly brief is stored but not sent: there is no scheduler.
- **P-04: counterparty tax fields.**
  - Migration 060 adds entity form and payment terms. The `landlord` and `lender` roles are application roles.
  - They are written through the existing POST and PATCH `/api/counterparties`. Setting the tax fields needs the accountant role or above.
  - New v2 edit route: `/business/counterparties/:id/edit`.
- **P-05: bill checklist (option B, batch 8.1).**
  - Migration 061 adds only the accountant check. The withholding slip is read from `withholding_records.bukti_potong_document_id` (031) with the read-only `GET /api/withholding-slips`.
  - The check is written with `PATCH /api/debts/:id/checklist`, which needs the accountant role or above and is audited.
  - `POST /api/debts` now strips these fields from the body it spreads.
  - The marks show in Bill detail and in the Accountant packages.
- **P-10.** `P10_TEMPLATE.md` is ready for owner review. There is no migration yet.
- **Not applied anywhere.** Until the owner applies migrations 058–061:
  - GET reads return nulls;
  - the batch-8 writes answer 409 `migration_not_applied`;
  - the screens show that state.
