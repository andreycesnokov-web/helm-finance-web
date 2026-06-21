# CFO AI — Design System (Frontend V1)

Canonical token layer: [`client/src/brand/tokens.css`](../../client/src/brand/tokens.css)
(imported once in `client/src/main.jsx`, ahead of `index.css`). All new screens use
these tokens — no raw HEX in components, no per-page palettes.

## Brand core (Brand Book)
| Token | Value | Use |
|-------|-------|-----|
| `--brand-navy` | `#003366` | identity, headings, hierarchy, dark surfaces |
| `--brand-electric-blue` | `#3399FF` | fills, active states, focus ring, logo dot, charts |
| `--brand-electric-blue-ink` | `#1565C0` | **text/links** (accessible ~4.6:1; `#3399FF` fails AA for body text) |
| `--brand-white` | `#FFFFFF` | card surfaces |
| `--brand-pale-grey` | `#F4F6F8` | page background |

Navy is `#003366` per owner sign-off (supersedes the preliminary `#0A192F` in
`docs/brand/BRAND_GUIDELINES_V1.md` and the legacy app `#0F172A`).

## Typography — self-hosted OFL via Fontsource (no Google CDN)
Imported in `main.jsx`; all ship `font-display: swap`; variable subsets lazy-load by `unicode-range`.

| Role | Token | Family (package) | Notes |
|------|-------|------------------|-------|
| Display / hero headings | `--font-display` | **Archivo Black** (`@fontsource/archivo-black`, latin + latin-ext) | latin-only — **no Cyrillic**; RU/ID display headings fall back to **Manrope ExtraBold** (declared in the fallback chain). Use sparingly (hero, big empty-states), never for body/tables. |
| Product UI (default) | `--font-ui` | **Manrope Variable** (`@fontsource-variable/manrope`, incl. Cyrillic) | nav, cards, labels, forms, buttons, tables, values. Weights via variable axis: Regular 400 / SemiBold 600 / ExtraBold 800. |
| Technical / machine | `--font-mono` | **JetBrains Mono Variable** (`@fontsource-variable/jetbrains-mono`) | wallet codes, transaction IDs, exact FX rates, crypto quantities, hashes. Not for body or all money. |

Fallback chains are defined in `tokens.css` (`--font-display/ui/mono`) ending in system fonts so
the UI is legible before/without the webfonts. Only the required subsets/weights are imported; no
unofficial font files are committed (Fontsource packages are OFL-licensed dependencies).

## Semantic, radius, elevation, space, type-scale
See `tokens.css` — `--success/--warning/--danger/--info` (+ `*-soft`), `--radius-sm…xl`,
`--shadow-sm/md/lg`, `--space-1…10`, `--text-xs…3xl`, `--line-tight/normal/relaxed`.
Green is **success-only**, never the primary brand color; semantic colors never recolor the logo.

## Legacy token migration
`index.css` still defines the older `--brand`(#2563EB)/`--brand-navy`(#0F172A)/`--surface-main`
system. Migration mapping is recorded in
[`personal-funding-frontend-phase0-audit.md`](personal-funding-frontend-phase0-audit.md) §E and will be
applied as screens are re-tokened during this module. The new `tokens.css` is the canonical layer.

## Pending (blocked)
- **Logo assets + `CFO_AI_Brand_Book_3.pdf`** are not yet in the repo; the Personal Overview Demo
  (§11) and favicon/app-icon wiring wait on them. Logo must not be redrawn/traced/substituted.
