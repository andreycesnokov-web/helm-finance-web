-- Migration 018 — Team onboarding & Telegram activation training
-- Date: 2026-06-12
-- Additive + idempotent. No DROP, no data loss.

-- ── business_members: onboarding progress ───────────────────────────────────
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS onboarding_status          TEXT DEFAULT 'not_started';
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS onboarding_step            TEXT DEFAULT NULL;
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS telegram_connected_at      TIMESTAMPTZ NULL;
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS telegram_test_completed_at TIMESTAMPTZ NULL;
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS last_onboarding_event_at   TIMESTAMPTZ NULL;

-- ── debts: training mode (test submissions, zero cash impact) ────────────────
ALTER TABLE debts ADD COLUMN IF NOT EXISTS is_training   BOOLEAN DEFAULT false;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS training_type TEXT    DEFAULT NULL;
-- training_type: 'payable' | 'receivable' | 'expense_request'

-- ── transactions: training flag (not used by MVP, future-proof) ──────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_training   BOOLEAN DEFAULT false;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS training_type TEXT    DEFAULT NULL;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS debts_is_training_idx                    ON debts(is_training);
CREATE INDEX IF NOT EXISTS business_members_onboarding_status_idx   ON business_members(onboarding_status);

-- Backfill: existing rows are real data
UPDATE debts        SET is_training = false WHERE is_training IS NULL;
UPDATE transactions SET is_training = false WHERE is_training IS NULL;
