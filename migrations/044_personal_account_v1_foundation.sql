-- Migration 044 — Personal Account v1 foundation (additive, minimal)
-- Date: 2026-06-27. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, no seed, no cash.
-- PROPOSED — NOT APPLIED until reviewed/approved.
--
-- Purpose: the minimum integrity guards for a type='personal' workspace that stores
-- wallets / transactions / cashflow_categories via business_id = personal_workspace_id
-- and scope = 'personal'. Personal Account v1 is fiat-only and has NO funding bridge.
--
-- This is intentionally a SEPARATE, SELF-CONTAINED migration from the (un-applied)
-- full 037. It uses V1-SPECIFIC object names so there is no ambiguity and so a later
-- full-037 apply can never mistake these for its own objects:
--   fn_personal_v1_owner_only_membership / trg_personal_v1_owner_only
--   businesses_one_personal_v1_per_owner_uidx
--
-- DELIBERATELY EXCLUDED (live ONLY in full 037 / 038 / 039 — NOT applied here):
--   • NO transactions precision ALTER (18,2)->(38,18)     [no table rewrite]
--   • NO wallet multi-asset metadata / immutability trigger
--   • NO user_workspace_preferences            (one personal ws per user → resolver finds it)
--   • NO personal_business_relationships / funding bridge tables
--   • NO fn_is_workspace_type                   (guard does its own inline lookup)

BEGIN;

-- Preconditions: the guarded tables must exist and businesses.type (migration 030)
-- plus owner_user_id must be present. Fail fast otherwise.
DO $$ BEGIN
  IF to_regclass('public.businesses') IS NULL OR to_regclass('public.business_members') IS NULL THEN
    RAISE EXCEPTION '044 needs businesses + business_members';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='businesses' AND column_name='type') THEN
    RAISE EXCEPTION '044 needs businesses.type (migration 030)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='businesses' AND column_name='owner_user_id') THEN
    RAISE EXCEPTION '044 needs businesses.owner_user_id';
  END IF;
END $$;

-- ── 1. Personal workspace is OWNER-ONLY in v1 ───────────────────────────────
-- A type='personal' workspace may have exactly one member: its owner. Blocks any
-- attempt to add a second / non-owner member (no teams on a personal workspace).
-- Fires only on FUTURE INSERT/UPDATE of business_members; existing rows untouched.
CREATE OR REPLACE FUNCTION fn_personal_v1_owner_only_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_type text; v_owner bigint;
BEGIN
  SELECT type, owner_user_id INTO v_type, v_owner FROM public.businesses WHERE id = NEW.business_id;
  IF v_type = 'personal' AND NEW.user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'personal workspace is owner-only in V1 (no non-owner members)';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_personal_v1_owner_only ON business_members;
CREATE TRIGGER trg_personal_v1_owner_only BEFORE INSERT OR UPDATE ON business_members
  FOR EACH ROW EXECUTE FUNCTION fn_personal_v1_owner_only_membership();

-- ── 2. At most ONE personal workspace per user ──────────────────────────────
-- Partial unique index → a second businesses row with type='personal' for the same
-- owner_user_id is rejected at the DB level (provisioning race-safe).
CREATE UNIQUE INDEX IF NOT EXISTS businesses_one_personal_v1_per_owner_uidx
  ON public.businesses (owner_user_id) WHERE type = 'personal';

COMMIT;

-- ── Verify (read-only; run after COMMIT) ────────────────────────────────────
SELECT 'owner_only_trigger' AS check,
       (EXISTS(SELECT 1 FROM information_schema.triggers
               WHERE trigger_name='trg_personal_v1_owner_only'
                 AND event_object_table='business_members'))::text AS v
UNION ALL
SELECT 'one_personal_per_owner_index',
       (EXISTS(SELECT 1 FROM pg_indexes
               WHERE schemaname='public' AND indexname='businesses_one_personal_v1_per_owner_uidx'))::text
UNION ALL
SELECT 'no_precision_alter_applied (amount_original scale expected 2)',
       (SELECT numeric_scale::text FROM information_schema.columns
        WHERE table_name='transactions' AND column_name='amount_original');
