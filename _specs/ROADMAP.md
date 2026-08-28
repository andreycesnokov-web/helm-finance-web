# Roadmap - CFO AI / Helm Finance

Last updated: 2026-08-28.

This file lists the next practical work, not every idea.

## Next 5 Tasks

1. Personal -> Business Activation MVP
   - Make a new email user start in Personal Account, understand separation, create/join/open a Business Workspace safely.

2. Entitlements / Pricing Foundation
   - Free identity, trial/product plan gate, Telegram add-on, Business Pro / AI Accountant entitlement scaffolding.

3. Personal AI CFO Insights After 5-10 Transactions
   - Personal-only insights based on real transaction history, no business data.

4. Business Pro Value Dashboard
   - Business premium dashboard that explains value: cash, runway, tax/compliance, approvals, AI Accountant status.

5. Telegram Paid Integration Design
   - Design only first: roles, paid gate, notifications, employee expense capture, CEO/CFO approvals, identity linking.

## Platform Admin Console

- Foundation shipped on branch `feature/admin-dashboard`: `/admin/dashboard` +
  `GET /api/admin/dashboard` (read-only counts, identity risks, activity, system health).
- Deliberately built INSIDE the existing app. **No separate backend app for now.**
- Next increments (not in the foundation): per-business activity/inactivity metrics,
  drilldown from risk rows, entitlements/billing once that layer exists.
- Later direction (not now): dedicated `admin.cfo-ai.site` console + analytics warehouse.

## Payment & Bank Ingestion Layer

Status: **Phases 1–4 BUILT, NOT ENABLED (2026-08-28).** Migrations 048/049/050 + flag-gated
routes exist on `feature/incoming-payments-foundation` behind `INCOMING_PAYMENTS_ENABLED`
(default OFF); no migration is applied to production and nothing is deployed. Phase 5
(direct bank APIs) remains spec only and unstarted.

**Rollout prerequisite:** 048, 049 and 050 are one unit. The routes select columns added by
049 and the review queue reads the table added by 050, so the flag must not be enabled until
all three are applied.

Spec: `_specs/incoming-payments-bank-gateway-ingestion.md` · Decision: [[D22]].

The AI Accountant differentiator: ingest the money that actually arrived (payment gateways
and bank accounts), match it where possible, separate gross/fee/net, draft the accounting
and tax treatment, and hand the accountant a reviewable evidence package.

Not greenfield — migration 021 (`bank_import_batches` / `_rows` / `_matches`,
`bank_reconciliations`) and the live `/api/bank-import/*` endpoints already exist, and
`wallets.type` already supports `payment_gateway`. `incoming_payments` normalizes **above**
that pipeline; it does not replace it.

Target workspaces: Helm Care Pay `HF-BIZ-000004` (Midtrans) and Helm Care Indonesia
`HF-BIZ-000002` (bank transfers). Never mixed.

Phases:

1. **Incoming Payments Foundation** — ✅ built (not enabled). Migration 048, one additive
   table, provider-agnostic source types, gross/fee/net separated, idempotency enforced by a
   unique index, ledger-inert by construction. Manual + manual-gateway-import sources are
   accepted; the two `future_*` sources are refused by the API. No matching engine, no UI.
2. **Gateway settlement import** — ✅ built (not enabled). Provider-agnostic manual import:
   midtrans, doku, xendit, hitpay, duitku, ipaymu, or an unrecognised gateway, all through
   one endpoint with no per-provider code path. A *direct* gateway feed is still **blocked on
   Q1/Q2** (integration mode + a real settlement sample) and was deliberately not attempted.
3. **Bank Statement Import v0** — ✅ built (not enabled). Confirmed credit rows from the
   existing bank-import flow produce incoming payments, with batch/row provenance and one
   payment per statement line, on both confirm routes. Still **blocked on Q3** for real use
   (which formats the banks actually export; PDF-only would change the parser, not this
   bridge).
4. **Reconciliation Engine** — 🟡 candidate half built (not enabled): deterministic scoring
   against receivables and income transactions with stated reasons, human accept/reject, and
   an unmatched-receipt review queue. Accepting links the payment only — it settles no debt
   and books no revenue. Still to come: settlement↔bank-credit pairing, draft tax treatment,
   evidence packages, explainable period readiness.
5. **Direct Bank APIs** — later, only after 1–4 are stable on real data, and only with its
   own security spec (credentials, consent, revocation, audit).

Hard rules carried from [[D22]]: cash evidence ≠ revenue · gross/fee/net always separate ·
net settlement is never booked as gross revenue · exactly one workspace per payment · AI
drafts, humans approve · no auto-submit · no duplicates from retried webhooks or re-uploads
· no direct bank API in v0.

Open questions blocking work: Midtrans integration mode · settlement report format · bank
export formats · receiving accounts/wallets (plus the `counterparties` business-scoping
gap) · tax treatment per revenue type · accountant export format · required evidence per
payment type. See §11 of the spec.

## Current Strategic Direction

Email account -> Personal Account -> Personal Finance -> optional Business Workspace -> optional Telegram paid integration.

CFO AI / Helm Finance OS is positioning as an **AI Accountant / Finance OS**. The major
differentiator is ingesting incoming payments from payment gateways and banks and preparing
accounting/tax evidence packages a real accountant can review — see the Payment & Bank
Ingestion Layer above and [[D22]].

## Current Near-Term Focus

- Stabilize email-to-business access.
- Keep Personal and Business data boundaries strict.
- Improve Business Workspace value for Helm Care testing.
- Keep Telegram useful but scoped: employee submission + company selection + owner/CFO notification.

## Not Next

- Full payment processing (taking payments / disbursing money). Note: **ingesting** incoming
  payments as evidence is now in scope — see Payment & Bank Ingestion Layer. Processing is not.
- Direct bank APIs / open banking (Payment & Bank Ingestion Phase 5, not before).
- Personal-to-Business bridge implementation.
- Telegram identity cutover.
- Professional Partner Portal implementation.
- Reset/R001 work.

