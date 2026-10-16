-- ═════════════════════════════════════════════════════════════════════════════
-- 073 — Platform admin security corrections (Platform admin). FORWARD-ONLY, idempotent.
--
-- Required after 072 on every database: corrects databases where 072 is already applied and is the second
-- step on new installs. 072 itself is left unchanged (it may already be deployed somewhere).
--
--  1. Guard trigger: RETURN OLD on DELETE (072 returned NEW = NULL, which silently cancelled every DELETE,
--     including the ON DELETE CASCADE from users → orphaned, still-active admin rows).
--  2. Guard trigger: serialize every change that can remove an active super_admin (072 allowed two concurrent
--     revocations to leave zero active super_admins — write skew).
--  3. Orphaned admin rows (user already deleted) are removed and audited.
--  4. Bootstrap writes its audit row in the SAME transaction as the role (072 audited afterwards, in JS).
--  5. Grant / revoke become SQL functions that change the role and write the audit row atomically.
--  6. Every function here has an explicit search_path; SECURITY DEFINER is not used (service_role only).
--  7. Defensive: EXECUTE on SECURITY DEFINER helpers from 046/047 is revoked from PUBLIC/anon/authenticated
--     (their migrations already intend this; a no-op where it already holds).
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$ BEGIN
  IF to_regclass('public.platform_admins') IS NULL OR to_regprocedure('public.fn_bootstrap_platform_super_admin(bigint)') IS NULL THEN
    RAISE EXCEPTION 'platform_admin_security_requires_072';
  END IF;
END $$;

-- An INTEGER overload (never shipped in this repository) would make PostgREST calls ambiguous (42725/PGRST203).
DROP FUNCTION IF EXISTS public.fn_bootstrap_platform_super_admin(integer);

CREATE OR REPLACE FUNCTION public.fn_platform_admins_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  active_supers int;
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (NEW.is_active = false OR NEW.role <> 'super_admin')) THEN
    IF OLD.role = 'super_admin' AND OLD.is_active THEN
      -- The count below must see every committed change: under REPEATABLE READ it would read a stale
      -- snapshot and two revocations could both pass. (SERIALIZABLE detects the conflict itself.)
      IF current_setting('transaction_isolation') = 'repeatable read' THEN
        RAISE EXCEPTION 'platform_admin_change_requires_read_committed' USING ERRCODE = 'P0001';
      END IF;
      -- One change that can remove an active super_admin at a time.
      PERFORM pg_advisory_xact_lock(hashtext('cfo_platform_admins_last_super'));
      SELECT count(*) INTO active_supers FROM public.platform_admins
       WHERE role = 'super_admin' AND is_active AND user_id <> OLD.user_id;
      IF active_supers < 1 THEN
        RAISE EXCEPTION 'cannot_revoke_last_super_admin' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Orphans left by 072 (user deleted, admin row kept by the cancelled cascade). The guard is bypassed only
-- for rows whose user no longer exists; each removal is audited.
ALTER TABLE public.platform_admins DISABLE TRIGGER trg_platform_admins_guard;
WITH gone AS (
  DELETE FROM public.platform_admins pa WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = pa.user_id)
  RETURNING pa.*
)
INSERT INTO public.audit_events (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
SELECT NULL, NULL, 'migration', 'migration', 'platform_admin', g.user_id::text, 'orphan_role_removed', to_jsonb(g), NULL FROM gone g;
ALTER TABLE public.platform_admins ENABLE TRIGGER trg_platform_admins_guard;

CREATE OR REPLACE FUNCTION public.fn_bootstrap_platform_super_admin(p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  existing_super bigint;
  before jsonb;
  after_row public.platform_admins;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cfo_platform_admin_bootstrap'));
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_email_identities WHERE user_id = p_user_id AND email_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = 'P0002';
  END IF;
  SELECT user_id INTO existing_super FROM public.platform_admins WHERE role = 'super_admin' AND is_active LIMIT 1;
  IF existing_super IS NOT NULL THEN
    IF existing_super = p_user_id THEN
      RETURN jsonb_build_object('status', 'already_super_admin', 'user_id', p_user_id, 'role', 'super_admin', 'is_active', true);
    END IF;
    RAISE EXCEPTION 'super_admin_already_exists' USING ERRCODE = 'P0003';
  END IF;
  SELECT to_jsonb(pa) INTO before FROM public.platform_admins pa WHERE user_id = p_user_id;
  INSERT INTO public.platform_admins (user_id, role, is_active, created_by, updated_at)
  VALUES (p_user_id, 'super_admin', true, p_user_id, now())
  ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin', is_active = true, revoked_at = NULL, updated_at = now()
  RETURNING * INTO after_row;
  -- Same transaction: if the audit row cannot be written, the role is not granted.
  INSERT INTO public.audit_events (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
  VALUES (NULL, p_user_id, 'system_bootstrap', 'cli', 'platform_admin', p_user_id::text, 'role_bootstrap', before, to_jsonb(after_row));
  RETURN jsonb_build_object('status', 'bootstrapped', 'user_id', p_user_id, 'role', 'super_admin', 'is_active', true);
END $$;

-- Acting super_admin re-checked in SQL (defense in depth: the route already requires it).
CREATE OR REPLACE FUNCTION public.cfo_require_active_super_admin(p_actor bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.platform_admins pa JOIN public.user_email_identities e ON e.user_id = pa.user_id AND e.email_verified_at IS NOT NULL
     WHERE pa.user_id = p_actor AND pa.role = 'super_admin' AND pa.is_active AND pa.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'super_admin_required' USING ERRCODE = 'P0004';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_platform_admin_grant(p_actor bigint, p_email text, p_role text, p_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  target bigint;
  verified timestamptz;
  before jsonb;
  after_row public.platform_admins;
  normalized text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('super_admin', 'platform_admin') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'P0005'; END IF;
  IF normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email' USING ERRCODE = 'P0005'; END IF;
  PERFORM public.cfo_require_active_super_admin(p_actor);
  SELECT user_id, email_verified_at INTO target, verified FROM public.user_email_identities WHERE email = normalized LIMIT 1;
  IF target IS NULL THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0006'; END IF;
  IF verified IS NULL THEN RAISE EXCEPTION 'email_not_verified' USING ERRCODE = 'P0002'; END IF;
  SELECT to_jsonb(pa) INTO before FROM public.platform_admins pa WHERE user_id = target FOR UPDATE;
  INSERT INTO public.platform_admins (user_id, role, is_active, created_by, updated_at, revoked_at)
  VALUES (target, p_role, true, p_actor, now(), NULL)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true, revoked_at = NULL, created_by = EXCLUDED.created_by, updated_at = now()
  RETURNING * INTO after_row;
  INSERT INTO public.audit_events (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json, request_id)
  VALUES (NULL, p_actor, 'super_admin', 'web', 'platform_admin', target::text, CASE WHEN before IS NULL THEN 'role_granted' ELSE 'role_updated' END,
          before, to_jsonb(after_row), p_request_id);
  RETURN jsonb_build_object('user_id', target, 'role', after_row.role, 'is_active', true, 'email', normalized);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_platform_admin_revoke(p_actor bigint, p_target bigint, p_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  before public.platform_admins;
  after_row public.platform_admins;
BEGIN
  PERFORM public.cfo_require_active_super_admin(p_actor);
  SELECT * INTO before FROM public.platform_admins WHERE user_id = p_target FOR UPDATE;
  IF NOT FOUND OR NOT before.is_active THEN RAISE EXCEPTION 'admin_not_found' USING ERRCODE = 'P0007'; END IF;
  -- The guard trigger refuses (cannot_revoke_last_super_admin) and serializes concurrent revocations.
  UPDATE public.platform_admins SET is_active = false, revoked_at = now() WHERE user_id = p_target RETURNING * INTO after_row;
  INSERT INTO public.audit_events (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json, request_id)
  VALUES (NULL, p_actor, 'super_admin', 'web', 'platform_admin', p_target::text, 'role_revoked', to_jsonb(before), to_jsonb(after_row), p_request_id);
  RETURN jsonb_build_object('ok', true, 'user_id', p_target, 'is_active', false);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_bootstrap_platform_super_admin(bigint)', 'public.cfo_require_active_super_admin(bigint)',
    'public.rpc_platform_admin_grant(bigint,text,text,text)', 'public.rpc_platform_admin_revoke(bigint,bigint,text)', 'public.fn_platform_admins_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF f <> 'public.fn_platform_admins_guard()' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
  -- 046/047 SECURITY DEFINER helpers: callable by the backend only.
  FOREACH f IN ARRAY ARRAY['public.apply_notification_grants(uuid,bigint,bigint,text,jsonb)', 'public.fn_bmng_reset_grants_on_membership_change()'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    END IF;
  END LOOP;
  IF to_regprocedure('public.apply_notification_grants(uuid,bigint,bigint,text,jsonb)') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_notification_grants(uuid,bigint,bigint,text,jsonb) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
