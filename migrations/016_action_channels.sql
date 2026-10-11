-- Migration 016 — Action channel traceability for debts
-- Date: 2026-06-12
-- Additive only
--
-- Allowed channel values: 'web' | 'telegram' | 'mobile' | 'api' | 'whatsapp_future'

ALTER TABLE debts ADD COLUMN IF NOT EXISTS approved_via_channel TEXT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS last_action_channel  TEXT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS info_request_note    TEXT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS info_requested_at    TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS info_requested_by    BIGINT DEFAULT NULL;

-- Backfill: existing approved records were approved via web
UPDATE debts SET approved_via_channel = 'web'
WHERE approval_status = 'approved' AND approved_via_channel IS NULL AND approved_by_user_id IS NOT NULL;

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'debts'
  AND column_name IN ('approved_via_channel','last_action_channel','info_request_note','info_requested_at','info_requested_by');
