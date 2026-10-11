# Atomic business balance: local verification and release runbook

This patch is based on PR #156 (`23cffdcc46785f02c4efba70fa9b69a0b69b3a72`).
Apply the complete patch to that base. Do not apply only the JavaScript changes.
No production operation is authorized by this document.

## Reproduce on an isolated database

Use Node 22 (`.nvmrc`) and PostgreSQL 16. `pg` is already a development dependency.
From a clean checkout with this patch applied:

```bash
nvm install 22
nvm use 22
npm ci
docker run --name cfo-balance-pg --rm -d \
  -e POSTGRES_PASSWORD=local-only \
  -p 127.0.0.1:55439:5432 postgres:16
docker exec cfo-balance-pg pg_isready -U postgres
BALANCE_PG_URL=postgresql://postgres:local-only@127.0.0.1:55439/postgres \
  node --test tests/integration/postgresBusinessBalance.test.js
docker stop cfo-balance-pg
```

If `pg_isready` reports startup, repeat that check before running tests.
An existing disposable, local PostgreSQL can replace Docker. The administrative
test user needs permission to create/drop a database and create test roles.
Do not use a production connection string, even through a local tunnel.
The test rejects non-loopback hosts, creates a uniquely named synthetic database,
loads its minimal fixture and original 066/067, reproduces both baseline bugs,
then applies 070 twice. It drops the database after the run. Test role definitions
can remain in the disposable cluster; they contain no credentials or real data.

Concurrency tests use independent PostgreSQL connections and a third observer
checking `pg_blocking_pids`, before committing the first transaction. The HTTP
test starts the actual Express server with a PostgreSQL-backed Supabase test
adapter. It does not run a PostgREST server or reproduce Supabase RLS policies.

Related regression command:

```bash
node --test \
  tests/walletLedger.test.js \
  tests/transactionClass.test.js \
  tests/integration/debtPaymentCurrencyGuard.test.js \
  tests/integration/debtPaymentIdempotency.test.js \
  tests/integration/debtPaymentReliability.test.js \
  tests/integration/walletTransfersTask30.test.js \
  tests/integration/debtPatchNullText.test.js \
  tests/integration/businessResolver.test.js \
  tests/integration/businessIsolation.test.js \
  tests/integration/personalAccount.test.js
node tests/unreconciledTxWorkbench.test.mjs
```

Check the actual filenames in your checkout if running a different base.
The currency script has three pre-existing failing checks (6, 9, 12), reproduced
on main; it is not a green overall regression suite. The workbench browser test
also requires its configured Chrome executable. Missing Chrome is a verification
gap, not a passing UI test. No frontend code is changed by this patch.

## Cash contract and exceptions

Balance is all-time native-currency ledger cash: income positive, expense/payroll
negative, correction signed. `amount_original` falls back to `amount_idr` only
for legacy missing native amounts. Wallet matching uses explicit `wallet_id` or
same-business name-addressed rows without a wallet id. No owner-wide orphan rows
are added to company balance. Date is not a running chronological cash limit.

Ordinary non-credit wallet changes are refused if their statement-level cash
delta is negative and the resulting balance is negative. Existing negative cash
therefore permits improvement and neutral edits. Credit/overdraft wallet types
retain their existing exemption. Historical import INSERTs with validated bank
row provenance, initial opening INSERTs on an empty wallet and correction INSERTs
retain separate policies. A source string alone is not an opening exemption.

070 uses an advisory transaction lock `(7070, 1)` shared by ALL ledger writes,
before tuple locks, followed by ordered wallet locks and an AFTER STATEMENT
net check. This intentionally serializes different businesses and also Personal
ledger writes; Personal cash restrictions stay unchanged, but timing and the
READ COMMITTED requirement change. Performance has not been benchmarked.
REPEATABLE READ and SERIALIZABLE ledger writes fail closed.

The captured deployed schema uses `numeric(18,2)` native/IDR ledger amounts.
RPCs reject raw native amounts that cannot be stored exactly; SQL cash uses exact
NUMERIC with no tolerance. Existing debt settlement tolerance of 0.01 remains
unchanged and is not used to allow negative wallet cash.

## Preflight before a separately authorized release

Use read-only inspection on the intended environment, under its normal process:

```sql
-- This must return no rows. Do not delete duplicates to make migration pass.
SELECT business_id, transfer_id, type, count(*)
FROM public.transactions
WHERE transfer_id IS NOT NULL AND type IN ('expense','income')
GROUP BY business_id, transfer_id, type HAVING count(*) > 1;

-- Inspect the actual schema precision, not an old migration assumption.
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
  ('transactions','debts','payroll_payments','payroll_payment_items','bank_import_rows')
ORDER BY table_name, ordinal_position;

-- Investigate; no automatic relinking/backfill is included.
SELECT t.id, t.business_id, t.wallet_id, t.currency_original, w.currency
FROM public.transactions t LEFT JOIN public.wallets w ON w.id=t.wallet_id
WHERE t.wallet_id IS NOT NULL AND
  (w.id IS NULL OR w.business_id IS DISTINCT FROM t.business_id OR
   upper(w.currency) IS DISTINCT FROM upper(t.currency_original));
```

Review existing triggers and direct SQL writers, lock duration, wallet metadata
updates, table/FK/RLS definitions and service-role grants on a Supabase-like
staging database. In particular, disabled funding/bridge paths can lock related
records before writing the ledger and need lock-order review before activation.
Their deadlock would roll back, but availability was not tested here.
The migration's duplicate-leg index intentionally fails rather than repairing
historical duplicates. Schema-wide historical cleanup is outside this patch.

## Release order and compatibility

1. Review this patch and preflight; benchmark the coarse gate.
2. Pause business financial writes for the schema/backend transition.
3. Apply new migration 070 with the established migration mechanism. Existing
   066/067 files are not edited. Review the reserved 069 numbering with #148.
4. Deploy the matching backend. Verify service-role EXECUTE, PostgREST schema
   cache and smoke tests before resuming writes.
5. No UI release is required for balance protection. A later UI may send
   `expected_version` to prevent saving an old draft after a completed edit.

The new backend explicitly requires guarded debt/transfer RPC names and new
PATCH/batch/payroll RPCs. Missing RPC returns 503 without direct-write fallback.
Old RPC names are updated by 070 for old-client compatibility. However, the old
backend does not supply the new import/opening provenance. An old backend during
the transition can refuse otherwise permitted historical imports or negative
opening balances; do not advertise a zero-downtime schema-only rollout.

V2 and the previous form-isolation patch are not dependencies. #148 is not
merged here. Its atomic confirm RPC must supply and validate the new import
provenance in a separate compatibility change before combined release; otherwise
historical imports that lower cash below zero can be incorrectly rejected.

## Rollback

Application rollback does not undo 070. Keep the SQL protection and use a
compatible backend, or keep writes paused while preparing a separately reviewed
rollback. Returning to the old SHA alone can break import/opening compatibility
and error handling. Never introduce an unguarded fallback to reopen writes.

Database rollback is a separate operation: pause writes, back up the ledger and
linked data, review how to restore function/trigger definitions and reconcile new
links/version columns with the chosen application. New columns may contain live
data and must not be dropped blindly. Removing guards restores the proven race;
it is not a safe routine rollback. No destructive down-migration is supplied.

## Limits of the guarantee

The proof concerns native wallet balance and atomic rows in the covered RPCs.
It is not a complete payroll/withholding/FX redesign. Existing payroll currency
interpretation and withholding settlement semantics remain. Plain manual expense
and payroll requests without an existing key do not gain idempotency. Historical
unkeyed debt payments lack a complete durable relation: `Payment:` descriptions
are conservatively protected and a metadata edit preserves that marker; unrelated
manual notes beginning with that prefix can require explicit review. Unknown old
payments without any marker/link cannot be identified automatically.

Old clients without `expected_version` are protected against overlapping server
read/modify/write requests. A draft submitted after another edit has completed
needs an explicit client version to be recognized as stale. Trusted service-role
or superuser code that disables triggers, modifies wallet metadata concurrently
or changes SQL definitions is outside the tested API guarantee.
