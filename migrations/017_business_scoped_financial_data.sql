-- Migration 017 — Business-scoped financial data
-- Date: 2026-06-12
-- Additive + idempotent only. No DROP, no data loss.
--
-- Verified types: users.id = BIGINT (telegram id), businesses.id = UUID.
-- All business_id columns are therefore UUID.
--
-- Model after this migration:
--   business_id         = financial owner (the workspace)
--   user_id             = legacy owner reference (kept for compatibility)
--   created_by_user_id  = who created the record (audit)
--   approved_by_user_id = who approved (debts, already exists)

-- ── 1. business_id on all financial tables ───────────────────────────────────
ALTER TABLE wallets               ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE transactions          ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE debts                 ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE payroll_employees     ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE payroll_payments      ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE payroll_payment_items ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE cashflow_categories   ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE counterparties        ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE business_directions   ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE activity_types        ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);
ALTER TABLE reminders             ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES businesses(id);

-- ── 2. created_by audit fields where missing (debts already has them, 013) ──
ALTER TABLE transactions          ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL;
ALTER TABLE wallets               ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL;
ALTER TABLE payroll_payments      ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL;
ALTER TABLE payroll_employees     ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT NULL;

-- ── 3. Backfill: assign legacy rows to the owner's default business ─────────
-- Each user's records → the business they OWN (earliest created if several).
-- Users without a business keep NULL business_id (legacy fallback: visible to
-- owner only via user_id). ensureDefaultBusiness() creates a business at login,
-- so re-running this migration later will pick up stragglers (idempotent).

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE wallets w SET business_id = db.business_id
FROM default_biz db WHERE w.user_id = db.owner_user_id AND w.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE transactions t SET business_id = db.business_id
FROM default_biz db WHERE t.user_id = db.owner_user_id AND t.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE debts d SET business_id = db.business_id
FROM default_biz db WHERE d.user_id = db.owner_user_id AND d.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE payroll_employees p SET business_id = db.business_id
FROM default_biz db WHERE p.user_id = db.owner_user_id AND p.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE payroll_payments p SET business_id = db.business_id
FROM default_biz db WHERE p.user_id = db.owner_user_id AND p.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE payroll_payment_items p SET business_id = db.business_id
FROM default_biz db WHERE p.user_id = db.owner_user_id AND p.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE cashflow_categories c SET business_id = db.business_id
FROM default_biz db WHERE c.user_id = db.owner_user_id AND c.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE counterparties c SET business_id = db.business_id
FROM default_biz db WHERE c.user_id = db.owner_user_id AND c.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE business_directions b SET business_id = db.business_id
FROM default_biz db WHERE b.user_id = db.owner_user_id AND b.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE activity_types a SET business_id = db.business_id
FROM default_biz db WHERE a.user_id = db.owner_user_id AND a.business_id IS NULL;

WITH default_biz AS (
  SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
  FROM businesses
  ORDER BY owner_user_id, created_at ASC
)
UPDATE reminders r SET business_id = db.business_id
FROM default_biz db WHERE r.user_id = db.owner_user_id AND r.business_id IS NULL;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS wallets_business_id_idx               ON wallets(business_id);
CREATE INDEX IF NOT EXISTS transactions_business_id_idx          ON transactions(business_id);
CREATE INDEX IF NOT EXISTS debts_business_id_idx                 ON debts(business_id);
CREATE INDEX IF NOT EXISTS payroll_employees_business_id_idx     ON payroll_employees(business_id);
CREATE INDEX IF NOT EXISTS payroll_payments_business_id_idx      ON payroll_payments(business_id);
CREATE INDEX IF NOT EXISTS payroll_payment_items_business_id_idx ON payroll_payment_items(business_id);
CREATE INDEX IF NOT EXISTS cashflow_categories_business_id_idx   ON cashflow_categories(business_id);
CREATE INDEX IF NOT EXISTS counterparties_business_id_idx        ON counterparties(business_id);
CREATE INDEX IF NOT EXISTS business_directions_business_id_idx   ON business_directions(business_id);
CREATE INDEX IF NOT EXISTS activity_types_business_id_idx        ON activity_types(business_id);
CREATE INDEX IF NOT EXISTS reminders_business_id_idx             ON reminders(business_id);

-- ── 5. Verification: how many rows still lack business_id ───────────────────
SELECT 'wallets' AS table_name, COUNT(*) AS missing_business_id FROM wallets WHERE business_id IS NULL
UNION ALL SELECT 'transactions', COUNT(*)          FROM transactions WHERE business_id IS NULL
UNION ALL SELECT 'debts', COUNT(*)                 FROM debts WHERE business_id IS NULL
UNION ALL SELECT 'payroll_employees', COUNT(*)     FROM payroll_employees WHERE business_id IS NULL
UNION ALL SELECT 'payroll_payments', COUNT(*)      FROM payroll_payments WHERE business_id IS NULL
UNION ALL SELECT 'payroll_payment_items', COUNT(*) FROM payroll_payment_items WHERE business_id IS NULL
UNION ALL SELECT 'cashflow_categories', COUNT(*)   FROM cashflow_categories WHERE business_id IS NULL
UNION ALL SELECT 'counterparties', COUNT(*)        FROM counterparties WHERE business_id IS NULL
UNION ALL SELECT 'business_directions', COUNT(*)   FROM business_directions WHERE business_id IS NULL
UNION ALL SELECT 'activity_types', COUNT(*)        FROM activity_types WHERE business_id IS NULL
UNION ALL SELECT 'reminders', COUNT(*)             FROM reminders WHERE business_id IS NULL;
