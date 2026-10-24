-- AC-0 / I-7 (24 Oct 2026): least privilege for the public Supabase roles in schema public.
--
-- Before: anon (the publishable key in the client bundle) and authenticated (anyone signed in with Supabase Auth) held
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on 84 tables and the intercompany_balances view, USAGE on
-- 27 sequences and EXECUTE on 45 functions (via PUBLIC), including rpc_reset_business_financial and
-- next_app_user_id. RLS (enabled everywhere, no policies) returned 0 rows and the writer gate refused writes, so no
-- company row could be read or changed (tests/integration/rcAcceptance/public-role-access.cjs, EXPECT=exposed) — but
-- every call reached RLS or a function body, and anon could advance app_user_id_seq.
--
-- Nothing legitimate uses these roles in schema public: the server uses only the service-role key, the client has no
-- Supabase data client (password sign-in goes to GoTrue, schema auth), the Telegram bot has no database credential.
--
-- After: anon/authenticated hold nothing in public; PUBLIC keeps no EXECUTE on public functions; service_role keeps
-- exactly the EXECUTE it had (it is re-granted explicitly where it came through PUBLIC); its table/sequence grants are
-- untouched. New objects created by postgres in public no longer grant anon/authenticated by default.
-- Rollback: 20261025090000_public_role_least_privilege_down.sql restores the exact previous grants.
-- No row, table, function body, policy or RLS setting changes. Idempotent.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _ac0_service_exec ON COMMIT DROP AS
  SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('service_role', p.oid, 'EXECUTE');

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid, format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    IF EXISTS (SELECT 1 FROM _ac0_service_exec s WHERE s.oid = f.oid) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;

-- Future objects created by postgres in public. (The PUBLIC EXECUTE default for new functions is global in
-- PostgreSQL and cannot be removed per schema; migrate-v2's postflight refuses any public function left executable
-- by PUBLIC, anon or authenticated.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon','authenticated']) r(role)
             WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p')
               AND has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  THEN RAISE EXCEPTION 'public_role_table_privilege_remains'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon','authenticated']) r(role)
             WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND has_sequence_privilege(r.role, c.oid, 'USAGE,SELECT,UPDATE'))
  THEN RAISE EXCEPTION 'public_role_sequence_privilege_remains'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon','authenticated']) r(role)
             WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege(r.role, p.oid, 'EXECUTE'))
  THEN RAISE EXCEPTION 'public_role_function_privilege_remains'; END IF;
  IF EXISTS (SELECT 1 FROM _ac0_service_exec s WHERE NOT has_function_privilege('service_role', s.oid, 'EXECUTE'))
  THEN RAISE EXCEPTION 'service_role_lost_execute'; END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
