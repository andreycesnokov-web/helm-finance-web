# 07 — Data integrity and security controls (proposal)

| Control | Design | Builds on |
|---|---|---|
| Company isolation | every GL table has `business_id NOT NULL`; triggers check that entry, lines, accounts, periods, rate usage and every subledger reference share it (same pattern as `fn_iso_*`, `fn_transaction_classification_guard`) | existing tenant triggers |
| RLS and grants | RLS enabled on every new table **and** `REVOKE ALL … FROM PUBLIC, anon, authenticated`; functions `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`; a postflight check in `migrate-v2.mjs` fails the migration if any grant leaks | pattern of migrations 20261024120000 / 20261024150000 |
| Server authorization | `/api/accounting/*` routes: auth → `requireBusiness` → role (04 §3) → plan entitlement → request key → RPC; classified in `billingRoutes.js` so the route-coverage test passes | existing route order |
| Cross-company leak prevention | the RPC takes `p_business` from the resolved membership, never from the body; foreign ids return 404; cross-tenant tests for every route and RPC | businessIsolation, teamIsolation tests |
| Atomic posting | one function call posts the whole entry; deferred balance trigger | — |
| Idempotency | outbox primary key; partial unique index per source event version; `request_key` + `payload_sha256` for manual actions | `financial_write_requests` pattern |
| No duplicates on retry | replay returns the stored entry; a different payload under the same key is refused | `debt_payment_idempotency` |
| Source ↔ document ↔ posting links | lines reference the transaction / bill / run / asset / treatment / document; entry references the source event and version | document links, operation-documents snapshot |
| Immutable history | posted entries/lines: UPDATE/DELETE refused by trigger; `audit_events` append-only (already) | `audit_events_append_only` |
| Full audit trail | every journal, period, account and mapping action writes `audit_events` in the same transaction; the action fails if the audit fails | classification route pattern |
| Period locking | posting checks the period row under `FOR SHARE`; close takes `FOR UPDATE`; closed = no inserts | — |
| Controlled reopening | owner/cfo with a reason; audited; snapshot of the earlier close kept; accountant notified | — |
| Reversal and adjustment | reversal = mirror entry with `reversal_of` (unique); adjustments are `adjustment` entries with reason and approver | — |
| Decimal precision | `numeric(20,2)` functional, `numeric(24,6)` transaction, `numeric(38,18)` rates; JS only through BigInt string helpers; no `Number()` on money in accounting code (lint rule) | `transactionClass.js` |
| FX snapshots | every rate used is an immutable `fx_rate_snapshots` row with source and date | `fxProvider.js` |
| Race conditions | per-company GL advisory lock (namespace 7071) + period row locks; cash writers keep lock 7070; race tests like `postgresFinancialWriterRaces` | existing race harness |
| AI and OCR boundary | AI/OCR may create **draft** entries or mapping suggestions (`created_by_kind = 'ai'`), never submit, approve or post; system postings come only from confirmed source rows | core invariant "AI explains, engines calculate" |
| Backups and recovery | before each GL migration: in-DB backup schema with md5 manifest + restore rehearsal (the 24 Oct procedure); GL tables are additive and droppable by `_down.sql` while in shadow; after go-live, the GL is rebuildable from sources + manual entries (manual/adjustment entries are the only non-derivable data and are exported with every close) | 24 Oct backup procedure |

## Existing gaps to fix before live posting (from 01)

1. **I-7** — revoke `EXECUTE` on `rpc_reset_business_financial` and the five `rpc_document_*` functions from
   `anon`/`authenticated`, and revoke table grants from `anon`/`authenticated` on financial tables (defence in depth;
   RLS with 0 policies currently blocks them). Disable the financial reset once a company has a closed period.
2. **I-5** — `PATCH /api/transactions/:id` must write `audit_events` (before/after) inside the RPC; the GL engine
   needs the source version to reverse and re-post.
3. **I-6** — funding record + schedule in one RPC.
4. **I-11** — add `transactions.wallet_id` FK (NOT VALID, then VALIDATE) and a CHECK on `type`, after verifying prod
   has no violating rows; stop matching wallets by name for new rows.
5. **I-12** — DB check (or nightly reconciliation) `debts.paid_amount` = Σ linked payment rows.
6. **I-1** — confirmed category group must win over transfer keywords for rows without a `transfer_id` (the GL
   posting rules never use keywords, but Pulse/AI CFO should not contradict the ledger).
