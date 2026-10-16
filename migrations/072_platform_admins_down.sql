-- DOWN for 072_platform_admins.sql (isolated test rehearsal only).
-- Requires explicit session setting to avoid accidental destruction of admin privileges.
-- Requires: SET cfo.confirm_down = '072_platform_admins'; in the same session.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $$ BEGIN
  IF current_setting('cfo.confirm_down', true) IS DISTINCT FROM '072_platform_admins' THEN
    RAISE EXCEPTION 'down_not_confirmed: run SET cfo.confirm_down = ''072_platform_admins'' in this session first';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_platform_admins_guard ON public.platform_admins;
DROP FUNCTION IF EXISTS public.fn_platform_admins_guard();
DROP FUNCTION IF EXISTS public.fn_bootstrap_platform_super_admin(BIGINT);
DROP TABLE IF EXISTS public.platform_admins CASCADE;

NOTIFY pgrst, 'reload schema';
COMMIT;
