# Runbook — Enable Email Auth (042) in Production

Operator-run. PLAN ONLY here — nothing is applied by this document. Enables the
already-shipped (flag-OFF) magic-link-first email auth by: baseline → restore point →
apply migration 042 → verify → backend flag → (email provider) → frontend flag → smoke.

Guardrails: do NOT apply 037–039/040/041/043; do NOT start Telegram linking; do NOT
enable `EMAIL_AUTH_DEV_RETURN_CODE` in production (dev-only). This runbook is ONLY for
042 + `EMAIL_AUTH_ENABLED` + `VITE_EMAIL_AUTH_ENABLED`.

> ⚠️ HARD PREREQUISITE — REAL EMAIL DELIVERY. The backend currently only LOGS the magic
> link / code (it has a `TODO(provider)` — no SES/Resend/etc. wired). With no email
> provider, production users will NOT receive a link and CANNOT sign in. Therefore:
> **do NOT enable the production frontend UI (Step 5) until a real email provider is
> configured and verified.** `EMAIL_AUTH_DEV_RETURN_CODE` must remain unset in
> production — the code/link must NEVER be returned in an API response in prod.

---

## STEP 0 — Pick the production project + record the baseline
Supabase Dashboard → the **production** project. Have the DB connection string ready
(Project Settings → Database → Connection string / URI).

Record these PRE-APPLY values (SQL Editor) — Step 3 compares against them:
```sql
SELECT count(*) AS users_count FROM users;
SELECT count(*) AS businesses_count FROM businesses;
SELECT count(*) AS personal_business_rows FROM businesses WHERE type='personal';
SELECT
  to_regclass('public.user_email_identities') AS uei,      -- expect NULL (not present yet)
  to_regclass('public.user_profiles')          AS profiles, -- expect NULL
  to_regclass('public.email_login_codes')       AS codes,    -- expect NULL
  to_regclass('public.app_user_id_seq')          AS seq;      -- expect NULL
```
✅ Write down — `users_count = ____`, `businesses_count = ____`,
`personal_business_rows = ____`, and confirm uei/profiles/codes/seq are all **NULL**
(042 objects not present yet).

## STEP 1 — Restore point via pg_dump (free-plan compatible) ⛔ blocker
Free plan has no dashboard PITR, but `pg_dump` works on any plan.
```powershell
$PGCONN = "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
pg_dump $PGCONN --schema=public --no-owner --no-privileges -f "prod_backup_pre042_$stamp.sql"
Get-Item "prod_backup_pre042_$stamp.sql" | Select-Object Name, Length   # must be > 0 bytes
```
✅ Record filename + timestamp: `____________________`. STOP if the dump fails / 0 bytes.

> This dump is an **EMERGENCY-ONLY** restore point. Restoring overwrites the public
> schema and is a last resort for genuine data loss — NOT a normal rollback, never run
> automatically or casually. Normal rollback is **flag OFF first** (Steps 4/5).

## STEP 2 — Apply migration 042 (additive; tables + sequence + functions)
SQL Editor → New query → paste the FULL contents of `migrations/042_email_identity.sql`
→ Run. Expect "Success. No rows returned." It creates user_email_identities,
user_profiles, email_login_codes, app_user_id_seq + triggers/grants. No existing data
touched. **Do NOT enable any flag yet.**

## STEP 3 — Verification SQL ⛔ blocker (every check must match)
```sql
-- 1) objects exist
SELECT to_regclass('public.user_email_identities') AS uei,
       to_regclass('public.user_profiles')          AS profiles,
       to_regclass('public.email_login_codes')       AS codes,
       to_regclass('public.app_user_id_seq')          AS seq;            -- all non-null

-- 2) sequence is NEGATIVE
SELECT increment_by, max_value FROM pg_sequences WHERE sequencename='app_user_id_seq'; -- -1, -1

-- 3) triggers exist
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
  AND tgname IN ('trg_uei_updated_at','trg_user_profiles_updated_at') ORDER BY tgname;  -- 2 rows

-- 4) email uniqueness index (case-insensitive)
SELECT indexname FROM pg_indexes WHERE tablename='user_email_identities'
  AND indexdef ILIKE '%lower(email)%';                                  -- 1 row

-- 5) anon / authenticated BLOCKED (tables + sequence + functions) — expect all false
SELECT has_table_privilege('anon','user_email_identities','SELECT')          AS anon_uei,
       has_table_privilege('authenticated','user_profiles','SELECT')         AS auth_prof,
       has_table_privilege('authenticated','email_login_codes','SELECT')     AS auth_codes,
       has_sequence_privilege('anon','app_user_id_seq','USAGE')              AS anon_seq,
       has_function_privilege('anon','next_app_user_id()','EXECUTE')          AS anon_next;

-- 6) service_role ALLOWED — expect all true
SELECT has_table_privilege('service_role','user_email_identities','INSERT') AS sr_ins,
       has_table_privilege('service_role','user_profiles','UPDATE')         AS sr_upd,
       has_table_privilege('service_role','email_login_codes','DELETE')     AS sr_del,
       has_sequence_privilege('service_role','app_user_id_seq','USAGE')      AS sr_seq,
       has_function_privilege('service_role','next_app_user_id()','EXECUTE')  AS sr_next;

-- 7) PUBLIC has no execute on the functions — expect false
SELECT has_function_privilege('public','next_app_user_id()','EXECUTE')               AS pub_next,
       has_function_privilege('public','fn_email_identity_set_updated_at()','EXECUTE') AS pub_touch;

-- 8) nothing created / nothing changed
SELECT count(*) AS email_identities FROM user_email_identities;          -- 0 (no email users yet)
SELECT count(*) AS users_count FROM users;                              -- MUST EQUAL Step 0
SELECT count(*) AS businesses_count FROM businesses;                    -- MUST EQUAL Step 0
SELECT count(*) AS personal_business_rows FROM businesses WHERE type='personal'; -- MUST EQUAL Step 0 (042 creates none)
```
Expected: all objects non-null; sequence `-1, -1`; both triggers; lower(email) index;
**all anon/authenticated = false**, **all PUBLIC function checks = false**, **all
service_role = true**; `email_identities = 0`; `users_count` / `businesses_count` /
`personal_business_rows` **exactly equal to Step 0**. STOP if any check fails or any count
differs.

## STEP 4 — Backend flag (only after Step 3 passes)
Railway → production service → Variables:
```
EMAIL_AUTH_ENABLED = true
# DO NOT set EMAIL_AUTH_DEV_RETURN_CODE in production (dev-only; leave unset)
```
Redeploy. **Rollback = set `EMAIL_AUTH_ENABLED=false` (or delete) → redeploy** — email
endpoints revert to 404 instantly; no DB change.

Quick backend check (no UI yet): `POST /api/auth/email/start {"email":"x@y.com"}` should
return `{"ok":true}` (NOT 404, NOT a dev_code). Confirm the response contains **no**
`dev_code`/`magic_link` (those appear only with the dev flag, which must be off).

## STEP 5 — Email provider + frontend flag ⛔ (gated on real email delivery)
**Do NOT proceed until a real email provider is configured.** The backend's
`issueEmailSecret` currently only `console.log`s the link/code — a provider (SES/Resend/
Postmark/etc.) must be wired to actually send the magic link (primary) + the 6-digit code
(fallback). Until then, prod users cannot receive a link and MUST NOT see the UI.

Once email sending is verified end-to-end (a real inbox receives the link):
- Frontend build/host env: `VITE_EMAIL_AUTH_ENABLED = true` → rebuild/redeploy the client.
- **Rollback = `VITE_EMAIL_AUTH_ENABLED=false` → rebuild** (routes tree-shaken out again).

## STEP 6 — Production smoke (after Steps 4 + 5 + provider)
On a real device/inbox you control:
1. `/login/email` opens.
2. Enter email → "Send sign-in link" → receive the email (real provider).
3. Click the magic link → `/login/email/callback?token=…` → signs in → lands on `/account`.
4. `/account` opens (Personal Account shell); edit + Save profile → persists on reload.
5. Confirm NO personal finance UI (no wallets/transactions/Personal Workspace).
6. Confirm `businesses.type='personal'` count is unchanged (signup creates none).
7. Confirm Telegram `/login` still works unchanged.
Fallback path: on `/login/email` choose "Enter a 6-digit code instead" → the emailed code
signs in.

## STOP conditions (halt immediately)
- Step 1 pg_dump fails / 0 bytes.
- Step 3: any anon/authenticated = true, any PUBLIC function = true, any service_role =
  false, sequence not `-1/-1`, missing tables/index/triggers, `email_identities ≠ 0`, or
  any of users_count / businesses_count / personal_business_rows differs from Step 0.
- Step 4: `email/start` still 404 after the flag (didn't take effect) OR a `dev_code`/
  `magic_link` appears in the response (dev flag wrongly on) → STOP, fix env.
- No email provider configured → do NOT enable `VITE_EMAIL_AUTH_ENABLED` (Step 5).
- Step 6: email endpoint errors, `/account` errors, a personal workspace appears, or
  Telegram login is impacted in any way → STOP.

## Rollback (ordered, least-destructive first)
1. **Frontend flag OFF:** `VITE_EMAIL_AUTH_ENABLED=false` → rebuild (UI hidden).
2. **Backend flag OFF:** `EMAIL_AUTH_ENABLED=false` → redeploy (endpoints 404).
3. **Do NOT drop the 042 tables** unless explicitly needed (additive, inert when off). If a
   teardown is truly required (rare): drop email_login_codes, user_profiles,
   user_email_identities, next_app_user_id(), app_user_id_seq,
   fn_email_identity_set_updated_at() — only PRE-LAUNCH (no email users). Once email users
   exist, do NOT drop (would orphan negative-id users).
4. **pg_dump restore = EMERGENCY ONLY** — last resort for genuine data loss; overwrites
   the public schema; never automatic/casual. Flag OFF is always the correct rollback.

## What this runbook does NOT do
No 037–039/040/041/043, no Telegram linking, no bot changes, no `EMAIL_AUTH_DEV_RETURN_CODE`
in prod. Only 042 + `EMAIL_AUTH_ENABLED` + `VITE_EMAIL_AUTH_ENABLED` (the latter gated on a
real email provider).
