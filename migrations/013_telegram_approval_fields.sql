-- Migration 013 — Telegram approval fields for debts (receivables / payables)
-- Date: 2026-06-11
-- Safe to re-run: all statements use IF NOT EXISTS
-- Additive only — no DROP, no ALTER COLUMN

-- ── Source channel tracking ────────────────────────────────────────────────────
ALTER TABLE debts ADD COLUMN IF NOT EXISTS source_channel       TEXT    DEFAULT 'web';
ALTER TABLE debts ADD COLUMN IF NOT EXISTS raw_input_text       TEXT    DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS raw_input_language   TEXT    DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS confidence_score     NUMERIC DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS attachment_url       TEXT    DEFAULT NULL;

-- ── Created-by tracking ────────────────────────────────────────────────────────
ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_by_user_id    BIGINT  DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_by_telegram_id BIGINT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_by_name       TEXT    DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_by_role       TEXT    DEFAULT NULL;

-- ── Approval flow ─────────────────────────────────────────────────────────────
ALTER TABLE debts ADD COLUMN IF NOT EXISTS approval_status      TEXT    DEFAULT 'approved';
ALTER TABLE debts ADD COLUMN IF NOT EXISTS approved_by_user_id  BIGINT  DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS rejected_reason      TEXT    DEFAULT NULL;

-- ── Backfill: existing records are trusted web entries ────────────────────────
UPDATE debts SET source_channel = 'web'      WHERE source_channel IS NULL;
UPDATE debts SET approval_status = 'approved' WHERE approval_status IS NULL;

-- ── Allowed values comments (enforced in application layer) ───────────────────
-- source_channel:  web | telegram | mobile | api | whatsapp_future
-- approval_status: approved | pending_approval | rejected

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'debts'
  AND column_name  IN (
    'source_channel','raw_input_text','raw_input_language','confidence_score',
    'attachment_url','created_by_user_id','created_by_telegram_id',
    'created_by_name','created_by_role',
    'approval_status','approved_by_user_id','approved_at','rejected_reason'
  )
ORDER BY column_name;
