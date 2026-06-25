# Personal Workspace + Funding Bridge — Enablement Plan (GATED)

Status: **NOT enabled.** Do not action without explicit, separate approval.

Hard constraints (in force):
- Migrations **037–039 NOT applied** to production.
- Migration **040 NOT applied** to production.
- `VITE_PERSONAL_FUNDING_UI_ENABLED` stays **off** (Personal/Funding UI gated).
- Production DB currently has only **R001** added (reset RPC) + the one approved
  business_id backfill for transaction id 45.

## Enablement order (when approved)
1. Read-only preflight (verify schema, no NULL leaks, gate audit clean).
2. Backup / restore point.
3. Apply 037 → 038 → 039 (Personal Workspace + Funding Bridge), one at a time, each
   followed by verification.
4. Apply 040 (AI Accountant fields) if/when separately approved.
5. Flip `VITE_PERSONAL_FUNDING_UI_ENABLED=true` and redeploy.
6. Smoke: personal workspace isolation, funding bridge, FX quotes.

## Data migration task — legacy personal transactions (DO NOT RUN NOW)
During the business-isolation NULL audit (2026-06), the prod audit found legacy
personal transactions with `business_id IS NULL` and `scope = 'personal'` that have
**no** business UI today (strict business scoping correctly hides them):

| id | user_id    | scope    | amount_idr | description              |
|----|------------|----------|-----------:|--------------------------|
| 46 | 7826585034 | personal | 180,000    | "Оплата сервиса QR CODE" |
| 47 | 7826585034 | personal | 3,000,000  | personal / entertainment |

(Transaction id 45 was a real **business** row and was backfilled to
`Andrey 💎 Business / HF-BIZ-000002` — `b949966a-3988-47cb-9e7c-afad1423f4f8`. It is
NOT part of this task.)

When Personal Workspace (037) ships, these rows must be **migrated into user
7826585034's personal workspace** (assign their personal-workspace id, keeping
`scope = 'personal'`), so they surface in the Personal UI instead of being orphaned.

Do NOT migrate them before 037 is applied and the personal workspace exists for that
user — there is no valid target workspace id until then. Until then they remain
`business_id NULL, scope personal` and are invisible (acceptable: no personal UI yet).

Proposed migration (illustrative — finalize the personal-workspace id resolution
against the 037 schema before running):
```sql
-- AFTER 037 is applied and user 7826585034 has a personal workspace.
UPDATE public.transactions t
SET business_id = (
  SELECT pw.id FROM public.businesses pw           -- personal workspaces live in businesses (type='personal')
   WHERE pw.owner_user_id = t.user_id AND pw.type = 'personal'
   ORDER BY pw.created_at ASC LIMIT 1)
WHERE t.id IN (46, 47)
  AND t.user_id = 7826585034
  AND t.business_id IS NULL
  AND t.scope = 'personal';
```
After running, re-check: `SELECT count(*) FROM transactions WHERE business_id IS NULL
AND scope='personal' AND user_id=7826585034;` → expect 0.
