# Personal Workspace + Funding Bridge — Enablement Plan (GATED)

Status: **NOT enabled.** Do not action without explicit, separate approval.

Hard constraints (in force):
- Migrations **037–039 NOT applied** to production.
- Migration **040 NOT applied** to production.
- `VITE_PERSONAL_FUNDING_UI_ENABLED` stays **off** (Personal/Funding UI gated).
- Production DB currently has only **R001** added (reset RPC) + the one approved
  business_id backfill for transaction id 45.

## Wallet & cross-workspace architecture (authoritative model)
Personal wallets must NEVER be created inside a Business Workspace.

- **Business Workspace** — business wallets/accounts, business categories, business
  transactions, business cash/runway/CFO score ONLY.
- **Personal Workspace** (this enablement) — personal wallets/accounts, personal
  categories, personal transactions, personal cashflow ONLY. Personal wallets are
  created here, never in a business.
- **Cross-workspace link** — a personal account can be linked to one OR many
  businesses as a funding source. Money moving from a personal wallet into a business
  is an explicit **cross-workspace funding transaction**, NOT a personal wallet living
  inside the business. Flows: owner funding, owner loan to business, equity/investment
  contribution, reimbursement business→personal. One personal wallet may fund
  Business A, B, C simultaneously.
- **Categories stay separate**: personal categories ≠ business categories.

Already enforced (shipped 2026-06, main 5ae673d): the Business Workspace Add-wallet
modal has no Business/Personal selector, and `POST /api/wallets` rejects
`scope='personal'` (`personal_wallets_disabled`) unless `PERSONAL_WORKSPACE_ENABLED=true`.
When Personal Workspace ships, personal wallet creation lives only in the personal UI;
business pages surface linked personal funding only through the funding/intercompany/
owner-contribution flow (see Funding & Investors + Intercompany foundation), never as
normal business wallets.

## Discovery findings (2026-06-26, code audit — no code changed)

### What already exists in code
- **Backend** `server/routes/personalFunding.js` (mounted at `/api`), fully built:
  `GET /workspaces`, `POST /personal-workspaces`, `GET /personal-workspaces/:id`,
  `PATCH /workspace-preferences`, `personal-business-connections` (request/confirm/
  reject/revoke/list), `fx/quotes` (+refresh), `wallet-transfers/preview|confirm`,
  `funding` (create/confirm/cancel/repay/incoming/outgoing/summary/:id). Helpers in
  `server/lib/workspaceAccess.js` + `server/lib/fxProvider.js`.
- **Frontend** `pages/personal/*` (Layout/Shell/Overview/Accounts/Transactions/
  Onboarding); `/personal/*` routes + WorkspaceSwitcher personal section + PERSONAL_NAV
  all gated by `VITE_PERSONAL_FUNDING_UI_ENABLED` (routes tree-shaken / redirect when off).
- **Workspace model**: a personal workspace **is** a `businesses` row with
  `type='personal'` (CHECK from migration 030) + exactly one owner `business_members`
  row. Entitlement is the per-user add-on `personal_finance_workspace` in
  `business_addons` (table from migration 020); Funding Bridge needs the separate
  `personal_investor_funding` add-on. Neither is derived from a Business plan.

### What is blocked because 037–039 are not applied
Missing tables: `user_workspace_preferences`, `personal_business_relationships`,
`personal_business_relationship_roles` (037); `exchange_rate_quotes`, `fx_conversions`,
`funding_transfers`, `funding_repayments`, `funding_audit` (038). Missing RPCs (039):
`rpc_request/confirm/reject/revoke_personal_business_connection`,
`rpc_create_fx_quote_record`, `rpc_create_funding_transfer`,
`rpc_confirm/repay/cancel_funding_transfer`, `rpc_create_wallet_transfer`. Missing
triggers: `trg_uwp_type_guard`, `trg_pbr_type_guard`, `trg_personal_owner_only`
(on `business_members`), `trg_wallet_asset_immutable` (on `wallets`),
`trg_quote_rate_immutable`, `funding_audit_append_only`; plus wallet asset columns
(`asset_code`) the transfer/funding layer reads.

### What would break if we enabled it NOW (flag on, migrations NOT applied)
- `GET /workspaces` keeps working — its `user_workspace_preferences` read only
  destructures `data` (error ignored), so a missing table degrades to `pref = {}`
  (is_primary/is_default/is_last_active all false). This is why prod works today.
- `PATCH /workspace-preferences` → 400 (upsert into a non-existent table).
- `fx/quotes`, `wallet-transfers/*`, `funding/*`, `personal-business-connections/*`
  → 500/4xx (missing tables + RPCs).
- `POST /personal-workspaces` does NOT depend on 037–039 — it inserts a
  `businesses(type='personal')` row + owner membership. With the entitlement add-on it
  would succeed, BUT without the 037 owner-only trigger there is no DB-level privacy
  enforcement, and preferences can't be persisted. Without the add-on → 403.

### IMPORTANT conflict to resolve before personal wallets work
`POST /api/wallets` goes through `requireBusiness → resolveActiveBusiness`, which now
**rejects** `type='personal'` (`business_workspace_required`). So personal wallets
**cannot** be created via the business wallet route as-is. When Personal ships, personal
wallet creation needs EITHER a dedicated personal-wallet endpoint OR a scope-aware
resolver that allows personal workspaces on personal routes only. Also `PERSONAL_WORKSPACE_ENABLED`
must be `true` (our new gate) for any `scope='personal'` wallet creation. These two
guards must be lifted together, on the personal path only — never on business routes.

### Exact requirements to enable later
1. Apply migrations **037 → 038 → 039** in order (preflight/postflight in
   `migrations/_preflight_postflight_037_039.sql`). 040 is independent (AI Accountant),
   not required for Personal.
2. Env flags: `VITE_PERSONAL_FUNDING_UI_ENABLED=true` (frontend UI) **and**
   `PERSONAL_WORKSPACE_ENABLED=true` (backend personal-wallet gate).
3. Per-user entitlements in `business_addons`: `personal_finance_workspace`
   (create/use personal workspace) and, for the Funding Bridge, `personal_investor_funding`.
4. Add the personal-wallet creation path (dedicated endpoint or scope-aware resolver).
5. Migrate legacy personal transactions 46/47 (see task above) once a personal
   workspace exists for user 7826585034.

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
