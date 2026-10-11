# Owner Checklist — Turn On Email Sign-In (042) in Production

Simple step-by-step. Nothing is enabled by reading this. Do the steps IN ORDER, and STOP
if anything looks wrong. Detailed reference: [042_email_auth_runbook.md](042_email_auth_runbook.md).

Domains in use:
- App URL: **https://app.cfo-ai.site**
- Email sender: **CFO AI <login@auth.cfo-ai.site>**

---

## 1) Have these ready BEFORE you start
- [ ] **Resend** account with the domain **auth.cfo-ai.site** showing **Verified**, and a
      **test email from the Resend dashboard actually arrived** in a real inbox (see the
      Resend setup checklist). If email doesn't arrive yet → STOP, don't start.
- [ ] **Resend sending API key** in your password manager (starts with `re_…`). Never paste it in chat.
- [ ] **Supabase production** database connection string (Project Settings → Database).
- [ ] **`pg_dump` installed** on your computer (comes with PostgreSQL tools).
- [ ] 15 quiet minutes. Do this when traffic is low.

## 2) Take a safety backup (pg_dump) — REQUIRED
In PowerShell (paste your real connection string):
```powershell
$PGCONN = "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
pg_dump $PGCONN --schema=public --no-owner --no-privileges -f "prod_backup_pre042_$stamp.sql"
Get-Item "prod_backup_pre042_$stamp.sql" | Select-Object Name, Length
```
✅ The file's **Length must be greater than 0**. Write down the filename. If the dump
fails or is empty → **STOP**.

## 3) Apply the database change (042)
- Supabase → **SQL Editor → New query**.
- Open `migrations/042_email_identity.sql`, copy ALL of it, paste, **Run**.
- Expect **"Success. No rows returned."** Do NOT set any Railway variable yet.

## 4) Verify the database (must all pass)
Paste this in the SQL Editor and check the results:
```sql
-- objects exist
SELECT to_regclass('public.user_email_identities') AS uei,
       to_regclass('public.user_profiles')          AS profiles,
       to_regclass('public.email_login_codes')       AS codes,
       to_regclass('public.app_user_id_seq')          AS seq;            -- all NOT null
-- id sequence is negative
SELECT increment_by, max_value FROM pg_sequences WHERE sequencename='app_user_id_seq'; -- -1, -1
-- outsiders blocked (expect all false)
SELECT has_table_privilege('anon','user_email_identities','SELECT')          AS anon_uei,
       has_table_privilege('authenticated','user_profiles','SELECT')         AS auth_prof,
       has_sequence_privilege('anon','app_user_id_seq','USAGE')              AS anon_seq;
-- backend allowed (expect all true)
SELECT has_table_privilege('service_role','user_email_identities','INSERT') AS sr_ins,
       has_sequence_privilege('service_role','app_user_id_seq','USAGE')      AS sr_seq;
-- nothing created / nothing changed
SELECT count(*) AS email_users FROM user_email_identities;               -- 0
SELECT count(*) AS personal_workspaces FROM businesses WHERE type='personal'; -- unchanged (042 makes none)
```
✅ All objects present · sequence shows **-1 / -1** · all "anon/auth" = **false** · all
"service_role" = **true** · email_users = **0**. If anything is off → **STOP**.

## 5) Turn it on — ORDER MATTERS

### 5a) BACKEND FIRST — Railway variables
Railway → production service → **Variables** → add these four, then redeploy:
```
EMAIL_PROVIDER       = resend
RESEND_API_KEY       = <your sending-only key from step 1>
EMAIL_FROM           = CFO AI <login@auth.cfo-ai.site>
APP_BASE_URL         = https://app.cfo-ai.site
EMAIL_AUTH_ENABLED   = true
```
> Do **NOT** add `EMAIL_AUTH_DEV_RETURN_CODE`. That is for local testing only and must
> never be set in production.

### 5b) SMOKE THE BACKEND (before any UI)
- Send yourself a real test from the API: a request to
  `https://app.cfo-ai.site/api/auth/email/start` with your email should return `{"ok":true}`
  AND **a magic-link email should arrive** at your inbox (from CFO AI <login@auth.cfo-ai.site>).
- Confirm the API response contains **no** `dev_code` or `magic_link` (those must never
  appear in production). If the email doesn't arrive, or a code/link shows in the response
  → **STOP** and fix before enabling the UI.

### 5c) FRONTEND SECOND — only after the email arrives
- Set the frontend build variable **`VITE_EMAIL_AUTH_ENABLED = true`** and redeploy the
  app. Now `/login` shows "Sign in with email" and `https://app.cfo-ai.site/login/email`
  works.
- Final check on a real device: open `https://app.cfo-ai.site/login/email` → "Send sign-in
  link" → click the emailed link → you land on `/account` → edit + Save profile. Telegram
  `/login` still works.

## 6) STOP conditions (halt, do not continue)
- pg_dump failed or the backup file is 0 bytes.
- Any verification check is wrong (missing tables, sequence not -1/-1, an outsider shows
  "true", service_role shows "false", email_users not 0, personal_workspaces changed).
- After turning the backend on: the test email does **not** arrive, OR the API response
  shows a `dev_code`/`magic_link`.
- Telegram `/login` stops working at any point.

## 7) Rollback (do the FIRST step that applies — least drastic first)
1. **Hide the UI:** set `VITE_EMAIL_AUTH_ENABLED = false` and redeploy the app — the email
   sign-in disappears; Telegram login keeps working.
2. **Turn off the backend:** set `EMAIL_AUTH_ENABLED = false` (or delete it) in Railway and
   redeploy — the email endpoints stop responding; no database change needed.
3. **Leave the database alone.** The 042 tables are safe to keep even when off. Do NOT drop
   them once anyone has signed in by email.
4. **Emergency only:** restoring the step-2 pg_dump overwrites the whole database — last
   resort for real data loss, never a routine rollback. Turning the flags OFF (steps 1–2)
   is the correct rollback.

---
Reminder: this checklist changes nothing on its own. Run it only when you decide to go live.
