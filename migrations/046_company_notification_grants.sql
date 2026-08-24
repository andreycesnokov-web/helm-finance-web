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
