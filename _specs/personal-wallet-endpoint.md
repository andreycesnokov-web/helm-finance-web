# Follow-up Spec — Personal Wallet Endpoint / Personal Wallet Creation Flow

Status: **PROPOSAL (doc-only).** No code, no migrations, no flags. Depends on the
Personal Workspace enablement (see [personal-workspace-enablement.md](personal-workspace-enablement.md)).

Design decision (locked): **`/api/wallets` stays Business Workspace only.** The business
resolver (`resolveActiveBusiness`) continues to REJECT `type='personal'`
(`business_workspace_required`). Personal wallets are created exclusively through a
dedicated personal path — never by making the business route scope-aware.

## 1. Endpoint proposal
Dedicated, personal-only routes (do not reuse `/api/wallets`):

- `POST   /api/personal-workspaces/:id/wallets` — create a personal wallet in that
  personal workspace. (Preferred: the workspace id is explicit in the path.)
- `GET    /api/personal-workspaces/:id/wallets` — list that workspace's wallets.
- `PATCH  /api/personal-workspaces/:id/wallets/:walletId` — rename/edit.
- `DELETE /api/personal-workspaces/:id/wallets/:walletId` — remove (empty-only, mirror
  business delete conservatism).

Shorthand alias acceptable: `POST /api/personal-wallets` with `personal_workspace_id`
in the body — but the path-scoped form is preferred for clarity and auth.

Write shape: `{ business_id: <personal ws id>, user_id: <owner>, scope: 'personal',
name, currency, type, ... }`. Reuse the wallet table; the ONLY differences from a
business wallet are `business_id` points at a `type='personal'` workspace and
`scope='personal'`.

## 2. Auth rules
Resolve via `workspaceAccess.resolvePersonalWorkspaceOwner(supabase, userId, :id)`
(already exists) — NOT `resolveActiveBusiness`. That helper enforces:
- **Owner only** — `businesses.owner_user_id === userId`.
- **Personal workspace only** — `businesses.type === 'personal'` (else 400).
- **Active membership required** — an active owner `business_members` row (defense in depth).
- **Cross-user isolation** — one user's personal wallet can never be created or read by
  another user (no business role on a connected business grants personal access).
Additional gates: `PERSONAL_WORKSPACE_ENABLED=true` (else 403 `personal_wallets_disabled`),
and the per-user `personal_finance_workspace` entitlement (else 403 upgrade_required).

## 3. Required schema / migrations
- **037 at minimum** (personal workspace foundation: `user_workspace_preferences`,
  workspace-type + owner-only triggers, wallet asset immutability). 038/039 are needed
  for the Funding Bridge but NOT for plain personal wallet CRUD.
- Env: `PERSONAL_WORKSPACE_ENABLED=true` (backend personal-wallet gate) and
  `VITE_PERSONAL_FUNDING_UI_ENABLED=true` (frontend personal UI).
- Entitlement: `personal_finance_workspace` add-on (`business_addons`).
- No new table — personal wallets reuse `wallets` (scope='personal', business_id =
  personal workspace). Confirm wallet asset columns (`asset_code`) from 037/038 exist
  before transfers/funding are used.

## 4. UI flow
- **WorkspaceSwitcher** shows the Personal account when `workspaces.personal` is
  non-empty (already implemented).
- If no personal workspace exists, a future **"+ Create personal workspace"** action
  (gated by the entitlement + `VITE_PERSONAL_FUNDING_UI_ENABLED`) calls
  `POST /api/personal-workspaces`.
- **Personal → Accounts → Add wallet** calls the dedicated personal-wallet endpoint
  (NOT `/api/wallets`). The Add-wallet modal here is personal-scoped; there is no
  Business/Personal selector (business modal already has none).

## 5. Isolation rules
- Business wallets NEVER visible in Personal Accounts; personal wallets NEVER visible
  in Business Accounts. Each list is strictly scoped by its workspace id
  (`bizOrFilter` strict business_id on business routes; the personal routes filter by
  the personal workspace id).
- A personal wallet connects to one or many businesses ONLY through the Funding Bridge
  (owner funding / loan / equity contribution / reimbursement) as explicit
  cross-workspace funding transactions — never surfaced as a business wallet.
- Categories stay separate: personal categories ≠ business categories.

## 6. Tests required before enablement
1. Create a personal workspace (owner; entitlement on) → 201, `type='personal'`.
2. Create a personal wallet via the dedicated endpoint → 201, `scope='personal'`.
3. Switch to a business workspace → the personal wallet is NOT visible in
   `GET /api/wallets`.
4. Personal wallet NOT creatable via `POST /api/wallets` (business route) → 400/403.
5. Another user cannot create/read the first user's personal wallet → 403.
6. Link the personal wallet to Business A and Business B via the Funding Bridge →
   funding appears as financing (not revenue/opex), business-side view hides the
   personal source balance.
7. Business data does not leak into Personal (and vice-versa) across all reads
   (wallets, transactions, pulse, categories).
8. Conservative delete: empty personal wallet deletable; non-empty blocked.

## 7. Legacy transactions 46/47
Migrate only AFTER a personal workspace exists for user 7826585034 (see enablement
plan). Not part of this endpoint work.
