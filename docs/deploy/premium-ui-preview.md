# Premium UI Preview — Railway deployment guide

A **separate, temporary** preview service for the branch `feature/personal-funding-frontend-v1`.
It serves the gated, synthetic-only `/demo/personal-overview` showcase. It must NOT be the
production service and must NOT use production secrets, database, or migrations.

> No repo-level `railway.json` is committed on purpose — that could change the production
> service's build. Configure the preview **per-service** in the Railway dashboard so production
> is never touched.

## 1. Create the preview service
Railway → your project → **New** → **GitHub Repo** → same repo → **New Empty Service**
(do NOT attach to the existing production service).

- **Service name:** `helm-finance-premium-ui-preview`
- **Branch:** `feature/personal-funding-frontend-v1` (enable auto-deploy on push if desired)
- If you use Railway PR/branch environments, a branch environment works too — keep it isolated
  from `production`.

## 2. Build & start (Settings → Build / Deploy)
- **Build command:**
  ```
  npm install && npm install --prefix client && npm run build --prefix client
  ```
- **Start command:**
  ```
  node server/index.js
  ```
  (Express serves the built `client/dist`. The preview page is 100% synthetic and never calls
  `/api`, so the backend is just a static host here.)

## 3. Environment variables (preview service only)
| Variable | Value | Why |
|----------|-------|-----|
| `VITE_PREMIUM_UI_PREVIEW` | `true` | **Build-time** flag. Unlocks the preview route. Without it the route 404s and the preview code is tree-shaken out of the bundle entirely. |
| `JWT_SECRET` | any throwaway string, e.g. `preview-not-a-secret` | Express env-validation requires it; never used by the synthetic preview. |
| `BOT_TOKEN` | `preview-not-a-secret` | Same — required to boot, never used. |
| `SUPABASE_URL` | `https://preview.invalid` | Dummy; the preview makes no Supabase calls. |
| `SUPABASE_SECRET_KEY` | `preview-not-a-secret` | Dummy; **do not paste the production service-role key.** |
| `PORT` | Railway provides it | — |

**Do NOT set** any real `SUPABASE_*` production value, and do **not** copy variables from the
production service. No migrations (037–039) run here; this service touches no database.

## 4. Safety guarantees (already in the code)
- Route `/demo/personal-overview` renders **404** unless `VITE_PREMIUM_UI_PREVIEW=true` at build.
  Verified: a build without the flag contains **no** preview strings/synthetic data (DCE-removed).
- Visible **`UI PREVIEW · SYNTHETIC DATA`** banner; all CTAs are disabled (`Coming next`).
- `noindex, nofollow` robots meta injected on the preview page.
- In-page state control (Normal / Loading / Empty / Error) — React state, not a data-changing query param.

## 5. Smoke checks after deploy
Open the preview URL and verify: logo + fonts load (no 404s), desktop 1440 / tablet 768 / mobile 375,
Workspace Switcher works, Personal↔Business switch, state controls switch, console errors = 0.

## 6. Production untouched
Creating this service does not modify the production service, its variables, its database, or `main`.
