-- Migration 020 — AI Accountant foundation (Phase 1, step 1)
-- Date: 2026-06-13
-- Additive + idempotent. No DROP, no data loss.
--
-- Tables: official_sources, tax_rules (versioned), tax_profiles (business),
--         compliance_events (business), business_addons (entitlements).
-- All business-scoped tables use business_id UUID → businesses(id).
-- Rules are NEVER overwritten — a change creates a new version row.

-- ── Add-on entitlements ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_addons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  addon        TEXT NOT NULL,          -- 'ai_accountant_compliance' | '..._review' | '..._full'
  status       TEXT NOT NULL DEFAULT 'active',  -- active | trialing | suspended | cancelled
  granted_by   BIGINT NULL,
  granted_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, addon)
);
CREATE INDEX IF NOT EXISTS business_addons_business_id_idx ON business_addons(business_id);

-- ── Official sources (jurisdiction reference; manually verified in V1) ───────
CREATE TABLE IF NOT EXISTS official_sources (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction       TEXT NOT NULL,        -- e.g. 'ID'
  authority          TEXT NOT NULL,        -- e.g. 'Direktorat Jenderal Pajak'
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  publication_date   DATE NULL,
  last_verified_at   TIMESTAMPTZ NULL,
  verified_by_user_id BIGINT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS official_sources_jurisdiction_idx ON official_sources(jurisdiction);

-- ── Tax rules registry (versioned) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction       TEXT NOT NULL,
  country            TEXT NOT NULL,
  legal_entity_type  TEXT NULL,            -- NULL = applies to all entity types
  tax_regime         TEXT NULL,
  obligation_type    TEXT NOT NULL,        -- corporate_income_tax | vat | payroll_tax | ...
  rule_code          TEXT NOT NULL,        -- stable code, e.g. 'ID_PPN_MONTHLY'
  title              TEXT NOT NULL,
  description        TEXT NULL,
  calculation_method TEXT NULL,            -- human description of the formula
  parameters         JSONB DEFAULT '{}'::jsonb,  -- { rate, thresholds, ... }
  filing_frequency   TEXT NULL,            -- monthly | quarterly | annual
  payment_frequency  TEXT NULL,
  due_date_rule      TEXT NULL,            -- machine hint, e.g. 'day:31 of next month'
  applies_when       JSONB DEFAULT '{}'::jsonb,  -- { vat_status:'pkp', has_employees:true }
  official_source_id UUID NULL REFERENCES official_sources(id),
  effective_from     DATE NULL,
  effective_to       DATE NULL,
  last_verified_at   TIMESTAMPTZ NULL,
  verified_by_user_id BIGINT NULL,
  version            INT NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'draft',  -- draft|under_review|active|deprecated|superseded
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_rules_lookup_idx ON tax_rules(jurisdiction, status);
CREATE INDEX IF NOT EXISTS tax_rules_code_idx   ON tax_rules(rule_code, version);

-- ── Business tax & compliance profile (one per business) ────────────────────
CREATE TABLE IF NOT EXISTS tax_profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  country              TEXT NULL,
  jurisdiction         TEXT NULL,
  legal_entity_type    TEXT NULL,          -- PT | CV | Perorangan | ...
  tax_residency        TEXT NULL,
  tax_regime           TEXT NULL,          -- normal | pp23_final | ...
  tax_identifier       TEXT NULL,          -- NPWP
  financial_year_start TEXT NULL,          -- 'MM-DD'
  financial_year_end   TEXT NULL,
  vat_status           TEXT NULL,          -- pkp | non_pkp | not_registered
  pkp_status           TEXT NULL,
  employee_status      TEXT NULL,          -- has_employees | none
  payroll_tax_status   TEXT NULL,
  industry             TEXT NULL,
  business_activity_codes TEXT NULL,
  accounting_method    TEXT NULL,          -- accrual | cash
  reporting_currency   TEXT NULL DEFAULT 'IDR',
  filing_frequency     TEXT NULL,
  professional_partner_id BIGINT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Compliance calendar events (generated from profile + active rules) ──────
CREATE TABLE IF NOT EXISTS compliance_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id                  UUID NULL REFERENCES tax_rules(id),
  rule_code                TEXT NULL,
  obligation_type          TEXT NULL,
  title                    TEXT NULL,
  period                   TEXT NULL,       -- e.g. '2026-05' or '2025'
  due_date                 DATE NULL,
  estimated_amount         NUMERIC NULL,
  currency                 TEXT NULL DEFAULT 'IDR',
  status                   TEXT NOT NULL DEFAULT 'upcoming',
  professional_review_status TEXT NULL DEFAULT 'not_started',
  owner_approval_status    TEXT NULL DEFAULT 'not_required',
  payment_status           TEXT NULL DEFAULT 'unpaid',
  filing_status            TEXT NULL DEFAULT 'not_filed',
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, rule_code, period)
);
CREATE INDEX IF NOT EXISTS compliance_events_business_idx ON compliance_events(business_id, due_date);

-- ── Seed: Indonesia official sources + common rules (V1, verify with a pro) ─
-- These are marked active so the calendar can build, but last_verified_at is
-- NULL until a licensed professional confirms them in-app.
INSERT INTO official_sources (id, jurisdiction, authority, title, url, publication_date)
SELECT '11111111-1111-1111-1111-111111111111', 'ID', 'Direktorat Jenderal Pajak',
       'DJP — Pajak Pertambahan Nilai (PPN)', 'https://www.pajak.go.id/id/pajak-pertambahan-nilai-ppn', NULL
WHERE NOT EXISTS (SELECT 1 FROM official_sources WHERE id = '11111111-1111-1111-1111-111111111111');

INSERT INTO official_sources (id, jurisdiction, authority, title, url, publication_date)
SELECT '22222222-2222-2222-2222-222222222222', 'ID', 'Direktorat Jenderal Pajak',
       'DJP — Pajak Penghasilan Badan (PPh Badan)', 'https://www.pajak.go.id/id/pajak-penghasilan-pph', NULL
WHERE NOT EXISTS (SELECT 1 FROM official_sources WHERE id = '22222222-2222-2222-2222-222222222222');

INSERT INTO official_sources (id, jurisdiction, authority, title, url, publication_date)
SELECT '33333333-3333-3333-3333-333333333333', 'ID', 'Direktorat Jenderal Pajak',
       'DJP — PPh Pasal 21 (Pemotongan Gaji)', 'https://www.pajak.go.id/id/pph-pasal-21', NULL
WHERE NOT EXISTS (SELECT 1 FROM official_sources WHERE id = '33333333-3333-3333-3333-333333333333');

INSERT INTO tax_rules (jurisdiction, country, obligation_type, rule_code, title, description, calculation_method, parameters, filing_frequency, payment_frequency, due_date_rule, applies_when, official_source_id, status)
SELECT 'ID','Indonesia','vat','ID_PPN_MONTHLY','PPN (VAT) — monthly return',
       'Value Added Tax on taxable supplies, reported monthly by a registered taxable enterprise (PKP).',
       'output_vat = 11% of taxable sales; payable = output_vat − creditable input_vat',
       '{"rate":0.11}'::jsonb,'monthly','monthly','end of following month',
       '{"vat_status":"pkp"}'::jsonb,'11111111-1111-1111-1111-111111111111','active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE rule_code = 'ID_PPN_MONTHLY');

INSERT INTO tax_rules (jurisdiction, country, legal_entity_type, obligation_type, rule_code, title, description, calculation_method, parameters, filing_frequency, payment_frequency, due_date_rule, applies_when, official_source_id, status)
SELECT 'ID','Indonesia','PT','corporate_income_tax','ID_PPH_BADAN_ANNUAL','PPh Badan — annual corporate income tax',
       'Annual corporate income tax return for a limited company (PT).',
       'estimated = 22% of annual taxable profit (general rate; small-business facilities may apply)',
       '{"rate":0.22}'::jsonb,'annual','annual','4 months after financial year end',
       '{}'::jsonb,'22222222-2222-2222-2222-222222222222','active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE rule_code = 'ID_PPH_BADAN_ANNUAL');

INSERT INTO tax_rules (jurisdiction, country, obligation_type, rule_code, title, description, calculation_method, parameters, filing_frequency, payment_frequency, due_date_rule, applies_when, official_source_id, status)
SELECT 'ID','Indonesia','payroll_tax','ID_PPH21_MONTHLY','PPh 21 — monthly payroll withholding',
       'Monthly withholding of employee income tax (PPh 21) by the employer.',
       'withholding computed per employee from gross salary using progressive PPh 21 schedule',
       '{}'::jsonb,'monthly','monthly','payment by the 10th, return by the 20th of the following month',
       '{"has_employees":true}'::jsonb,'33333333-3333-3333-3333-333333333333','active'
WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE rule_code = 'ID_PPH21_MONTHLY');

-- Verify
SELECT 'tax_rules' AS t, COUNT(*) FROM tax_rules
UNION ALL SELECT 'official_sources', COUNT(*) FROM official_sources;
