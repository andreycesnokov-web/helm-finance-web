-- Migration 015 — Payment tracking columns for debts
-- Date: 2026-06-11
-- Additive only

ALTER TABLE debts ADD COLUMN IF NOT EXISTS linked_transaction_id BIGINT  DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS last_payment_at       TIMESTAMPTZ DEFAULT NULL;

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'debts'
  AND column_name IN ('linked_transaction_id', 'last_payment_at');
