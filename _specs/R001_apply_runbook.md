# R001 — Supabase Apply Runbook (operator-run, production)

Apply ONLY R001. Do NOT apply 037–039 / 040. Do NOT enable Personal/Funding.
Do NOT run a reset until Step 3 verification fully passes.

---

## STEP 0 — Pick the production project
Supabase Dashboard → select the **production** project (not staging/local).

## STEP 1 — Backup / restore point  ⛔ blocker
Dashboard → **Database → Backups**.
- Confirm a recent daily backup exists.
- Click **Create backup** (or note the current **PITR** timestamp).
- ✅ Record the restore-point timestamp here: `__________________`
Do not continue until the restore point is visible.

## STEP 2 — Apply R001 (function only, deletes nothing)
Dashboard → **SQL Editor → New query**. Paste the FULL contents of
`migrations/R001_reset_business_financial.sql` and **Run**.
Expected: `Success. No rows returned`.

> It only runs DROP/CREATE FUNCTION + REVOKE/GRANT. No data is touched on apply.

## STEP 3 — Verify (run each; all must match) ⛔ blocker

### 3a — only the (uuid, bigint) overload exists
```sql
SELECT pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'rpc_reset_business_financial';
```
✅ Exactly ONE row: `p_business uuid, p_actor_user_id bigint`  (no uuid-only row)

### 3b — anon / authenticated CANNOT execute
```sql
SELECT
  has_function_privilege('anon',          'rpc_reset_business_financial(uuid,bigint)', 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', 'rpc_reset_business_financial(uuid,bigint)', 'EXECUTE') AS authenticated_exec;
```
✅ Both `false`

### 3c — service_role CAN execute
```sql
SELECT has_function_privilege('service_role', 'rpc_reset_business_financial(uuid,bigint)', 'EXECUTE') AS service_role_exec;
```
✅ `true`

### 3d — no PUBLIC execute leaked
```sql
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'rpc_reset_business_financial';
```
✅ Only grantee = `service_role` (EXECUTE). No `PUBLIC`.

### 3e — confirm gated migrations are still ABSENT (safety)
```sql
SELECT
  to_regclass('public.intercompany_funding_records') AS ic_033,   -- expect non-null (applied)
  to_regclass('public.tax_deposit_entries')          AS tax_034,  -- expect non-null (applied)
  to_regclass('public.fx_rate_quotes')               AS fx_038,   -- expect NULL (037-039 not applied)
  to_regclass('public.personal_workspaces')          AS pw_037;   -- expect NULL (037-039 not applied)
```
✅ `fx_038` and `pw_037` are **NULL**. (If either is non-null, STOP — funding got applied; do not proceed.)

> Note: adjust the 037/038 table names if yours differ — the point is to confirm
> the Personal/Funding tables are NOT present in production.

## STEP 4 — STOP. Report back.
Paste the outputs of 3a–3e here. Do NOT run a reset yet.

---

## STEP 5 — (after my go) Promote runtime + redeploy
Done from the dev side once 3a–3e pass:
1. `feature/personal-funding-frontend-v1 → develop` (FF)
2. `develop → main` (merge)
3. Railway redeploys `main`.

## STEP 6 — (after deploy) Controlled prod reset smoke
On a **throwaway / test business** only (NOT a real one):
1. Note counts: `GET /api/business/financial-counts` (with that business active).
2. Settings → Reset financial data → confirm `RESET`.
3. Expect UI: **"Financial data reset successfully."** (never "Partial reset").
4. Re-check counts → all target tables 0; users/team/settings/tax profile/documents intact.
5. A non-admin member + a personal workspace must both be rejected
   ("Reset failed. No data was deleted.").

## Rollback
- R001 itself: `DROP FUNCTION IF EXISTS rpc_reset_business_financial(uuid, bigint);`
  (apply makes no data changes, so nothing to restore).
- An executed reset: restore from the Step 1 restore point.
