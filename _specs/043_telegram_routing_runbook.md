# Runbook — Enable Telegram Active-Business Routing (043) in Production

Operator-run. PLAN ONLY here — nothing is applied by this document. Enables the
already-shipped (flag-OFF) Telegram routing by: take a restore point → apply migration
043 → verify → flip the Railway flag → smoke test → (bot-side work).

Guardrails: do NOT apply 042, do NOT start Telegram linking Phase 2, do NOT touch
037–039/040/041. This runbook is ONLY for 043 + `TELEGRAM_ACTIVE_BUSINESS_ENABLED`.

---

## STEP 0 — Pick the production project + record the baseline
Supabase Dashboard → the **production** project. Have the DB connection string ready
(Project Settings → Database → Connection string / URI).

Record these PRE-APPLY counts (SQL Editor) — Step 3 compares against them:
```sql
SELECT count(*) AS users_count FROM users;
SELECT count(*) AS businesses_count FROM businesses;
SELECT count(*) AS telegram_state_table_exists
FROM information_schema.tables
WHERE table_schema='public' AND table_name='telegram_user_state';   -- expect 0 (table not present yet)
```
✅ Write them down here — `users_count = ____`, `businesses_count = ____`,
`telegram_state_table_exists = ____ (expect 0)`.

## STEP 1 — Restore point via pg_dump (free-plan compatible)  ⛔ blocker
Free plan has no dashboard PITR, but `pg_dump` works on any plan. Take a full
schema+data backup of the public schema BEFORE applying anything.

PowerShell (replace the connection string):
```powershell
$PGCONN = "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
pg_dump $PGCONN --schema=public --no-owner --no-privileges -f "prod_backup_pre043_$stamp.sql"
# verify the file is non-empty:
Get-Item "prod_backup_pre043_$stamp.sql" | Select-Object Name, Length
```
✅ Record the filename + timestamp here: `____________________`
STOP if the dump fails or is 0 bytes — do not proceed.

> This dump is an **EMERGENCY-ONLY** restore point. Restoring from it is a manual,
> last-resort action (e.g. unexpected data loss) — it is **not** the normal rollback and
> must **never** be run automatically or casually. Normal rollback is **flag OFF first**
> (see Step 7). A full restore would overwrite the public schema and should only be done
> by an operator who has confirmed it is truly necessary.

## STEP 2 — Apply migration 043 (additive; creates one table)
Dashboard → SQL Editor → New query → paste the FULL contents of
`migrations/043_telegram_user_state.sql` → Run. Expect "Success. No rows returned."
It only creates `telegram_user_state` + its trigger + grants. No existing data touched.

## STEP 3 — Verification SQL  ⛔ blocker (every check must match)
Run this block; all expectations must hold before touching the flag.
```sql
-- 1) table + columns exist
SELECT to_regclass('public.telegram_user_state') AS table_present;       -- non-null
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='telegram_user_state'
ORDER BY ordinal_position;
-- expect: user_id bigint NOT NULL, active_business_id uuid NULL, updated_at timestamptz NOT NULL

-- 2) trigger exists
SELECT tgname FROM pg_trigger
WHERE tgrelid='public.telegram_user_state'::regclass AND NOT tgisinternal;  -- trg_telegram_user_state_updated_at

-- 3) anon / authenticated BLOCKED (expect all false)
SELECT has_table_privilege('anon','telegram_user_state','SELECT')          AS anon_sel,
       has_table_privilege('anon','telegram_user_state','INSERT')          AS anon_ins,
       has_table_privilege('authenticated','telegram_user_state','SELECT') AS auth_sel,
       has_table_privilege('authenticated','telegram_user_state','UPDATE') AS auth_upd;

-- 4) service_role ALLOWED (expect all true)
SELECT has_table_privilege('service_role','telegram_user_state','SELECT') AS sr_sel,
       has_table_privilege('service_role','telegram_user_state','INSERT') AS sr_ins,
       has_table_privilege('service_role','telegram_user_state','UPDATE') AS sr_upd,
       has_table_privilege('service_role','telegram_user_state','DELETE') AS sr_del;

-- 5) no Telegram routing rows yet (fresh table) + existing data MUST equal Step 0
SELECT count(*) AS telegram_state_rows FROM telegram_user_state;          -- expect 0
SELECT count(*) AS users_count FROM users;                                -- MUST EQUAL Step 0 users_count
SELECT count(*) AS businesses_count FROM businesses;                      -- MUST EQUAL Step 0 businesses_count
```
Expected: table_present non-null; 3 columns as described; trigger present;
**all anon/authenticated = false**; **all service_role = true**; `telegram_state_rows = 0`;
and `users_count` / `businesses_count` **exactly equal to the Step 0 baseline** (043 only
CREATEs — it must not change any existing rows). STOP and do NOT flip the flag if any
check fails or any count differs from Step 0.

## STEP 4 — Railway flag (only after Step 3 passes)
Railway → the production service → Variables → add:
```
TELEGRAM_ACTIVE_BUSINESS_ENABLED = true
```
Redeploy (Railway restarts on a variable change). **Rollback at any time = set this
variable back to false (or delete it) and redeploy** — the backend reverts to the old
Telegram behavior instantly; no DB change needed.

## STEP 5 — Backend smoke test after flag ON (bot-secret required)
Use a real Telegram user id you control (`<TID>`) and the bot secret
(`TELEGRAM_WEBHOOK_SECRET` or `BOT_TOKEN`). PowerShell:
```powershell
$B   = "https://app.cfo-ai.site"
$SEC = "<bot-secret>"
$H   = @{ "x-bot-secret" = $SEC; "Content-Type" = "application/json" }

# resolve: expect status auto|active (1 business) or choose (2+)
Invoke-RestMethod -Uri "$B/api/telegram/active-business?telegram_id=<TID>" -Headers $H

# if choose: pick one business id from options, then set it
$body = @{ telegram_id = "<TID>"; business_id = "<BUSINESS-UUID>" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$B/api/telegram/active-business" -Headers $H -Body $body
# expect { ok: true, business: { id, name, business_code, role } }

# re-resolve: expect status=active with the chosen business
Invoke-RestMethod -Uri "$B/api/telegram/active-business?telegram_id=<TID>" -Headers $H
```
Then confirm the row persisted (SQL Editor):
```sql
SELECT user_id, active_business_id, updated_at FROM telegram_user_state WHERE user_id = <TID>;
```
Expected: one row, `active_business_id` = the chosen business. (Endpoints return 404 only
if the flag is still off — re-check Step 4.)

## STEP 6 — Bot-side implementation checklist (separate bot repo)
Only after Steps 1–5 are green. The web backend contract is already live; the bot must:
- `/company` → call `GET /api/telegram/active-business` → render an **inline keyboard**,
  one button per option: text `"<name> · <business_code>"`, the active one prefixed ✅,
  `callback_data = "setbiz:<business_id>"`.
- On callback `setbiz:<id>` → call `POST /api/telegram/active-business` → reply:
  **"Active company: <name> (<business_code>). New entries will be saved here."**
- On an ambiguous create (backend returns `409 company_selection_required` + `options`):
  show the SAME inline keyboard, then **retry the pending action** after the user picks.
- Every saved record confirms the target: **"Saved to <name> (<business_code>)."**
- NO free-text company-name matching as the primary flow.

## STEP 7 — Rollback plan (ordered, least-destructive first)
1. **Flag OFF first:** set `TELEGRAM_ACTIVE_BUSINESS_ENABLED=false` (or delete it) in
   Railway → redeploy. Backend immediately reverts to the old behavior; active-business
   endpoints 404; `from-receipt` uses the legacy resolver.
2. **Bot fallback:** the bot keeps working as before (it never required the new endpoints
   when the backend 404s them). If the bot was already updated, it should treat 404 /
   absent routing as "single-business / legacy" and not block.
3. **Do NOT drop `telegram_user_state`** unless explicitly needed — it's additive, inert
   when the flag is off, and holds only routing selections (no financial data). If a full
   teardown is truly required (rare): `DROP TABLE IF EXISTS telegram_user_state;
   DROP FUNCTION IF EXISTS fn_telegram_user_state_set_updated_at();`.
4. **pg_dump restore = EMERGENCY ONLY.** Restoring the Step-1 dump overwrites the public
   schema and is a last resort for genuine data loss — NOT a normal rollback step, never
   run automatically, and only after an operator confirms it is truly necessary. For
   disabling the feature, **flag OFF (step 1 above) is always the correct rollback.**

---

## STOP conditions (halt immediately, do not proceed)
- Step 1 pg_dump fails / 0 bytes → no restore point → STOP.
- Step 3: any anon/authenticated = true, or any service_role = false, or
  `telegram_state_rows` ≠ 0, or the table/columns/trigger missing → STOP, investigate.
- Step 5: endpoints 404 after setting the flag → the flag didn't take effect (redeploy);
  do not assume routing is live.
- Any unexpected change to users/businesses counts → STOP, restore from Step 1.

## What this runbook does NOT do
No 042, no Email Auth, no Telegram linking Phase 2 (044), no 037–039/040/041, no bot
code in THIS repo. Only 043 + the `TELEGRAM_ACTIVE_BUSINESS_ENABLED` flag.
