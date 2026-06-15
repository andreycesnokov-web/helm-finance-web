-- Migration 024 — Indonesia Tax Rule Pack V1: professional review + content
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. No DROP, no data loss, no destructive change.
-- Does NOT seed any active rule. Rules are created as draft/under_review and
-- only activated through the workflow (source verified + professional approved).
--
-- Builds on 020 + 023. Type contract: business/platform ids UUID, *_user_id BIGINT.

-- ── 1. Professional review records (one per rule version review) ─────────────
CREATE TABLE IF NOT EXISTS tax_rule_reviews (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_rule_id                 UUID NOT NULL REFERENCES tax_rules(id) ON DELETE CASCADE,
  rule_version                INT NULL,
  reviewer_user_id            BIGINT NULL,
  reviewer_name               TEXT NULL,
  reviewer_role               TEXT NULL,          -- tax_consultant | public_accountant | KAP | internal
  license_number              TEXT NULL,
  license_type                TEXT NULL,
  issuing_authority           TEXT NULL,
  license_verification_status TEXT NOT NULL DEFAULT 'unverified', -- unverified | manually_verified | failed
  review_status               TEXT NOT NULL DEFAULT 'pending',
  -- pending | in_review | changes_required | approved | rejected | expired
  review_scope                TEXT NULL,
  review_notes                TEXT NULL,
  changes_requested_json      JSONB NULL,
  reviewed_at                 TIMESTAMPTZ NULL,
  expires_at                  TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_rule_reviews_rule_idx   ON tax_rule_reviews(tax_rule_id, rule_version);
CREATE INDEX IF NOT EXISTS tax_rule_reviews_status_idx ON tax_rule_reviews(review_status);

-- ── 2. Rule content structuring (explanation + computational status) ─────────
-- (existing reused: parameters, applies_when, due_date_rule_json, effective_*,
--  official_source_id, version, status, reviewed_by/at, supersedes_rule_id)
ALTER TABLE tax_rules
  ADD COLUMN IF NOT EXISTS interpretation_notes    TEXT  NULL,   -- explanation, NOT a calc source
  ADD COLUMN IF NOT EXISTS exceptions              JSONB NULL,
  ADD COLUMN IF NOT EXISTS required_profile_fields JSONB NULL,
  ADD COLUMN IF NOT EXISTS parameters_status       TEXT  NOT NULL DEFAULT 'not_defined';
  -- not_defined | draft | professionally_reviewed | approved
  -- Only professionally_reviewed/approved params may later feed the Tax Draft Engine.

-- ── 3. Official source pack — provenance + amendment tracking ────────────────
-- (existing reused: source_type, document_number, effective_from/to, language,
--  content_hash, status, notes, last_verified_at, verified_by_user_id)
ALTER TABLE official_sources
  ADD COLUMN IF NOT EXISTS relevant_sections        TEXT  NULL,
  ADD COLUMN IF NOT EXISTS quoted_section_reference TEXT  NULL,
  ADD COLUMN IF NOT EXISTS interpretation_notes     TEXT  NULL,
  ADD COLUMN IF NOT EXISTS superseded_documents     JSONB NULL,
  ADD COLUMN IF NOT EXISTS known_amendments         JSONB NULL,
  ADD COLUMN IF NOT EXISTS accessed_at              TIMESTAMPTZ NULL;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'tax_rule_reviews' AS check, COUNT(*)::text AS value FROM tax_rule_reviews
UNION ALL SELECT 'tax_rules total', COUNT(*)::text FROM tax_rules
UNION ALL SELECT 'tax_rules active', COUNT(*)::text FROM tax_rules WHERE status='active';
