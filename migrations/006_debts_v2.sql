-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006: Debts V2 — status, partial payments, priority, notes
-- Apply in Supabase SQL Editor
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING pattern)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add new columns (all nullable / with defaults → safe for existing rows)
ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS status          TEXT    DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS paid_amount     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS priority        TEXT    NULL,
  ADD COLUMN IF NOT EXISTS notes           TEXT    NULL;

-- 2. Backfill original_amount from current amount for all existing debts.
--    This preserves the original value even if amount was previously modified
--    by partial payments (old behaviour).
UPDATE debts
  SET original_amount = amount
  WHERE original_amount IS NULL;

-- 3. Backfill status for already-settled debts.
UPDATE debts
  SET status = 'paid',
      paid_amount = COALESCE(original_amount, amount)
  WHERE is_settled = true
    AND status = 'open';

-- 4. Verify (optional — returns 0 rows if migration is clean)
-- SELECT id, counterparty, amount, original_amount, paid_amount, status, is_settled
-- FROM debts LIMIT 10;
