-- ============================================================================
-- Incoming Payments — POSTFLIGHT (read-only, run AFTER the apply script)
--
-- Every query is a SELECT. Run all eight blocks. EVERY check must pass before
-- INCOMING_PAYMENTS_ENABLED is even considered.
-- ============================================================================

-- ── 1. Both tables exist ────────────────────────────────────────────────────
-- ✅ Both non-null.
SELECT
  to_regclass('public.incoming_payments')                 AS incoming_payments,
  to_regclass('public.incoming_payment_match_candidates') AS match_candidates;

-- ── 2. incoming_payments has all 34 columns ─────────────────────────────────
-- ✅ column_count = 34. Below 34 means 049 did not apply and the API will fail:
--    the routes select bank_import_batch_id / bank_import_row_id explicitly.
SELECT count(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'incoming_payments';

-- ✅ Both rows returned — these two are the 049 columns specifically.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'incoming_payments'
  AND column_name IN ('bank_import_batch_id','bank_import_row_id')
ORDER BY column_name;

-- ── 3. All 13 indexes exist ─────────────────────────────────────────────────
-- ✅ index_count = 13 (11 named below + the 2 primary keys).
-- The three UNIQUE ones are the duplicate-money guards; without them a retried
-- webhook or a re-uploaded statement can double-count revenue.
SELECT count(*) AS index_count
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('incoming_payments','incoming_payment_match_candidates');

-- ✅ Exactly these 4 rows, all UNIQUE.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('incoming_payments_idempotency_uidx',
                    'incoming_payments_provider_txn_uidx',
                    'incoming_payments_bank_row_uidx',
                    'incoming_payment_candidates_uidx')
ORDER BY indexname;

-- ── 4. Business-logic CHECK constraints exist ───────────────────────────────
-- ✅ All 4 present. These are the accounting guards:
--    net_consistent   — net must equal gross − fee − withholding when all known
--    review_stamp     — a reviewer and a review time move together
--    one_target       — a candidate points at exactly one target
--    decision_stamp   — a decided candidate carries who decided and when
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('incoming_payments_net_consistent',
                  'incoming_payments_review_stamp',
                  'incoming_payment_candidates_one_target',
                  'incoming_payment_candidates_decision_stamp')
ORDER BY conname;

-- ── 5. Foreign keys point at the right tables ───────────────────────────────
-- ✅ 10 rows — 6 on incoming_payments (business_id, wallet_id,
--    linked_transaction_id, linked_debt_id, plus bank_import_batch_id and
--    bank_import_row_id from 049) and 4 on incoming_payment_match_candidates.
--    Fewer than 10 means part of the unit did not apply.
--    Note the delete rules: business_id is RESTRICT (a workspace with
--    receipts cannot be hard-deleted — receipts are evidence), while the
--    ledger/import links are SET NULL (deleting a transaction or an import
--    batch must never destroy the evidence that money arrived).
SELECT tc.table_name, kcu.column_name,
       ccu.table_name AS references_table, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('incoming_payments','incoming_payment_match_candidates')
ORDER BY tc.table_name, kcu.column_name;

-- ── 6. Triggers and their functions exist ───────────────────────────────────
-- ✅ 2 triggers, 2 functions.
-- trg_incoming_payment_candidate_guard is the cross-company guard: it refuses a
-- candidate whose target debt/transaction belongs to another business. Its
-- absence would let one company's money be matched to another's receivable.
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('trg_incoming_payments_updated_at','trg_incoming_payment_candidate_guard')
ORDER BY tgname;

SELECT proname FROM pg_proc
WHERE proname IN ('fn_incoming_payments_updated_at','fn_incoming_payment_candidate_guard')
ORDER BY proname;

-- ── 7. Both new tables are EMPTY ────────────────────────────────────────────
-- ✅ Both 0. The apply creates schema only; it inserts nothing and backfills
--    nothing. Anything other than 0 means something wrote data unexpectedly.
SELECT
  (SELECT count(*) FROM incoming_payments)                 AS incoming_payments_rows,
  (SELECT count(*) FROM incoming_payment_match_candidates) AS candidate_rows;

-- ── 8. No existing data changed ─────────────────────────────────────────────
-- ✅ Identical to the preflight block 5 numbers, row for row.
-- This is the evidence that the apply was schema-only.
SELECT
  (SELECT count(*) FROM businesses)          AS businesses_rows,
  (SELECT count(*) FROM wallets)             AS wallets_rows,
  (SELECT count(*) FROM transactions)        AS transactions_rows,
  (SELECT count(*) FROM debts)               AS debts_rows,
  (SELECT count(*) FROM bank_import_batches) AS bank_import_batches_rows,
  (SELECT count(*) FROM bank_import_rows)    AS bank_import_rows_rows;
