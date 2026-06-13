-- Migration 019 — Multiple receipt attachments per debt
-- Date: 2026-06-13
-- Additive + idempotent.
--
-- attachments: JSONB array of
--   { file_id, mime, amount, counterparty, date, recognized }
-- Keeps the legacy single attachment_url (first receipt) for compatibility.

ALTER TABLE debts ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Backfill: wrap any existing single attachment into the array
UPDATE debts
SET attachments = jsonb_build_array(jsonb_build_object('file_id', NULL, 'url', attachment_url, 'recognized', false))
WHERE attachment_url IS NOT NULL
  AND (attachments IS NULL OR attachments = '[]'::jsonb);

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'debts' AND column_name = 'attachments';
