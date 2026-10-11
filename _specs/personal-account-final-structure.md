# Personal Account v1 / v1.5 — Final Product + UI Structure

Status: **SPEC (approved direction; no code in this doc).** Authoritative structure for
Personal Account desktop + mobile, the data/API model, plans, the future Personal→Business
Bridge, Telegram personal mode, rollout phases, and guardrails.

Related: [[helm-finance-build-status]] · migration 044 (applied) · flags
`PERSONAL_ACCOUNT_V1_ENABLED` (backend, runtime) + `VITE_PERSONAL_ACCOUNT_V1_ENABLED`
(frontend, build-time). Funding bridge (037–039) stays deferred.

---

## 1. Product Principle
- Personal Account is a **real personal finance workspace**, not profile settings.
- It is the **first place an email user lands** after registration.
- A user can use personal finance **before** creating or joining any business.
- Business connection is **optional and secondary**.
- **Personal money ≠ business money.** A personal wallet never appears as a business
  wallet; a business wallet never appears as a personal wallet.
- The only link is an **explicit bridge later** (reimbursement / owner loan / equity /
  transfer) — never automatic mixing.

## 2. Desktop Layout (must match the Business Workspace shell)
Permanent left sidebar · workspace card · nav groups · same card system, typography, page
width, spacing, and mobile-drawer behavior (shared `WorkspaceShell`).

**Workspace card:** avatar/initials · "Personal Account" · email or account id · type **Personal**.

**Navigation — group `PERSONAL`:**
Overview · Wallets · Transactions · Categories · AI CFO Lite · Business Links · Profile

**Never include business-only nav:** Payables, Receivables, Invoices, Payroll, Bank Import,
Team, Documents, Business Settings.

> Note on current v1 build: the shipped nav uses groups OVERVIEW (Pulse, Radar/CFO Lite) /
> FINANCE (Transactions, Accounts) / OPERATIONS (Business Connections, Profile Settings).
> The **target** nav above (single PERSONAL group incl. explicit Wallets + Categories
> items) is the v1.5 convergence — to align in the next UI pass.

## 3. Mobile Layout
Compact bottom navigation: **Home · Wallets · Add · AI CFO · Profile**.
- Same header/drawer style as Business Workspace.
- Primary **Add** opens a quick-add sheet: **Expense / Income / Transfer / Receipt**.
- Business Links is accessible but **secondary** — never a first-screen block.

## 4. Main Screen — Personal Dashboard / Overview (first screen after email login)
Blocks in order:
- **A. Personal Balance** — total personal balance, default currency, month change, cash
  available / safe-to-spend.
- **B. Monthly Snapshot** — income, expenses, net saved, savings rate, top categories
  (planned-vs-actual later).
- **C. Wallets / Accounts** — types: Cash, Bank account, Card, Wise/Revolut/PayPal,
  E-wallet, Crypto (later). Action: **+ Add wallet/account**.
- **D. Quick Add** — + Expense · + Income · Transfer · Receipt. Natural input later
  ("spent 100k on fuel", "received 5m salary"); same later via Telegram.
- **E. Recent Transactions** — latest personal tx; filters income/expense/transfer; search;
  edit category/wallet.
- **F. CFO AI Lite** — personal-only insights ("spent more than usual on restaurants",
  "X days left, pace is high", "safe to move up to X into business", "not enough data —
  add 5–10 transactions"). **No** company runway/payroll/receivables/payables/business
  cashflow.
- **G. Business Connections** — secondary: connected businesses, create, join; fund /
  owner loan / equity / reimbursement later.

## 5. Personal Categories (human, not business)
- **Income:** Salary · Owner draw · Dividends · Freelance · Investment income · Gift ·
  Refund · Other income
- **Daily Expenses:** Groceries · Restaurants & cafes · Transport · Fuel · Taxi/ride-hailing ·
  Shopping · Mobile & internet · Subscriptions · Entertainment
- **Home & Life:** Rent · Utilities · Home supplies · Repairs · Family · Pets · Health ·
  Insurance · Education
- **Travel:** Flights · Hotels · Visa/immigration · Travel food · Local transport
- **Finance:** Bank fees · Loan payment · Credit card payment · Savings · Investments ·
  Crypto · Taxes
- **Business-related Personal:** Paid for business · Reimbursable expense · Owner loan to
  business · Owner equity contribution · Business paid me back

**Important:** Business-related Personal categories **do not** create business records in
v1 — they only tag the personal record to prepare the future Personal→Business Bridge.

> Current v1 seed (migration-independent, server-side) is a smaller subset; this is the
> target taxonomy to expand to in v1.5.

## 6. Personal Free vs Personal Pro
**Personal Free** (quick start, understand value): 2–3 wallets · manual income/expense ·
basic categories · recent tx · monthly summary · CFO AI Lite 3–5 Q/mo · simple insights ·
~3 receipt scans/mo · no funding bridge · no advanced multi-currency · no advanced budgets ·
no Telegram personal mode · can create/join business.

**Personal Pro / Founder Personal CFO** (personal finance OS): unlimited wallets ·
cash/bank/card/Wise/PayPal/crypto-later · multi-currency · transfers · recurring tx ·
subscriptions · more AI · weekly report · safe-to-spend · personal runway · anomaly
detection · receipt OCR · auto category/merchant · attachments · budgets · alerts ·
savings goals · Personal→Business Bridge · multi-business · export · Telegram personal
(optional/add-on).

**Pricing ideas:**
- A) Personal Pro $5–9/mo standalone.
- B) Bundle with Business plan for the owner: Business Free→Personal Free; Starter→Personal
  Pro Lite; Pro→Personal Pro + funding bridge; extra personal users = paid add-on.

## 7. Personal → Business Bridge (designed now, NOT v1)
- "I paid a business expense from my personal card" → personal expense + business
  payable-to-owner/reimbursement + linked record.
- "I put money into the business" → choose owner loan / equity contribution / temporary advance.
- "Business paid me back" → closes reimbursement / loan.
Always explicit user action; never automatic mixing.

## 8. Telegram Personal Mode (NOT v1)
Later: personal bot commands separate from business; workspace selector (Personal /
Business A / Business B). e.g. "spent 100k on food" → personal expense; "paid ads for
business from personal card" → suggests the bridge flow. Likely Pro-only or paid add-on
or bundled with Business paid plan.

## 9. Data Model
**Current v1 foundation (live):**
- `businesses.type='personal'` allowed; migration **044** enforces one personal workspace
  per owner (partial unique index) + owner-only membership (trigger).
- Personal wallets → `wallets.scope='personal'`, `business_id = personal_workspace_id`.
- Personal transactions → `transactions.scope='personal'`, same `business_id`.
- Personal routes under `/api/personal/*`; business resolver rejects `type='personal'`.
- Categories seeded server-side into `cashflow_categories` scoped to the personal workspace.

**Needed / future:** dedicated personal categories table or richer seed · personal budgets
table · receipt attachments (storage + table) · bridge link table · personal plan limits ·
AI usage counters.

## 10. API Structure
**Current / dark:** `GET /api/personal/summary` · `GET|POST /api/personal/wallets` ·
`GET|POST /api/personal/transactions` · `GET /api/personal/categories`
(v1 backend also ships `PATCH|DELETE` for wallets and transactions).

**Future:** receipt upload · budgets · bridge endpoints · AI usage endpoints.

**Rules:** Personal API must **never** accept `x-business-id`; it resolves the current
user's personal workspace only. Business API must never return personal rows. Invalid
mixing returns **403/409**.

## 11. Rollout Phases
- **Phase 0 (done):** email auth live · personal profile shell · no personal finance.
- **Phase 1 (Personal Account v1):** dashboard · wallets · manual transactions · categories ·
  CFO AI Lite basic · business links secondary. Requires **044** +
  `PERSONAL_ACCOUNT_V1_ENABLED` + `VITE_PERSONAL_ACCOUNT_V1_ENABLED`. Does **not** require
  037–039/040/041/043.
- **Phase 2 (polish):** edit/delete · richer categories · receipt upload · budgets · plan
  limits · Free/Pro gating.
- **Phase 3 (Bridge):** explicit bridge model + funding/reimbursement/loan/equity logic;
  likely 038/039 or a successor migration.
- **Phase 4 (Telegram personal mode):** Telegram linking · personal/business selector ·
  role/plan gates.

## 12. What must NOT happen
- No business wallets in Personal; no personal wallets in Business.
- No auto-created business; no personal workspace for Telegram legacy users unless they
  explicitly use Personal Account.
- Employees never see personal owner data.
- Personal transactions never affect business runway; no business reports from personal data.
- Never require business creation before personal finance.
- Do not enable 037–039/040/041/043 for this spec.

## 13. UI Implementation Guidance (after approval)
- Use the Business Workspace shell. Desktop = permanent sidebar. Mobile = compact nav/drawer.
- Personal Overview is first and useful even with zero businesses. Business Connections is
  lower priority. Profile Settings is secondary.

**Verification for future implementation:** build flag OFF · build flag ON · desktop
screenshot ≥1440 · mobile screenshot · 0 `/api/personal` refs when flag OFF · login routes
unchanged · business workspace unchanged.

---

### Current build vs this spec — convergence notes (for the next UI pass)
1. Nav → consolidate to a single **PERSONAL** group with explicit **Wallets** and
   **Categories** items (today: 3 groups, no standalone Categories page).
2. Add a **mobile bottom nav** (Home/Wallets/Add/AI CFO/Profile) with an **Add** quick-add
   sheet (today: shared top drawer only).
3. Expand the category seed to the full §5 taxonomy.
4. Add a **Categories** management page and a **Receipt** quick-add stub (Phase 2).
5. Keep everything behind `VITE_PERSONAL_ACCOUNT_V1_ENABLED` / `PERSONAL_ACCOUNT_V1_ENABLED`.
