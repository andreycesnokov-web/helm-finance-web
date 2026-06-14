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
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id BIGINT NULL,
  channel       TEXT NULL,              -- web | telegram | mobile | api | system
  entity_type   TEXT NOT NULL,          -- tax_profile | tax_rule | official_source | compliance_obligation | ...
  entity_id     TEXT NULL,
  action        TEXT NOT NULL,          -- created | updated | activated | deprecated | verified | generated | status_changed | ...
  before_json   JSONB NULL,
  after_json    JSONB NULL,
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
  ADD COLUMN IF NOT EXISTS generated_by        BIGINT NULL;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'audit_events' AS t, COUNT(*) FROM audit_events
UNION ALL SELECT 'tax_rules', COUNT(*) FROM tax_rules
UNION ALL SELECT 'official_sources', COUNT(*) FROM official_sources
UNION ALL SELECT 'compliance_events', COUNT(*) FROM compliance_events;
