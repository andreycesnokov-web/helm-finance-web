# Brand Migration V1 — Checklist

> **Do not start until** the professional vector package and final colors are
> approved (see [BRAND_GUIDELINES_V1.md](BRAND_GUIDELINES_V1.md)). Execute on a
> dedicated `feature/brand-migration-v1` branch, never directly on `main`.
> Replace assets surface-by-surface; verify each before moving on.

| Field | Value |
|---|---|
| Status | Blocked — pending asset package + final color sign-off |
| Target domain | `cfo-ai.app` |
| Typeface | Manrope |

---

## Pre-requisites (gate)

- [ ] Final canonical SVGs delivered (symbol primary/accent/white/black, horizontal variants).
- [ ] One approved Brand Navy HEX, one Electric Blue HEX, one Dark Background HEX.
- [ ] favicon.svg / favicon.ico, app icons 1024/512/192, Telegram avatar 512×512, OG 1200×630.
- [ ] Manrope licensed/loaded for web, email, PDF.
- [ ] Safe area + minimum sizes confirmed against the vector.

## 0. Design tokens (do FIRST, once colors are final)
- [ ] Add `--brand-navy`, `--brand-electric`, `--brand-dark`, `--brand-white` to the app's CSS variables.
- [ ] Core-pulse animation: gated to AI-analysis state only; honor `prefers-reduced-motion`.
- [ ] Map existing theme variables to the new tokens (no hard-coded hex in components).

## 1. Web App
- [ ] Replace logo in the top bar / header.
- [ ] Sidebar (expanded) logo.
- [ ] Collapsed sidebar → **symbol only**.
- [ ] Loading / splash states.
- [ ] AI Active state uses the electric-blue core; everything else Corporate.

## 2. Login & onboarding
- [ ] Login screen logo + wordmark.
- [ ] Onboarding / first-run screens.
- [ ] Auth emails header (if any).

## 3. Favicon & PWA
- [ ] `favicon.svg` + `favicon.ico`.
- [ ] PWA `manifest.json` icons (192 / 512) + name `CFO AI`, `Financial OS` description.
- [ ] Apple touch icon.
- [ ] Theme color = final Brand Navy / Dark Background.

## 4. Browser metadata
- [ ] `<title>` / app name = CFO AI.
- [ ] `<meta name="theme-color">`.
- [ ] Description / app meta.

## 5. Telegram bot
- [ ] Bot avatar = `symbol-accent.svg` exported 512×512 (round-crop verified, padded).
- [ ] Bot name / description / about → CFO AI · Financial OS.
- [ ] Any in-message branding/emoji consistent.

## 6. Email
- [ ] Transactional/notification email header logo (PNG fallback for mail clients).
- [ ] Footer wordmark + descriptor.
- [ ] Manrope with safe web-font fallback stack.

## 7. PDF & reports
- [ ] Report/export header logo (vector or high-res).
- [ ] Use Corporate mode (navy core) — never the electric-blue AI variant in official docs.
- [ ] Manrope embedded or safe fallback.

## 8. Open Graph / social
- [ ] OG image 1200×630.
- [ ] `og:title` / `og:description` / `og:image` / Twitter card.

## 9. Public site
- [ ] Landing/marketing site logo + favicon + OG.
- [ ] Consistent palette and Manrope.

## 10. Domain `cfo-ai.app`
- [ ] DNS + TLS for `cfo-ai.app`.
- [ ] Redirects from any old domain.
- [ ] Update absolute URLs (emails, OG, PWA, deep links, Telegram WEB_APP_URL).

## 11. Documentation
- [ ] Update README / docs branding references.
- [ ] Add a short "brand assets" pointer in `docs/brand/`.

---

## Verification per surface
After each surface: visual check at real sizes, dark-mode check, round-crop check
(Telegram/PWA), `prefers-reduced-motion` check (no pulse), and confirm the
electric-blue core appears **only** in AI-active contexts.
