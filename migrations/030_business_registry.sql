-- Migration 030 — Platform Admin: business_code, admin overrides, access audit
-- Date: 2026-06-18. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, no business
-- UUID change, no financial data touched. business_code backfill is safe to rerun.

BEGIN;

-- ── 1. Human-readable business code (HF-BIZ-000001), sequence-based ──────────
CREATE SEQUENCE IF NOT EXISTS business_code_seq;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS business_code TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'business',  -- business | personal
  -- Admin override (NOT a paid subscription). Effective access honors this above sub/trial.
  ADD COLUMN IF NOT EXISTS admin_override_plan   TEXT NULL,
  ADD COLUMN IF NOT EXISTS override_started_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS override_ends_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS override_reason       TEXT NULL,
  ADD COLUMN IF NOT EXISTS override_by_user_id   BIGINT NULL;

-- Backfill codes for existing businesses (idempotent: only NULLs get a code).
UPDATE businesses
   SET business_code = 'HF-BIZ-' || LPAD(nextval('business_code_seq')::text, 6, '0')
 WHERE business_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_business_code_uidx ON businesses(business_code);

-- New businesses get a code automatically (backend may also set it explicitly).
CREATE OR REPLACE FUNCTION fn_business_code_default() RETURNS trigger AS $$
BEGIN
  IF NEW.business_code IS NULL THEN
    NEW.business_code := 'HF-BIZ-' || LPAD(nextval('business_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_business_code_default ON businesses;
CREATE TRIGGER trg_business_code_default BEFORE INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION fn_business_code_default();

-- ── 2. Access change audit (read-only history) ──────────────────────────────
CREATE TABLE IF NOT EXISTS access_audit (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  business_code         TEXT NULL,
  action                TEXT NOT NULL,  -- trial_activated|trial_extended|override_created|override_changed|override_removed|returned_to_free|subscription_corrected|business_code_backfilled
  previous_plan         TEXT NULL,
  previous_effective_plan TEXT NULL,
  new_plan              TEXT NULL,
  new_effective_plan    TEXT NULL,
  access_source         TEXT NULL,
  reason                TEXT NULL,
  changed_by_user_id    BIGINT NULL,
  changed_at            TIMESTAMPTZ DEFAULT NOW(),
  override_ends_at      TIMESTAMPTZ NULL,
  metadata              JSONB NULL
);
CREATE INDEX IF NOT EXISTS access_audit_business_idx ON access_audit(business_id, changed_at);

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT id, name, business_code, type, plan, trial_status, subscription_status, admin_override_plan
FROM businesses ORDER BY business_code;
