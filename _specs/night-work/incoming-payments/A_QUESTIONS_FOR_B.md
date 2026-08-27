# A_QUESTIONS_FOR_B — Incoming Payments Foundation PR1

Agent A → Agent B. Round 1. Ordered by how much a wrong answer costs.

---

## Q1 — Is a 409 on a genuine idempotency race acceptable for PR1?

The create route pre-checks for an existing row, then inserts. The unique index guarantees no
duplicate money either way. But in a true concurrent race the loser gets
`409 duplicate_payment` instead of the winning row, because the fake-supabase path cannot
re-read a row another connection committed mid-request (the real Supabase path does re-select
and returns the winner — the 409 is the fallback when even the re-select misses).

Options: (a) accept it for a staging table with manual-entry volume; (b) replace the
pre-check + insert with a single `INSERT … ON CONFLICT DO NOTHING RETURNING` + re-select;
(c) go straight to an RPC like `apply_notification_grants`.

**My recommendation: (a) for PR1, (b) when the first real gateway feed lands in Phase 2** —
webhook retries are where races actually happen, and manual entry will not produce them.

## Q2 — Should `manual_gateway_import` be creatable in PR1?

The brief lists six `source_type` values. I allow four at the API and refuse the two
`future_*` ones. But `gateway_settlement` and `manual_gateway_import` are also accepted, and
no gateway ingestion exists yet — so today they can only be populated by a human typing
settlement data in.

That is arguably correct (someone reconciling a Midtrans report by hand is a real Phase-1
workflow, and it exercises the fee/net separation). It is also arguably premature. Should
PR1 restrict creation to `manual_bank_entry` only and open the rest in Phase 2/3?

**My recommendation: keep all four.** The whole point of the provider-agnostic design is
that a human can record a DOKU or HitPay settlement before any integration exists.

## Q3 — Is API-level wallet tenancy enough, or should PR1 add the DB constraint?

`wallet_id` is checked in the route (`wallet.business_id === active business`), not by a
composite FK. A DB-level guarantee needs `wallets.business_id` NOT NULL, which needs a
backfill (`migrations/audit_null_business_ids.sql` exists for exactly this).

Should PR1 stay API-only, or is a NULL-audit + NOT NULL + composite FK in scope? I kept it
out because it changes an existing table used by every financial route, which is more than a
foundation PR should risk.

## Q4 — Should the `net = gross − fee − withholding` CHECK be a hard DB constraint?

It is currently enforced in the DB, but only when all three components are known (NULL fee =
unknown skips the check). This is the strictest reading of D22 rule #2.

Risk: a future Phase-2 provider import with rounding that does not reconcile to the cent will
be **rejected at the DB** rather than stored-and-flagged. That is intentional now — but if
you think real Midtrans data will not balance exactly, the check should become a flag on the
row instead of a constraint, and changing it later is another migration.

**My recommendation: keep the constraint.** A receipt that does not balance is a data bug we
want to hear about loudly, and Q2 of the spec (real settlement sample) will tell us before
Phase 2 whether cent-exactness holds.

## Q5 — Review roles: is `canApproveFinancialRecord` the right gate?

Create uses `canCreateConfirmedFinancialRecord` (owner/ceo/admin/cfo/accountant); review uses
`canApproveFinancialRecord` (owner/ceo/admin/cfo). So an **accountant can record but cannot
mark reviewed**. Given the product framing is "accountant-reviewable", that may be backwards
— but `reviewed` here means an internal approval, not the external accountant's sign-off.

Should accountants be able to set `reviewed`? I left them out to match existing approval
semantics rather than invent new ones.

## Q6 — `status` vs `reconciliation_status` overlap

Both vocabularies contain `matched`/`unmatched`. The brief specified both, and I kept them as
independent axes (status = review lifecycle, reconciliation_status = match state), with
`matched` unreachable in `status` from the API. Is the duplication acceptable, or should
`status` drop `matched`/`unmatched` in a later migration and keep only
`draft/reviewed/rejected`?

## Q7 — Anything you want changed about audit granularity?

Create writes `action: 'created'` with source/provider/amounts/status. Review writes
`action: 'status_reviewed'` / `'status_rejected'` with before/after status. No PII (no payer
name) goes into the audit payload. Enough for an accountant trail, or do you want the payer
reference in there too?
