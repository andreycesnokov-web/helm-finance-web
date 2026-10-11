# CFO AI — Brand Guidelines V1

> **STATUS: Pending professional vectorization and final color approval.**
> This document records the *approved brand system and usage rules*. It is NOT
> yet an implementation source. Do **not** embed the Gemini PNG, do **not**
> autotrace approximate SVGs, and do **not** replace the current brand in the
> app until the professional vector package (below) is delivered.

| Field | Value |
|---|---|
| Document type | Brand Guidelines (foundation) |
| Brand | CFO AI |
| Version | 1.0 (draft — pending vector + color sign-off) |
| Typeface | Manrope |
| Date | 2026-06-15 |

---

## 1. Final sources of truth (to be produced)

These — not this document and not any raster image — become authoritative once
delivered:

- the canonical **SVG** symbol/logo files (hand-built on a grid);
- **one** approved **Brand Navy** HEX;
- **one** approved **AI Electric Blue** HEX;
- **one** approved **Dark Background** HEX;
- **Manrope** as the typeface;
- approved **safe area** and **minimum sizes**.

Until those exist, every value here is provisional.

---

## 2. Approved brand system

| Mode | Symbol | Core | Use |
|---|---|---|---|
| **Corporate** | dark navy | dark navy core | default; documents, reports, web |
| **AI Active** | dark navy | electric blue core | AI activity, app icon, Telegram bot |
| **Dark mode** | white | electric blue core | dark backgrounds |

- **Wordmark:** `CFO AI`
- **Descriptor:** `Financial OS` (never altered)
- **Typeface:** Manrope (geometric sans-serif)

### Core pulse — NOT part of the static logo
The pulsing core is a **UI state animation**, shown **only while the AI is
analysing data**. The normal logo is always static. The animation must respect
`prefers-reduced-motion` (no motion when the user opts out). The electric-blue
core must **not** be used as the default/Corporate mark in official documents.

### Telegram
Use the **symbol only** (`symbol-accent.svg`), never the full horizontal logo
with the wordmark — text is unreadable in a small round avatar. Requires
adequate padding from the edges and a verified round-crop.

---

## 3. Colors — PRELIMINARY (not final)

These are working references pending hand-drawing and sign-off. The brand book
image and the spec text disagree; the values below are the current preliminary
picks and must be confirmed against the real SVG before any implementation.

| Token | Preliminary value | Notes |
|---|---|---|
| Brand Navy | `#0A192F` *(preliminary)* | Owner's preliminary pick; deep near-black navy. Image showed `#003366` — superseded pending sign-off. |
| AI Electric Blue | `#3399FF` *(preliminary, TBD)* | From the brand book image; not yet approved. |
| Dark Background | *TBD* | One value to be approved (image showed a dark navy panel). |
| White | `#FFFFFF` | Fixed. |

No CSS design tokens are created yet — these values are intentionally **not**
wired into the app to avoid shipping a temporary palette.

---

## 4. Usage rules — DO

- Keep the exact geometry, angles, line weights and optical center of the
  hand-built vector.
- Maintain the safe area: clear space = 2× the internal gap of the symbol (to be
  finalized with the vector).
- Minimum size: 16 px for the symbol (per the brand book); confirm with vector.
- Use the mode appropriate to context (Corporate by default).

## 5. Usage rules — DO NOT

- Do **not** stretch or distort the symbol.
- Do **not** change the relative position of the elements.
- Do **not** use arbitrary/random colors.
- Do **not** add shadows or 3D effects.
- Do **not** place the mark on a noisy/busy background.
- Do **not** use the electric-blue core as the default version in official
  documents.
- Do **not** alter the `Financial OS` descriptor.

---

## 6. Required asset package (designer deliverable)

Before any Brand Migration work begins, obtain the full professional package:

```
Master Figma file
symbol-primary.svg      symbol-accent.svg
symbol-white.svg        symbol-black.svg
logo-horizontal-primary.svg
logo-horizontal-accent.svg
logo-horizontal-white.svg
favicon.svg             favicon.ico
app icons 1024 / 512 / 192
Telegram avatar 512×512
Open Graph logo 1200×630
```

The symbol must be **rebuilt by hand on a grid** in Figma/Illustrator — never an
automatic trace of the PNG.

---

## 7. Next step

Do not implement from this document. Once the asset package + final colors are
approved, execute **Brand Migration V1** on a dedicated feature branch — see
[BRAND_MIGRATION_V1_CHECKLIST.md](BRAND_MIGRATION_V1_CHECKLIST.md).
