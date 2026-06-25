-- ════════════════════════════════════════════════════════════════════════════
-- READ-ONLY AUDIT — legacy rows with business_id IS NULL in scoped financial tables.
--
-- Context: bizOrFilter was made STRICT (business_id only); the legacy
-- `business_id IS NULL` union was removed. Migration 017 backfilled NULL rows into
-- each user's default business, so this audit should return 0 everywhere.
--
-- If any table reports n > 0, those rows would become invisible under strict scoping
-- (they belong to no business). Report the counts before promotion and decide:
--   • backfill them to the owning business (additive UPDATE), or
--   • explicitly approve a temporary compatibility path.
-- NOTE on categories/counterparties: any rows there with BOTH business_id IS NULL
-- AND user_id IS NULL are shared "system" rows. The OLD union also excluded those
-- (it required user_id = owner), so strict scoping does NOT change their visibility.
-- The rows that matter for the leak are user-owned financial rows: transactions,
-- wallets, debts, reminders, payroll. Those must be 0.
--
-- Does NOT modify any data. Safe to run on production.
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'transactions'        AS table, count(*) AS null_business_id_rows FROM public.transactions        WHERE business_id IS NULL
UNION ALL SELECT 'wallets',            count(*) FROM public.wallets            WHERE business_id IS NULL
UNION ALL SELECT 'debts',              count(*) FROM public.debts              WHERE business_id IS NULL
UNION ALL SELECT 'reminders',          (SELECT count(*) FROM public.reminders          WHERE business_id IS NULL)
UNION ALL SELECT 'payroll_payments',   (SELECT count(*) FROM public.payroll_payments   WHERE business_id IS NULL)
UNION ALL SELECT 'payroll_payment_items', (SELECT count(*) FROM public.payroll_payment_items WHERE business_id IS NULL)
UNION ALL SELECT 'counterparties',     (SELECT count(*) FROM public.counterparties     WHERE business_id IS NULL)
UNION ALL SELECT 'cashflow_categories',(SELECT count(*) FROM public.cashflow_categories WHERE business_id IS NULL)
ORDER BY null_business_id_rows DESC, table;
