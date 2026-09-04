# External Counterparty Sync V1 — design note

**Status:** design only. Nothing in this note is built.
**Written:** 2026-09-04, alongside Counterparty Intelligence V1.

## Why this is a note and not code

The brief asked whether CFO AI could expose scoped API keys so a company's existing
CRM/ERP can push counterparties in, and said explicitly: do not invent a half-secure
API key system.

**There is no API-key infrastructure in this codebase today.** The nearest thing is
migrations 051/052 (`payment_provider_connections`, `payment_provider_credentials`),
which is a *credential vault for outbound provider connections* — CFO AI storing
someone else's secret. That is the opposite direction from an inbound API key, where
CFO AI issues a credential and must authenticate, scope, rate-limit, rotate, revoke
and audit it.

Reusing the vault for inbound keys would be a category error. So this stays a design.

## What already exists and can be reused

| need | exists today |
|---|---|
| business scoping | `requireBusiness` / `bizOrFilter`, used by every financial route |
| audit trail | `recordAudit` → `audit_events`, plus `document_audit` for documents |
| entitlement gating | `hasDocumentsAccess`, plan/addon lookups |
| idempotent upsert key | proposed `(business_id, source_system, external_id)` unique index in the 055 draft |
| role model | `counterparties.type`, extended by the 055 draft |

Only the key issuance, authentication and rate-limiting layer is missing.

## Proposed shape

### Key model

```
api_keys
  id, business_id, name,
  key_prefix          -- shown in the UI, e.g. cfo_live_a1b2
  key_hash            -- Argon2id or scrypt. The secret is shown ONCE at creation.
  scopes              TEXT[]
  created_by_user_id, created_at,
  last_used_at, expires_at,
  revoked_at, revoked_by_user_id
```

The full key is never stored and never recoverable — only its hash. A lost key is
rotated, not retrieved. `key_prefix` exists so a user can identify a key in a list
without the secret being displayable.

### Scopes

```
counterparties:read    counterparties:write
documents:read         transactions:read
invoices:read          invoices:write
```

Least privilege by default: a CRM sync that only pushes counterparties needs
`counterparties:read` + `counterparties:write` and nothing else. A key with no scope
grants nothing rather than everything.

### Authentication

`Authorization: Bearer cfo_live_…` on a dedicated `/api/v1/*` surface, resolved by
middleware that maps key → business_id → scopes. **The key determines the business.**
A client-supplied `business_id` is ignored exactly as it is on the session routes —
this is the single most important property to preserve, and it is why the external
surface should not simply reuse the session middleware.

### Rate limits

Per key and per business, with a low default. Exceeded → `429` with `Retry-After`.
Bulk import goes through an explicit batch endpoint rather than a burst of singles.

### Idempotent upsert

Counterparties upsert on `(business_id, source_system, external_id)`. Where the
external system has no stable id, fall back in this order — the same order
`counterpartyIntelligence.matchCounterparty` already uses:

1. NPWP
2. bank account number
3. normalised legal name → **possible match only**, never an automatic merge

A name-only collision must return `409` with the candidates, not silently merge two
companies. Merging counterparties is destructive and irreversible in practice.

### Webhooks (outbound)

HMAC-SHA256 over the raw body with a per-endpoint secret, timestamp in the signed
payload, and a short replay window. Signature verification instructions belong in the
docs, not in a header the sender controls.

### Audit

Every external mutation writes an `audit_events` row carrying the key id, so "who
changed this counterparty" answers with a key rather than a person — which is the
honest answer for machine traffic.

## Sequencing

1. **055 migration** (drafted, unapplied) — `source_system` / `external_id` /
   `external_url` / `last_synced_at` land here, so records created manually today can
   be reconciled with an external system later without a second migration.
2. **CSV import** — same upsert and duplicate rules, no new security surface. This is
   the cheapest way to prove the matching rules against real customer data.
3. **API keys** — only once (1) and (2) are in production and the upsert semantics
   have survived contact with real duplicates.

Building (3) first would mean designing an authentication surface around merge rules
that have not yet been tested on real data.

## Explicitly out of scope

OAuth / third-party app authorisation, per-user keys (keys are per business),
customer-managed encryption keys, and any public developer portal.
