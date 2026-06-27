# Go-Live Report — Email Auth (042) Enabled in Production

Status: **LIVE in production (2026-06-27).** Email sign-in (magic-link first, 6-digit
fallback) is enabled. Operator-run via [042_email_auth_OWNER_CHECKLIST.md](042_email_auth_OWNER_CHECKLIST.md).
Doc-only record — no code/migration/flag change made by this file.

## Domains
- App URL: **https://app.cfo-ai.site**
- Email sender: **CFO AI <login@auth.cfo-ai.site>** (Resend, domain `auth.cfo-ai.site`)

## What was done (operator)
| Item | Result |
|---|---|
| Backup (pg_dump restore point) | `prod_backup_pre042_20260627-121102.sql` · **422011 bytes** |
| Baseline before apply | users = **5** · businesses = **4** · personal_workspaces = **0** |
| Migration 042 applied | **Yes** (user_email_identities, user_profiles, email_login_codes, app_user_id_seq + triggers/grants) |
| Verification | **Passed** (objects present · sequence −1/−1 · anon/authenticated blocked · service_role allowed · email_users = 0 · counts == baseline) |
| Backend env (Railway) | `EMAIL_AUTH_ENABLED=true` · `EMAIL_PROVIDER=resend` · `EMAIL_FROM=CFO AI <login@auth.cfo-ai.site>` · `APP_BASE_URL=https://app.cfo-ai.site` · `RESEND_API_KEY` set in Railway (never in chat/repo) |
| `EMAIL_AUTH_DEV_RETURN_CODE` | **NOT set** (correct — dev-only) |
| Frontend env | `VITE_EMAIL_AUTH_ENABLED=true` |
| Magic-link email delivery | **Arrived in inbox** |
| First email login | created email user **user_id = -1** (negative id — disjoint from positive Telegram ids, as designed) |
| personal_workspaces after | **0** (unchanged — no `type='personal'` created) |

## Verified invariants
- New email user got a **negative id** (`-1`) → no collision with Telegram (positive) ids.
- **No personal workspace** created by email signup (count 0 → 0).
- Magic-link delivery works end-to-end via Resend from `login@auth.cfo-ai.site`.
- Backend smoke: `/api/auth/email/start` → `{ ok:true }` with **no** `dev_code`/`magic_link`
  in the response (dev flag correctly unset in prod).

## Open / to confirm
- **Telegram `/login` still works:** owner to confirm (pending). Email auth is additive and
  Telegram auth code is unchanged, so this is expected to pass — confirm and update here.

## Production state after go-live
```
042 APPLIED to production (email identity tables/sequence/functions)
EMAIL_AUTH_ENABLED = true · VITE_EMAIL_AUTH_ENABLED = true · EMAIL_PROVIDER = resend
EMAIL_AUTH_DEV_RETURN_CODE NOT set
Telegram login: unchanged (additive)
NOT changed: 037–039, 040, 041, 043 (telegram routing), Personal/Funding, Telegram linking
```

## Rollback (if needed later)
1. Frontend: `VITE_EMAIL_AUTH_ENABLED=false` → rebuild (hides the email UI).
2. Backend: `EMAIL_AUTH_ENABLED=false` → redeploy (email endpoints 404).
3. Leave the 042 tables in place (email users now exist — do NOT drop).
4. Emergency only: restore `prod_backup_pre042_20260627-121102.sql` (overwrites schema;
   never routine).
