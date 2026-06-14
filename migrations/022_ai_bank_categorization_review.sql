-- Migration 022 — AI Bank Categorization & Review Queue V1
-- Date: 2026-06-14
-- ADDITIVE + IDEMPOTENT. No DROP, no data loss, no destructive change.
--
-- Builds on 021 (bank_import_*). Adds:
--   1. suggestion + review + final-decision columns on bank_import_rows
--   2. classification_rules     — business-scoped deterministic rules (Level 1/2)
--   3. classification_feedback  — audit of AI suggestion vs user's final choice
--   4. ai_usage_events          — cost control / token accounting
--
-- Type contract (verified against existing schema):
--   business_id      = UUID  REFERENCES businesses(id)        (matches 017)
--   *_user_id        = BIGINT                                  (users.id = telegram id)
--   category_id      = UUID  REFERENCES cashflow_categories(id)
--   counterparty_id  = UUID  REFERENCES counterparties(id)
--
-- NOTE: the ledger (transactions.category) stays TEXT. Staging carries the
-- category_id for AI/validation; on confirm the backend resolves id -> name so
-- Bank Import V1 and existing reports are untouched.

-- ── 1. Extend bank_import_rows ───────────────────────────────────────────────
ALTER TABLE bank_import_rows
  ADD COLUMN IF NOT EXISTS suggested_transaction_type TEXT    NULL,
  ADD COLUMN IF NOT EXISTS suggested_category_id      UUID    NULL REFERENCES cashflow_categories(id),
  ADD COLUMN IF NOT EXISTS suggested_counterparty_id  UUID    NULL REFERENCES counterparties(id),
  ADD COLUMN IF NOT EXISTS suggested_scope            TEXT    NULL,   -- business | personal
  ADD COLUMN IF NOT EXISTS suggested_match_type       TEXT    NULL,   -- existing_tx | payable | receivable | payroll | transfer | telegram
  ADD COLUMN IF NOT EXISTS suggested_match_id         TEXT    NULL,   -- id of the matched record (type varies → TEXT)
  ADD COLUMN IF NOT EXISTS suggestion_source          TEXT    NULL,   -- rule | counterparty | match | keyword | ai | none
  ADD COLUMN IF NOT EXISTS suggestion_confidence      NUMERIC NULL,   -- 0..1
  ADD COLUMN IF NOT EXISTS suggestion_reason          TEXT    NULL,
  ADD COLUMN IF NOT EXISTS review_status              TEXT    NULL DEFAULT 'unprocessed',
  -- unprocessed | suggesting | suggested | high_confidence | needs_review |
  -- matched_existing | possible_duplicate | confirmed | excluded | imported | failed
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id        BIGINT  NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at                TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_transaction_type     TEXT    NULL,
  ADD COLUMN IF NOT EXISTS final_category_id          UUID    NULL REFERENCES cashflow_categories(id),
  ADD COLUMN IF NOT EXISTS final_counterparty_id      UUID    NULL REFERENCES counterparties(id),
  ADD COLUMN IF NOT EXISTS final_scope                TEXT    NULL;

CREATE INDEX IF NOT EXISTS bank_import_rows_review_idx ON bank_import_rows(batch_id, review_status);

-- ── 2. classification_rules ──────────────────────────────────────────────────
-- Business-specific memory. Created only from confirmed user corrections,
-- never automatically on a single choice. Suggestion layer Level 1/2.
CREATE TABLE IF NOT EXISTS classification_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_name               TEXT NULL,
  match_type              TEXT NOT NULL DEFAULT 'contains',  -- contains | equals | starts_with | regex
  match_value             TEXT NOT NULL,                     -- as entered
  normalized_value        TEXT NOT NULL,                     -- normalizeDesc(match_value)
  transaction_type        TEXT NULL,
  category_id             UUID NULL REFERENCES cashflow_categories(id),
  counterparty_id         UUID NULL REFERENCES counterparties(id),
  scope                   TEXT NULL,
  priority                INT  NOT NULL DEFAULT 100,
  is_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id      BIGINT NULL,
  created_from            TEXT NULL,                         -- confirmed_correction | manual
  confirmed_examples_count INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS classification_rules_biz_idx ON classification_rules(business_id, is_enabled, priority);
CREATE INDEX IF NOT EXISTS classification_rules_norm_idx ON classification_rules(business_id, normalized_value);

-- ── 3. classification_feedback ───────────────────────────────────────────────
-- Every AI suggestion vs final human decision, for audit + rule-promotion.
CREATE TABLE IF NOT EXISTS classification_feedback (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bank_import_row_id       UUID NULL REFERENCES bank_import_rows(id) ON DELETE SET NULL,
  normalized_desc          TEXT NULL,
  suggested_category_id    UUID NULL REFERENCES cashflow_categories(id),
  final_category_id        UUID NULL REFERENCES cashflow_categories(id),
  suggested_transaction_type TEXT NULL,
  final_transaction_type   TEXT NULL,
  confidence               NUMERIC NULL,
  accepted                 BOOLEAN NULL,    -- did user keep the AI suggestion?
  source                   TEXT NULL,       -- bank_review | post_import_edit
  reviewed_by_user_id      BIGINT NULL,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS classification_feedback_biz_idx ON classification_feedback(business_id, normalized_desc);

-- ── 4. ai_usage_events ───────────────────────────────────────────────────────
-- Token / cost accounting for AI categorization (and reusable for other AI features).
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NULL REFERENCES businesses(id) ON DELETE CASCADE,
  feature         TEXT NOT NULL,            -- 'bank_categorization_ai'
  batch_id        UUID NULL,
  rows_processed  INT  NULL,
  model           TEXT NULL,
  input_tokens    INT  NULL,
  output_tokens   INT  NULL,
  cost_estimate   NUMERIC NULL,
  created_by_user_id BIGINT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_biz_idx ON ai_usage_events(business_id, feature, created_at);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('classification_rules','classification_feedback','ai_usage_events')
ORDER BY table_name;
