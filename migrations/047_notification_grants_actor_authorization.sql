-- Migration 047 — Company notification grants: actor-side authorization in the RPC
--
-- 046 shipped apply_notification_grants with TARGET-side checks only (the target must be an active
-- CEO/CFO of the business). It trusted its caller for the ACTOR: p_granted_by and p_actor_role were
-- written into the grant/audit but never validated. The API route enforces owner-only, but the RPC
-- was not self-securing — a future service_role caller could grant without being an owner.
--
-- This migration replaces the function body (same signature, so nothing else changes) to validate
-- the actor inside the database, as defence in depth:
--   * the actor (p_granted_by) MUST be an ACTIVE member of THIS business;
--   * the actor's role is DERIVED from business_members — p_actor_role is NO LONGER trusted for
--     authorization, and the DERIVED role is what the audit records;
--   * v0 policy: only 'owner' may grant/revoke. There is no company-admin delegation yet.
--   * a missing / inactive / removed / cross-business / non-owner actor -> RAISE 'actor_not_authorized'
--     BEFORE any grant or audit write, so a forbidden call changes nothing and leaves no audit row.
--
-- Unchanged: the target checks, the FOR UPDATE lock and its concurrency guarantee, the grant/revoke
-- audit atomicity, and the membership-change auto-revoke trigger (fn_bmng_reset_grants_on_membership_change).
--
-- ADDITIVE and IDEMPOTENT (CREATE OR REPLACE with the identical signature; re-runnable). 046 is
-- already applied in production; this is the forward migration that hardens the function there.

CREATE OR REPLACE FUNCTION apply_notification_grants(
  p_business_id UUID,
  p_user_id     BIGINT,
  p_granted_by  BIGINT,
  p_actor_role  TEXT,   -- ACCEPTED for call-site compatibility, but IGNORED: authorization and the
                        -- audit's actor_role are derived from business_members below, never trusted.
  p_changes     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  k TEXT;
  v BOOLEAN;
  prev BOOLEAN;
  changed INT := 0;
  v_actor_role TEXT;   -- DERIVED from business_members; the only role trusted for auth/audit
  ALLOWED TEXT[] := ARRAY['company_financial','tax_compliance','payables_receivables',
                          'documents_review','team_approvals','ai_cfo_summary'];
BEGIN
  IF p_business_id IS NULL OR p_user_id IS NULL OR p_granted_by IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  -- ── ACTOR AUTHORIZATION (defence in depth) ────────────────────────────────
  -- Derive the actor's LIVE role from an ACTIVE membership in THIS business. A missing, inactive,
  -- removed, or cross-business actor yields NULL. v0: only 'owner' may grant/revoke. This runs
  -- BEFORE any write, so a forbidden actor produces no grant change and no audit row.
  --
  -- FOR UPDATE locks the actor's membership row, so a concurrent demotion/deactivation of the ACTOR
  -- serialises with this grant instead of racing it (mirroring the target lock below):
  --   * grant-first  → the grant is made while the actor is still a valid owner, then the demotion
  --                    commits; the grant stands as an authorised-at-the-time decision.
  --   * demote-first → this lock waits, then re-reads the now-non-owner role and raises
  --                    actor_not_authorized. No ordering lets a just-demoted owner slip a grant
  --                    through.
  -- On deadlocks: normal API calls (owner actor, CEO/CFO target) cannot form an actor/target lock
  -- cycle — the API only ever calls this with an owner granting a distinct CEO/CFO. Pathological
  -- direct service_role misuse (e.g. two callers locking the same rows in opposite order) could in
  -- principle deadlock; if it does, PostgreSQL aborts one transaction, and because everything here
  -- is one transaction, atomicity is preserved — no partial grant or audit survives.
  SELECT role INTO v_actor_role
    FROM business_members
    WHERE business_id = p_business_id AND user_id = p_granted_by AND status = 'active'
    LIMIT 1
    FOR UPDATE;
  IF v_actor_role IS NULL OR v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;

  -- ── TARGET lock + eligibility (unchanged from 046) ────────────────────────
  -- Lock the TARGET member row first so a concurrent demotion/deactivation serialises with this
  -- grant instead of racing it (grant-first -> disabled by the demotion trigger; demote-first ->
  -- the re-read below raises member_not_grantable).
  PERFORM 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = p_user_id
    FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = p_user_id
      AND status = 'active' AND role IN ('ceo','cfo')
  ) THEN
    RAISE EXCEPTION 'member_not_grantable';
  END IF;

  FOR k, v IN SELECT key, value::boolean FROM jsonb_each_text(p_changes) LOOP
    IF NOT (k = ANY(ALLOWED)) THEN
      RAISE EXCEPTION 'unknown_category';
    END IF;

    SELECT enabled INTO prev FROM business_member_notification_grants
      WHERE business_id = p_business_id AND user_id = p_user_id AND category = k;

    INSERT INTO business_member_notification_grants
      (business_id, user_id, category, enabled, granted_by_user_id)
    VALUES (p_business_id, p_user_id, k, v, p_granted_by)
    ON CONFLICT (business_id, user_id, category)
    DO UPDATE SET enabled = EXCLUDED.enabled,
                  granted_by_user_id = EXCLUDED.granted_by_user_id,
                  updated_at = now();

    -- Audit only real transitions. actor_role is the DERIVED v_actor_role, never the caller's
    -- p_actor_role — the audit trail cannot be spoofed by a caller-supplied role string.
    IF prev IS DISTINCT FROM v THEN
      INSERT INTO audit_events
        (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
      VALUES (p_business_id, p_granted_by, v_actor_role, 'web', 'notification_grant', p_user_id::text,
              CASE WHEN v THEN 'granted' ELSE 'revoked' END,
              jsonb_build_object('category', k, 'enabled', COALESCE(prev, false)),
              jsonb_build_object('category', k, 'enabled', v));
      changed := changed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('changed', changed);
END $fn$;

-- Re-assert the privilege posture (idempotent; CREATE OR REPLACE preserves grants, but we keep
-- this explicit so the file is self-contained). Execute only as service_role; never PUBLIC.
REVOKE ALL ON FUNCTION apply_notification_grants(UUID, BIGINT, BIGINT, TEXT, JSONB) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION apply_notification_grants(UUID, BIGINT, BIGINT, TEXT, JSONB) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION apply_notification_grants(UUID, BIGINT, BIGINT, TEXT, JSONB) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION apply_notification_grants(UUID, BIGINT, BIGINT, TEXT, JSONB) TO service_role;
  END IF;
END $$;
