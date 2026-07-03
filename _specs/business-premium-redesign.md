# Business Premium Redesign — CFO AI (Pulse + AI Accountant + modules)

Status: **SPEC (approved direction; no code in this doc).**
Source designs: Stitch project «Stitch Design Preview» (`projects/17392797755219302819`,
18 screens: AI Accountant Dashboard, Cash Pulse & Radar, Wallets & Accounts, Bank Import
& Reconciliation, Deterministic Tax Draft, Document Center, Audit & Security Trail…).
Interactive brand-aligned prototype approved in-chat (2026-07-02).

## 0. Prime directive — DO NOT BREAK WHAT EXISTS

- **Every existing route, component, and data flow stays as is.** All 17 `/business/*`
  routes remain ([App.jsx:595-621](../client/src/App.jsx)): Pulse, Radar, AI CFO,
  AI Accountant, Transactions, Accounts, Invoices, Receivables, Payables,
  Funding & Investors, Bank Import, Intercompany, Payroll, Approvals, Team, Documents,
  Settings (+ /business/new).
- **Nothing is removed or renamed.** The redesign is ADDITIVE: new blocks appear inside
  existing pages, and the AI Accountant module gets new premium screens.
- **Everything new ships behind flags** (build-time, Vite). Flag OFF → app is
  byte-for-byte identical to today (0 new API calls, no new UI — verified the same way
  as Personal Account v1: bundle grep + dual builds).
- **No backend, no migrations, no env, no Telegram** in the UI phase. Tax engine
  (023–025), tax profile (040), funding bridge (037–039) — untouched; separate tasks.
- Personal ≠ Business isolation rules stay exactly as shipped.

## 1. Product goal

Copy the Stitch UX (information density, AI-insight blocks, confidence/traceability,
inline actions) — **keep our brand**. The result should feel like a real $150+/mo
product: more information per screen, plain-language tax guidance, audit-grade
traceability. Core invariant preserved: **engines calculate, AI explains.**

## 2. Brand mapping (Stitch → our tokens, from brand/tokens.css + shell.css)

| Stitch | Ours |
|---|---|
| Bright blue accent | `--brand-electric-blue #3399FF` (buttons, links, active tabs) |
| Dark hero panels | `--brand-navy #003366` (`.cfo-summary`), labels `#AFC6DE`, meta `#C5D6E7` |
| Pos/neg amounts | `#7FE3B6` / `#FFB4A8` on navy; `--success #0F7A52` / `--danger #C62828` on white |
| Headings (Geist) | `--font-display` Archivo Black (H1 30px), `--font-ui` Manrope |
| Numbers / IDs / money | `--font-mono` JetBrains Mono — **always** |
| Cards | white `--surface-card`, border `#DDE5EC`, `--radius-lg 16px` |
| Page bg | `--surface-page #F4F6F8` |
| Soft chips / active nav | `--info-soft` + navy text |
| Status tints | `--success-soft #E5F4EE`, `--warning-soft #FBF1DF`, `--danger-soft #FBEAEA` |

No new colors are introduced. All new UI uses existing tokens + `cfo-*` primitives
(SummaryCard, Card, Stat, DataList, EmptyState, Btn, PageTabs, cfo-modal).

## 3. Flags

- `VITE_BUSINESS_PREMIUM_UI` — Pulse additions (Radar strip, Decision Engine, enriched
  AI CFO Insight, Compliance snapshot) + Accounts share-% view.
- `VITE_AI_ACCOUNTANT_PREMIUM` — the new AI Accountant premium screens.
- Both default **OFF**; may be one flag if simpler — decide at implementation. OFF →
  tree-shaken out (same gating pattern as `VITE_PERSONAL_ACCOUNT_V1_ENABLED`).

## 4. Per-section plan (KEEP + ADD)

### 4.1 Pulse (`/business/pulse`) — KEEP hero, metric cards, AI CFO summary, Recent activity
ADD (flag ON):
- **Radar strip** under hero: chips Pending approvals (from Approvals), Upcoming tax
  (from AI Accountant calendar data when available), Runway status. Colors: warning/
  info/success softs. Each chip links to its module.
- **Decision Engine card**: "What happens to runway if I pay X today?" → Simulate
  impact. V1 = deterministic client-side projection from current burn/balance (no
  backend): new runway = (cash − X) / burn. Clearly labeled as projection.
- **AI CFO insight enriched**: keep Live badge; add drivers line (top expense
  categories MTD from existing transactions data) + "Ask AI CFO" (links to /business/ai-cfo).
- **Compliance snapshot card**: score + next deadline; "Open AI Accountant" link.
  V1 shows static/derived placeholder until engine wiring; marked "preview" if no data.

### 4.2 AI Accountant (`/business/accountant`) — KEEP existing page as fallback (flag OFF)
ADD (flag ON) — premium module, new in-module sections (single route, in-shell tabs or
subroutes if easy):
1. **Workbench Overview (Dashboard)** — "Synced from your modules" chips (Transactions,
   Invoices, Payables, Receivables, Payroll ✓; Bank Import · N to review — counts from
   existing endpoints); Tax Reserve navy card (placeholder until engine); Compliance
   score; Pending actions (Review bank import → /business/bank-import; Confirm AI tax
   draft → Tax Draft section); Compliance calendar preview card → Calendar section;
   **"This month, in plain language"** — What to do / Why / What to prepare + buttons
   "Prepare filing pack" (disabled "soon" in v1) and "Explain simpler".
2. **Compliance Calendar** — **real month grid** (per owner's decision): 7-col calendar,
   deadline days highlighted (PPN = electric-blue filled, Withholding = danger-soft,
   Service tax = ink/info-soft), legend, right column list with source module refs
   ("from Payroll", "from Payables") and amounts when engine provides them. V1 data:
   static Indonesian deadline rules (PPN monthly, PPH 21/26, PPH 23) computed
   client-side from the current month; engine wiring later.
3. **Deterministic Tax Draft** — two-column: left deterministic calculation (rows →
   highlighted Taxable income → Estimated liability); right **AI Explanation** (plain
   language) + **Official Source Traceability** cards (UU/PP references); status bar
   "AI prepared · confidence" + "Request professional review". V1 = layout + demo/empty
   states; real numbers come from tax engine (separate backend task, 023–025/040 gated).
4. **Audit & Security** (phase 2 of the module) — metric tiles, log table, Rule
   Provenance; reuse existing audit_events read endpoints where available.

### 4.3 Accounts (`/business/accounts`) — KEEP list + CRUD
ADD: navy Total-balance hero (all wallets), per-wallet **share %** progress bar,
type/currency subline. Pure presentation over existing data.

### 4.4 Bank Import (`/business/bank-import`) — KEEP flow
ADD: stepper header (Upload→Detect→Parse→Dedupe→Match→Review) mapped to existing batch
states; AI summary strip (auto-categorized %, duplicates — from existing 021/022 data);
confidence chips on suggestion rows (success ≥90, warning mid, danger low); "Sync to
ledger" = existing confirm action relabeled. No new backend.

### 4.5 Documents (`/business/documents`) — KEEP
ADD: folder chips with counts, status chips (Review required / Confirmed / OCR…),
AI-insight strip ("N invoices missing tax IDs") when derivable from existing metadata.

### 4.6 Everything else (Transactions, Invoices, Receivables, Payables, Payroll,
Approvals, Team, Intercompany, Funding, Settings) — **unchanged in this milestone.**
They are data sources; later polish is a separate task list.

## 5. Data & sync contract

```
Transactions ┐
Invoices     ├─ read-only → AI Accountant aggregation → [engine calculates]
Payables     │                                          PPN / PPH 21·23·26 / CIT
Receivables  │                                          (deterministic, sourced)
Payroll      │                                    → [AI explains in plain language]
Bank Import  ┘                                      what / why / how / what to prepare
```
- AI Accountant **reads** other modules by business_id; never writes into them.
- Engine numbers only from the deterministic tax engine with official-source refs;
  the AI layer explains, simplifies, translates — never computes tax.
- All queries strictly scoped by active business (`x-business-id` resolver as today).
- Until engine endpoints exist, premium screens show honest "preview / not connected"
  states — no fake numbers presented as real.

## 6. Rollout phases

- **P1 (frontend, dark):** Pulse additions + AI Accountant Workbench + Calendar (static
  rules) + Tax Draft layout + Accounts hero/share%. Flags OFF in prod.
- **P2 (frontend):** Bank Import stepper/confidence, Documents chips/insight, Audit
  screen, mobile polish of all new blocks.
- **P3 (backend, separate approval):** tax engine read endpoints (obligations, drafts,
  reserve, calendar amounts) on top of existing 023–025/031–034; possibly 040 apply —
  **own runbook/preflight, explicit go**.
- **P4:** filing pack export (PDF), professional review flow, plan gating ($150+ tier).

## 7. Verification (each phase)

- Build flag OFF → exit 0; bundle has **0 refs** to new premium markers; all existing
  pages byte-identical behavior.
- Build flag ON → exit 0; screenshots desktop ≥1440 + mobile 375 for changed pages.
- Existing tests stay green (personalAccount 10, businessResolver 7); login untouched.
- No backend/migration/env diffs in frontend PRs.
- feature branch → checks → report → merge only after owner review.

## 8. Out of scope (explicitly)

Telegram; payments; funding bridge (037–039); 040/041/043 apply; personal finance
changes; any destructive/reset actions; renaming existing nav items.
