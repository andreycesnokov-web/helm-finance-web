-- Migration 023 — Tax Engine Foundation V1
-- Date: 2026-06-14
-- ADDITIVE + IDEMPOTENT. No DROP, no data loss, no destructive change.
--
-- Builds on 020 (official_sources, tax_rules, tax_profiles, compliance_events,
-- business_addons). Those tables ALREADY EXIST and are reused — this migration
-- only ADDs the columns the Tax Engine Foundation V1 needs, plus a generic
-- audit_events table (none existed before).
--
-- Type contract (verified against existing schema):
--   business_id      = UUID REFERENCES businesses(id)
--   *_user_id        = BIGINT (users.id = telegram id)
--   rule/source ids  = UUID

-- ── 1. Generic audit trail (NEW — none existed) ──────────────────────────────
-- APPEND-ONLY by application contract: no update/delete endpoints are exposed;
-- normal users cannot edit or remove events. Never store secrets/tokens or
-- unnecessary personal data in before_json/after_json. business_id is NULL for
-- platform-level entities (tax_rules, official_sources).
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id BIGINT NULL,
  actor_role    TEXT NULL,              -- role at time of action (owner|cfo|accountant|platform_admin|...)
  channel       TEXT NULL,              -- web | telegram | mobile | api | system
  entity_type   TEXT NOT NULL,          -- tax_profile | tax_rule | official_source | compliance_obligation | ...
  entity_id     TEXT NULL,
  action        TEXT NOT NULL,          -- created | updated | activated | deprecated | verified | generated | status_changed | ...
  before_json   JSONB NULL,
  after_json    JSONB NULL,
  request_id    TEXT NULL,              -- correlation id for tracing a single request
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_business_idx ON audit_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx   ON audit_events(entity_type, entity_id);

-- ── 2. tax_profiles — add profile status, verification, NPWP/NIB, audit ───────
-- (existing reused: country, jurisdiction, legal_entity_type, tax_residency,
--  tax_regime, tax_identifier, financial_year_start/end, vat_status, pkp_status,
--  employee_status, payroll_tax_status, industry, business_activity_codes,
--  accounting_method, reporting_currency, filing_frequency, professional_partner_id)
ALTER TABLE tax_profiles
  ADD COLUMN IF NOT EXISTS npwp                  TEXT NULL,   -- Indonesia tax ID (alias of tax_identifier; kept explicit)
  ADD COLUMN IF NOT EXISTS nib                   TEXT NULL,   -- business identification number
  ADD COLUMN IF NOT EXISTS withholding_tax_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_status        TEXT NOT NULL DEFAULT 'incomplete',
  -- incomplete | draft | active | needs_review | verified | archived
  ADD COLUMN IF NOT EXISTS verified_by_user_id   BIGINT NULL,
  ADD COLUMN IF NOT EXISTS verified_at           TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id    BIGINT NULL;

-- ── 3. official_sources — add type, validity window, status, integrity ───────
-- (existing reused: jurisdiction(country), authority, title(source_title),
--  url(source_url), publication_date, last_verified_at, verified_by_user_id)
ALTER TABLE official_sources
  ADD COLUMN IF NOT EXISTS source_type     TEXT NULL,   -- law | regulation | portal | ministry_publication
  ADD COLUMN IF NOT EXISTS document_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS effective_from  DATE NULL,
  ADD COLUMN IF NOT EXISTS effective_to    DATE NULL,
  ADD COLUMN IF NOT EXISTS language        TEXT NULL,
  ADD COLUMN IF NOT EXISTS content_hash    TEXT NULL,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'draft',
  -- draft | verified | active | outdated | unavailable | replaced
  ADD COLUMN IF NOT EXISTS notes           TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();

-- ── 4. tax_rules — versioning workflow + structured due-date + multi-match ────
-- (existing reused: jurisdiction, country, legal_entity_type, tax_regime,
--  obligation_type, rule_code, title, description, calculation_method,
--  parameters(parameters_json), filing_frequency, payment_frequency,
--  due_date_rule(text), applies_when(applicability_conditions_json),
--  official_source_id, effective_from, effective_to, last_verified_at,
--  verified_by_user_id, version, status)
ALTER TABLE tax_rules
  ADD COLUMN IF NOT EXISTS legal_entity_types  JSONB NULL,   -- multi-value; legal_entity_type kept for back-compat
  ADD COLUMN IF NOT EXISTS tax_regimes         JSONB NULL,
  ADD COLUMN IF NOT EXISTS due_date_rule_json  JSONB NULL,   -- structured; due_date_rule(text) kept for back-compat
  ADD COLUMN IF NOT EXISTS supersedes_rule_id  UUID NULL REFERENCES tax_rules(id),
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id  BIGINT NULL,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();

-- Versioning guarantee: one row per (rule_code, version). A change creates a new
-- version; the old row stays immutable and keeps its links to existing events.
CREATE UNIQUE INDEX IF NOT EXISTS tax_rules_code_version_uniq ON tax_rules(rule_code, version);

-- ── 5. compliance_events — richer obligation tracking (acts as compliance_obligations) ─
-- (existing reused: rule_id(tax_rule_id), rule_code, obligation_type, title,
--  period, due_date, estimated_amount, currency, status,
--  professional_review_status, owner_approval_status, payment_status, filing_status)
ALTER TABLE compliance_events
  ADD COLUMN IF NOT EXISTS rule_version        INT NULL,
  ADD COLUMN IF NOT EXISTS period_start        DATE NULL,
  ADD COLUMN IF NOT EXISTS period_end          DATE NULL,
  ADD COLUMN IF NOT EXISTS amount_status       TEXT NOT NULL DEFAULT 'unknown',
  -- unknown | estimated | calculated | professionally_reviewed | owner_confirmed
  ADD COLUMN IF NOT EXISTS confirmed_amount    NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS calculation_status  TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_snapshot_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS generated_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS generated_by        BIGINT NULL,
  ADD COLUMN IF NOT EXISTS source_verification_required BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 6. Legacy seed handling (data, idempotent) ───────────────────────────────
-- Migration 020 seeded 3 Indonesia rules as 'active' but with unverified
-- sources (last_verified_at IS NULL). Per V1 rule "active requires a verified
-- source", demote them to 'under_review' (NOT draft) so they stop driving new
-- obligations / AI / Decision Engine until a professional verifies the source.
-- Idempotent: only touches still-active, unverified rows.
UPDATE tax_rules
   SET status = 'under_review',
       updated_at = NOW()
 WHERE status = 'active'
   AND last_verified_at IS NULL;

-- Keep already-generated calendar events (history) but flag them so AI / CFO /
-- Decision Engine treat them as unconfirmed until the source is verified.
UPDATE compliance_events ce
   SET source_verification_required = TRUE,
       updated_at = NOW()
  FROM tax_rules tr
 WHERE ce.rule_code = tr.rule_code
   AND tr.status = 'under_review'
   AND tr.last_verified_at IS NULL;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: audit_events table present; tax_rules now show 'under_review' for the
-- 3 unverified seeds; flagged compliance_events counted.
SELECT 'audit_events rows'            AS check, COUNT(*)::text AS value FROM audit_events
UNION ALL SELECT 'tax_rules total',            COUNT(*)::text FROM tax_rules
UNION ALL SELECT 'tax_rules under_review',     COUNT(*)::text FROM tax_rules WHERE status='under_review'
UNION ALL SELECT 'tax_rules active',           COUNT(*)::text FROM tax_rules WHERE status='active'
UNION ALL SELECT 'events flagged unverified',  COUNT(*)::text FROM compliance_events WHERE source_verification_required;
