# Personal Finance & Funding Frontend V1 — Phase 0 Audit

Branch: `feature/personal-funding-frontend-v1` (cut from `feature/personal-investor-funding-v1`,
which carries the validated backend; that backend PR is **not yet merged to `develop`**).

> **GATE:** §3/§11 of the master task require the official logo assets + Brand Book before
> the Personal Overview Demo can be built. They are **absent** (see §C-blocker). Implementation
> is paused at the design-approval checkpoint; this document is the Phase-0 deliverable.

---

## 10.1 Frontend architecture audit

### Reuse map
| Area | File | Verdict |
|------|------|---------|
| Wallet detail (already decimal-safe) | `client/src/pages/WalletDetail.jsx` | **Reuse** — already migrated to `lib/money.js`. |
| Accounts engine | `client/src/pages/Accounts.jsx` | **Reuse, make workspace-aware.** |
| Money utility | `client/src/lib/money.js` | **Reuse** — string/BigInt, asset precision. |
| Card / tab / modal / empty-state CSS | `client/src/index.css` (`.hf-*`), `hf-system.css` | **Reuse** the primitives; re-token colors. |
| Modal pattern | `DebtFormModal.jsx`, `DebtPaymentModal.jsx` (createPortal) | **Reuse** pattern for funding/transfer wizards. |
| i18n | `client/src/i18n/`, `useTranslation`, inline `RU_TEXT_MAP` in App.jsx | **Reuse**; move new strings into i18n files (EN/RU/ID). |
| Access gating | `client/src/hooks/useAccess.js`, `LockedFeature.jsx` | **Reuse** for entitlement screens. |

### Answers to the 12 audit questions
1. **Reusable pages/components:** WalletDetail, Accounts, money.js, the `.hf-*` card/tab/modal/empty primitives, LockedFeature, DocumentsPanel, the modal-via-portal pattern.
2. **Single-business assumption:** `client/src/lib/api.js` resolves one `activeBusinessId` from `localStorage` and stamps `x-business-id` on every call; `useAccess.js` sets it from `/access/status`. There is **no workspace-type concept** (personal vs business) anywhere.
3. **`x-business-id` origin:** `getActiveBusinessId()` → `localStorage.getItem('activeBusinessId')` (`api.js:5`). Set in `useAccess.js:36`. This must become a workspace-aware value driven by the new Workspace Switcher (+ `/api/workspaces`, `last_active_workspace_id`).
4. **Routes that must become workspace-aware:** `/` (Pulse), `/accounts`, `/transactions`, `/cfo`, `/documents`, and the new `/personal/*` + `/funding-investors` routes. The sidebar/bottom-nav must switch sets by active workspace **type**.
5. **Finance pages that can serve both modes:** Accounts, Transactions, Wallet Detail, Documents, Pulse, AI CFO — with a `workspaceType` prop/context and a money/asset-aware display layer.
6. **Personal-only components needed:** Personal Overview, Personal Connections, Fund-a-Business wizard, Personal Funding list, Wallet-Transfer wizard, Workspace Switcher, Create-Personal-Workspace onboarding, "Private" badge.
7. **Role/access gates today:** `useAccess` (plan/trial/override) + role helpers server-side; `LockedFeature` renders upsell. No entitlement concept for `personal_finance_workspace` / `personal_investor_funding` on the client yet.
8. **Shared card/tab/modal components:** CSS-class based (`.hf-card`, `.hf-tab`, etc.) rather than React components; modals are ad-hoc via `createPortal`. Recommend extracting thin React wrappers during this module to avoid further duplication.
9. **Unsafe money math:** `lib/api.js` `fmt()`/`fmtFull()` use `Number(n)` + `toFixed()` for **display abbreviation** (acceptable for K/M/B summary, but NOT for exact crypto). All new money rendering must use `lib/money.js` `formatAmount(value, asset)`; `fmt()` must never be used for crypto quantities or exact ledger values.
10. **Personal-data leak surfaces:** the Workspace Switcher list, breadcrumbs/page titles, search, cached query state after a switch, and `localStorage activeBusinessId`. Switching workspaces must **clear** prior workspace-scoped state and never render another user's personal names to an unauthorized viewer.
11. **Pages conflicting with the Brand Book:** all of them — current palette is `--brand:#2563EB` / `--brand-navy:#0F172A`, not the Brand Book `#3399FF`/`#003366`; the UI font is `-apple-system/Inter`, not Manrope.
12. **Legacy CFO classes:** keep the `.hf-*` structural primitives (cards/tabs/grids), **re-token** their colors to the canonical layer, and retire the parallel `--brand` (generic blue) tokens.

---

## 10.2 Brand implementation audit

### A. Logo matrix — **BLOCKED (assets absent)**
No approved logo files (`symbol_*`, `logo_main_*`, `app_icon_white_rounded_1024.png`) and no
`CFO_AI_Brand_Book_3.pdf` exist in the workspace. The only images are placeholder
`client/public/icon-192.png` / `icon-512.png` ("fallback until we have real icons", `index.html`).
Per §3 + §6.7, the logo must **not** be redrawn, generated, traced, or emoji-substituted.

### B. Palette — conflict requiring sign-off
| Source | Navy | Electric Blue |
|--------|------|---------------|
| Master task (this doc's target) | `#003366` | `#3399FF` |
| `docs/brand/BRAND_GUIDELINES_V1.md` | `#0A192F` *(preliminary; says `#003366` "superseded pending sign-off")* | `#3399FF` *(preliminary)* |
| Current app (`index.css`) | `#0F172A` | `#2563EB` |
**Three different navies are in play.** The master task says `#003366` is exact; the in-repo brand
doc says `#003366` was superseded by `#0A192F`. This needs an explicit owner decision before tokens ship.

### C. Typography map — not yet loaded
Required: **Archivo Black** (hero), **Manrope** (UI), **JetBrains Mono** (codes/rates). Current app uses
`-apple-system/Inter`. No `@font-face`/webfont loading for the brand fonts exists. Need the approved
webfont package or explicit approval to load from a licensed web source (e.g. Google Fonts — all three are available there under OFL).

### D. UI gap analysis
- Obsolete generic-blue primary (`#2563EB`) instead of Electric Blue `#3399FF`.
- Navy mismatch (`#0F172A` vs `#003366`).
- No brand fonts (Manrope/Archivo/JetBrains Mono).
- No official logo; placeholder favicon.
- Token names differ from the master spec (`--surface-main` vs `--surface-page`, `--text-main` vs `--text-primary`, etc.).
- `fmt()` uses float `Number()` for display abbreviation.

### E. Proposed token migration (old → canonical §7)
| Old | Canonical |
|-----|-----------|
| `--brand` `#2563EB` | `--brand-electric-blue` `#3399FF` |
| `--brand-navy` `#0F172A` | `--brand-navy` `#003366` *(pending sign-off)* |
| `--surface-main` `#F8FAFC` | `--surface-page` (≈ `--brand-pale-grey` `#F4F6F8`) |
| `--surface-muted` | `--surface-card-muted` |
| `--text-main` `#0F172A` | `--text-primary` |
| `--text-muted` `#64748B` | `--text-secondary` / `--text-muted` |
| `--border-soft` `#E2E8F0` | `--border-default` |
| `--success/--warning/--danger` | keep, add `*-soft` + `--info`/`--info-soft` |
| `--radius/--radius-lg/...` | `--radius-md/--radius-lg/...` (rename) |
| `--shadow-sm/md/lg` | keep |
| (none) | `--font-display` Archivo Black, `--font-ui` Manrope, `--font-mono` JetBrains Mono |

### F. Accessibility risks
- `#3399FF` on white is ~2.6:1 — **fails** WCAG AA for normal text; usable for large UI/borders/icons but for text/links an accessible darker shade is required (§31 permits an accessible UI shade while preserving identity).
- Navy `#003366` on white ≈ 12:1 — passes.
- Verify focus rings, disabled contrast, ≥44px touch targets, reduced-motion for the "AI pulse", and status-not-by-color-alone.

---

## Blockers (STOP per §3/§10)
1. **Logo assets + `CFO_AI_Brand_Book_3.pdf` absent.** Required by the Personal Overview Demo (§11) and forbidden to substitute.
2. **Navy color conflict** (`#003366` vs `#0A192F`) — needs owner sign-off.
3. **Brand webfonts** (Manrope / Archivo Black / JetBrains Mono) not present — need the package or approval to load from a licensed web source.
4. **Backend PR not merged to `develop`** — frontend currently branches off the backend feature branch.

Implementation is paused here pending these inputs, as the task mandates.
