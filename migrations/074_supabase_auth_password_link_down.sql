-- Down for 074_supabase_auth_password_link. Removes the Supabase Auth bridge (links and password sessions).
-- Every password user loses the way to sign in until 074 is re-applied (their app identity, companies and
-- data are untouched). For isolated rehearsal only; never a production rollback step. Fail-closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
 IF current_setting('cfo.confirm_down', true) IS DISTINCT FROM '074' THEN
  RAISE EXCEPTION 'auth_password_link_down_not_confirmed: run SET cfo.confirm_down = ''074'' in this session first';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.rpc_auth_revoke_all_sessions(uuid,text);
DROP FUNCTION IF EXISTS public.rpc_auth_end_session(bigint,uuid);
DROP FUNCTION IF EXISTS public.rpc_auth_password_session(uuid,text,timestamptz,integer);
DROP TABLE IF EXISTS public.auth_app_sessions;
DROP TABLE IF EXISTS public.auth_user_links;
DROP FUNCTION IF EXISTS public.fn_auth_app_sessions_guard();
DROP FUNCTION IF EXISTS public.fn_auth_user_links_guard();
COMMIT;
