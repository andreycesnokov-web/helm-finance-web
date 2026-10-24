# 08 — Migration and backfill strategy (proposal; nothing applied)

**Approach:** add the ledger next to the existing engine, prove it in shadow on synthetic and copied data, then
switch posting on per company. Existing rows are never rewritten; the ledger only adds rows that point at them.

## 1. Accounting start date and opening trial balance

Each company gets an `accounting_start_date` (first day of a month, chosen with the accountant).

- Events **on or after** the start date are posted from their source rows.
- Everything **before** it enters as one `opening` entry built from an accountant-approved opening trial balance
  (assets, liabilities, equity, open AR/AP by bill). Pre-start events are never posted individually, so nothing is
  counted twice.
- The opening bank lines must equal `fn_wallet_ledger_balance` as of the day before the start date (P10 from day
  one). The D4 opening anchors already give a dated starting point per wallet.
- A company without an accountant-approved opening TB can start with "bank only": opening bank lines against
  3-9000 Opening balance equity, which the accountant clears later (and which blocks the first close until zero).

## 2. Ordered migration plan

| # | Migration (additive) | Contents | Rollback |
|---|---|---|---|
| M0 | integrity hardening (AC-0) | revoke anon/authenticated grants on financial tables and functions; audit in `rpc_patch_business_transaction`; atomic funding RPC; `transactions.wallet_id` FK NOT VALID | `_down.sql` restores previous grants/function bodies |
| M1 | ledger schema (AC-1) | `gl_account_templates`, `gl_accounts`, `gl_category_accounts`, `gl_periods`, `gl_journal_entries`, `gl_journal_lines`, `gl_entry_sequences`, `gl_period_snapshots`, `fx_rate_snapshots`, `gl_posting_outbox`; invariant triggers; grants; runner postflight | `_down.sql` drops the empty tables |
| M2 | chart template + provisioning RPCs (AC-2) | `id_pt_default` v1 template rows; `rpc_gl_chart_action` (provision, add, rename, deactivate, map category) | `_down.sql` |
| M3 | posting engine (AC-3) | `rpc_gl_post_event`, rule functions, `rpc_gl_journal_action` | `_down.sql` |
| M4 | outbox hooks (AC-4) | one `INSERT INTO gl_posting_outbox … ON CONFLICT DO NOTHING` added to each cash/register writer RPC | `_down.sql` restores the previous writer bodies (stored verbatim) |
| M5 | periods and close (AC-8) | `rpc_gl_period_action`, snapshot writer | `_down.sql` |
| M6 | live posting switch (AC-10) | writers call `rpc_gl_post_event` in-transaction for companies with `accounting_mode = 'live'` | per-company flag back to `shadow` |

Each migration goes through `scripts/migrate-v2.mjs` (manifest entry, probes, sha256 ledger row, postflight grants
check), the 24 Oct backup + restore rehearsal before production, and owner approval per migration. Never apply
`migrations/20261020163121_payroll_runs_no_cash.sql`.

## 3. Backfill (per company, only after M1–M3 are validated)

1. **Dry run:** build every entry from the start date with the production rule set inside a transaction that is
   rolled back (or into a scratch schema on a copy). Output: entry count, TB, cash-vs-GL per wallet, AR/AP vs
   control, exceptions (suspense lines with their source rows and reasons).
2. **Review:** the accountant approves the opening TB, the category→account mapping and the exception list.
3. **Run:** the same builder writes entries with `entry_kind = 'backfill'` and the normal source keys. The unique
   source-event index makes a second run a no-op; an interrupted run resumes.
4. **Verify:** reconciliation reports (06 §7) all pass or every difference has an accountant note.
5. **Exceptions stay visible:** historical rows without enough evidence post to suspense with a review item; nothing
   is guessed, nothing is hidden.

## 4. Shadow-validation phase (required before live posting)

1. Create accounting entries in an isolated environment: local runner DB and the rcAcceptance synthetic companies,
   then a restored copy of production data (never production itself).
2. Compare every bank/cash control account with `fn_wallet_ledger_balance` per wallet per day.
3. Check trial-balance equality for every company and month.
4. Reconcile bills (AR/AP) and payroll runs against their control accounts.
5. Verify reports against independently calculated examples (the 05 scenarios as golden fixtures, computed by hand).
6. Investigate every discrepancy; live posting stays off until there are none unexplained.

On production, shadow mode means: outbox rows are written by the writers, the poster posts them, reports are
visible only to the owner/accountant labelled "validation", and no management figure changes.

## 5. Guarantees during the transition

- No existing table loses or changes a row; `transactions`, balances, Pulse, Radar and the cash P&L are untouched.
- Cash is never duplicated: the journal has no cash of its own; bank lines reference transaction ids (P10).
- No uncontrolled backfill: per company, dry run first, accountant approval, idempotent run.
- Rollback while in shadow: disable the poster and drop the GL tables with `_down.sql`; writers keep working.
