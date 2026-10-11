# Helm Finance — Premium Design System

**Date:** 2026-06-09  
**Version:** v1.0 (pre-implementation)  
**Status:** DESIGN ONLY — awaiting approval before code changes

---

## Design Principles

**1. Trust through precision.**
Every number is correctly formatted, right-aligned, and uses tabular figures. Financial data that looks sloppy feels untrustworthy. We earn trust through typographic discipline.

**2. Calm confidence.**
Expenses are not alarming. Red is reserved for overdue, critical, and destructive actions. A business that spends money is healthy. The UI should not panic when it sees a payment.

**3. Density with breathing room.**
We show more information per screen than a mobile app but we never crowd. Tables have sufficient row height. Sections have clear visual separation. The sidebar never feels cramped.

**4. AI as advisor, not gimmick.**
The AI CFO panel is always present on desktop but never interrupts. It answers questions the user was about to ask. Insights use plain language, not ML jargon.

**5. Mobile and desktop are equal citizens.**
Desktop gets the three-column layout. Mobile gets the full-screen layout with bottom navigation. Both use the same design tokens, same components, same data.

---

## Color System

### Primitives (raw values — do not use directly in components)

```css
/* Neutrals */
--neutral-0:   #ffffff
--neutral-50:  #f8f9fb
--neutral-100: #f1f3f6
--neutral-200: #e4e7ed
--neutral-300: #cdd2db
--neutral-400: #9aa3b0
--neutral-500: #6b7585
--neutral-600: #4a5468
--neutral-700: #323b4d
--neutral-800: #1e2535
--neutral-900: #141922
--neutral-950: #0d1117

/* Brand — Indigo (primary interactive) */
--indigo-50:   #eef2ff
--indigo-100:  #e0e7ff
--indigo-300:  #a5b4fc
--indigo-400:  #818cf8
--indigo-500:  #6366f1
--indigo-600:  #4f46e5
--indigo-700:  #4338ca

/* Emerald (income, positive, success) */
--emerald-50:  #ecfdf5
--emerald-300: #6ee7b7
--emerald-400: #34d399
--emerald-500: #10b981
--emerald-600: #059669

/* Rose (overdue, critical, destructive) */
--rose-50:     #fff1f2
--rose-300:    #fda4af
--rose-400:    #fb7185
--rose-500:    #f43f5e
--rose-600:    #e11d48

/* Amber (warning, attention, pending) */
--amber-50:    #fffbeb
--amber-300:   #fcd34d
--amber-400:   #fbbf24
--amber-500:   #f59e0b
--amber-600:   #d97706

/* Violet (AI, insights, special actions) */
--violet-50:   #f5f3ff
--violet-300:  #c4b5fd
--violet-400:  #a78bfa
--violet-500:  #8b5cf6
--violet-600:  #7c3aed
```

### Semantic Tokens (use these in components)

```css
:root {
  /* Backgrounds */
  --bg-app:      #0d1117;   /* Page background */
  --bg-surface:  #141922;   /* Sidebar, panels */
  --bg-elevated: #1e2535;   /* Cards, dialogs */
  --bg-overlay:  #252f40;   /* Dropdown, tooltip bg */
  --bg-input:    #1a2232;   /* Input fields */

  /* Borders */
  --border-subtle:  rgba(255,255,255,0.06);   /* Dividers, card edges */
  --border-default: rgba(255,255,255,0.10);   /* Input borders, table lines */
  --border-strong:  rgba(255,255,255,0.18);   /* Focus rings, hover */

  /* Text */
  --text-primary:   #f0f4f8;   /* Headings, values, primary labels */
  --text-secondary: #8892a4;   /* Supporting text, metadata */
  --text-tertiary:  #4a5468;   /* Placeholders, disabled, captions */
  --text-inverse:   #0d1117;   /* Text on light backgrounds */

  /* Interactive */
  --accent:          #6366f1;   /* Primary CTA, links, focus */
  --accent-hover:    #4f46e5;   /* Hover on primary */
  --accent-subtle:   rgba(99,102,241,0.12);   /* Accent bg for selection, highlight */

  /* Semantic status */
  --color-income:    #10b981;   /* Income, positive delta */
  --color-income-bg: rgba(16,185,129,0.10);
  --color-expense:   #f0f4f8;   /* Expense — NEUTRAL, not alarming */
  --color-overdue:   #f43f5e;   /* Overdue, critical, destructive */
  --color-overdue-bg: rgba(244,63,94,0.10);
  --color-pending:   #f59e0b;   /* Pending, attention needed */
  --color-pending-bg: rgba(245,158,11,0.10);
  --color-ai:        #8b5cf6;   /* AI insights, Helm CFO branding */
  --color-ai-bg:     rgba(139,92,246,0.10);

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.5);

  /* Layout */
  --sidebar-width:       240px;
  --right-panel-width:   320px;
  --topbar-height:       56px;
  --content-max-width:   1200px;

  /* Spacing scale (4px base) */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;

  /* Transitions */
  --transition-fast: 100ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
}
```

---

## Typography System

### Type Scale

| Role | Size | Weight | Line-height | Use case |
|------|------|--------|-------------|----------|
| `display-xl` | 48px | 700 | 1.1 | Hero metric (balance on empty state) |
| `display-lg` | 36px | 700 | 1.15 | Primary metric tiles |
| `display-md` | 28px | 600 | 1.2 | Section totals |
| `heading-lg` | 20px | 600 | 1.3 | Page title, dialog title |
| `heading-md` | 16px | 600 | 1.4 | Card headings, section headers |
| `heading-sm` | 14px | 600 | 1.4 | Table column headers |
| `body-lg` | 15px | 400 | 1.6 | Primary body text |
| `body-md` | 14px | 400 | 1.5 | Default body, table rows |
| `body-sm` | 13px | 400 | 1.5 | Secondary body, tooltips |
| `label-lg` | 12px | 500 | 1.4 | Labels, filter pills |
| `label-sm` | 11px | 500 | 1.3 | Captions, UPPERCASE section labels |
| `mono-lg` | 15px | 500 | 1.4 | Large financial amounts |
| `mono-md` | 14px | 400 | 1.4 | Table amounts, IDs |
| `mono-sm` | 12px | 400 | 1.3 | Small amounts, metadata |

### Financial Amount Rules

```css
.amount {
  font-family: var(--font-sans);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  letter-spacing: -0.01em;
}

.amount--large {
  font-size: 28px;
  font-weight: 600;
  color: var(--text-primary);
}

.amount--income  { color: var(--color-income); }
.amount--expense { color: var(--text-primary); }   /* NEUTRAL */
.amount--overdue { color: var(--color-overdue); }
.amount--pending { color: var(--color-pending); }
```

### Section Label Pattern (Mercury-inspired)

```css
.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}
```

---

## Layout System

### Desktop Three-Column

```
┌──────────────────────────────────────────────────────────────────────┐
│ 240px SIDEBAR │ MAIN WORKSPACE (flex-grow)    │ 320px RIGHT PANEL    │
│               │                               │                      │
│ Logo          │ Page header                   │ AI CFO               │
│ ─────────     │ ──────────────────────────    │ ──────────────────   │
│ Navigation    │ Metrics bar                   │ Analysis text        │
│ ─────────     │ ──────────────────────────    │ ──────────────────   │
│ (space)       │ Main content area             │ Action items         │
│               │                               │ ──────────────────   │
│ ─────────     │                               │ Quick stats          │
│ User profile  │                               │ ──────────────────   │
│               │                               │ Upcoming             │
└──────────────────────────────────────────────────────────────────────┘
```

**Breakpoints:**
- `< 768px` — mobile: bottom nav + full-screen content, no sidebar, no right panel
- `768px – 1079px` — tablet: sidebar (icon-only, 64px), no right panel
- `1080px – 1279px` — small desktop: full sidebar (240px), no right panel
- `≥ 1280px` — full desktop: sidebar (240px) + main + right panel (320px)

### CSS Grid for Shell

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr var(--right-panel-width);
  grid-template-rows: 1fr;
  min-height: 100dvh;
}

@media (max-width: 1279px) {
  .app-shell { grid-template-columns: var(--sidebar-width) 1fr; }
}

@media (max-width: 1079px) {
  .app-shell { grid-template-columns: 64px 1fr; }
}

@media (max-width: 767px) {
  .app-shell { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
}
```

---

## Component Specifications

### Sidebar

**Desktop (240px):**
```
┌──────────────────────────┐
│  ⬡ HELM FINANCE          │  ← Logo + wordmark, 56px height
├──────────────────────────┤
│  CORE                    │  ← section-label
│  ◉ Pulse          ●      │  ← active: left border 2px indigo, bg accent-subtle
│  ○ Radar                 │
│  ○ Accounts              │
│                          │
│  MONEY                   │  ← section-label
│  ○ Invoices      NEW     │  ← badge for new features
│                          │
│  TEAM                    │
│  ○ Payroll               │
│                          │
│  ──────────────────────  │
│  ○ Settings              │
├──────────────────────────┤
│  [avatar] Andrey         │  ← user profile, 56px height
│  via Telegram        ·   │
└──────────────────────────┘
```

**States:**
- Default nav item: 36px height, 12px horizontal padding, secondary text
- Active nav item: 36px height, 2px left border in `--accent`, bg `--accent-subtle`, primary text bold
- Hover: bg `--bg-overlay` transition 100ms
- Section labels: UPPERCASE, 11px, tertiary color, margin-top 24px

**Icon-only tablet mode (64px):**
- Icons only, no text
- Active: icon gets `--accent` color
- Tooltip on hover shows label

### Metrics Bar

Used at the top of Pulse page and potentially Accounts.

```
┌────────────┬────────────┬────────────┬────────────┐
│ Total      │ Income     │ Expenses   │ Runway     │
│ Balance    │ This Month │ This Month │            │
│            │            │            │            │
│ Rp 5.6M   │+Rp 17.4M  │ Rp 38.3M   │ 14 days    │
│ ─────────  │ ─────────  │ ─────────  │ ─────────  │
│ all time   │ Jun 2026   │ Jun 2026   │ at burn    │
└────────────┴────────────┴────────────┴────────────┘
```

Specifications:
- 4 tiles in a row, equal width, separated by border
- Tile padding: 20px 24px
- Label: `label-sm`, tertiary color, uppercase
- Value: `display-md` (28px), 600 weight, tabular-nums
- Sub-label: `body-sm`, tertiary
- Income value: `--color-income`
- Balance negative: `--color-overdue`
- Runway < 7 days: `--color-overdue`; 7–14 days: `--color-pending`; > 14 days: primary

### Data Table (Transaction List)

```
┌────────────┬──────────────────────────┬───────────┬────────┬──────────────┐
│ DATE       │ DESCRIPTION              │ CATEGORY  │ SOURCE │       AMOUNT │
├────────────┼──────────────────────────┼───────────┼────────┼──────────────┤
│ Jun 9      │ Бензин                   │ Transport │ BCA    │  -Rp 300,000 │
│ Jun 8      │ Оплата от клиента        │ Income    │Permata │+Rp 5,000,000 │
└────────────┴──────────────────────────┴───────────┴────────┴──────────────┘
```

Specifications:
- Row height: 44px
- Column header: `label-sm`, uppercase, tertiary, border-bottom
- Row text: `body-md`, primary
- Date: secondary color, fixed width 72px
- Description: flex-grow, truncate at 1 line
- Category: badge pill (see Badge spec)
- Source: secondary, fixed 80px
- Amount: `mono-md`, tabular-nums, right-aligned, fixed 120px
  - Income: `--color-income`
  - Expense: `--text-primary` (neutral — NOT red)
- Row hover: background `--bg-overlay`, transition 100ms
- Selected row: background `--accent-subtle`, left border 2px `--accent`
- Striping: none — use hover to distinguish rows

### Status Badges

```
Usage: transaction category, invoice status, scope indicator
```

| Badge type | Background | Text | Border |
|-----------|-----------|------|--------|
| Income | `--color-income-bg` | `--color-income` | none |
| Overdue | `--color-overdue-bg` | `--color-overdue` | none |
| Pending | `--color-pending-bg` | `--color-pending` | none |
| Draft | `--bg-overlay` | `--text-secondary` | `--border-default` |
| Paid | `--color-income-bg` | `--color-income` | none |
| Business | `--accent-subtle` | `--accent` | none |
| Personal | `--bg-overlay` | `--text-secondary` | `--border-subtle` |
| AI | `--color-ai-bg` | `--color-ai` | none |

Specifications:
- Height: 20px
- Padding: 0 8px
- Border-radius: `--radius-full`
- Font: `label-lg` (12px, 500)
- Uppercase: NO — sentence case only

### Buttons

```css
/* Primary — main CTA, one per view */
.btn-primary {
  background: var(--accent);
  color: white;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  transition: background var(--transition-fast);
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:active { transform: translateY(1px); }

/* Secondary — supporting actions */
.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  /* same height/padding/radius */
}
.btn-secondary:hover { border-color: var(--border-strong); }

/* Ghost — low-priority, in-table actions */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  /* no border */
}
.btn-ghost:hover { color: var(--text-primary); background: var(--bg-overlay); }

/* Danger — destructive actions, always secondary-looking until hover */
.btn-danger {
  background: transparent;
  color: var(--color-overdue);
  border: 1px solid var(--color-overdue-bg);
}
.btn-danger:hover { background: var(--color-overdue-bg); }

/* Icon button — square, for toolbar actions */
.btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--radius-md);
  /* ghost by default, secondary on hover */
}
```

### Input Fields

```css
.input {
  height: 36px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  transition: border-color var(--transition-fast);
}
.input:hover { border-color: var(--border-strong); }
.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}
.input::placeholder { color: var(--text-tertiary); }
```

Textarea: same, with `min-height: 100px; resize: vertical; padding: 10px 12px`.

### Cards

Used only for summary tiles and standalone panels — not for list items.

```css
.card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
}
.card--interactive:hover {
  border-color: var(--border-default);
  box-shadow: var(--shadow-sm);
}
```

### Skeleton Loading

Replace all "Loading..." text with skeleton screens.

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--bg-overlay) 50%,
    var(--bg-elevated) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-md);
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Usage: */
.skeleton-text   { height: 14px; width: 120px; }
.skeleton-amount { height: 28px; width: 100px; }
.skeleton-row    { height: 44px; width: 100%; }
```

### Empty States

Every empty list/table has a dedicated empty state — never a blank area.

**Pattern:**
```
        [icon — 48px, tertiary color]
        
        Primary message (16px, 500)
        
        Supporting text (14px, secondary)
        
        [Primary CTA button]         [optional secondary link]
```

**Per-screen empty state messages:**

| Screen | Primary | Secondary | CTA |
|--------|---------|-----------|-----|
| Pulse — no transactions | "No transactions yet" | "Add your first transaction to see your balance and spending summary." | "Add transaction" |
| Pulse — no reminders | "No upcoming items" | "You're all caught up." | — |
| Radar — no results | "No transactions match" | "Try adjusting your filters or date range." | "Clear filters" |
| Accounts — no accounts | "No accounts detected" | "Accounts are created automatically from your transaction sources." | "Add transaction" |
| Invoices — no invoices | "No invoices yet" | "Track what you owe and what you're owed. Add your first invoice or upload via Telegram." | "New invoice" |

### Toast Notifications

Replace all `alert()` and silent failures with a toast system.

```
[top-right, stacks downward]
┌────────────────────────────────────────┐
│ ✓ Reminder snoozed for 3 days          │  ← success: green left border
│                                    [×] │
└────────────────────────────────────────┘
┌────────────────────────────────────────┐
│ ⚠ Could not reach server              │  ← error: rose left border
│ Check your connection and try again.   │
│                                    [×] │
└────────────────────────────────────────┘
```

Specifications:
- Width: 340px
- Background: `--bg-elevated`
- Border: `--border-default`
- Left border: 3px colored by type
- Border-radius: `--radius-md`
- Auto-dismiss: 4 seconds (success), 8 seconds (error), never (destructive confirmation)
- Animation: slide in from right, fade out

### AI CFO Panel

Right panel — desktop only (≥ 1280px).

```
┌──────────────────────────────────────┐
│ ✦ Helm CFO                  [·····]  │  ← header, violet accent, refresh spinner
├──────────────────────────────────────┤
│ Analysis                             │  ← section-label
│                                      │
│ You're running at 2.2× spend vs      │
│ income this month. Main driver:      │
│ operational costs (Rp 28M, 73%).     │
│                                      │
├──────────────────────────────────────┤
│ Recommended actions           3      │  ← section-label + count badge
│                                      │
│ ○ Review Helm Care expenses          │
│   Rp 28M in 14 transactions          │
│                                      │
│ ○ 2 invoices need attention          │
│   Overdue total: Rp 4.5M             │
│                                      │
├──────────────────────────────────────┤
│ Quick Stats                          │  ← section-label
│                                      │
│ Runway          14 days              │
│ Burn rate       Rp 1.3M/day          │
│ Net position    -Rp 20.9M            │
│ Receivables     +Rp 0                │
│ Payables        -Rp 0                │
│                                      │
├──────────────────────────────────────┤
│ Upcoming                             │  ← section-label
│ No upcoming debts                    │
└──────────────────────────────────────┘
```

---

## Motion / Animation

**Principles:**
- Motion is purposeful, not decorative
- Duration: 100ms for instant feedback, 200ms for transitions, 300ms for complex
- Easing: ease-out for elements entering, ease-in for elements leaving

**Defined animations:**
```css
/* Page transition */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: fadeSlideUp 200ms ease-out; }

/* Modal enter */
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

/* Toast enter */
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Skeleton shimmer — defined in component section above */
```

**What does NOT animate:**
- Data values (number changes are immediate — never count-up animations)
- Sidebar (always visible, no slide-in)
- Table rows (appear immediately on data load)

---

## Icon System

**Source:** Lucide React (already lightweight, consistent stroke width)  
**Size:** 16px for inline, 20px for navigation, 24px for empty states  
**Stroke width:** 1.5px (more refined than the default 2px)  
**Color:** Inherits from parent — never hardcoded

**Navigation icons:**

| Page | Icon name (Lucide) |
|------|-------------------|
| Pulse | `Activity` |
| Radar | `Search` or `ScanLine` |
| Accounts | `Wallet` |
| Invoices | `FileText` |
| Payroll | `Users` |
| Settings | `Settings` |
| Helm logo | custom SVG hexagon |

---

## Helm Brand Mark

The Helm Finance logo should be a minimal geometric mark — a hexagon (nautical helm reference) with clean lines.

**In sidebar header:**
```
⬡ HELM FINANCE
```
- Hexagon: 28px, `--accent` color
- "HELM" wordmark: 14px, weight 700, `--text-primary`, tracking 0.08em
- "FINANCE" wordmark: 14px, weight 400, `--text-secondary`, tracking 0.08em

**Favicon / PWA icon:**
- Solid hexagon on dark background

---

## Design Tokens Export Format

When implemented, tokens will live in `client/src/styles/tokens.css` and be imported once in `index.css`. Components use `var(--token-name)` exclusively — no hardcoded hex values in component files.

```
client/src/styles/
  tokens.css          ← all :root variables
  reset.css           ← box-sizing, body margin, font smoothing
  typography.css      ← type scale classes
  animations.css      ← keyframes
  components.css      ← base component classes (btn, badge, input, card, skeleton)
index.css             ← imports all of the above
```

---

## Accessibility Baseline

- All interactive elements have visible focus state (3px ring in `--accent`)
- Color is never the only signal — status has icon + color + label
- Minimum touch target: 44×44px (mobile), 36×36px (desktop)
- `prefers-reduced-motion` media query suppresses all animations
- `aria-label` on icon-only buttons
- Table uses proper `<thead>`, `<th scope="col">`, `<tbody>`

---

## What This System Does NOT Include in v1

- Light mode (planned for v2 — token architecture supports it)
- Custom chart library (recharts or tremor in v2)
- Mobile-specific gesture handling
- Drag and drop
- Rich text / markdown in descriptions
- Internationalization beyond Russian/English
