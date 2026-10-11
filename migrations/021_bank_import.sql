-- Migration 021 — Bank Statement Import & Reconciliation V1
-- Date: 2026-06-14
-- Additive + idempotent. No DROP, no data loss.
--
-- Staging tables only — importing a row creates a normal `transactions` record;
-- these tables never replace the ledger. business_id = UUID (matches 017).

-- ── Import batches (one per uploaded file) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_import_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  wallet_id           UUID NULL REFERENCES wallets(id),       -- target wallet (set during review)
  uploaded_by_user_id BIGINT NULL,
  source_channel      TEXT NOT NULL DEFAULT 'web',            -- web | telegram
  file_name           TEXT NULL,
  file_type           TEXT NULL,                              -- csv | xlsx
  bank_format         TEXT NULL,                              -- detected format key
  currency            TEXT NULL DEFAULT 'IDR',
  statement_start     DATE NULL,
  statement_end       DATE NULL,
  opening_balance     NUMERIC NULL,
  closing_balance     NUMERIC NULL,
  row_count           INT NOT NULL DEFAULT 0,
  matched_count       INT NOT NULL DEFAULT 0,
  duplicate_count     INT NOT NULL DEFAULT 0,
  imported_count      INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'uploaded',
  -- uploaded | parsing | review_required | ready_to_import |
  -- imported | partially_imported | cancelled | failed
  error               TEXT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bank_import_batches_business_idx ON bank_import_batches(business_id, created_at);

-- ── Parsed rows (one per statement line) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_import_rows (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES bank_import_batches(id) ON DELETE CASCADE,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  row_index             INT NOT NULL,
  raw                   JSONB DEFAULT '{}'::jsonb,            -- original columns
  tx_date               DATE NULL,
  description           TEXT NULL,
  amount                NUMERIC NULL,                         -- absolute amount
  direction             TEXT NULL,                            -- in (credit) | out (debit)
  bank_reference        TEXT NULL,
  balance_after         NUMERIC NULL,
  dedup_hash            TEXT NULL,                            -- date|amount|direction|deschash|wallet|ref
  suggested_type        TEXT NULL,                            -- income | expense
  suggested_category    TEXT NULL,
  suggested_counterparty TEXT NULL,
  confidence            NUMERIC NULL,
  match_status          TEXT NOT NULL DEFAULT 'review_required',
  -- auto_suggested | review_required | confirmed | rejected | duplicate
  matched_transaction_id BIGINT NULL,                         -- existing tx this row matches
  linked_transaction_id  BIGINT NULL,                         -- tx created on import
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bank_import_rows_batch_idx  ON bank_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS bank_import_rows_dedup_idx  ON bank_import_rows(business_id, dedup_hash);

-- ── Suggested matches to existing records (audit of matching decisions) ──────
CREATE TABLE IF NOT EXISTS bank_import_matches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES bank_import_batches(id) ON DELETE CASCADE,
  row_id                UUID NOT NULL REFERENCES bank_import_rows(id) ON DELETE CASCADE,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  matched_transaction_id BIGINT NULL,
  match_type            TEXT NULL,                            -- exact | amount_date | fuzzy
  confidence            NUMERIC NULL,
  status                TEXT NOT NULL DEFAULT 'suggested',    -- suggested | accepted | rejected
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bank_import_matches_row_idx ON bank_import_matches(row_id);

-- ── Reconciliation (ending balance check per batch) ─────────────────────────
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES bank_import_batches(id) ON DELETE CASCADE,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  wallet_id           UUID NULL REFERENCES wallets(id),
  opening_balance     NUMERIC NULL,
  closing_balance     NUMERIC NULL,                           -- stated on the statement
  computed_closing    NUMERIC NULL,                           -- opening + Σ imported rows
  difference          NUMERIC NULL,
  status              TEXT NOT NULL DEFAULT 'pending',        -- pending | balanced | unbalanced
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bank_reconciliations_batch_idx ON bank_reconciliations(batch_id);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('bank_import_batches','bank_import_rows','bank_import_matches','bank_reconciliations')
ORDER BY table_name;
