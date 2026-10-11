# Helm Finance — Desktop Product Audit

**Date:** 2026-06-09  
**Type:** Pre-redesign audit  
**Scope:** Current UI quality assessment, gap analysis vs premium fintech benchmarks  
**Status:** READ ONLY — no code changes until design plan approved

---

## Executive Summary

The current app is a functional MVP built mobile-first. On mobile it is usable. On desktop it falls into the most common PWA anti-pattern: a 400px card column centered in a 1440px browser window, surrounded by dead space. The product works. It does not feel like software worth paying for.

The gap between "working" and "premium" is entirely design execution. The data model is sound. The AI parsing is real. The infrastructure is solid. What is missing is information density, spatial hierarchy, and the visual language of financial trust.

---

## Benchmark Analysis

### Stripe Dashboard
**What makes it premium:**
- Sidebar navigation with icon + label, grouped by function
- Metrics row at top of every page — never buried
- Data tables with consistent column widths, right-aligned numbers, monospace amounts
- Cards only for summary tiles, never for lists
- Color used sparingly — green/red only for status, never decoration
- Empty states have clear CTAs, not just "no data"

**What we should steal:** The metrics bar. Monospace amounts. Status pill design. Empty state pattern.

### Mercury Banking
**What makes it premium:**
- Persistent left sidebar with account balance visible at all times
- Account switcher at top of sidebar
- Clean transaction list — date on left, description center, amount right-aligned
- Amount color: green for in, default for out (not red — Mercury is calm, not alarming)
- Minimal iconography — used only to support text, never to replace it
- Real horizontal density on desktop

**What we should steal:** Always-visible balance in sidebar. Transaction list layout. The calm, non-alarming color use for expenses.

### Ramp
**What makes it premium:**
- Three-column layout: sidebar, main, context panel
- Main area is a real data grid, not stacked cards
- Right panel shows AI insights and recommended actions
- Typography: tight tracking, large metric numbers, small supporting labels
- Status badges: rounded rectangles, very subtle background, matching text color
- Hover states on every interactive row

**What we should steal:** The three-column layout directly. AI CFO panel on the right. Row hover states. Badge design.

### Linear
**What makes it premium:**
- Dense sidebar with nested navigation — project groupings
- Main workspace is a real list, not cards
- Keyboard-first design (shortcuts visible in tooltips)
- Neutral color palette — priority conveyed by position and weight, not color screaming
- Instant feedback on every action
- Progress indicators are subtle, never blocking

**What we should steal:** Navigation grouping. Density of the list view. Subtle interaction feedback.

### Vercel
**What makes it premium:**
- Dark-first design system that feels technical and confident
- System status always visible
- Deployment/activity timeline as primary affordance
- Monospace for technical values (IDs, hashes, amounts could mirror this)
- Excellent empty states that explain value, not just absence

**What we should steal:** Confidence of the dark theme option. Activity timeline concept for transaction feed. The "zero to value" empty state messaging.

---

## Current UI Audit — Screen by Screen

### Global / Shell

**What exists:**
- Bottom navigation bar (mobile)
- Sidebar exists but is a CSS-class sidebar that only shows on wider screens
- No persistent account summary
- No global search
- No keyboard shortcuts
- No user profile/avatar in navigation

**Severity: CRITICAL**

Issues:
1. Sidebar is hidden by default and appears only via CSS breakpoint — it's not a real desktop layout
2. Bottom nav shows on desktop at some widths — looks like a mobile app in a browser
3. No persistent balance or account context visible anywhere on desktop
4. Navigation items have no grouping or hierarchy
5. No active state visual weight — current page is barely distinguishable
6. No app logo / wordmark in sidebar
7. User identity (Telegram avatar/name) not visible after login

**What premium looks like:**
- Fixed 240px sidebar, always visible on desktop
- Logo + user account at top of sidebar
- Navigation grouped: (Core: Pulse, Radar, Accounts) | (Money: Invoices) | (Team: Payroll) | (Config: Settings)
- Current page: full-width colored left border + bold label + filled icon
- Sidebar bottom: user avatar, name, Telegram badge
- Right panel: AI CFO — 320px, always visible on desktop ≥ 1280px

---

### Pulse Page

**What exists:**
- Header with greeting + date
- Summary tiles (income / expense / balance) — horizontal row of cards
- "Today's Focus" section — reminders and debts as action items
- "This Month" transactions as scrollable list
- Right panel (desktop): AI analysis + AI action items + quick stats + upcoming debts

**What works:**
- The data is correct
- Right panel concept is right
- Today Focus is genuinely useful

**What is broken on desktop:**

| Issue | Severity |
|-------|----------|
| Summary tiles are mobile cards stretched to ~300px each — enormous whitespace | HIGH |
| Transaction list is a column of cards, not a table | HIGH |
| "Today's Focus" items have no visual hierarchy between reminder vs debt | MEDIUM |
| No real date filtering (month selector) | MEDIUM |
| Numbers use `toLocaleString('id-ID')` but format inconsistently | MEDIUM |
| Amount typography is body text weight, not metric weight | HIGH |
| No currency toggle (all amounts in IDR, but user transacts in USD/RUB too) | MEDIUM |
| Empty state for no transactions is just blank | HIGH |
| Loading state is a bare "Loading..." text | HIGH |
| The greeting "Good morning, Andrey" — okay for MVP, too casual for CFO tool | LOW |

**Desktop layout needed:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ METRICS BAR: Total Balance | This Month In | This Month Out | Runway    │
├───────────────────────────────────────────────┬─────────────────────────┤
│ TODAY'S FOCUS                   (compact list) │ AI CFO PANEL            │
│ ─────────────────────────────────────────────  │ ─────────────────────── │
│ TRANSACTIONS THIS MONTH         (data table)   │ Analysis + Actions      │
│                                                │ Quick Stats             │
│                                                │ Upcoming Debts          │
└───────────────────────────────────────────────┴─────────────────────────┘
```

---

### Radar Page (Transaction Explorer)

**What exists:**
- Filter bar (scope, type, period)
- List of transactions as stacked cards
- Each card: description, category, amount, date, source, scope badge

**What is broken on desktop:**

| Issue | Severity |
|-------|----------|
| Cards for a transaction list — should be a proper table | CRITICAL |
| No column sorting | HIGH |
| No search / text filter | HIGH |
| No export button (CSV exists in bot but not web) | MEDIUM |
| Category column is always null for existing data | MEDIUM (known, pre-migration) |
| No pagination or virtual scrolling — all records loaded | HIGH |
| Amount column not right-aligned | HIGH |
| Date column shows full ISO string in some views | MEDIUM |
| No row hover state | MEDIUM |

**Desktop layout needed:**
```
┌────────────────────────────────────────────────────────────┐
│ FILTER BAR: Search | Scope | Type | Period | Date range    │
├────────┬──────────────────┬──────────┬───────┬─────────────┤
│ Date   │ Description      │ Category │Source │      Amount │
├────────┼──────────────────┼──────────┼───────┼─────────────┤
│ rows with hover states, right-aligned amounts, badges       │
└────────────────────────────────────────────────────────────┘
```

---

### Accounts Page

**What exists:**
- Account cards (virtual accounts derived from source)
- Per-account: icon, name, balance, transaction count
- Click to expand: transaction list for that account

**What is broken on desktop:**

| Issue | Severity |
|-------|----------|
| Account cards are mobile-sized in a responsive grid | HIGH |
| No accounts sidebar (Accounts list left, Detail right) | HIGH |
| "Adjust balance" feature is hidden and confusing | MEDIUM |
| Virtual account icons are placeholder circles | MEDIUM |
| No account-level transaction table (uses cards) | HIGH |
| Source names not normalized — same account can appear twice with different casing | HIGH (Group G) |
| null-source transactions fall into unnamed bucket | HIGH (Group G) |

**Desktop layout needed:**
```
┌────────────────┬───────────────────────────────────────────┐
│ ACCOUNTS LIST  │ ACCOUNT DETAIL                            │
│ ─────────────  │ ─────────────────────────────────────────  │
│ BCA      4.2M  │ BCA — Rp 4,200,000                        │
│ Permata  1.1M  │ [Transaction table for this account]      │
│ Cash     320K  │                                           │
│ ─────────────  │                                           │
│ TOTAL    5.6M  │                                           │
└────────────────┴───────────────────────────────────────────┘
```

---

### Add Page

**What exists:**
- Text area for natural language input
- Parse button
- Preview of parsed transactions
- Confirm / cancel

**What is broken on desktop:**

| Issue | Severity |
|-------|----------|
| Full-width textarea on desktop — too wide to type naturally | MEDIUM |
| No quick-add shortcuts (common transaction templates) | LOW |
| Parse result preview is mobile cards | MEDIUM |
| No ability to edit individual fields after parse | MEDIUM |
| No file upload for invoice/receipt parsing (future) | LOW |

**Desktop layout needed:**
```
┌────────────────────────────┬───────────────────────────────┐
│ INPUT AREA                 │ PARSED RESULT PREVIEW         │
│ Natural language textarea  │ Editable transaction fields   │
│ [Parse →]                  │ [✓ Confirm] [✗ Cancel]        │
└────────────────────────────┴───────────────────────────────┘
```

---

### Settings Page

**What exists:**
- Profile section
- Logout button
- Placeholder sections

**What is broken:**

| Issue | Severity |
|-------|----------|
| Essentially empty — minimal content | HIGH |
| No currency preferences | MEDIUM |
| No date format preference | LOW |
| No notification preferences | LOW |
| No API key / integrations section | LOW |

---

## Typography Audit

**Current state:**
- Font: system default (no custom font loaded)
- Metric numbers: same weight as body text (400)
- No monospace for financial amounts
- Line heights inconsistent across components
- `font-size` values scattered — no type scale

**What premium fintech uses:**
- Display metrics: 32–48px, weight 600–700
- Body: 14px, weight 400, line-height 1.5
- Labels/captions: 11–12px, weight 500, letter-spacing 0.05em, UPPERCASE
- Amounts: monospace or tabular figures so columns align
- Heading hierarchy: 3 levels maximum, clear distinction

**Required fonts:**
- UI text: Inter (already common, legible, professional)
- Amounts: Inter with `font-variant-numeric: tabular-nums` — keeps it one font
- No display font needed for v1 — Inter at large weights is sufficient

---

## Color System Audit

**Current tokens (from index.css :root):**
```css
--bg: #0d0f12        /* Near black */
--bg-2: #161a20      /* Dark card */
--bg-3: #1e232b      /* Slightly lighter */
--border: #2a303c    /* Subtle divider */
--text: #e8ecf1      /* Primary text */
--text-2: #8892a0    /* Secondary */
--text-3: #4a5568    /* Tertiary / disabled */
--green: #22c55e     /* Success / income */
--green-dark: #16a34a
--red: #ef4444       /* Error / expense */
--amber: #f59e0b     /* Warning */
--amber-dark: #d97706
--blue: #3b82f6      /* Accent / interactive */
--blue-dark: #2563eb
```

**Issues:**
1. `--red` for expenses — this is alarming language for normal spending. Mercury uses neutral text. Only overdue/critical should be red.
2. No surface hierarchy between page bg, panel bg, card bg — three shades exist but inconsistently applied
3. `--blue` used for all interactive elements — no distinction between primary action, secondary action, and link
4. No semantic tokens (e.g. `--color-income`, `--color-expense`, `--color-overdue`) — components hardcode `var(--green)` / `var(--red)`
5. No light mode support — entirely dark, which is fine for v1 but should be planned
6. `--amber` used for both "attention" and "warning" — same token for different semantic states

**Required additions:**
- Semantic layer over primitives
- Expense color: `--text` (neutral) not red — only negative balance uses red
- Overdue: `--red` — reserved for actionable urgency only
- Brand accent: a distinct indigo/violet to differentiate from pure blue utilities

---

## Spacing System Audit

**Current state:**
- Inline `padding: '14px'`, `gap: 6`, `margin: 8` everywhere in JSX style props
- No spacing scale
- Cards have different internal padding values across components
- List items inconsistent height — some 44px, some 56px, some auto

**Required:**
A strict 4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64

---

## Component Inventory — What Needs Rebuilding

| Component | Current State | Required State | Priority |
|-----------|--------------|----------------|----------|
| Shell / Layout | Mobile layout + CSS sidebar | True 3-column desktop layout | P0 |
| Sidebar | Basic nav list | Grouped nav, logo, user, account summary | P0 |
| Right AI Panel | Exists, rough | Polished, structured sections | P0 |
| Metric tiles | Large mobile cards | Compact 4-up metrics bar | P0 |
| Transaction list | Stacked cards | Data table with columns | P0 |
| Account list | Cards grid | Sidebar list + detail panel | P1 |
| Status badges | CSS class pills | Design system badges | P1 |
| Loading states | "Loading..." text | Skeleton screens | P1 |
| Empty states | Blank / nothing | Illustrated empty + CTA | P1 |
| Buttons | Inconsistent styles | Primary / Secondary / Ghost / Danger | P1 |
| Modals | createPortal, functional | Polished with animation | P2 |
| Forms / inputs | Raw HTML inputs | Designed input components | P2 |
| Date range picker | None | Real picker component | P2 |
| Toast / notifications | None (alert() was there) | Toast system | P2 |

---

## Critical Regressions to Prevent

When redesigning, these must not break:
1. `createPortal` modals — already fixed, must stay
2. CSS custom properties in `:root` — already fixed, must stay
3. Mobile PWA layout — redesign desktop; mobile must remain functional
4. Auth flow — JWT session, Telegram widget
5. Data fetching — all API calls intact
6. Snooze endpoint — just built, must stay wired

---

## Summary: What "Premium" Requires

| Dimension | Current | Target |
|-----------|---------|--------|
| Layout | Mobile card column | 3-column desktop + mobile PWA |
| Navigation | Bottom bar + CSS sidebar | Persistent 240px sidebar |
| Information density | 1 item per card | Real tables, 10+ rows visible |
| Typography | System font, uniform weight | Inter, tabular nums, size scale |
| Color | Functional but alarming | Semantic, calm, status-driven |
| Spacing | Arbitrary inline values | 4px grid, design tokens |
| Empty states | None | Designed with CTAs |
| Loading states | "Loading..." | Skeleton screens |
| Interactivity | Basic click | Hover states, keyboard nav |
| Feedback | None / alert() | Toast system |
