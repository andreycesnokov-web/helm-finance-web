# A_IMPLEMENTATION_NOTES — Incoming Payments Foundation PR1

Agent A. Design reasoning behind the code, for review. Round 1.

---

## 1. Why a new table above `bank_import_*` and not an extension of it

Migration 021 already gives us `bank_import_batches / _rows / _matches` and
`bank_reconciliations`, with live `/api/bank-import/*` endpoints and an AI suggest cascade.
The temptation was to widen `bank_import_rows` and be done.

I did not, because `bank_import_rows` is shaped as **a line in a parsed file**: it has
`row_index`, `raw`, `batch_id NOT NULL`, `direction`, `balance_after`. A Midtrans settlement
has none of those and does not belong to a file at all. Forcing gateway data into it would
mean either a nullable `batch_id` (destroying the batch invariant) or fake batches per
webhook.

So `incoming_payments` is the **normalized layer above** every source. `bank_import_rows`
stays the file parser and becomes a feeder in Phase 3 — one confirmed credit row produces one
`incoming_payment`, carrying its row id as provenance. Nothing in 021 was touched.

## 2. Why the table is provider-agnostic in the schema, not just in the docs

`provider` is free TEXT, not an enum or a CHECK list. Adding DOKU, Xendit, HitPay, Duitku,
iPaymu or tomorrow's Indonesian gateway must not require a migration — that is the difference
between a payments layer and a Midtrans integration. `KNOWN_PROVIDERS` in the lib is a
normalisation aid (case folding), never an allow-list.

`source_type` **is** a closed CHECK, because it describes *how the data reached us*, which is
a property of our own architecture and changes only when we build something.

The two `future_*` source types exist in the DB CHECK but are refused by the API. The column
can express a direct bank feed; no code may pretend to have one. That keeps NO-GO #1 true at
the boundary that matters.

## 3. The three-way distinction the money columns encode

- `0` — confirmed: the gateway charged nothing.
- `NULL` — unknown: we have not been told the fee yet.
- absent from the request — treated as `0`.

This matters because coercing unknown to `0` silently asserts "no fee was charged", which
inflates net and, downstream, revenue. The DB CHECK therefore skips validation when any
component is NULL: there is nothing to verify against, and refusing the row would force
callers to invent a number.

When everything IS known, the arithmetic is enforced hard, in the DB, and a contradicting
`net_amount` from a client is a 400 rather than a silent overwrite. That is D22 rule #2 and
NO-GO #3 turned into a constraint.

## 4. The COALESCE in the unique index is not cosmetic

```sql
UNIQUE (business_id, source_type, COALESCE(provider, ''), idempotency_key)
```

Postgres treats NULLs as distinct in a unique index. A plain four-column UNIQUE would allow
**unlimited** rows with the same key whenever `provider IS NULL` — which is exactly the
manual-entry case, the only source PR1 can actually produce today. The bug would have been
invisible until someone double-clicked Save. There is a dedicated test
(`a NULL provider still deduplicates — the COALESCE index case`).

## 5. Why `matched` is unreachable from the API

Both `status` and `reconciliation_status` contain a `matched` value (the brief specified
both). PR1 performs no matching. If a client could set `status = 'matched'`, the table would
carry rows claiming a reconciliation with `linked_transaction_id IS NULL` — a lie that later
reporting would happily read.

So: `CREATABLE_STATUSES = [draft, unmatched]`, `CLIENT_SETTABLE_STATUSES` adds only
`reviewed`/`rejected`, `reconciliation_status` is derived server-side, and a supplied
`linked_*_id` is a 400 instead of being ignored. The only way to reach `matched` will be the
reconciliation PR that writes the link in the same operation.

## 6. 404 vs 403 on another business's payment

Fetching a payment id belonging to another workspace returns **404**, because the query is
filtered by `business_id` — the row is simply not found. A 403 would confirm the id exists,
turning the endpoint into a cross-tenant existence oracle. Creating *for* another business is
still a 403, because there the workspace itself is the thing being refused and the resolver
already answers that way.

## 7. Column projection is modelled in the test fake

The fake Supabase in `notificationGrantsApi.test.js` ignores `.select(cols)`. I extended mine
to actually project, so the assertion "raw_provider_payload is absent from list responses"
can fail. Without that the test passes vacuously no matter what the route does. Worth
back-porting to the shared fake if a third API test appears.

## 8. What I deliberately did NOT build

- **No `counterparty_id`.** `counterparties` is still `user_id`-scoped (migration 002
  comment: "Phase 1: user-scoped. Future: business_id-scoped"). Adding the FK now bakes in a
  tenancy bug. Payer stays free text until Q4 of the spec is answered.
- **No invoice dependency.** `invoices` (041) exists in migrations but the brief says not to
  depend on it; matching will target `debts` (receivables) and `transactions`.
- **No UI.** Backend and tests only, per the brief's ordering.
- **No auto-transaction, no revenue booking, no tax inference, no export.** Those are Phases
  4+ and each needs human approval semantics that do not exist yet.
- **No changes to `wallets`.** Tempting to make `business_id` NOT NULL for a composite FK;
  that is a migration against a table every financial route uses, which is not a foundation
  PR's risk to take. Raised as Q3.

## 9. Where the code sits

Routes went immediately **before** the `/api/bank-import/batches` block in `server/index.js`,
keeping the ingestion domain together rather than appending to the end of a 610KB file. The
`require('./lib/incomingPayments')` is local to that block, matching how `docIntake` /
`pkpStatus` are required mid-file elsewhere in this codebase.
