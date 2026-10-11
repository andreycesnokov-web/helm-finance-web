# CFO AI redesign v2: design spec

Final design, 3 Oct 2026, approved by the owner. This spec belongs with:
- `prototype/CFO-AI-prototype.html`: the clickable reference for navigation.
- `screens/`: PNGs.
- `designs/`: per-screen source markup.

## 1. Ground truth

- **Demo data only.** Every number on the screens belongs to a fictional company, "Nusantara Facilities". Never hard-code a figure; all values come from the API. Empty, loading and error states are not drawn, so use the existing patterns.
- **Copy:** the English text in the designs is final wording. Route it through the existing i18n (`client/src/i18n`), because the app also ships RU and ID.
- **Brand tokens:** `client/src/brand/tokens.css` is the single source of truth. Map design colors to existing tokens; add a token only if none fits, and only in that file (`tests/design/tokenOwnership.test.mjs`). Fonts are self-hosted via Fontsource: Archivo Black for display, Manrope for UI. No Google Fonts CDN in the app.
- **Money numerals:**
  - The designs use Manrope with tabular figures.
  - `tokens.css` defines a financial numeral treatment (JetBrains Mono).
  - Keep the token treatment unless the owner says otherwise, and list it as an open question in the first report.

## 2. Design values (map to tokens)

- Navy `#003366` · electric `#3399FF` · primary button `#1565C0` · page `#F4F6F8` · card `#FFFFFF` · card border `#DDE5EC` · row divider `#EDF1F5` · secondary text `#3D556E` · muted `#5A6E82`.
- Status pairs (always with a text label):
  - Good: `#0F7A52` on `#E5F4EE`.
  - Warning: `#8B5A08` on `#FBF1DF` (dot `#B5740B`).
  - Critical: `#C62828` on `#FBEAEA`.
  - Info: `#1565C0` on `#E6F1FB`.
- Charts:
  - Series in fixed order: `#2A6FD1`, `#D98A1C`, `#16A085`.
  - Line width 2px; bars rounded 4px at the data end; never two y-axes.
  - Every chart has a "Show as table" view.
- Shape: cards radius 20px (hero 24px); buttons radius 10px, height 40px (44px on phone); chips are pill-shaped. Shadows only on overlays.
- Layout:
  - Desktop: sidebar 248px; content max-width 1120px; padding 32px top/bottom, 40px left/right.
  - Phone: 390px wide, sticky top bar, sticky bottom tab bar (Pulse · Radar · + Add · AI CFO · More).

## 3. Screens → routes → existing code

Workspace: B = Business, P = Personal, A = Platform admin.

**Existing routes stay working. Nothing is removed or renamed.** New routes are additive.

| Screen (design file) | Route | Existing code | WS | What changes |
|---|---|---|---|---|
| Pulse (`Main`, `PulseMobile`) | `/business/pulse` | `pages/Pulse.jsx`, `pages/business/*` | B | Hero: status line, runway vs target, cash now, net last 30 days. "Needs your decision". Next 7 days, including daily averages. Tiles: Money in / Money out / Owed to you / You owe. |
| Radar (`Radar`, `RadarMobile`) | `/business/radar` | `Radar.jsx`, `RadarBlocks.jsx` | B | Expected line, best-to-worst band, worst-case dashed line. Header: end cash, lowest point, worst case. What-if chips. Key dates show only items ≥ Rp 1M, with an All/In/Out filter and "Show all" linking to Transactions. |
| AI CFO (`AICFO`, `AICFOMobile`) | `/business/ai-cfo` | `AICFO.jsx`, `AICFOBlocks.jsx` | B | Weekly brief, CFO score with factors, three decisions, ask box. |
| AI CFO panel (`AskPanel`, `AskSheetMobile`) | overlay, no route | new component | B | Opened by every "Ask AI CFO", "Why?" and question chip. 440px right drawer on desktop, bottom sheet on phone. The header shows "Looking at: <page · period>". Answers show sources and action buttons. |
| Performance (`Performance`, `PerformanceCash`, `PerformanceForecast`, `PerformanceMobile`) | `/business/performance`, `/cash`, `/forecast` | **new** | B | Spec: `PERFORMANCE_METRICS.md`. Accrual profit and cash flow; the forecast tab reuses Radar data. |
| Performance drill-down (`PerformanceApril`) | `/business/performance?month=YYYY-MM&compare=YYYY-MM&focus=<event>` | **new** | B | Opened from a highlighted phrase in an AI note. See rule 6. |
| Accounts (`Accounts`) | `/business/accounts` | `Accounts.jsx` | B | Statement freshness per account. |
| Transactions (`Transactions`) | `/business/transactions` | `Transactions.jsx` | B | "Needs a category" banner, filters. |
| Funding (`Funding`) | `/business/funding-investors` | existing page | B | Equity and loans; never revenue. |
| Assets & balance (`Assets`, `AddAsset`) | `/business/assets`, `/business/assets/new` | **new** | B | Asset register, depreciation, management balance. Add flow starts from the invoice; the document checklist depends on asset type. |
| Bills & invoices (`Bills`, `MobileBills`) | `/business/payables`, `/business/receivables`, `/business/invoices` | `Payables.jsx`, `Receivables.jsx`, `Invoices.jsx` | B | Design shows both directions on one page. Implement as one page with tabs, reachable from all three routes (tab preset by route). |
| Bill detail (`BillDetail`) | `/business/payables/:id` | **new** | B | Tax split (to supplier / to tax office), cash effect, document checklist, approve. |
| Payroll (`Payroll`) | `/business/payroll` | `Payroll.jsx` | B | PPh 21 by TER, take-home per person. |
| Approvals (`Approvals`, `MobileApprovals`) | `/business/approvals` | `Approvals.jsx` | B | Nothing is paid without approval. |
| Counterparties (`Counterparties`, `AddCounterparty`) | `/business/counterparties`, `/new` | existing route | B | Duplicate suggestions (never auto-merge); tax rule per counterparty type; bank holder must match. |
| Documents (`Documents`) | `/business/documents` | `Documents.jsx` | B | |
| AI Accountant (`Accountant`, `AccountantPackages`, `AccountantTaxes`) | `/business/accountant` (tabs) | `Accountant.jsx`, `ComplianceCalendar.jsx` | B | Tabs: Month close · Documents by transaction · Tax calendar · Tax profile. |
| Company profile (`CompanyProfile`) | `/accountant/tax-profile` | `TaxProfile.jsx` | B | Filled from deed, NIB and NPWP; derives obligations. |
| Settings (`Settings`) | `/business/settings`, `/business/team` | `Settings.jsx`, `Team.jsx` | B | |
| First day (`FirstDay`) | `/business/onboarding` | `Onboarding.jsx` | B | |
| Personal (`Personal`) | `/personal` | `PersonalDashboard.jsx` | P | Must not call business endpoints. The founder loan appears only through the existing approved mirror. |
| Add (`MobileAdd`) | `/add` | `Add.jsx` | B | Desktop: same content as a modal (not drawn). |
| More (`MobileMore`) | phone nav | `shell/*` | B | |
| Sidebar (`Sidebar`) | shell | `shell/WorkspaceShell.jsx` | B | New information architecture. "Platform admin" is visible only to the platform owner. |
| Platform admin (`AdminOverview`, `AdminCompanies`, `AdminSystem`) | `/admin/dashboard`, `/admin/businesses(/:id)`, new `/admin/system` | `AdminDashboard.jsx`, `AdminBusinesses.jsx`, `AdminBusinessDetail.jsx`, `AdminAccessAudit.jsx` | A | Client financial data stays closed. |

## 4. Rules that must survive implementation

1. **Workspaces never mix.** Personal never calls business APIs, and the reverse.
2. **Approval first.** Items with `approval_status='pending_approval'` show "Waiting for approval". The design shows them on Radar with that tag; confirm with the owner and Codex before changing what Pulse totals include.
3. **Withholding:**
   - Suppliers and landlords are paid net.
   - Withheld tax (PPh 23, PPh 4(2), PPh 21) is a separate payment due on the 15th.
   - The withholding slip is made before that payment.
   - Two SPT Masa reports are due by the 20th: PPh 21, and Unifikasi.
   - Rates come only from the existing verified tax rule engine. "Engines calculate, AI explains."
4. **Cash view vs profit view.** Pulse and Radar show cash; Performance shows accrual. Every number is labelled with its view, and the two are never mixed in one figure.
5. **Navigation parity.** Every link and button in the prototype leads to the same place in the app. A button whose action does not exist yet shows an honest "not available yet" state; it is never a dead click.
6. **Clickable AI phrases.** A highlighted phrase in any AI text (example: "April expansion") is a link to a page plus filter (page, period, compare period, focus). The target shows:
   - a filter chip, cleared with × or "All months";
   - what changed vs the comparison period;
   - the payments behind it;
   - an AI summary.
   Build it as one general mechanism.
7. **Platform admin privacy.** The owner sees plan, usage, errors and health. Balances, transactions and documents open only through a support-access grant: the client owner approves it, it lasts 24 hours, it is read-only, and it is written to the client's audit log. Env flags are shown read-only; global flags still change via deploy.

## 5. Not drawn: use existing patterns or ask

- Empty, loading and error states.
- Desktop Add modal.
- Billing.
- The client's side of a support-access request.
- Phone versions of secondary pages (responsive desktop is fine).
- Live what-if recalculation and filters.

## 6. Needs owner approval before any code (AGENTS.md)

- **Migrations:**
  - asset register;
  - category→group (P&L class);
  - funding records;
  - counterparty tax fields;
  - support-access grants;
  - admin metrics tables.
- Backend auth, Railway env, payments/billing, Telegram linking, the Personal↔Business bridge.
- Production data.
