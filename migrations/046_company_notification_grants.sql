-- Migration 046 — Company Admin notification grants
--
-- An owner may hand specific financial notification categories to a CEO or CFO of the SAME
-- business. This table records those grants and nothing else. It does not decide delivery on its
-- own: the notification policy resolver reads it as a widening of the owner-only baseline, and
-- always re-checks the member's live role and business. A grant is a stored intent, never an
-- authorisation short-cut.
--
-- ADDITIVE and IDEMPOTENT. Creates one table, one unique index, one updated_at trigger. No
-- backfill — the table starts empty, which means "no CEO/CFO receives anything" until an owner
-- grants it, matching the default-OFF posture of the feature flag. Safe to re-run.
--
-- NOTE: neither role nor Telegram id is stored here. Role lives in business_members and is read
-- fresh at send time (so a demotion makes a grant inert); Telegram identity lives in
-- user_channel_links (045). Copying either into this table would create a second source of truth
-- that could drift — the exact failure the identity work spent PRs eliminating.

CREATE TABLE IF NOT EXISTS business_member_notification_grants (
  id                  BIGSERIAL   PRIMARY KEY,
  business_id         UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id             BIGINT      NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category            TEXT        NOT NULL,
  enabled             BOOLEAN     NOT NULL,
  granted_by_user_id  BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One grant row per (business, user, category). No global grants: business_id is NOT NULL, so a
-- grant always names its business and cannot leak across tenants. An owner toggling a category
-- UPSERTs this row rather than accumulating history.
CREATE UNIQUE INDEX IF NOT EXISTS business_member_notification_grants_uidx
  ON business_member_notification_grants (business_id, user_id, category);

-- Lookups at send time are by business, filtered to enabled rows.
CREATE INDEX IF NOT EXISTS business_member_notification_grants_biz_idx
  ON business_member_notification_grants (business_id) WHERE enabled = true;

-- updated_at maintained by a trigger, matching 043/045 — no reliance on callers.
CREATE OR REPLACE FUNCTION fn_business_member_notification_grants_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_bmng_updated_at ON business_member_notification_grants;
CREATE TRIGGER trg_bmng_updated_at
  BEFORE UPDATE ON business_member_notification_grants FOR EACH ROW
  EXECUTE FUNCTION fn_business_member_notification_grants_updated_at();

-- ── Access control ──────────────────────────────────────────────────────────
-- Backend-only, same posture as 045. No browser role may read or write these rows: who can see
-- a company's financial alerts is a fact the client must never be able to enumerate or edit
-- directly. All access goes through the owner-only API, which runs as service_role.
REVOKE ALL ON TABLE public.business_member_notification_grants FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_business_member_notification_grants_updated_at() FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.business_member_notification_grants_id_seq FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.business_member_notification_grants FROM anon;
    REVOKE ALL ON FUNCTION public.fn_business_member_notification_grants_updated_at() FROM anon;
    REVOKE ALL ON SEQUENCE public.business_member_notification_grants_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.business_member_notification_grants FROM authenticated;
    REVOKE ALL ON FUNCTION public.fn_business_member_notification_grants_updated_at() FROM authenticated;
    REVOKE ALL ON SEQUENCE public.business_member_notification_grants_id_seq FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_member_notification_grants TO service_role;
    GRANT EXECUTE ON FUNCTION public.fn_business_member_notification_grants_updated_at() TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.business_member_notification_grants_id_seq TO service_role;
  END IF;
END $$;

-- ── Atomic grant change + audit (P1: grant and audit must commit together) ────
-- The API used to upsert the grant, then write the audit event in a separate call that ignored
-- its own error — so a permission could change with no audit trail. A Postgres function runs in a
-- single transaction: either the grant change AND its audit rows all commit, or none do. The API
-- calls this via rpc() and treats anything other than a confirmed JSONB result as failure.
--
-- SECURITY DEFINER with a locked search_path: the function is owned by the migration runner and
-- executes with its privileges so service_role can call it without direct table grants being the
-- only guard, and the pinned search_path stops a hijacked schema from resolving these names.
--
-- Self-guarding: the target MUST be an active CEO/CFO of THIS business, re-checked here against
-- the live membership. A buggy or malicious caller cannot grant to a manager or across tenants
-- even if the API layer were bypassed.
CREATE OR REPLACE FUNCTION apply_notification_grants(
  p_business_id UUID,
  p_user_id     BIGINT,
  p_granted_by  BIGINT,
  p_actor_role  TEXT,
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
  ALLOWED TEXT[] := ARRAY['company_financial','tax_compliance','payables_receivables',
                          'documents_review','team_approvals','ai_cfo_summary'];
BEGIN
  IF p_business_id IS NULL OR p_user_id IS NULL OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  -- Lock the member row FIRST, so a concurrent demotion/deactivation serialises with this grant
  -- instead of racing it. Whichever transaction takes the lock first runs to completion; the other
  -- waits and then re-reads the membership below. This is what makes "concurrent grant vs
  -- demotion" unable to leave an enabled grant:
  --   * grant-first  → grant commits, then the demotion's trigger disables it;
  --   * demote-first → this re-read sees a non-CEO/CFO role and raises member_not_grantable.
  PERFORM 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = p_user_id
    FOR UPDATE;

  -- Live eligibility: active CEO/CFO of this business, or nothing is written.
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

    -- Audit only real transitions, so repeating the same value is idempotent and produces no
    -- misleading duplicate event. Same transaction → rolls back with the grant if it fails.
    IF prev IS DISTINCT FROM v THEN
      INSERT INTO audit_events
        (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
      VALUES (p_business_id, p_granted_by, p_actor_role, 'web', 'notification_grant', p_user_id::text,
              CASE WHEN v THEN 'granted' ELSE 'revoked' END,
              jsonb_build_object('category', k, 'enabled', COALESCE(prev, false)),
              jsonb_build_object('category', k, 'enabled', v));
      changed := changed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('changed', changed);
END $fn$;

-- (An earlier revision had a standalone disable_member_notification_grants() the API called on
-- PATCH/DELETE. It is removed: the trigger below supersedes it — one mechanism, at the database
-- level, covering every route and race rather than the two the API happened to call.)

-- Execute only as service_role; never PUBLIC.
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

-- ── DB-level stale-grant safety (P1: every route and every race) ─────────────
-- A grant must never survive a membership transition. The earlier fix disabled grants in the API
-- on PATCH/DELETE, but that (a) missed every other route that writes business_members — invite
-- reactivation, admin tooling, direct SQL — (b) was two separate statements and therefore
-- raceable against a concurrent grant, and (c) was gated by the app feature flag, so safety
-- vanished while the flag was off. This trigger closes all three: it is DB-level (covers every
-- writer including direct updates), runs in the SAME transaction as the membership change (atomic,
-- no window), and is independent of the app flag (once 046 is applied, safety is always on).
--
-- The rule is symmetric and deliberately blunt: ANY real membership transition — into OR out of
-- CEO/CFO, a brand-new membership, a reactivation — resets THIS member's grants in THIS business
-- to OFF. Only a subsequent explicit owner action (apply_notification_grants, which is NOT a
-- business_members write) can turn them back on. So a stale grant cannot ride a promotion,
-- reactivation, or re-invite back to life, and a demotion cannot leave one enabled.
--
-- A same-role, same-status update (an unrelated field edit) is NOT a transition and leaves grants
-- untouched, so a legitimate current grant is not wiped by incidental writes.
CREATE OR REPLACE FUNCTION fn_bmng_reset_grants_on_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $t$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role   IS NOT DISTINCT FROM OLD.role
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;   -- not a transition; grants are left exactly as they are
  END IF;

  FOR r IN
    SELECT category FROM business_member_notification_grants
    WHERE business_id = NEW.business_id AND user_id = NEW.user_id AND enabled = true
  LOOP
    UPDATE business_member_notification_grants
      SET enabled = false, updated_at = now()
      WHERE business_id = NEW.business_id AND user_id = NEW.user_id AND category = r.category;
    -- System-attributed: the actor of a membership change is not trusted here, and an auto-revoke
    -- is the database enforcing an invariant, not a person acting. NULL actor + 'system' channel
    -- records that honestly rather than blaming whoever happened to trigger it.
    INSERT INTO audit_events
      (business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
    VALUES (NEW.business_id, NULL, 'system', 'system', 'notification_grant', NEW.user_id::text,
            'auto_revoked',
            jsonb_build_object('category', r.category, 'enabled', true),
            jsonb_build_object('category', r.category, 'enabled', false, 'reason', 'membership_change'));
  END LOOP;
  RETURN NEW;
END $t$;

-- AFTER INSERT OR UPDATE OF role, status: fires on a new membership and whenever an update targets
-- the role or status column. The internal distinct-check makes a same-value write a no-op.
DROP TRIGGER IF EXISTS trg_bmng_reset_on_membership ON business_members;
CREATE TRIGGER trg_bmng_reset_on_membership
  AFTER INSERT OR UPDATE OF role, status ON business_members
  FOR EACH ROW EXECUTE FUNCTION fn_bmng_reset_grants_on_membership_change();

REVOKE ALL ON FUNCTION fn_bmng_reset_grants_on_membership_change() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION fn_bmng_reset_grants_on_membership_change() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION fn_bmng_reset_grants_on_membership_change() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION fn_bmng_reset_grants_on_membership_change() TO service_role;
  END IF;
END $$;
