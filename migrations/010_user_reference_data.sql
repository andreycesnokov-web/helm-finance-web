-- Migration 010: Make reference data user-owned
-- Date: 2026-06-11
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING
-- No data loss: additive only — no DROP, no hard DELETE

-- Add new columns to cashflow_categories
ALTER TABLE cashflow_categories
  ADD COLUMN IF NOT EXISTS language    TEXT    NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source      TEXT    NULL DEFAULT 'user';

-- Add new columns to business_directions
ALTER TABLE business_directions
  ADD COLUMN IF NOT EXISTS language    TEXT    NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source      TEXT    NULL DEFAULT 'user';

-- Add new columns to activity_types
ALTER TABLE activity_types
  ADD COLUMN IF NOT EXISTS language    TEXT    NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source      TEXT    NULL DEFAULT 'user';

-- Convert existing global seed data to inactive templates
-- They stay in DB so old transaction foreign-key references still resolve,
-- but is_active=false means they won't appear in dropdowns for any user.
UPDATE cashflow_categories
  SET is_template = true,
      is_active   = false,
      source      = 'helm_care_template'
  WHERE user_id IS NULL;

UPDATE business_directions
  SET is_template = true,
      is_active   = false,
      source      = 'helm_care_template'
  WHERE user_id IS NULL;

UPDATE activity_types
  SET is_template = true,
      is_active   = false,
      source      = 'helm_care_template'
  WHERE user_id IS NULL;

-- Verification query (run to confirm)
SELECT table_name, COUNT(*) AS total_rows,
       SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active_rows,
       SUM(CASE WHEN is_template THEN 1 ELSE 0 END) AS template_rows
FROM (
  SELECT 'cashflow_categories' AS table_name, is_active, is_template FROM cashflow_categories
  UNION ALL
  SELECT 'business_directions', is_active, is_template FROM business_directions
  UNION ALL
  SELECT 'activity_types', is_active, is_template FROM activity_types
) t
GROUP BY table_name
ORDER BY table_name;
