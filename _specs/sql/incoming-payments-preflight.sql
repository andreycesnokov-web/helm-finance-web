-- ============================================================================
-- Incoming Payments — PREFLIGHT (read-only, run BEFORE the apply script)
--
-- Every query here is a SELECT. Nothing is created, altered or written.
-- Run all six blocks and record the results. Any ❌ is a STOP.
--
-- Note: this project does NOT track migrations in the database (there is no
-- schema_migrations table), so migration state is established by object
-- existence via to_regclass, the same convention the R001 runbook uses.
-- ============================================================================

-- ── 1. Migration state: are the target objects already present? ─────────────
-- Expected on a FIRST apply: both NULL.
-- If both are non-null the unit is already applied — re-running is safe
-- (fully idempotent) but you should understand why before proceeding.
-- ❌ STOP if EXACTLY ONE is non-null: that is a partially-applied unit.
SELECT
  to_regclass('public.incoming_payments')                  AS incoming_payments_048,
  to_regclass('public.incoming_payment_match_candidates')  AS candidates_050;

-- ── 2. Dependency tables the foreign keys require ───────────────────────────
-- ❌ STOP if ANY is NULL. The apply will fail on the missing FK target.
-- bank_import_* come from migration 021; if they are absent, 021 was never
-- applied to this database and 049 CANNOT apply.
SELECT
  to_regclass('public.businesses')          AS businesses,          -- 048, 050
  to_regclass('public.wallets')             AS wallets,             -- 048
  to_regclass('public.transactions')        AS transactions,        -- 048, 050
  to_regclass('public.debts')               AS debts,               -- 048, 050
  to_regclass('public.bank_import_batches') AS bank_import_batches, -- 049 (migration 021)
  to_regclass('public.bank_import_rows')    AS bank_import_rows;    -- 049 (migration 021)

-- ── 3. Foreign-key column TYPES must match the new columns ──────────────────
-- 048 declares linked_transaction_id/linked_debt_id as BIGINT and
-- business_id/wallet_id as UUID. A type mismatch fails the apply.
-- ❌ STOP unless: businesses.id=uuid, wallets.id=uuid, transactions.id=bigint,
--    debts.id=bigint, bank_import_batches.id=uuid, bank_import_rows.id=uuid
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'id'
  AND table_name IN ('businesses','wallets','transactions','debts',
                     'bank_import_batches','bank_import_rows')
ORDER BY table_name;

-- ── 4. gen_random_uuid() must be available ──────────────────────────────────
-- Both new tables default their primary key to gen_random_uuid().
-- Built into Postgres 13+; on older versions pgcrypto must be enabled.
-- ❌ STOP if this errors.
SELECT gen_random_uuid() AS uuid_generation_works;

-- ── 5. Baseline row counts — the "nothing changed" evidence ─────────────────
-- Record these numbers. Postflight re-runs the identical query and the two
-- results MUST be equal: the apply is schema-only and must not touch a single
-- existing row.
SELECT
  (SELECT count(*) FROM businesses)          AS businesses_rows,
  (SELECT count(*) FROM wallets)             AS wallets_rows,
  (SELECT count(*) FROM transactions)        AS transactions_rows,
  (SELECT count(*) FROM debts)               AS debts_rows,
  (SELECT count(*) FROM bank_import_batches) AS bank_import_batches_rows,
  (SELECT count(*) FROM bank_import_rows)    AS bank_import_rows_rows;

-- ── 6. Name collisions ──────────────────────────────────────────────────────
-- The apply creates these indexes, functions and triggers. Nothing unrelated
-- should already own these names.
-- Expected on a first apply: 0 rows from each.
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'incoming_payments_idempotency_uidx','incoming_payments_provider_txn_uidx',
    'incoming_payments_business_idx','incoming_payments_status_idx',
    'incoming_payments_reconciliation_idx','incoming_payments_provider_idx',
    'incoming_payments_bank_row_uidx','incoming_payments_bank_batch_idx',
    'incoming_payment_candidates_uidx','incoming_payment_candidates_payment_idx',
    'incoming_payment_candidates_business_idx');

SELECT proname FROM pg_proc
WHERE proname IN ('fn_incoming_payments_updated_at','fn_incoming_payment_candidate_guard');

SELECT tgname FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('trg_incoming_payments_updated_at','trg_incoming_payment_candidate_guard');
