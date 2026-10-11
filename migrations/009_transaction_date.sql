-- TASK: Fix wallet transaction linking
-- Add transaction_date column to transactions table for correct period filtering.
-- Backfill from created_at for existing rows.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_date DATE;

UPDATE transactions
  SET transaction_date = created_at::date
  WHERE transaction_date IS NULL;
