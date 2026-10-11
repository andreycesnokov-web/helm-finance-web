-- Helm Finance — Group E Additive Migration
-- Date: 2026-06-09
-- Safe to re-run: all statements use IF NOT EXISTS
-- No data loss: additive only, no DROP, no ALTER COLUMN

-- 1. Add category text column to transactions
--    Replaces the broken category_id FK (which is always null).
--    Both Telegram Bot and Web App will write to this column.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;

-- 2. Add snoozed_until timestamp to reminders
--    Required for the snooze modal (Group F).
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL;

-- Verify columns were added (run this after the above to confirm):
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'transactions' AND column_name IN ('category', 'category_id', 'account_id'))
    OR
    (table_name = 'reminders' AND column_name = 'snoozed_until')
  )
ORDER BY table_name, column_name;
