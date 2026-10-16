-- Down for 073_platform_admins_security. Restores the 072 definitions verbatim (which re-introduce the defects
-- 073 fixed). For isolated rehearsal only; never a production rollback step. Fail-closed: explicit confirmation.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
 IF current_setting('cfo.confirm_down', true) IS DISTINCT FROM '073' THEN
  RAISE EXCEPTION 'platform_admin_security_down_not_confirmed: run SET cfo.confirm_down = ''073'' in this session first';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.rpc_platform_admin_revoke(bigint,bigint,text);
DROP FUNCTION IF EXISTS public.rpc_platform_admin_grant(bigint,text,text,text);
DROP FUNCTION IF EXISTS public.cfo_require_active_super_admin(bigint);
CREATE OR REPLACE FUNCTION public.fn_platform_admins_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  active_supers INT;
BEGIN
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (NEW.is_active = false OR NEW.role <> 'super_admin'))) THEN
    IF (OLD.role = 'super_admin' AND OLD.is_active = true) THEN
      SELECT count(*) INTO active_supers 
      FROM public.platform_admins
      WHERE role = 'super_admin' AND is_active = true AND user_id <> OLD.user_id;
      
      IF active_supers < 1 THEN
        RAISE EXCEPTION 'cannot_revoke_last_super_admin' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_bootstrap_platform_super_admin(
  p_user_id BIGINT
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_verified_at TIMESTAMPTZ;
  v_existing_super_id BIGINT;
BEGIN
  -- 1. Acquire transaction-level advisory lock specifically for platform_admin bootstrap.
  -- Hashtext of 'cfo_platform_admin_bootstrap' ensures a deterministic 64-bit advisory lock key across all connections.
  PERFORM pg_advisory_xact_lock(hashtext('cfo_platform_admin_bootstrap'));

  -- 2. Verify that target user has a verified email identity
  SELECT email_verified_at INTO v_verified_at
  FROM public.user_email_identities
  WHERE user_id = p_user_id AND email_verified_at IS NOT NULL
  LIMIT 1;

  IF v_verified_at IS NULL THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Check for ANY existing active super_admin
  SELECT user_id INTO v_existing_super_id
  FROM public.platform_admins
  WHERE role = 'super_admin' AND is_active = true
  LIMIT 1;

  -- 4. Idempotency or Rejection
  IF v_existing_super_id IS NOT NULL THEN
    IF v_existing_super_id = p_user_id THEN
      RETURN jsonb_build_object(
        'status', 'already_super_admin',
        'user_id', p_user_id,
        'role', 'super_admin',
        'is_active', true
      );
    ELSE
      RAISE EXCEPTION 'super_admin_already_exists' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- 5. Insert new super_admin
  INSERT INTO public.platform_admins (user_id, role, is_active, created_by, updated_at)
  VALUES (p_user_id, 'super_admin', true, p_user_id, now())
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'super_admin',
    is_active = true,
    revoked_at = NULL,
    updated_at = now();

  RETURN jsonb_build_object(
    'status', 'bootstrapped',
    'user_id', p_user_id,
    'role', 'super_admin',
    'is_active', true
  );
END $$;
REVOKE ALL ON FUNCTION public.fn_bootstrap_platform_super_admin(BIGINT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.fn_bootstrap_platform_super_admin(BIGINT) TO service_role; END IF; END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
