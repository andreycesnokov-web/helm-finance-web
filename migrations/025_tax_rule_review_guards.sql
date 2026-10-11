-- Migration 025 — Tax rule review: DB-level approval guards + status naming
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. No DROP of data. Builds on 024 (tax_rule_reviews).
--
-- Fixes:
--  * single license status value `verified` (not `manually_verified`); the
--    method is stored separately in `verification_method`.
--  * the DATABASE — not just the PATCH endpoint — rejects an `approved` review
--    that lacks reviewer identity, license data, verified license or reviewed_at.
--  * only ONE active approved review per (tax_rule_id, rule_version).
-- tax_rule_reviews currently has 0 rows, so no backfill is required.

ALTER TABLE tax_rule_reviews
  ADD COLUMN IF NOT EXISTS verification_method TEXT NULL;  -- e.g. 'manual'

-- Allowed review_status values
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_rule_reviews_review_status_chk') THEN
    ALTER TABLE tax_rule_reviews ADD CONSTRAINT tax_rule_reviews_review_status_chk
      CHECK (review_status IN ('pending','in_review','changes_required','approved','rejected','expired','superseded'));
  END IF;
END $$;

-- Allowed license_verification_status values (single 'verified')
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_rule_reviews_license_status_chk') THEN
    ALTER TABLE tax_rule_reviews ADD CONSTRAINT tax_rule_reviews_license_status_chk
      CHECK (license_verification_status IN ('unverified','verified','failed'));
  END IF;
END $$;

-- An approved review MUST carry reviewer identity, license data, a verified
-- license and a reviewed_at timestamp. Enforced at the database level.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_rule_reviews_approved_integrity_chk') THEN
    ALTER TABLE tax_rule_reviews ADD CONSTRAINT tax_rule_reviews_approved_integrity_chk
      CHECK (
        review_status <> 'approved' OR (
          reviewer_name IS NOT NULL
          AND license_number IS NOT NULL
          AND license_verification_status = 'verified'
          AND reviewed_at IS NOT NULL
        )
      );
  END IF;
END $$;

-- At most one ACTIVE approved review per rule version.
CREATE UNIQUE INDEX IF NOT EXISTS tax_rule_reviews_one_approved
  ON tax_rule_reviews(tax_rule_id, rule_version)
  WHERE review_status = 'approved';

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT conname FROM pg_constraint
WHERE conrelid = 'tax_rule_reviews'::regclass
  AND conname IN ('tax_rule_reviews_review_status_chk','tax_rule_reviews_license_status_chk','tax_rule_reviews_approved_integrity_chk')
ORDER BY conname;
