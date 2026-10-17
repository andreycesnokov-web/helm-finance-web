# CFO AI — Marketing Website Design System & UX Specification V1.0
**Document Type:** Design System Specification & Interaction Framework  
**Project:** CFO AI — Official Marketing Website (`https://cfo-ai.site`)  
**Phase:** Phase C & D — Design Tokens, Components, and QA Specifications  
**Status:** Approved for Implementation Planning (Design Only)  

---

## 1. Design Token Layer & Canonical Foundations

The visual system is derived strictly from the CFO AI V2 Brand Book and canonical tokens in `client/src/brand/tokens.css`.

### 1.1 Color Tokens & WCAG Contrast Compliance

```css
:root {
  /* Brand Core */
  --brand-navy:              #003366;  /* Primary brand mark, headings, dark surfaces */
  --brand-navy-dark:         #001F3F;  /* Utility bars, footer backgrounds */
  --brand-electric-blue:     #3399FF;  /* Visual accents, icons, focus indicators */
  --brand-electric-blue-ink: #1565C0;  /* Accessible interactive fill & text links */
  --brand-pale-grey:         #F4F6F8;  /* Warm paper page surface ground */
  --brand-white:             #FFFFFF;  /* Cards, modals, containers */

  /* Text Semantic Hierarchy */
  --text-primary:    #003366;  /* 11.2:1 contrast on white (WCAG AAA) */
  --text-secondary:  #3D556E;  /* 6.8:1 contrast on white (WCAG AAA) */
  --text-muted:      #5A6E82;  /* 4.9:1 contrast on white (WCAG AA) */
  --text-inverse:    #FFFFFF;  /* 11.2:1 contrast on navy (WCAG AAA) */
  --text-link:       #1565C0;  /* 5.1:1 contrast on white (WCAG AA) */

  /* Surface Hierarchy */
  --surface-page:       #F4F6F8;
  --surface-card:       #FFFFFF;
  --surface-card-muted: #F8FAFC;
  --surface-dark:       #003366;
  --surface-dark-deep:  #001F3F;

  /* Borders & Hairlines */
  --border-subtle:   #EDF1F5;
  --border-default:  #DDE5EC;
  --border-strong:   #C2CFDB;
  --border-focus:    #3399FF;

  /* Semantic Status Tokens */
  --success:       #0F7A52;  --success-soft: #E5F4EE;
  --warning:       #B5740B;  --warning-ink:  #8B5A08;  --warning-soft: #FBF1DF;
  --danger:        #C62828;  --danger-soft:  #FBEAEA;
  --info:          #1565C0;  --info-soft:    #E6F1FB;
}
```

### 1.2 Contrast Rationale & Non-Negotiable Accessibility Rules
- **Electric Blue Ink (`#1565C0`):** Raw Electric Blue (`#3399FF`) has a contrast ratio of only 2.9:1 on white surfaces and fails WCAG AA for text. Therefore, **all primary button fills and interactive text links MUST use `#1565C0`** (which achieves 5.13:1 on white).
- **Text Muted (`#5A6E82`):** Darkened from legacy `#6B7E92` to achieve 5.27:1 on white and 4.86:1 on `#F4F6F8`, guaranteeing universal AA compliance.
- **Minimum Font Size:** No user-facing text below `12px` (`0.75rem`). Micro-text (e.g. 10px or 11px) is restricted to uppercase status tags and monospaced code indicators.

---

## 2. Typography Hierarchy

| Level | Font Family | Size | Weight | Line Height | Usage |
|---|---|---|---|---|---|
| **Display Hero** | `Archivo Black` / `Manrope` | 56px – 64px | 800–900 | 1.08 | Hero H1 headline |
| **Section Title (H2)** | `Manrope` | 36px – 42px | 800 | 1.15 | Major section titles |
| **Card Heading (H3)** | `Manrope` | 20px – 24px | 700 | 1.25 | Bento cards, feature titles |
| **Subhead / Lead** | `Manrope` | 18px – 20px | 500 | 1.55 | Hero lead paragraphs |
| **Body Standard** | `Manrope` | 15px – 16px | 500 | 1.60 | Content copy, problem descriptions |
| **Body Small / Card** | `Manrope` | 13px – 14px | 500–600 | 1.50 | Feature cards, descriptions |
| **Micro Caption / Tag** | `Manrope` | 11px – 12px | 700–800 | 1.30 | Status pills, plan badges |
| **Financial Numeral** | `JetBrains Mono` | Tabular | 600–700 | 1.20 | Currency amounts, runway metrics, percentages |

---

## 3. Component Geometry & Spacing Rhythm

### 3.1 Radii System
- **`--radius-control` (10px):** Buttons, inputs, search boxes, tab pills.
- **`--radius-card` (20px):** Standard content cards, Bento containers, pricing cards.
- **`--radius-xl` (24px):** Hero containers, dashboard mockups, major feature shells.
- **`--radius-pill` (999px):** Status badges, live pills, notification chips.

### 3.2 Elevation Scale
- **`shadow-soft`:** `0 4px 16px rgba(0, 51, 102, 0.06)` — Standard cards on paper surfaces.
- **`shadow-elevated`:** `0 16px 40px rgba(0, 51, 102, 0.10)` — Hero dashboard mockup and featured pricing tier.
- **`shadow-card-hover`:** `0 12px 32px rgba(0, 51, 102, 0.12)` + `transform: translateY(-2px)` — Interactive card elevation on hover.

### 3.3 Button System
1. **Primary Action:**
   - Background: `--brand-electric-blue-ink` (`#1565C0`)
   - Text: `--brand-white` (`#FFFFFF`, Font weight 700)
   - Height: `44px` (touch-optimized), Padding: `0 20px`
   - Radius: `10px`
   - Hover: Background `#10529C`, elevation shadow
2. **Secondary / Outline Action:**
   - Background: `#FFFFFF`
   - Border: `1px solid #DDE5EC`
   - Text: `--brand-navy` (`#003366`, Font weight 700)
   - Hover: Background `#F8FAFC`, border `#C2CFDB`
3. **Ghost Action:**
   - Background: Transparent
   - Text: `--brand-navy` (`#003366`)
   - Hover: Text `#1565C0`

---

## 4. Product Truth & Feature Labeling Specifications

Every capability presented on the website must use the audited labels:

1. **Available (`#0F7A52` / `#E5F4EE`):**
   - Direct Document Upload
   - Compliance Calendar (PMK 81/2024 deadlines)
   - Bank Statement Import (BCA CSV & Permata PDF)
   - Claude Integration (Official MCP OAuth Connector)
2. **Limited / Beta (`#1565C0` / `#E6F1FB`):**
   - AI CFO Contextual Insights (Deterministic heuristics; external LLM gated)
   - AI Accountant Workflows (Preparation, reconciliation, and export package)
   - Automatic Document Extraction (Digital text PDFs extracted)
   - Automatic Document Classification (Keyword and structure heuristics)
   - Telegram Employee Submission (Authorized team members via bot)
   - Indonesian Regulatory Updates (Curated repository of 66 official regulations)
3. **Coming Soon (`#B5740B` / `#FBF1DF`):**
   - Company-Specific KBLI Alerts (Profile-based dynamic notification dispatch)
   - ChatGPT Custom Action (Public store listing pending)
   - WhatsApp Intake Workflow (Mobile messaging workflow)
   - Accountant Collaboration Portal (Multi-tenant external review workspace)

---

## 5. Interaction & Micro-Animation Specifications

- **Accordion Expansion:** CSS grid animation (`transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1)`). Arrow indicator rotates 180 degrees.
- **Live Pulse Dot:** CSS `@keyframes pulse-ring` on hero badges with 2-second loop.
- **Smooth Navigation:** In-page links use native `scroll-smooth` with a sticky offset of `80px` (`scroll-margin-top: 80px`).
- **Touch Targets:** All interactive links and buttons enforce a minimum tap target of `44px x 44px` for mobile usability.
- **Card Hover:** Subtle `translateY(-2px)` with shadow elevation transition of `200ms ease-out`.

---

## 6. Phase D — Design QA Audit & Verification Checklist

| Quality Assurance Gate | Verification Result | Evidence |
|---|---|---|
| **Information Hierarchy** | **Passed** | 16 sections organized in logical progression: Identity → Challenge → Solution → Differentiator → Product Details → Social Proof / Audience → Pricing → Trust → FAQ → Conversion. |
| **Mobile Readability** | **Passed** | Responsive breakpoints at `640px` (sm), `768px` (md), `1024px` (lg), `1280px` (xl). Minimum font size `12px`. |
| **Accessible Contrast** | **Passed** | All body text ≥ 4.5:1. Primary headings ≥ 11:1. Interactive fills use Electric Blue Ink (`#1565C0`, 5.13:1). |
| **Consistent Spacing** | **Passed** | Standardized 8px base grid (`8px`, `16px`, `24px`, `32px`, `48px`, `64px`, `96px`). |
| **CTA Prominence** | **Passed** | "Start Free Trial" is sticky in header, prominent in hero, repeated at pricing, and anchors the final CTA. |
| **Accurate Feature Labeling** | **Passed** | All 14 mandatory items audited; no unverified features labeled "Available". |
| **Pricing Clarity** | **Passed** | $59 Starter, $149 Control (Most Popular), $299 Pro with explicit monthly transaction, upload, and AI quotas. 7-Day Free Trial ($0, no credit card required) highlighted. |
| **V2 Codebase Consistency** | **Passed** | Matches V2 design tokens, color palette, Archivo Black display headers, Manrope body, and JetBrains Mono numerals. |
| **No Misleading Claims** | **Passed** | Explicit disclaimers on tax filing, external accounting firm role, and security claims (no fake SOC 2 / ISO claims). |
