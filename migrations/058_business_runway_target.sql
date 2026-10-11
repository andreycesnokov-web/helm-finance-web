-- Migration 058 — Per-business runway target (Design v2, proposal P-01)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md (3 Oct 2026).
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   businesses.runway_target_days — how many days of runway this business wants to hold.
--   Pulse compares measured runway with it ("Target 60 days"). NULL means "not set" and
--   the product default of 60 days applies (client/src/v2/lib/pulseModel.js).
--
-- NO FINANCIAL EFFECT. It is a threshold for status colours and copy. Nothing reads it to
-- create, change or move money, and no existing figure changes when it is set.
--
-- ADDITIVE and IDEMPOTENT. One nullable column and one CHECK. No existing column is
-- changed, no data is written, every existing row keeps NULL (= the 60-day default).
-- Re-running is a no-op.
--
-- WRITES go through PATCH /api/business/targets only: owner/ceo/admin/cfo, Business
-- workspaces only (never Personal), each change written to audit_events.

BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS runway_target_days INTEGER NULL;

-- 1..730 days: a target of zero is meaningless and more than two years is a typo.
DO $$ BEGIN
  ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_runway_target_days_chk
    CHECK (runway_target_days IS NULL OR (runway_target_days BETWEEN 1 AND 730));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.businesses.runway_target_days IS
  'Design v2 P-01: runway target in days. NULL = product default (60).';

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'businesses' AND column_name = 'runway_target_days';
-- SELECT count(*) AS set_targets FROM public.businesses WHERE runway_target_days IS NOT NULL;  -- 0 right after apply
--
-- ── rollback (only if needed; drops the setting, nothing else depends on it) ──
-- ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_runway_target_days_chk;
-- ALTER TABLE public.businesses DROP COLUMN IF EXISTS runway_target_days;
