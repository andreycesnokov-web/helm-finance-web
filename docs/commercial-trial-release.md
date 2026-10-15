# Commercial V2 trial/admin release

Scope: Business and Platform/admin. Personal identity and wallet data remain separate.
Completed A and the historical B SQL preview are preserved. This release supersedes
old checkpoint statements that the API is not installed.

API admission, exactly 168-hour confirmed-email/current-membership trial, command
readback, immutable catalog versions, verified paid-period storage, audited finite grants,
CAS/idempotent admin commands, quota reserve/start/commit/release are implemented.
Financial recovery is checked before expiry denial. Existing companies retain legacy
access, including after a temporary administrative overlay ends. No payment writer exists.

V2 routes: /business/trial, /business/billing, /admin/billing. Existing registration,
company creation and invitation acceptance are reused. Employees bypass trial activation.
RU/EN/ID and desktop/mobile. No card, checkout, fake payment or MRR is created.
Scheduled terms are projected by server time, without replacing an existing paid period,
extending trial or creating new access. Explicit assignment cancels an earlier schedule.
MCP/Telegram callers are gated; external integrations remain disabled. Existing reachable
AI/import work is synchronous. Admitted upload completion survives expiry.

## Owner decisions

| Parameter | Required decision for Starter / Control / Pro |
|---|---|
| Capacity | Users, companies, documents, AI operations, imports: number or explicit unlimited |
| Features | Documents, AI, import, payroll, team, approvals, export, integrations |
| Usage basis | Confirm calendar UTC month and per-company billing; shared organization capacity requires a later design |

USD monthly prices: 59 / 149 / 299. No historical seeds constitute approved limits.
Defaults are unpublished drafts. Synthetic acceptance terms are explicitly staging_fixture.
Incomplete plans cannot be publicly activated. Xendit is only a candidate; no provider is
selected. Referral portal, email campaign and MRR dashboard remain later stages.

## Flags and migration

COMMERCIAL_BILLING_ENABLED defaults OFF. COMMERCIAL_BILLING_FIXTURES additionally requires
CFO_DEPLOYMENT_ENV=staging. VITE_DESIGN_V2 remains default OFF. Platform ADMIN_TELEGRAM_IDS
is independent of company roles. The owner requested andrey.cesnokov@gmail.com; the
existing staging identity was verified confirmed. No company admin is promoted implicitly.
No production or Railway flag changes.

Final migration: 20261015033808_cfo_commercial_trial.sql; no prior migrations replayed.
RLS/private service_role RPCs, append-only terms/audit. Restore rehearsed on separate PG17
with original ACLs; protected backup contents and keys never leave staging.

## Rollback / roll-forward

Preserve old V2 image/compose, Classic identity, backup hash, source HEAD/tree and migration
hash. Roll back V2 only to old image/compose with commercial flag OFF. Keep additive schema
and receipts; never restore shared DB over later data. Roll forward to the verified image
and existing schema marker; do not replay migration. Unknown commands need receipt readback.

Fresh restore matched 311 businesses, 1403 transactions, 139 documents, 0 plans. Native
final migration: 29 groups. Actual HTTP: 13 pre-expiry + 4 expiry/recovery groups. V2 ON/OFF
builds passed. UI and rollout evidence are tracked separately in the final checkpoint.
