-- Rollback of 20261024120000_business_category_pnl_groups.sql. Drops only the per-company mapping of system
-- categories; companies then see those operations under "Needs review" again (the behaviour before it).
-- No category, transaction or company-owned mapping is touched.
BEGIN;
SET LOCAL lock_timeout='5s';
DROP TABLE IF EXISTS public.business_category_pnl_groups;
DROP FUNCTION IF EXISTS public.fn_business_category_pnl_group_guard();
NOTIFY pgrst, 'reload schema';
COMMIT;
