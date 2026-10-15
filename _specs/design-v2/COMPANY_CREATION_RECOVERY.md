# Company creation and recovery — Business / actor account

This registration operation creates a Business, not Personal financial records. It
uses the existing signed CFO JWT and BIGINT actor, without changing authentication.

`POST /api/businesses` requires an actor-scoped UUID Idempotency-Key. The invoker,
service-role-only `rpc_create_business_once` enters the existing financial writer
gate before any parent/metadata/receipt lock. Business, active owner membership,
default categories and non-financial creation receipt commit together. Original
database trial, business-code, plan and currency defaults are retained. The old
handler had no company-count entitlement check; this patch adds no billing policy.

Replay compares normalized company fields, returns the original result, and requires
current active owner membership. Another payload conflicts; another actor has a
separate namespace. Deleting a created company leaves a receipt tombstone through
SET NULL and cannot recreate it by replay. Optional absent schema fields are
reported explicitly. A required schema/RPC absence fails closed; there is no
non-transactional fallback.

`GET /api/business-creation/:key` only reads the signed actor's receipt. Not-found
does not prove an in-flight request rolled back. Financial receipts and ledgers
are not used for this non-financial operation.

The V2 form persists an actor-scoped draft and immutable submitted request. Recovery
after reload reads status; retry is explicit and uses the original key/body. Web
Locks coordinate tabs. If durable storage or Web Locks are unavailable, creating
a company fails before sending. Credentials and uploaded documents are never
stored in the draft. Successful creation requires an explicit Continue action.
Tax-profile creation is no longer a silently ignored second side effect: legal
and tax details are reviewed and explicitly saved in the profile step.

Real browser reproduction found a double-click layout shift: shrinking the submit
label moved Back under the second click. Keep the label/position stable and guard
Back while submitting. Receipt responses use private/no-store and vary by actor
authorization; the client also rejects results owned by another actor.

## Deployment and rollback

New migration: `20261012110000_durable_company_creation.sql`. Keep existing applied
migrations intact. Before own staging application rollout, preserve a fresh private
database/Storage backup, restore to a disposable PostgreSQL17 copy, compare existing
public/auth/storage data, verify rollback, independent-connection replay and grants.
Record the exact source and migration SHA in the own staging execution journal.

For rollback stop only the two owned application containers. Keep the additive
table/functions and receipts. Do not restart the old non-idempotent company writer;
keep registration unavailable until a compatible image is restored. A full database
restore is an explicit recovery action and would lose newer synthetic fixtures;
never overwrite the live database just to remove this additive schema.

## Separate open dependencies

- Existing empty-company delete refuses freshly seeded synthetic companies (409).
  Retain those fixtures; do not bypass the existing financial deletion RPC.
- Referral reward activation is explicitly deferred by the owner. Terms will be
  administered in the app; subscription payments and reward accruals remain OFF.
- R1–R10 document/AI/profile/invite acceptance is separate from company creation.
- Import, payroll, financial receipt coverage and production rollout are unchanged.
