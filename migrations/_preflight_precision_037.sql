-- ════════════════════════════════════════════════════════════════════════════
-- READ-ONLY PRODUCTION PREFLIGHT for the transactions precision widening
-- (037: amount_original / amount_idr  DECIMAL(18,2) -> NUMERIC(38,18))
--
-- ⚠️  DO NOT RUN ANY DDL FROM THIS FILE. Every statement below is a SELECT.
--     Purpose: measure prod state BEFORE the ALTER so we can size the table
--     rewrite, confirm no value would overflow/truncate, and enumerate every
--     dependent object (views/functions/indexes) the ALTER must not break.
--     Run in Supabase SQL Editor, capture output, paste back for review.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Row count + table size (sizes the rewrite / lock window).
SELECT 'row_count' AS metric, count(*)::text AS value FROM public.transactions
UNION ALL
SELECT 'table_size', pg_size_pretty(pg_total_relation_size('public.transactions'));

-- 2. Current column types (expect numeric scale 2 pre-migration).
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema='public' AND table_name='transactions'
  AND column_name IN ('amount_original','amount_idr','amount_reporting','booked_rate');

-- 3. Largest magnitude actually stored — confirm 38 integer+fraction digits suffice.
--    NUMERIC(38,18) allows 20 integer digits. Flag anything with > 20 integer digits.
SELECT 'max_int_digits_amount_original' AS metric,
       COALESCE(max(length(split_part(trim(leading '-' from amount_original::text),'.',1))),0)::text AS value
FROM public.transactions
UNION ALL
SELECT 'max_int_digits_amount_idr',
       COALESCE(max(length(split_part(trim(leading '-' from amount_idr::text),'.',1))),0)::text
FROM public.transactions
UNION ALL
SELECT 'rows_exceeding_20_int_digits',
       count(*)::text FROM public.transactions
       WHERE length(split_part(trim(leading '-' from amount_original::text),'.',1)) > 20;

-- 4. Max decimal scale currently in use (informational; widening never truncates).
SELECT 'max_scale_amount_original' AS metric,
       COALESCE(max(scale(amount_original)),0)::text AS value FROM public.transactions
UNION ALL
SELECT 'max_scale_amount_idr', COALESCE(max(scale(amount_idr)),0)::text FROM public.transactions;

-- 5. Dependent VIEWS referencing transactions (must survive the ALTER).
SELECT DISTINCT v.table_schema, v.table_name AS dependent_view
FROM information_schema.view_column_usage u
JOIN information_schema.views v ON v.table_name=u.view_name AND v.table_schema=u.view_schema
WHERE u.table_name='transactions' AND u.table_schema='public';

-- 6. Dependent FUNCTIONS / RPCs that read transactions money columns.
SELECT n.nspname, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND pg_get_functiondef(p.oid) ILIKE '%transactions%'
  AND (pg_get_functiondef(p.oid) ILIKE '%amount_original%' OR pg_get_functiondef(p.oid) ILIKE '%amount_idr%')
ORDER BY 1,2;

-- 7. Indexes on transactions (a type change rewrites/​revalidates these).
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='transactions';

-- 8. Generated columns / CHECK constraints touching the money columns.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid='public.transactions'::regclass AND contype='c';

-- ── POST-MIGRATION VERIFICATION (run AFTER the ALTER, same read-only nature) ──
-- Expect numeric_scale = 18 for amount_original/amount_idr; legacy IDR values
-- unchanged; amount_reporting backfilled = amount_idr; reporting_currency='IDR'.
-- SELECT column_name, numeric_scale FROM information_schema.columns
--   WHERE table_name='transactions' AND column_name IN ('amount_original','amount_idr');
-- SELECT count(*) FILTER (WHERE amount_reporting IS DISTINCT FROM amount_idr) AS reporting_mismatch
--   FROM public.transactions WHERE reporting_currency='IDR';

-- NOTE: PostgREST schema cache must be reloaded after the ALTER:
--   NOTIFY pgrst, 'reload schema';   -- (run separately, not part of preflight)
-- ROLLBACK PLAN: NUMERIC(38,18) -> DECIMAL(18,2) is NOT safe (would truncate any
-- crypto rows written post-migration). Take a logical backup of transactions
-- before applying; rollback = restore from that snapshot, not a reverse ALTER.
