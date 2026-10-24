-- Rollback of 20261025092000_atomic_funding_creation.sql. Funding records and schedules written through the function
-- stay (they are ordinary rows of the register); only the function, its receipts and the uniqueness index go. The
-- application must be rolled back first (the new route calls rpc_create_business_funding).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.rpc_create_business_funding(uuid,bigint,text,jsonb,jsonb,text);
DROP TABLE IF EXISTS public.funding_creation_requests;
DROP FUNCTION IF EXISTS public.fn_funding_creation_requests_append_only();
DROP INDEX IF EXISTS public.bfr_received_tx_uniq;
NOTIFY pgrst, 'reload schema';
COMMIT;
