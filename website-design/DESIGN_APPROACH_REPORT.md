# CFO AI — Marketing Website Design Approach Report & Product Truth Audit
**Document Version:** 1.0  
**Phase:** Phase A — Design Strategy, Tools Audit & Product Truth Matrix  
**Status:** Complete / Ready for Review  
**Author:** Senior Product Designer & B2B SaaS UX Strategist (AntiGravity)

---

## 1. Executive Summary & Context

CFO AI is an intelligent financial operating system built specifically for companies operating in Indonesia (PT PMA, local PTs, growing SMEs, and enterprise finance teams). It bridges four core pillars:
1. **AI Chief Financial Officer** — Financial health visibility, runway forecasting, and contextual intelligence.
2. **AI Accounting Assistant** — Streamlined document workflows, reconciliation, and accounting preparation for professional review.
3. **Indonesian Regulatory Intelligence** — Tax, KBLI, and compliance deadline monitoring (PMK 81/2024, OSS, UU HPP).
4. **Document Intelligence & Channel Workflows** — Frictionless multi-channel intake (Direct Upload, Telegram, Claude MCP, ChatGPT, and planned WhatsApp).

As mandated by the Master Design Brief, this current phase is **DESIGN ONLY — NO DEVELOPMENT**. Existing application code, backend schemas, auth, and production environments remain strictly isolated and read-only.

---

## 2. Design Tools & Skills Audit

A strict capability inspection was conducted within the AntiGravity execution environment.

| Tool / Skill / Resource | Status | Verification Result | Practical Application |
|---|---|---|---|
| **Generative UI (`generative_ui`)** | **Available & Verified** | Native skill verified. Allows self-contained interactive HTML/Tailwind CSS artifacts with responsive viewport rendering. | **Primary UI Deliverable Engine:** Used to build high-fidelity interactive desktop & mobile concept prototypes. |
| **Asset Generation (`generate_image`)** | **Available & Verified** | Native image generation engine accessible. | **Visual Asset Creation:** Used for photorealistic conceptual hero visuals and marketing accents. |
| **V2 Design System (Read-Only)** | **Available & Verified** | Read-only inspection of `client/src/brand/tokens.css`, `client/src/v2/v2.css`, and `client/src/v2/ui.jsx`. | **Design Consistency:** Direct extraction of brand colors, typography, spacing, and component geometry. |
| **Google Stitch MCP (`stitch`)** | **Unavailable (Unauthorized)** | Schema present in `mcp/stitch`, but execution returns `HTTP 401 Unauthorized` (no active account/token). | **Bypassed:** Replaced with high-fidelity standalone Generative UI HTML/CSS prototypes. |
| **Figma / External Cloud UI** | **Unavailable** | No Figma MCP server or API plugin configured. | **Bypassed:** All layouts authored natively in clean, inspectable web code and visual prototypes. |
| **Blender MCP (`blender-mcp`)** | **Available (Not Applicable)** | 3D Python Blender engine installed. | Not applicable for 2D SaaS fintech web interfaces. |

### Recommended Design Workflow
1. **Design System Grounding:** Use canonical CFO AI V2 tokens (`--brand-navy: #003366`, `--brand-electric-blue: #3399FF`, `--brand-electric-blue-ink: #1565C0`, `--surface-page: #F4F6F8`, etc.).
2. **Concept Exploration:** Deliver two distinct, fully realized interactive visual prototypes (Concept A: *Premium Financial Intelligence*; Concept B: *Modern AI Operating System*) accessible via interactive previews.
3. **Product Truth Alignment:** Strict adherence to verified product capability labels (**Available**, **Limited / Beta**, **Coming Soon**).
4. **Owner Milestone Decision:** Present both directions side-by-side with architectural rationale, allowing the owner to choose before Phase C (full responsive layouts & component specifications).

---

## 3. Required Product Truth Audit Matrix

Per Section 16 of the Master Design Brief, every capability has been verified against the codebase (`integration/pilot-rc1-main` @ `cc3af8b` and Obsidian knowledge base) to prevent misleading claims.

| Feature / Capability | Codebase Implementation Status | Evidence in Codebase | Current Release Availability | Website Label |
|---|---|---|---|---|
| **Direct Document Upload** | **Implemented** | `server/lib/documentIntake.js`, `server/lib/uploadIntent.js`, `client/src/v2/pages/Documents.jsx`, SHA-256 deduplication and append-only audit. | **Yes** (Production & V2) | **Available** |
| **Compliance Calendar** | **Implemented** | `client/src/v2/pages/Accountant.jsx`, `tests/taxDeadlines.test.js`, PR #153 live. Tracks PPh 21, 23, Final, PPN, SPT Tahunan per PMK 81/2024. | **Yes** (Live in V2) | **Available** |
| **Bank Statement Import** | **Implemented (Partial)** | `server/lib/statementParsers.js`, `client/src/v2/pages/BankImport.jsx`, atomic RPC `rpc_confirm_bank_import`. BCA CSV & Permata PDF supported. | **Yes** (BCA CSV & Permata PDF) | **Available** (BCA CSV & Permata PDF; others expanding) |
| **Claude Integration** | **Implemented** | `server/mcp/index.js`, `server/mcp/oauth/provider.js`, `tests/integration/mcpOAuth.test.js`. 8 MCP tools with OAuth connector for claude.ai. | **Yes** (Live via MCP OAuth) | **Available** (Official Claude Connector via MCP) |
| **AI CFO Contextual Assistance** | **Partial (Deterministic + Rules)** | `client/src/v2/pages/AICFO.jsx`, `server/lib/financialInsights.js`. Runway, burn, and health scores work deterministically. External LLM egress is closed for pilot (`D-EGRESS`). | **Partial** (Rule-based heuristics active; generative LLM gated) | **Limited / Beta** (Intelligent financial insights & runway analysis) |
| **AI Accountant Workflows** | **Partial (Preparation Only)** | `client/src/v2/pages/Accountant.jsx`, `server/lib/aiAccountantCore.js`, `server/lib/taxGate.js`. Readiness checklist & transaction linking live. Lock & filing confirmation Missing. | **Partial** (Preparation & review live; official filing not included) | **Limited / Beta** (Accounting preparation & reconciliation assistance) |
| **Automatic Document Extraction** | **Partial (Text-layer PDFs)** | `server/lib/documentExtraction.js`, `server/lib/documentOcr.js`. Digital PDFs extract automatically; vision OCR flag is default OFF in pilot (`needs_review`). | **Partial** (Digital PDFs extract; image scans require review) | **Limited / Beta** (AI extraction for digital invoices & receipts) |
| **Automatic Document Classification** | **Partial (Heuristic Identification)** | `server/lib/documentIdentify.js`. Keyword, header, and structure rules classify invoices, receipts, and statements; unknown files flag `needs_review`. | **Partial** (Rule-based classification active) | **Limited / Beta** (Intelligent document categorization) |
| **Telegram Employee Submission** | **Implemented (Legacy / Add-on)** | `helm-finance-bot/`, `server/lib/telegramWorkspace.js`. Bot receives payables in IDR. Outside immediate pilot scope; planned as paid add-on. | **Partial** (Legacy live; pilot focus is web-first) | **Limited / Beta** (Authorized employee Telegram document submission) |
| **Indonesian Regulatory Updates** | **Partial (Curated Repository)** | `knowledge/indonesia_tax_kb/` & `indonesia_official_kb/` (66 official sources: PMK 81/2024, UU HPP, OSS). Rules in `draft`/`under_review`. | **Partial** (Curated legal articles & deadlines active) | **Limited / Beta** (Curated Indonesian tax & regulatory intelligence) |
| **Company-Specific KBLI Alerts** | **Planned / Under Development** | Company profile captures KBLI (`Company Setup & Profile`), but automated notification dispatch for KBLI revisions is not connected. | **No** | **Coming Soon** (Dynamic company-profile KBLI monitoring) |
| **ChatGPT Integration** | **Planned / In Architecture** | `server/mcp/auth.js` and `client/src/pages/OAuthConsent.jsx` reference AI client protocols, but official ChatGPT Store Action is unlisted. | **No** (MCP backend exists; public Action pending) | **Coming Soon** (Authorized ChatGPT Integration) |
| **WhatsApp Document Collection** | **Not Started** | Zero references in code; planned roadmap feature. | **No** | **Coming Soon** (WhatsApp messaging workflow) |
| **Accountant Review Workspace** | **In-Browser Export Live; Workspace Planned** | `Accountant.jsx` line 29: "Send to accountant" button marked "currently unavailable". In-browser ZIP + PDF summary export works. | **No** (Direct export available; external portal pending) | **Coming Soon** (Dedicated Accountant Collaboration Portal) |

---

## 4. Visual Identity & Design Token System

Extracted directly from canonical `client/src/brand/tokens.css` (Brand Book approved):

### Color Palette
- **Brand Navy (`--brand-navy: #003366`):** The institutional anchor. Used for high-contrast primary typography, dark navigation accents, and structural containers.
- **Electric Blue (`--brand-electric-blue: #3399FF`):** The technological accent. Used for decorative highlights, data visualizations, and active states.
- **Electric Blue Ink (`--brand-electric-blue-ink: #1565C0`):** The accessible action color. Meets WCAG AA contrast (5.13:1 on white) for primary buttons and text links.
- **Pale Grey (`--surface-page: #F4F6F8`):** The warm paper background ground. Eliminates harsh digital glare and provides soft contrast.
- **Pure White (`--surface-card: #FFFFFF`):** Crisp surface for content cards and elevation.
- **Status Accents:**
  - Success: `#0F7A52` (Soft: `#E5F4EE`)
  - Warning: `#B5740B` (Ink: `#8B5A08`, Soft: `#FBF1DF`)
  - Danger: `#C62828` (Soft: `#FBEAEA`)

### Typography Hierarchy
- **Display Headings:** `Archivo Black` / `Manrope ExtraBold` (Geometric, commanding, authoritative).
- **Body & Controls:** `Manrope` (Clean, modern humanist sans-serif with excellent legibility).
- **Financial Figures & Metrics:** `JetBrains Mono` with `tabular-nums lining-nums` (Ensures financial data aligns crisply without visual shifting).

### Elevation & Geometry
- **Control Radius:** `10px` (`--radius-control`)
- **Card Radius:** `20px` (`--radius-card`)
- **Container Radius:** `24px` (`--radius-xl`)
- **Elevation:** Soft fintech shadows (`0 4px 12px rgba(0, 51, 102, 0.08)`).

---

## 5. Website Information Architecture

```
[ HEADER ]
  ├── Brand Logo (CFO AI Navy & Electric Blue Mark)
  ├── Navigation: Platform | AI CFO | AI Accountant | Document Intelligence | Compliance | Pricing | FAQ
  └── Actions: Log In (Ghost) | Start Free Trial (Electric Blue Primary)

[ HERO ]
  ├── Eyebrow: THE INTELLIGENT FINANCIAL OPERATING SYSTEM
  ├── Headline: Your AI CFO. Your Business Under Control.
  ├── Subheadline: Clear financial visibility, document workflows, accounting prep, and regulatory awareness.
  ├── CTAs: Start Your 7-Day Free Trial (Primary) | Explore the Platform (Secondary)
  ├── Supporting Badge: Built for businesses operating in Indonesia (PT PMA & PT).
  └── Interactive Dashboard Showcase: Real Pulse metrics, Runway chart, BCA/Permata imports, PMK 81/2024 alert.

[ SECTION 02: THE CHALLENGE ]
  ├── 4 Problem Cards: Scattered Financial Information | Endless Document Collection | Limited Visibility | Changing Regulations

[ SECTION 03: THE SOLUTION ]
  ├── 4 Strategic Pillars: AI CFO | AI Accountant | Document Intelligence | Regulatory Intelligence

[ SECTION 04: DOCUMENT INTELLIGENCE ]
  ├── Pipeline Visual: Direct Upload / Telegram / Claude / ChatGPT → CFO AI Inbox → AI Extraction → Human Review → Financial Records
  └── Channel Cards with Verified Status Badges (Available / Beta / Coming Soon)

[ SECTION 05: EMPLOYEE COLLABORATION ]
  └── Workflow: Employee receives invoice → Submits via authorized channel → Review queue → Accountant verification

[ SECTION 06: AI CFO ]
  └── Financial Health, Cash Flow, Multi-Account Tracking, Receivables & Payables, Financial Radar

[ SECTION 07: AI ACCOUNTANT ]
  └── Preparation vs. Filing boundary: AI organizes & checks; professionals sign & submit

[ SECTION 08: INDONESIAN REGULATORY INTELLIGENCE ]
  └── Real-time Compliance Cards: PMK 81/2024, KBLI Monitoring, OSS Deadlines, AI Summaries + Official References

[ SECTION 09: CONNECTED MODULES ]
  └── Bento Grid: Pulse, Radar, Transactions, Accounts, Invoices, Documents, AI Accountant, Company Setup

[ SECTION 10: HOW IT WORKS ]
  └── 5-Step Linear Onboarding (Register → Setup Company → Bring Data → Explore Insights → Stay Organized)

[ SECTION 11: TARGET AUDIENCE ]
  └── Tailored for: PT PMA | Indonesian PTs | Founders & Owners | Finance Teams | Accountants

[ SECTION 12: PRICING & FREE TRIAL ]
  ├── Free Trial: 7 Days / 168 Hours, $0, No Credit Card Required
  ├── Starter: $59/mo (Essential Financial Visibility)
  ├── Control: $149/mo (Most Popular — Financial Intelligence & Compliance Awareness)
  └── Pro: $299/mo (Advanced Finance Operations & Multi-User Collaboration)

[ SECTION 13: TRUST & SECURITY ]
  └── Company Data Isolation, Role-Based Access, Audit Trails, Backup & Recovery

[ SECTION 14: HUMAN EXPERTISE ]
  └── AI handles the preparation; qualified accountants & tax consultants provide regulated judgment

[ SECTION 15: FAQ ]
  └── 12 Authoritative Accordion Items clarifying scope, trial, integrations, and legal boundaries

[ SECTION 16: FINAL CTA & FOOTER ]
  └── High-conversion closing banner + 4-column structured footer with official copyright & legal links
```

---

## 6. Two Distinct Design Concepts for Selection

### Concept A: Premium Financial Intelligence
* **Design Philosophy:** Minimalist, institutional, authoritative fintech.
* **Atmosphere:** Evokes the timeless trust of a top-tier private bank combined with contemporary Swiss typographic discipline.
* **Key Visual Elements:**
  - High-contrast deep Navy (`#003366`) headers and crisp off-white (`#F4F6F8`) canvas.
  - Generous whitespace, refined 1px borders (`#DDE5EC`), and hairline separators.
  - Deep data presentation: live tabular figures in JetBrains Mono, structured balance metrics, and subtle executive status tags.
  - Restrained use of color: Electric Blue is reserved strictly for interactive focus, while soft emerald (`#0F7A52`) and amber (`#B5740B`) highlight compliance health.
* **Best Suited For:** Enterprise PT PMA boards, serious founders, and CFOs who value clarity, data density, and quiet confidence over flashy animations.

### Concept B: Modern AI Operating System
* **Design Philosophy:** Dynamic, product-focused, workflow-first B2B SaaS.
* **Atmosphere:** Modern, highly communicative, modular, and fast-paced.
* **Key Visual Elements:**
  - Interactive multi-channel document ingestion pipeline with active connecting nodes.
  - Bento-grid modular layout with glowing electric blue subtle gradients and soft navy glass accents.
  - Prominent "Smart Badge" indicators displaying live system state (e.g., "⚡ AI Classification Active", "✓ BCA Import Ready", "📋 PMK 81/2024 Verified").
  - Animated workflow preview tabs letting prospects test-drive features directly on the homepage.
* **Best Suited For:** Modern founders, cross-functional startup teams, and tech-forward business operators who want to immediately see how their team will interact with the system every day.

---

## 7. Next Steps & Owner Action

Both interactive concepts are authored and ready for visual preview in the accompanying artifacts:
1. `concept-a-preview.html` — Concept A: Premium Financial Intelligence
2. `concept-b-preview.html` — Concept B: Modern AI Operating System
3. `concept-comparison-showcase.html` — Side-by-side interactive comparator with live viewport switcher (Desktop / Tablet / Mobile).

**Owner Decision Requested:** Select Concept A or Concept B to proceed into Phase C (full responsive layout production, design token package, and interaction specifications).
