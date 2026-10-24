-- Rollback of 20261025094000_transaction_integrity_constraints.sql: drops the two constraints and the composite key.
-- No row is touched.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_known;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_wallet_same_business_fkey;
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_id_business_key;
NOTIFY pgrst, 'reload schema';
COMMIT;
