-- ═════════════════════════════════════════════════════════════════════════════
-- 072 — Platform Administrators: Server-Side RBAC & Authorization Foundation
--
-- Replaces environment-based ADMIN_TELEGRAM_IDS with a durable, auditable,
-- database-backed role model in PostgreSQL.
--
-- Roles:
--   super_admin    — Full platform admin control, manage other administrators,
--                    audit, security settings.
--   platform_admin — Platform operations (Billing, company management, support,
--                    tax rules), without permission to grant or revoke admin roles.
--
-- Security rules:
--   1. Access to Platform Admin requires a verified email identity.
--   2. Telegram logins cannot grant platform admin privileges.
--   3. The last active super_admin can NEVER be deleted, deactivated, or demoted.
--   4. Only service_role (the backend) can query and mutate this table.
--   5. Changes are logged to audit_events.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id     BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('super_admin', 'platform_admin')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ NULL
);

-- Partial index for active administrator lookups
CREATE INDEX IF NOT EXISTS idx_platform_admins_active 
  ON public.platform_admins(user_id) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_platform_admins_role 
  ON public.platform_admins(role) 
  WHERE is_active = true;

-- Guard trigger: prevents revoking, deactivating or deleting the last active super_admin
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

DROP TRIGGER IF EXISTS trg_platform_admins_guard ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_guard
  BEFORE UPDATE OR DELETE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.fn_platform_admins_guard();

-- Lock down access: only service_role (backend) may access
REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.platform_admins FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.platform_admins FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admins TO service_role;
  END IF;
END $$;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Atomic Bootstrap function protected by transaction-level advisory lock
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
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.fn_bootstrap_platform_super_admin(BIGINT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.fn_bootstrap_platform_super_admin(BIGINT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.fn_bootstrap_platform_super_admin(BIGINT) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
