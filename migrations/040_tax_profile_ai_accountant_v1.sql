-- ════════════════════════════════════════════════════════════════════════════
-- 040 — AI Accountant Profile V1: additive columns for the Company Tax &
--       Compliance Profile UI. PROPOSAL ONLY — NOT APPLIED to production.
--
-- Purely additive (ADD COLUMN IF NOT EXISTS). Does not touch existing columns,
-- tax calculation, rules, or applicability logic. Until applied, the frontend
-- keeps these fields as LOCAL DRAFT state; the existing TAX_PROFILE_FIELDS
-- columns continue to persist via PUT /api/accountant/profile as today.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.tax_profiles
  -- Section 1 — basic profile
  ADD COLUMN IF NOT EXISTS foreign_owned            TEXT,          -- 'yes' | 'no' | 'unknown'
  ADD COLUMN IF NOT EXISTS company_legal_name       TEXT,
  ADD COLUMN IF NOT EXISTS brand_name               TEXT,
  -- Section 2 — tax identity
  ADD COLUMN IF NOT EXISTS kpp                       TEXT,          -- registered tax office
  ADD COLUMN IF NOT EXISTS pkp_effective_date        DATE,
  -- Section 3 — business activity
  ADD COLUMN IF NOT EXISTS nib_issue_date            DATE,
  ADD COLUMN IF NOT EXISTS primary_kbli              TEXT,
  ADD COLUMN IF NOT EXISTS additional_kbli           TEXT[],
  ADD COLUMN IF NOT EXISTS actual_business_activities TEXT,
  -- Section 4 — employees
  ADD COLUMN IF NOT EXISTS employee_count            INTEGER,
  ADD COLUMN IF NOT EXISTS local_employee_count      INTEGER,
  ADD COLUMN IF NOT EXISTS foreign_employee_count    INTEGER,
  ADD COLUMN IF NOT EXISTS payroll_frequency         TEXT,
  ADD COLUMN IF NOT EXISTS bpjs_registered           BOOLEAN,
  -- Section 5 — transaction types (string array of enabled types)
  ADD COLUMN IF NOT EXISTS transaction_types         TEXT[],
  -- Per-field verification status map: { field: 'missing'|'user_declared'|
  --   'document_uploaded'|'extracted'|'accountant_verified'|'conflict' }.
  ADD COLUMN IF NOT EXISTS field_verification        JSONB DEFAULT '{}'::jsonb;

COMMIT;

-- Verify (read-only):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='tax_profiles' AND column_name IN
--   ('foreign_owned','company_legal_name','kpp','primary_kbli','employee_count',
--    'transaction_types','field_verification');
