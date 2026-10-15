# CFO OS V2 commercial contract — stage A / B

Base: 90ab5e6b7a2fc69cd0e5c5bd43e5bf6850e27760. Business and Platform/admin only.
This is a development contract, not a deployment or acceptance certificate.

## Source and staging evidence

Local source and remote candidate are clean at the base. Running V2 image:
sha256:e75803ba63cfbd60bdf14ad6220bafc27bf1c49e5f85ed27886e65e890a28fe3.
Read-only table inventory confirms plan_limits, access_audit, ai_usage_events,
onboarding tables and payment-provider connection/vault tables. No subscription,
billing payment or referral tables were found by targeted name inventory. No billing,
Xendit, Midtrans or referral environment keys were present in the V2 container.
Vault credentials were not decrypted or inspected. Provider selection is unresolved.

| Area | Existing | Reuse | Modify | Missing |
|---|---|---|---|---|
| Identity | server/index.js email routes, user_email_identities | Existing BIGINT identity and verified email | Read verified identity for trial; no new auth | Commercial onboarding entry |
| Company | server/lib/companyCreation.js; migrations/20261012110000_durable_company_creation.sql | Atomic creation and recovery receipt | New-company defaults must not start trial | Explicit commercial enrollment |
| Catalog | migrations/005_saas_foundation.sql plan_limits | Stable plan key and existing capacity/feature consumers | Add Control/Pro without renaming Business/Founder; immutable terms versions | Prices, publication, localized terms |
| Access | server/lib/businessAccess.js; server/index.js getBusinessAccess/hasDocumentsAccess/billQuota | One effective access resolver and membership checks | Period-backed paid access, trial selected plan, central action policy | Atomic quota reservations for AI/import |
| Admin | server/index.js requireAdmin, /api/admin/businesses/:id/access and /trial; client/src/v2/AdminApp.jsx | Existing platform identity allowlist and access_audit | Atomic audit, CAS, command receipts, V2 forms | Versioned catalog editor and grant management |
| Payments | server/lib/paymentConnections.js, incomingPayments.js | Connection metadata only where applicable | Keep merchant receipts separate from CFO subscription revenue | Selected provider adapter, quote/payment/period/event storage |
| Notifications | server/lib/emailSender.js, notificationPolicy.js, telegramNotifications.js | Delivery and permission mechanisms | Lifecycle outbox and state recheck; controlled recipients only | Commercial lifecycle messages RU/EN/ID |
| Onboarding | server/lib/onboarding.js; migrations/054_onboarding_foundation.sql; client/src/v2/setup/Setup.jsx | Persistent progress and existing routes | Server-derived milestones; invited-member bypass | Trial and billing screens |
| Referral | No runtime implementation found in server/client/migrations search | Prior owner decision: default USD 30 | No company financial ledger changes | Config/version snapshot, first-payment event, refund reversal |

## Persistence and ownership

Extend plan_limits as the stable catalog root; plan_versions stores immutable accepted
terms (price minor units, currency, monthly interval, features, limits, terms version,
effective time and approval/fixture status). Archiving the root prevents new selection,
not access under existing snapshots. No prices in React. Commercial prices:
Starter 5900, Control 14900, Pro 29900 USD cents/month. Capacity values remain unapproved;
only explicitly named fixtures can activate in controlled staging. Public activation
must refuse incomplete/unapproved terms.

Businesses retain existing legacy access until explicit transition approval. New
commercial enrollment is marked independently and never inferred from name, signup,
JWT, or employee membership. A single billing account belongs to one business. Store
selected terms, trial start/end, account version, cancellation intent and scheduled
change. Receipt keys are unique per actor/account/command with canonical payload hash.
Membership and verified email are checked inside the same transaction as activation.

Trial activation locks the account, takes server UTC time once, and ends exactly
604800 seconds later. Concurrent commands return the same original interval. Selection
may change terms but not restart the clock. Admin extension requires reason, CAS,
before/after, atomic audit and invalidation of stale notifications.

## Access and quotas

The existing resolver is the sole projection: active current-company admin grant,
then verified paid service period, then valid selected-plan trial, else restricted.
Membership and endpoint RBAC remain mandatory and independent. Paid does not imply
owner/admin. Missing or cross-company snapshots fail closed. Legacy policy is unchanged
without explicit enrollment. A frontend countdown is informational and anchored to
server_now, never used for permission decisions.

The initial pure implementation is in businessAccess.js, selected only by an explicit
server-loaded billing snapshot. It is NOT yet hydrated by routes and provides no
new endpoint enforcement. Do not describe unit tests as native DB or staging acceptance.

Action inventory must classify HTTP, MCP, Telegram and background jobs before enablement.
Always permit authorized billing/profile/history/read-only/export policy and receipt
recovery. New paid work checks current membership, tenant, terms and quota. Receipts
are read before reserve, and quota reservation keys are business/operation scoped.
Reserve and capacity check share a DB lock; commit/release are terminal and idempotent.
Failed work releases its reservation with a reason. A retry reads or resumes the same
job, never charges twice. A job admitted before expiry may finish the same reserved
operation; retries cannot start unrelated work. No financial transaction is split
by a billing check; admission precedes its atomic financial RPC.

## Payment and state contract

| Event | Mutation | Access consequence |
|---|---|---|
| select terms | selected version + CAS + receipt | No trial or paid period created |
| activate trial | one original server interval | Selected version until exclusive end |
| create checkout | frozen server quote/price/version/environment | Existing access unchanged |
| verified settled payment | dedup event/payment + one service period atomically | Access during paid period |
| payment failure/checkout expiry | payment attempt + event | Existing paid period preserved |
| cancel renewal | cancel_at_period_end | Existing paid period preserved |
| refund | recorded reconciliation/refund state | No automatic refund/proration policy invented; operator review until approved |
| admin grant/revoke | finite complimentary interval + audit | No paid flag or MRR/revenue |
| scheduled plan change | version + effective boundary | No retroactive price or paid-period change |

Subscription status is a projection; no manual status=active command substitutes for
payment. Service-period activation is independent of trial expiry event ordering. Reject
old/out-of-order mutations by provider semantics and version/CAS, not arrival timestamp.
Never activate by redirect or a mock webhook. Enforce payment/company/subscription ID,
amount, currency, environment and provider authenticity. Reconcile authoritative provider
state on ambiguous events. Rollback preserves idempotent receipts and safe recovery.

Provider and FX gates are unresolved: do not pick Xendit over Midtrans based on text
matches in imported statements. USD catalog is authoritative. IDR checkout needs an
approved source/rate/time/TTL quote. No arbitrary rate or recurring promise. Sandbox
credentials absent from V2 env is not proof of absence from the vault; only inspect a
platform billing credential after a provider is actually selected. No real collection,
refund, customer notification, production migration or production deployment.

## Notifications, referral, analytics

Transactional billing events feed a deduplicated outbox. Recheck current account version,
trial deadline, paid status and notification authorization immediately before sending.
Payment cancels trial-ending notices; extension reschedules. Do not reuse auth-code
email templates as billing messages. Sending to real customers remains disabled.

One first qualifying paid-company event drives referral; no trial/admin grant rewards,
unique company qualification, USD 30 configurable snapshot, hold/qualification policy
unapproved, refunds recorded/reversed per approved policy, real payouts disabled.
No referral entry in customer transactions/wallets. Marketing events exclude document
contents, bank details, email tokens and provider secrets. MRR methodology remains
unapproved: show unavailable rather than inventing a number or mixing currencies.

## Acceptance and rollout gates

Keep the user's 22 required native/staging groups as separate evidence rows. Local pure
tests only establish resolver logic. Before any shared staging migration: applicability
against actual schema, fresh backup, separate restore rehearsal and migration on the
restored copy. Never replay existing migration history or restore over live staging.
Then exact source/tree/image hashes, OFF behavior, actual API/native DB/browser evidence,
desktop/mobile RU/EN/ID, rollback image and checkpoint. Provider sandbox acceptance and
email delivery acceptance remain separately BLOCKED until real prerequisites exist.

Current stage B scope is the pure resolver only. Catalog persistence, activation, quota,
route enforcement, UI, provider, admin, lifecycle/referral and full acceptance remain open.
