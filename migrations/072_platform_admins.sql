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

NOTIFY pgrst, 'reload schema';
COMMIT;
