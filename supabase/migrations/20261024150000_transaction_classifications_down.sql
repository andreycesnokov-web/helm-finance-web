-- Rollback of 20261024150000_transaction_classifications.sql. Drops only the purpose / accountant-review marks;
-- every operation then keeps its category-based treatment (the behaviour before it). No transaction, amount,
-- balance, category or document is touched.
BEGIN;
SET LOCAL lock_timeout='5s';
DROP TABLE IF EXISTS public.transaction_classifications;
DROP FUNCTION IF EXISTS public.fn_transaction_classification_guard();
NOTIFY pgrst, 'reload schema';
COMMIT;
