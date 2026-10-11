-- Migration 049 — Bank-import provenance on incoming_payments (PR2)
--
-- Lets a confirmed CREDIT row from the existing bank-import pipeline (migration 021) record
-- an incoming_payment, while keeping a hard pointer back to the batch and row it came from.
-- Provenance is the whole point: an accountant asking "where did this receipt come from?"
-- must land on the exact statement line, not on a re-typed copy of it.
--
-- The bank-import flow itself is UNCHANGED. This adds columns; it moves no data, converts no
-- existing row, and creates nothing on its own.
--
-- ADDITIVE and IDEMPOTENT. Two nullable columns and one partial unique index. Safe to re-run.
-- Requires 048.

BEGIN;

ALTER TABLE incoming_payments
  -- ON DELETE SET NULL, never CASCADE: deleting an import batch must not delete the evidence
  -- that money arrived. Same reasoning as linked_transaction_id in 048.
  ADD COLUMN IF NOT EXISTS bank_import_batch_id UUID NULL REFERENCES bank_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_import_row_id   UUID NULL REFERENCES bank_import_rows(id)    ON DELETE SET NULL;

-- One receipt per statement line, enforced in the DB rather than trusted to the caller.
-- Re-confirming a batch, re-running the bridge, or importing an overlapping statement cannot
-- produce a second payment for the same row. Partial, because most payments have no bank row.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_payments_bank_row_uidx
  ON incoming_payments (business_id, bank_import_row_id)
  WHERE bank_import_row_id IS NOT NULL;

-- Batch-level lookups: "show me everything this statement produced".
CREATE INDEX IF NOT EXISTS incoming_payments_bank_batch_idx
  ON incoming_payments (business_id, bank_import_batch_id)
  WHERE bank_import_batch_id IS NOT NULL;

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'incoming_payments'
  AND column_name IN ('bank_import_batch_id', 'bank_import_row_id')
ORDER BY column_name;
