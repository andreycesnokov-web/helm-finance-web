-- Migration 059 — Targets and alerts: minimum cash, weekly brief schedule
-- (Design v2, proposal P-08; extends P-01 / migration 058)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md (3 Oct 2026).
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   businesses.min_cash_idr       — the lowest cash balance (IDR) the owner wants to keep.
--                                   Pulse warns when expected cash dips under it.
--   businesses.weekly_brief_cron  — when the weekly brief should go out, as a restricted
--                                   5-field cron: "<minute> <hour> * * <weekday 0-6>",
--                                   interpreted in the business timezone. NULL = no brief.
--
-- THE BRIEF ITSELF IS NOT SENT BY THIS CHANGE. The repo has no scheduler (see the TODO next
-- to telegram_daily_financial_pulse in server/index.js); adding one is a Railway/env change
-- and needs its own approval. When it exists it must pick recipients through the existing
-- notification policy (server/lib/notificationPolicy.js, category 'ai_cfo_summary', owner
-- only by default) — never from this column. This column only stores the owner's choice.
--
-- NO FINANCIAL EFFECT. Thresholds and a schedule. No money is created, changed or moved.
--
-- ADDITIVE and IDEMPOTENT. Two nullable columns, two CHECKs. Existing rows keep NULL.
--
-- WRITES go through PATCH /api/business/targets only: owner/ceo/admin/cfo, Business
-- workspaces only, each change written to audit_events.

BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS min_cash_idr      NUMERIC(20,2) NULL,
  ADD COLUMN IF NOT EXISTS weekly_brief_cron TEXT          NULL;

DO $$ BEGIN
  ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_min_cash_idr_chk
    CHECK (min_cash_idr IS NULL OR min_cash_idr >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only "once a week at a time of day" is allowed. A free cron string could schedule a
-- message every minute; this shape cannot.
DO $$ BEGIN
  ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_weekly_brief_cron_chk
    CHECK (weekly_brief_cron IS NULL OR weekly_brief_cron ~ '^([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* [0-6]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.businesses.min_cash_idr IS
  'Design v2 P-08: minimum cash to keep, IDR. NULL = not set.';
COMMENT ON COLUMN public.businesses.weekly_brief_cron IS
  'Design v2 P-08: weekly brief time, "m h * * dow" in the business timezone. NULL = off. Recipients come from notificationPolicy, never from here.';

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'businesses' AND column_name IN ('min_cash_idr','weekly_brief_cron');
--
-- ── rollback (only if needed) ────────────────────────────────────────────────
-- ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_weekly_brief_cron_chk;
-- ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_min_cash_idr_chk;
-- ALTER TABLE public.businesses DROP COLUMN IF EXISTS weekly_brief_cron;
-- ALTER TABLE public.businesses DROP COLUMN IF EXISTS min_cash_idr;
