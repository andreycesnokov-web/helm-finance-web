-- Business access: direct REST callers must use the underlying tables' RLS.
-- The server service_role path remains authorized; owners, ACL and data are preserved.
-- Requires PostgreSQL 15+, verified on native PostgreSQL 17 staging.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER VIEW public.intercompany_balances SET (security_invoker = true);
NOTIFY pgrst, 'reload schema';
COMMIT;
