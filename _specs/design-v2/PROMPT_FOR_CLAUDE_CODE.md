# Task: implement CFO AI redesign v2 in `helm-finance-web`

You are the implementing engineer for the CFO AI redesign v2 in the `helm-finance-web` repository (React/Vite client in `client/`, Node/Express server in `server/`, Supabase, deployed on Railway). The owner approved the design on 3 Oct 2026.

## 0. Setup: do this first

1. The design package lives at `_specs/design-v2/` in the repo, the same folder this file is in.
   - If it isn't there, stop and ask the owner to add it.
   - Do not invent designs.
2. Read, in this order:
   - `AGENTS.md`;
   - `_specs/AI_WORKING_MEMORY.md`;
   - `_specs/PROJECT_STATE.md`;
   - `_specs/ARCHITECTURE.md`;
   - `_specs/RISKS_AND_TESTS.md`;
   - `_specs/business-premium-redesign.md` (an earlier redesign; v2 supersedes its visuals but not its safety rules);
   - `_specs/design-v2/specs/DESIGN_SPEC.md`;
   - `_specs/design-v2/specs/PERFORMANCE_METRICS.md`.
3. Open `_specs/design-v2/prototype/CFO-AI-prototype.html` in a browser (Playwright is fine).
   - The bar at the top switches Desktop/Phone and jumps to any screen.
   - It is the reference for navigation and layout.
   - `screens/` has PNGs.
   - `designs/<Screen>.dc.html` has exact markup, spacing and copy. It is HTML with inline styles; ignore `<x-dc>`, `<helmet>` and the `data-dc-script` block.
4. Write a short plan before you code. The plan covers:
   - the files you will touch per batch;
   - how design values map to `client/src/brand/tokens.css`;
   - which data each screen needs and whether an endpoint already exists;
   - the gaps.
   Put it in `_specs/design-v2/IMPLEMENTATION_PLAN.md`, commit it as batch 0, and continue.

## 1. Non-negotiable rules

- **Workspaces.** Every batch states the workspace it touches (Business / Personal / Platform admin). Personal and Business stay fully separated: no Personal call to business APIs and none the other way, and no business record is created from Personal.
- **Flag.**
  - All new UI sits behind a new build-time flag `VITE_DESIGN_V2`, default OFF.
  - With the flag OFF, the app must be identical to today: no new API calls, no new UI. Verify with a bundle grep and builds with the flag OFF and ON, the way earlier flags were verified.
  - Document the flag in `.env.example`.
  - Do not touch Railway env.
- **Do not change without explicit owner approval:**
  - migrations;
  - backend auth;
  - payments/billing;
  - Telegram linking/cutover;
  - the Personal↔Business bridge;
  - production data;
  - Reset/R001;
  - migrations 037–043.
  - If a screen needs a new table or column, render the honest empty state ("Not set up yet" / "Coming soon") and write a proposal in `_specs/design-v2/PROPOSALS.md`: the table, the fields, why, and the risk.
- **Data.**
  - Every figure on the designs is demo data for "Nusantara Facilities". Never hard-code a number, name or date from the designs.
  - Use existing endpoints. If one is missing for a read-only view, you may add a read-only, business-scoped server endpoint that follows the existing auth and business-isolation patterns, with tests. List each one in the batch report.
  - No financial mutations and no new write endpoints.
- **Tokens and fonts.**
  - Use `client/src/brand/tokens.css`. Do not redeclare tokens elsewhere; `tests/design/tokenOwnership.test.mjs` enforces this.
  - Fonts are self-hosted via Fontsource.
  - Money numerals: keep the existing token treatment and raise it as an open question.
- **Copy** goes through the existing i18n with EN text from the designs. Add RU/ID keys too; if a translation is unknown, use EN and list it.
- **Existing routes keep working.** Nothing is removed or renamed. New routes are additive; see DESIGN_SPEC §3.
- **Tax logic.** Rates and dates come only from the existing verified tax rule engine. "Engines calculate, AI explains." Never put tax rates in UI code.
- **AI.** The AI CFO panel uses the existing AI CFO backend. It must not execute payments or approvals; it only links to the screens where a human acts.

## 2. Batches

Work on a branch per batch, stacked: `design-v2/b1-shell`, `design-v2/b2-pulse-radar`, and so on. Open one PR per batch, and do not merge; Codex reviews and the owner merges. Continue to the next batch only when the current one builds with the flag OFF and ON and all tests pass. If you are blocked on an approval, skip what is blocked, note it, and go on.

1. **Shell and navigation.**
   - New desktop sidebar (`designs/Sidebar.dc.html`): groups Overview / Money / Obligations / Accounting, with Settings and Switch to Personal at the bottom. The "Platform admin" link shows only for the platform owner, using the existing admin check.
   - Phone top bar and bottom tab bar (Pulse, Radar, + Add, AI CFO, More) and the More screen (`MobileMore`).
   - Routes for every screen in DESIGN_SPEC §3. Screens not built yet show a designed placeholder.
2. **Pulse and Radar** (`Main`, `PulseMobile`, `Radar`, `RadarMobile`).
   - Restyle on the existing data.
   - Radar key dates:
     - only items ≥ Rp 1M (make the threshold a constant);
     - an All/In/Out filter;
     - a "Show N of M · smaller payments are in the line" footer;
     - a "Show all" link to Transactions.
   - Draw the worst-case and best-case lines only if the forecast logic already provides them. Otherwise draw the expected line and report the gap.
3. **Obligations and money:** Bills & invoices (one page with tabs, reachable from `/business/payables`, `/receivables` and `/invoices`), Bill detail, Approvals, Counterparties, Add counterparty (UI only, saving through existing endpoints if they exist), Accounts, Transactions, Payroll, Funding.
4. **Accounting:** AI Accountant with 4 tabs (Month close, Documents by transaction, Tax calendar, Tax profile), Company profile, Documents, Settings, First day.
5. **AI CFO:** the page, plus the AI CFO panel (desktop drawer / phone sheet).
   - Opened by every "Ask AI CFO", "Why?" and question chip.
   - Passes the current page and period as context and shows "Looking at: …".
   - Implement the clickable-phrase mechanism (DESIGN_SPEC rule 6) as a link format the AI answer can carry: page plus filter params.
6. **New read-only screens:** Performance (Profit / Cash / Forecast, plus the drill-down from rule 6), Assets & balance, and Add asset.
   - Follow `PERFORMANCE_METRICS.md`.
   - Where a category→group mapping or an asset table is missing, show the empty state and write the proposal.
7. **Platform admin:** Overview, Companies (with the company detail panel) and Flags & system, on the existing admin routes plus a new `/admin/system`.
   - Client balances, transactions and documents stay closed.
   - "Request support access" is UI only until the owner approves the grant design.

## 3. Definition of done (every batch)

- Every link and button in the prototype for that batch's screens goes to the same place in the app. A button whose action doesn't exist yet shows an honest disabled or "not available yet" state, never a dead click.
- Desktop 1440 and phone 390 both match the designs:
  - no horizontal scroll at 390;
  - no text overflowing its box (use `min-width: 0` and ellipsis in grid cells);
  - touch targets ≥ 44px on phone.
- No console errors.
- Accessibility: keyboard focus is visible, icon buttons have `aria-label`, and status is never shown by color alone.
- Flag OFF build is unchanged. Flag ON build passes. All existing tests pass. Add tests for every new endpoint and for the isolation rules you touched.

## 4. Report after every batch (AGENTS.md format)

- Files changed.
- Tests and checks run, with results.
- Workspace type affected.
- Flags touched.
- Migrations touched (should be none).
- New endpoints.
- Risks introduced or reduced.
- Production impact.
- Gaps and placeholders.
- Open questions for the owner.

Keep each report short and concrete. Then start the next batch.
