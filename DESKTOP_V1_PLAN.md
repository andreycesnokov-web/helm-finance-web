# Helm Finance — Desktop v1 Implementation Plan

**Date:** 2026-06-09  
**Status:** AWAITING APPROVAL — no code changes until approved  
**Scope:** Full desktop redesign + premium design system implementation  
**Mobile:** Preserved — redesign is additive at the layout level

---

## Goals

1. Three-column desktop shell (sidebar / main / AI panel)
2. Premium design system applied consistently
3. Real data tables for transaction lists
4. Proper empty states and skeleton loading
5. Toast notification system
6. All existing features intact and working

---

## What We Are NOT Changing

- Auth flow (JWT + Telegram Login Widget)
- API endpoints (all server logic untouched)
- Data model (no schema changes)
- Mobile PWA layout (bottom nav preserved)
- Snooze endpoint (just built)
- Any bot functionality

---

## Screen-by-Screen Design Plan

---

### PULSE

**User's main question:** *How is my business doing right now?*

---

#### Desktop Layout (≥ 1080px)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SIDEBAR (240px)        │  MAIN WORKSPACE                │  AI CFO (320px)   │
│                        │                                │                   │
│ ⬡ HELM FINANCE         │  ┌── METRICS BAR ────────────┐ │  ✦ Helm CFO       │
│                        │  │ Balance │ In │ Out │Runway │ │  ────────────     │
│  CORE                  │  └────────────────────────────┘ │  Analysis text    │
│  ◉ Pulse               │                                │                   │
│  ○ Radar               │  TODAY'S FOCUS     Jun 9, 2026 │  ─────────────    │
│  ○ Accounts            │  ┌────────────────────────────┐ │  Recommended      │
│                        │  │ ○ Reminder title    Snooze │ │  actions          │
│  MONEY                 │  │ ○ Debt: counterparty  Mark │ │                   │
│  ○ Invoices            │  └────────────────────────────┘ │  ─────────────    │
│                        │                                │  Quick Stats      │
│  TEAM                  │  TRANSACTIONS   Jun 2026  [▾] │                   │
│  ○ Payroll             │  ┌──────┬──────────────┬──────┐ │  Runway  14d      │
│                        │  │ Date │ Description  │  Amt │ │  Burn    1.3M/d   │
│  ────────────          │  ├──────┼──────────────┼──────┤ │  Net    -20.9M    │
│  ○ Settings            │  │ rows                       │ │                   │
│                        │  │ rows                       │ │  ─────────────    │
│  ────────────          │  └────────────────────────────┘ │  Upcoming debts   │
│  [avatar] Andrey       │                                │                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Metrics bar tiles:**
1. Total Balance (all accounts, all time)
2. Income This Month (green value)
3. Expenses This Month (neutral/primary value — not red)
4. Runway (days; color by threshold)

**Today's Focus list:**
- Compact rows, not cards
- Checkboxes for reminders (click = mark done)
- Snooze button appears on hover for reminders
- "Mark paid" for debts
- Overdue items: rose left border
- Empty: subtle "You're all caught up ✓" message

**Transaction table:**
- Columns: Date | Description | Category | Source | Scope | Amount
- Right-aligned amounts, tabular-nums
- No cards — pure table
- Month selector (dropdown) to switch periods
- Default: current month

---

#### Mobile Layout (< 768px)

```
┌─────────────────────────┐
│ TOPBAR: Helm Finance   ≡ │
├─────────────────────────┤
│ SCROLL AREA             │
│                         │
│  ┌───────────────────┐  │
│  │ Balance           │  │
│  │ Rp 5,620,000      │  │
│  └───────────────────┘  │
│                         │
│  ┌────────┬──────────┐  │
│  │ In     │ Out      │  │
│  │ 17.4M  │ 38.3M    │  │
│  └────────┴──────────┘  │
│                         │
│  TODAY'S FOCUS ─────    │
│  ○ Reminder...  Snooze  │
│                         │
│  TRANSACTIONS ──────    │
│  Jun 9 · Бензин -300K   │
│  Jun 8 · Оплата +5M     │
│  ...                    │
│                         │
├─────────────────────────┤
│ BOTTOM NAV              │
│ Pulse Radar Acc Add     │
└─────────────────────────┘
```

Mobile changes from current:
- Balance tile: full-width, prominent (already somewhat this way)
- Income/Expense: two-up row (not three cards)
- Transaction list: compact rows, NOT cards with full metadata visible
- Remove the AI panel entirely on mobile (it's in a floating sheet instead, triggered by a button)

---

#### Primary Actions
- Mark reminder done
- Snooze reminder
- Mark debt paid
- Navigate to period (month dropdown)
- Add transaction (button in topbar or FAB on mobile)

#### Data Required
- `GET /api/pulse` — all pulse data
- Fields: `transactions`, `reminders`, `debts`, `accounts`, `aiAnalysis`

#### Empty State (no transactions ever)
```
        [Activity icon — 48px, tertiary]
        
        No transactions yet
        
        Add your first transaction to see your balance,
        spending breakdown, and AI insights.
        
        [Add transaction]
```

#### Risks
- Metrics bar requires calculating total balance across all virtual accounts — currently done client-side from transaction sum. If user has many transactions, this is slow. For v1: acceptable. For v2: precompute server-side.
- AI analysis requires a call to Anthropic on every page load — needs a loading state and should be cached with a TTL (e.g. 5 minutes). Current implementation fires on every mount.
- "Today's Focus" reminders: currently no filter by `snoozed_until` on the client — a snoozed reminder still shows until the query filters it. The GET /api/pulse should exclude reminders where `snoozed_until > now()`.

---

### RADAR (Transaction Explorer)

**User's main question:** *Where did my money go?*

---

#### Desktop Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  RADAR — Transaction Explorer               [Export CSV] │
│         │  ┌──────────────────────────────────────────────────────┐│
│         │  │ 🔍 Search  │ Scope ▾ │ Type ▾ │ Period ▾ │ Date ▾   ││
│         │  └──────────────────────────────────────────────────────┘│
│         │  ┌──────────────────────────────────────────────────────┐│
│         │  │  TOTAL FILTERED: Rp 38,347,000 · 14 transactions      ││
│         │  ├─────────┬─────────────────────┬──────────┬───┬───────┤│
│         │  │ DATE    │ DESCRIPTION         │ CATEGORY │SRC│AMOUNT ││
│         │  ├─────────┼─────────────────────┼──────────┼───┼───────┤│
│         │  │ Jun 09  │ Бензин              │Transport │BCA│-300K  ││
│         │  │ Jun 08  │ Оплата от клиента   │ Income   │Prm│+5.0M  ││
│         │  │ ...                                                    ││
│         │  └──────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
```

**Filter bar:**
- Search: text input, filters description in real-time (client-side)
- Scope: All / Personal / Business
- Type: All / Income / Expense
- Period: This month / Last 30d / This quarter / This year / Custom
- Date: date range picker (from / to)

**Summary row above table:**
- Total filtered amount (sum of visible rows)
- Count of visible transactions
- Updates live as filters change

**Table columns:**
- Date: short format "Jun 9" — sortable
- Description: truncated, full on hover tooltip
- Category: badge pill
- Source: secondary text
- Scope: badge (Business / Personal)
- Amount: right-aligned, tabular-nums, income green / expense neutral

**Row actions (visible on hover):**
- Edit (pencil icon) — future
- Delete (trash icon) — future
- For now: click to expand details in a bottom drawer or inline expansion

---

#### Mobile Layout

```
┌─────────────────────────┐
│ Radar           [⚙ ...]  │
├─────────────────────────┤
│ [🔍 Search           ]  │
│ [All ▾] [All ▾] [Mo ▾] │
├─────────────────────────┤
│ Total: Rp 38.3M · 14tx  │
├─────────────────────────┤
│ Jun 9                   │
│ Бензин          -300K   │
│ Transport · BCA          │
│ ─────────────────────── │
│ Jun 8                   │
│ Оплата от клиента  +5M  │
│ Income · Permata         │
└─────────────────────────┘
```

Mobile: grouped by date, two-line compact rows (description + meta below).

---

#### Primary Actions
- Filter transactions
- Export CSV
- Search by description

#### Data Required
- `GET /api/transactions?scope=&type=&from=&to=` — full transaction list with filters

#### Empty State (filters return nothing)
```
        [Search icon]
        
        No transactions match
        
        Try adjusting your filters or date range.
        
        [Clear filters]
```

#### Risks
- No pagination in current API — all transactions loaded at once. For small datasets (< 200 rows) this is fine. Flag for v2.
- Category is null for all pre-migration transactions — the category column will be empty for most rows until users add new transactions. This is expected. Consider showing "Uncategorized" as a badge rather than a blank cell.

---

### ACCOUNTS

**User's main question:** *What's in each of my accounts?*

---

#### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  ACCOUNTS                                              │
│         │ ┌──────────────────┬─────────────────────────────────┐│
│         │ │ ACCOUNTS         │ BCA                              ││
│         │ │ ───────────────  │ ─────────────────────────────── ││
│         │ │ BCA      4,200K  │ Balance: Rp 4,200,000            ││
│         │ │ Permata  1,100K  │ 8 transactions                   ││
│         │ │ Cash       320K  │                                  ││
│         │ │ Helm Care  500K  │ ┌──────────────────────────────┐ ││
│         │ │ ───────────────  │ │ DATE  DESCRIPTION     AMOUNT │ ││
│         │ │ TOTAL    6,120K  │ ├──────────────────────────────┤ ││
│         │ │                  │ │ rows...                       │ ││
│         │ │ [+ Adjust]       │ └──────────────────────────────┘ ││
│         │ └──────────────────┴─────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

**Left panel (accounts list):**
- Each account: name + balance (right-aligned)
- Total row at bottom
- Selected account: accent left border + bg highlight
- "+ Adjust balance" link at bottom (opens modal)

**Right panel (account detail):**
- Account name as heading
- Balance metric (large)
- Transaction count
- Filtered transaction table for that account

---

#### Mobile Layout

```
┌─────────────────────────┐
│ Accounts                │
├─────────────────────────┤
│ TOTAL: Rp 6,120,000     │
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ BCA                 │ │
│ │ Rp 4,200,000  8 tx  │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ Permata             │ │
│ │ Rp 1,100,000  3 tx  │ │
│ └─────────────────────┘ │
│ [tap to expand txns]    │
└─────────────────────────┘
```

Mobile: card list with tap-to-expand. No split panel.

---

#### Primary Actions
- Select account to view transactions
- Adjust balance (modal)
- Add transaction (topbar shortcut)

#### Data Required
- `GET /api/pulse` (already contains accounts + transactions)
- Or dedicated `GET /api/accounts` — virtual accounts computed server-side

#### Empty State
```
        [Wallet icon]
        
        No accounts detected
        
        Accounts appear automatically when you add
        transactions with a source account specified.
        
        [Add transaction]
```

#### Risks
- Account source normalization (Group G) not yet done — same account may appear multiple times with different names ("BCA", "bca", "BCA Personal"). This makes the Accounts page look broken. Either approve Group G before launching the redesign, or add a note in empty/warning state.
- Adjust balance inserts a special transaction — this won't appear correctly in the account detail table without filtering it out or labeling it differently.

---

### ADD TRANSACTION

**User's main question:** *How do I add a transaction quickly?*

---

#### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  ADD TRANSACTION                                        │
│         │ ┌───────────────────────┬──────────────────────────────┐│
│         │ │ DESCRIBE              │ PARSED RESULT                ││
│         │ │                       │                              ││
│         │ │ [Natural language     │ (empty until parsed)         ││
│         │ │  textarea, 5 rows]    │                              ││
│         │ │                       │                              ││
│         │ │ [Parse →]             │                              ││
│         │ │                       │                              ││
│         │ │ ─ or paste directly ─ │ After parse:                 ││
│         │ │                       │ ┌──────────────────────────┐ ││
│         │ │ Tips:                 │ │ Type    expense     [▾]  │ ││
│         │ │ · "кофе 35к наличные" │ │ Amount  35,000      [✎]  │ ││
│         │ │ · "зарплата 5М BCA"   │ │ Source  Наличные    [✎]  │ ││
│         │ │ · "оплата от клиента  │ │ Scope   Personal    [▾]  │ ││
│         │ │   Helm Care 2М"       │ │ Cat.    Еда         [✎]  │ ││
│         │ │                       │ └──────────────────────────┘ ││
│         │ │                       │ [✓ Save]  [✗ Cancel]        ││
│         │ └───────────────────────┴──────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

**After parse:**
- Show editable field-by-field breakdown
- Each field can be corrected before saving
- Multiple transactions (if parsed): show list, each collapsible

---

#### Mobile Layout

```
┌─────────────────────────┐
│ Add Transaction         │
├─────────────────────────┤
│ [Describe transaction   │
│  in any language...   ] │
│                         │
│          [Parse →]      │
├─────────────────────────┤
│ (parsed result appears) │
│                         │
│ expense · 35,000 IDR    │
│ Кофе · Наличные         │
│                         │
│ [✓ Save]  [✗ Cancel]    │
└─────────────────────────┘
```

---

#### Primary Actions
- Parse text
- Edit parsed fields
- Confirm save
- Cancel

#### Data Required
- `POST /api/parse` (text → parsed transactions)
- `POST /api/transactions/batch` (save confirmed transactions)

#### Empty State (before parse)
- Tips section with example inputs (already planned above)

#### Risks
- Currently no field-level editing after parse — this is a new feature. For v1 of the redesign, we can keep the current flow (parse → preview → confirm) and add editing in v2. Flag this.
- Multi-transaction parse produces multiple items — UI needs to handle the array case cleanly.

---

### INVOICES (NEW MODULE — design only, no code yet)

*See INVOICES_MODULE_SPEC.md for full specification.*

**User's main question:** *What do I owe and who owes me?*

---

#### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  INVOICES                            [+ New Invoice]        │
│         │ ┌─────────────────────────────────────────────────────────┐│
│         │ │ SUMMARY BAR                                             ││
│         │ │ Receivable: +Rp 12M (3)  │  Payable: -Rp 4.5M (2)     ││
│         │ │ Overdue: Rp 2M (1)       │  Due this week: Rp 1.5M (1) ││
│         │ ├─────────────────────────────────────────────────────────┤│
│         │ │ [All ▾] [Status ▾] [Type ▾] [Period ▾]  [🔍 Search]   ││
│         │ ├──────────┬──────────────┬──────────┬─────────┬─────────┤│
│         │ │ DUE DATE │ COUNTERPARTY │ TYPE     │ STATUS  │  AMOUNT ││
│         │ ├──────────┼──────────────┼──────────┼─────────┼─────────┤│
│         │ │ Jun 15   │ Helm Care    │Receivable│ Pending │  +5.0M  ││
│         │ │ Jun 12   │ Vendor ABC   │ Payable  │ Overdue │  -2.0M  ││
│         │ │ ...                                                      ││
│         │ └─────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

---

#### Mobile Layout

```
┌─────────────────────────┐
│ Invoices        [+ New] │
├─────────────────────────┤
│ OVERDUE    Rp 2M    (1) │
│ THIS WEEK  Rp 1.5M  (1) │
├─────────────────────────┤
│ [All ▾] [Status ▾]     │
├─────────────────────────┤
│ OVERDUE                 │
│ Vendor ABC   -Rp 2M     │
│ Due Jun 12              │
│                         │
│ PENDING                 │
│ Helm Care   +Rp 5M      │
│ Due Jun 15              │
└─────────────────────────┘
```

---

### SETTINGS

**User's main question:** *How do I manage my account and preferences?*

---

#### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  SETTINGS                                              │
│         │ ┌──────────────────┬─────────────────────────────────┐│
│         │ │ SETTINGS NAV     │ PROFILE                         ││
│         │ │ ─────────────    │ ─────────────────────────────── ││
│         │ │ ● Profile        │ [avatar 48px]                   ││
│         │ │ ○ Preferences    │ Andrey Cesnokov                 ││
│         │ │ ○ Integrations   │ Connected via Telegram          ││
│         │ │ ○ Danger Zone    │                                 ││
│         │ │                  │ ─────────────────────────────── ││
│         │ │                  │ PREFERENCES (v1 placeholder)    ││
│         │ │                  │ Default currency: IDR           ││
│         │ │                  │ Date format: DD MMM YYYY        ││
│         │ │                  │                                 ││
│         │ │                  │ ─────────────────────────────── ││
│         │ │                  │ DANGER ZONE                     ││
│         │ │                  │ [Log out]                       ││
│         │ └──────────────────┴─────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

#### Mobile Layout

```
┌─────────────────────────┐
│ Settings                │
├─────────────────────────┤
│ [avatar] Andrey         │
│ via Telegram            │
├─────────────────────────┤
│ PREFERENCES             │
│ Currency   IDR     [▾]  │
├─────────────────────────┤
│ ACCOUNT                 │
│ Log out           [→]   │
└─────────────────────────┘
```

---

## Implementation Sequence

### Phase 1 — Design System Foundation
*Touches: `client/src/styles/` (new), `client/src/index.css`*

1. Create `client/src/styles/tokens.css` — all design tokens
2. Create `client/src/styles/reset.css` — body, box-sizing, font-smoothing
3. Create `client/src/styles/typography.css` — type scale classes
4. Create `client/src/styles/animations.css` — keyframes
5. Update `client/src/index.css` to import above files; migrate existing tokens

**Deliverable:** No visual change yet, but token system in place.

---

### Phase 2 — Shell Redesign
*Touches: `client/src/App.jsx`, new `Sidebar.jsx`, new `RightPanel.jsx`, new `BottomNav.jsx`*

1. Extract Sidebar into `client/src/components/Sidebar.jsx`
2. Extract RightPanel into `client/src/components/RightPanel.jsx`
3. Extract BottomNav into `client/src/components/BottomNav.jsx`
4. Rewrite App.jsx layout with CSS Grid 3-column shell
5. Implement responsive breakpoints

**Deliverable:** Three-column desktop shell visible. Pages still show existing content inside.

---

### Phase 3 — Core Components
*Touches: new `client/src/components/ui/` directory*

1. `MetricsBar.jsx` — 4-tile summary bar
2. `DataTable.jsx` — reusable table with columns, sort, hover
3. `Badge.jsx` — status/category badges
4. `Button.jsx` — primary / secondary / ghost / danger variants
5. `Input.jsx` — input, textarea, select
6. `Skeleton.jsx` — shimmer loading placeholder
7. `EmptyState.jsx` — icon + message + CTA
8. `Toast.jsx` + `useToast.js` — toast notification system
9. `Modal.jsx` — wrapper for createPortal modals (already pattern exists)

**Deliverable:** Component library ready to use.

---

### Phase 4 — Page Redesigns
*Touches: `client/src/pages/*.jsx`*

Order:
1. **Pulse** — highest value, most visible
2. **Radar** — DataTable is the primary win here
3. **Accounts** — split panel layout
4. **Add** — two-panel layout
5. **Settings** — settings sidebar + content

**Deliverable:** All existing pages use new design system.

---

### Phase 5 — Polish
1. Empty states for all pages
2. Skeleton loading for all async data
3. Toast notifications replacing any remaining alert() or silent failures
4. Page transition animations
5. Keyboard navigation basics (Tab order, Escape for modals)

**Deliverable:** Production-quality UI.

---

### Phase 6 — Invoices Module
*After Phase 5 is approved*

See INVOICES_MODULE_SPEC.md. New page, new API endpoints, new DB table.

---

## File Change Map

| File | Change type | Phase |
|------|-------------|-------|
| `client/src/styles/tokens.css` | CREATE | 1 |
| `client/src/styles/reset.css` | CREATE | 1 |
| `client/src/styles/typography.css` | CREATE | 1 |
| `client/src/styles/animations.css` | CREATE | 1 |
| `client/src/index.css` | REWRITE | 1 |
| `client/src/App.jsx` | REWRITE | 2 |
| `client/src/components/Sidebar.jsx` | CREATE | 2 |
| `client/src/components/RightPanel.jsx` | CREATE | 2 |
| `client/src/components/BottomNav.jsx` | CREATE | 2 |
| `client/src/components/ui/MetricsBar.jsx` | CREATE | 3 |
| `client/src/components/ui/DataTable.jsx` | CREATE | 3 |
| `client/src/components/ui/Badge.jsx` | CREATE | 3 |
| `client/src/components/ui/Button.jsx` | CREATE | 3 |
| `client/src/components/ui/Input.jsx` | CREATE | 3 |
| `client/src/components/ui/Skeleton.jsx` | CREATE | 3 |
| `client/src/components/ui/EmptyState.jsx` | CREATE | 3 |
| `client/src/components/ui/Toast.jsx` | CREATE | 3 |
| `client/src/pages/Pulse.jsx` | REWRITE | 4 |
| `client/src/pages/Radar.jsx` | REWRITE | 4 |
| `client/src/pages/Accounts.jsx` | REWRITE | 4 |
| `client/src/pages/Add.jsx` | REWRITE | 4 |
| `client/src/pages/Settings.jsx` | REWRITE | 4 |
| `client/src/pages/Invoices.jsx` | CREATE | 6 |
| `server/index.js` | ADD endpoints | 6 |

---

## Mobile PWA Preservation Rules

During every phase, these mobile behaviors must be preserved:
- Bottom navigation bar visible on `< 768px`
- Sidebar hidden on `< 768px`
- Right panel hidden on `< 1280px`
- Touch targets minimum 44px
- Scroll areas use `-webkit-overflow-scrolling: touch`
- PWA manifest and service worker unchanged

---

## Open Questions Requiring Your Decision Before Implementation

**Q1: Transaction amounts on desktop — should expenses be neutral (primary text) or a very dark red?**
My recommendation: neutral (primary text). Red = alarming, breaks calm CFO feel. Overdue items use red, not routine expenses.

**Q2: Should Invoices be in the nav immediately (disabled state with "Coming soon") or hidden until implemented?**
My recommendation: show it with a subtle "Soon" badge. It communicates product direction to users and feels like a real product roadmap.

**Q3: Should we pre-approve Group G (source normalization) before the redesign launch?**
My recommendation: yes. The Accounts page will look broken with duplicate account names. Group G should ship with or before the redesign.

**Q4: Font loading — import Inter from Google Fonts or bundle it?**
My recommendation: Google Fonts (one `@import` line in index.css). Fast enough for a web app, zero bundle size cost, always up-to-date. Bundle it in v2 if you want offline-first.

**Q5: Should the AI CFO panel be collapsible?**
My recommendation: yes, with a toggle button. Power users want to collapse it for more main content width. State should persist in localStorage.
