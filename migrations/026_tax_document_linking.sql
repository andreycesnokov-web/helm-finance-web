-- Migration 026 — Shared Financial Document Foundation V1
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. No DROP, NO seed, NO cash movement.
-- Cash lives ONLY in `transactions`. This layer adds documents, logical
-- documents, links, tax treatments, withholding and SETTLEMENT allocations.
--
-- VERIFIED key types: businesses/counterparties/compliance_events/payroll_payments = UUID;
--   debts.id / transactions.id = BIGINT; *_user_id = BIGINT.
--
-- ON DELETE policy: evidence keeps RESTRICT to ledger + business_id. Businesses
-- are SOFT-deleted (archived) in the app; a hard purge is a separate admin
-- procedure (export + audit), never an FK cascade. Pure document↔document links
-- CASCADE with their documents (meaningless without them).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. document_files — the PHYSICAL uploaded file (dedup lives here)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS document_files (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  storage_path       TEXT NOT NULL,
  file_name          TEXT NULL,
  mime_type          TEXT NULL,
  file_size          BIGINT NULL,
  sha256_hash        TEXT NOT NULL,
  upload_channel     TEXT NULL,            -- web | telegram | mobile | api
  uploaded_by_user_id BIGINT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  archived_at        TIMESTAMPTZ NULL
);
-- Dedup of the physical file, per business.
CREATE UNIQUE INDEX IF NOT EXISTS document_files_dedup_idx ON document_files(business_id, sha256_hash);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. financial_documents — a LOGICAL document (a page-range of a file)
--    One physical file may hold several logical documents.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS financial_documents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  file_id                UUID NOT NULL REFERENCES document_files(id) ON DELETE RESTRICT,
  page_start             INT NOT NULL DEFAULT 1,
  page_end               INT NOT NULL DEFAULT 1,
  document_type          TEXT NOT NULL CHECK (document_type IN
    ('vendor_invoice','customer_invoice','tax_invoice','bukti_potong','tax_billing','payment_proof','filing_confirmation','bank_document','other')),
  document_number        TEXT NULL,
  document_date          DATE NULL,
  period_start           DATE NULL,
  period_end             DATE NULL,
  issuer_counterparty_id UUID NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  recipient_business_id  UUID NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  currency               TEXT NULL DEFAULT 'IDR',
  commercial_base_amount NUMERIC(20,2) NULL,
  commercial_tax_amount  NUMERIC(20,2) NULL,
  gross_amount           NUMERIC(20,2) NULL,
  official_tax_base      NUMERIC(20,2) NULL,
  official_tax_amount    NUMERIC(20,2) NULL,
  extraction_status      TEXT NOT NULL DEFAULT 'pending',   -- pending|extracting|extracted|failed
  extracted_json         JSONB NULL,                        -- AI/OCR output, separate from confirmed values
  review_status          TEXT NOT NULL DEFAULT 'needs_review', -- needs_review|confirmed|rejected
  reviewed_by_user_id    BIGINT NULL,
  reviewed_at            TIMESTAMPTZ NULL,
  created_by_user_id     BIGINT NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  archived_at            TIMESTAMPTZ NULL,
  CHECK (page_start > 0),
  CHECK (page_end >= page_start)
);
-- NOTE: NO sha unique here — dedup is on document_files. One file → many docs.
CREATE INDEX IF NOT EXISTS fin_docs_business_type_idx ON financial_documents(business_id, document_type);
CREATE INDEX IF NOT EXISTS fin_docs_number_idx        ON financial_documents(business_id, document_number);
CREATE INDEX IF NOT EXISTS fin_docs_file_idx          ON financial_documents(file_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. document_links + document↔CFO-entity links (referential, not polymorphic)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS document_links (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  source_document_id   UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  target_document_id   UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  link_type            TEXT NOT NULL CHECK (link_type IN
    ('supports','tax_invoice_for','withholding_for','payment_proof_for','tax_billing_for','filing_for','supersedes','related')),
  match_confidence     NUMERIC NULL,
  match_reason         TEXT NULL,
  match_status         TEXT NOT NULL DEFAULT 'suggested',  -- suggested|needs_review|confirmed|rejected
  confirmed_by_user_id BIGINT NULL,
  confirmed_at         TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  CHECK (source_document_id <> target_document_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS document_links_uniq ON document_links(source_document_id, target_document_id, link_type);

CREATE TABLE IF NOT EXISTS document_debt_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID   NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id UUID   NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  debt_id     BIGINT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, debt_id)
);
CREATE TABLE IF NOT EXISTS document_transaction_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID   NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id    UUID   NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, transaction_id)
);
CREATE TABLE IF NOT EXISTS document_compliance_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id         UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  compliance_event_id UUID NOT NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  created_by_user_id  BIGINT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, compliance_event_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. tax_treatments + withholding_records (Accountant AI interpretation)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tax_treatments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id             BIGINT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  invoice_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  treatment_status    TEXT NOT NULL DEFAULT 'suggested',
  -- suggested|needs_review|confirmed|professionally_reviewed|rejected|superseded
  tax_type            TEXT NULL,
  tax_nature          TEXT NULL,
  tax_object_code     TEXT NULL,
  commercial_base     NUMERIC(20,2) NULL,
  vat_dpp             NUMERIC(20,2) NULL,
  vat_amount          NUMERIC(20,2) NULL,
  withholding_dpp     NUMERIC(20,2) NULL,
  withholding_rate    NUMERIC NULL,
  withholding_amount  NUMERIC(20,2) NULL,
  expected_vendor_net NUMERIC(20,2) NULL,
  rule_id             UUID NULL REFERENCES tax_rules(id) ON DELETE SET NULL,
  rule_version        INT NULL,
  source_id           UUID NULL REFERENCES official_sources(id) ON DELETE SET NULL,
  suggestion_source   TEXT NULL,
  confidence          NUMERIC NULL,
  reviewed_by_user_id BIGINT NULL,
  reviewed_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_treatments_business_idx ON tax_treatments(business_id, treatment_status);
CREATE INDEX IF NOT EXISTS tax_treatments_debt_idx     ON tax_treatments(debt_id);

CREATE TABLE IF NOT EXISTS withholding_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  tax_treatment_id           UUID NULL REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  debt_id                    BIGINT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  invoice_document_id        UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  bukti_potong_document_id   UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  tax_type                   TEXT NULL,
  tax_nature                 TEXT NULL,
  tax_object_code            TEXT NULL,
  tax_base                   NUMERIC(20,2) NULL,
  tax_rate                   NUMERIC NULL,
  withholding_amount         NUMERIC(20,2) NULL,
  expected_vendor_net_amount NUMERIC(20,2) NULL,
  status                     TEXT NOT NULL DEFAULT 'suggested',
  -- suggested|needs_review|confirmed|certificate_issued|tax_payable|partially_paid|paid|filed|reconciled
  reported_at                TIMESTAMPTZ NULL,
  paid_at                    TIMESTAMPTZ NULL,
  filing_status              TEXT NULL DEFAULT 'not_filed',
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS withholding_records_business_idx ON withholding_records(business_id, status);
CREATE INDEX IF NOT EXISTS withholding_records_debt_idx     ON withholding_records(debt_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Settlement allocations
--    A payable can be settled by CASH (transaction) OR by a confirmed
--    withholding record (no cash) OR a credit note / adjustment.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS debt_settlement_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID   NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id              BIGINT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  settlement_source_type TEXT NOT NULL CHECK (settlement_source_type IN ('transaction','withholding_record','credit_note','adjustment')),
  transaction_id       BIGINT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  withholding_record_id UUID  NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  credit_note_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  allocated_amount     NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id   BIGINT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  -- exactly the field matching the source type is set
  CHECK (
    (settlement_source_type = 'transaction'       AND transaction_id IS NOT NULL AND withholding_record_id IS NULL AND credit_note_document_id IS NULL) OR
    (settlement_source_type = 'withholding_record' AND withholding_record_id IS NOT NULL AND transaction_id IS NULL AND credit_note_document_id IS NULL) OR
    (settlement_source_type = 'credit_note'        AND credit_note_document_id IS NOT NULL AND transaction_id IS NULL AND withholding_record_id IS NULL) OR
    (settlement_source_type = 'adjustment'         AND transaction_id IS NULL AND withholding_record_id IS NULL AND credit_note_document_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS debt_settle_debt_idx ON debt_settlement_allocations(debt_id);
-- One transaction allocated to a debt at most once.
CREATE UNIQUE INDEX IF NOT EXISTS debt_settle_tx_uniq ON debt_settlement_allocations(debt_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS debt_settle_wht_uniq ON debt_settlement_allocations(debt_id, withholding_record_id) WHERE withholding_record_id IS NOT NULL;

-- A tax payment transaction closes the withholding LIABILITY (separate from the
-- vendor payable). One tax payment may cover several withholding records.
CREATE TABLE IF NOT EXISTS withholding_payment_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID   NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  withholding_record_id UUID  NOT NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  transaction_id       BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  allocated_amount     NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id   BIGINT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (withholding_record_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS wht_alloc_record_idx ON withholding_payment_allocations(withholding_record_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. DB GUARDS — over-allocation (row-locked) + business isolation
--    Functions are idempotent (CREATE OR REPLACE); triggers re-created safely.
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Debt settlement: sum(allocations) <= debt amount; same-business only.
CREATE OR REPLACE FUNCTION fn_debt_settlement_guard() RETURNS trigger AS $$
DECLARE d_amount NUMERIC; d_business UUID; allocated NUMERIC;
BEGIN
  SELECT COALESCE(original_amount, amount), business_id INTO d_amount, d_business
    FROM debts WHERE id = NEW.debt_id FOR UPDATE;          -- lock the payable row
  IF d_amount IS NULL THEN RAISE EXCEPTION 'debt % not found', NEW.debt_id; END IF;
  IF d_business <> NEW.business_id THEN RAISE EXCEPTION 'business isolation: debt % belongs to another business', NEW.debt_id; END IF;
  IF NEW.transaction_id IS NOT NULL AND
     (SELECT business_id FROM transactions WHERE id = NEW.transaction_id) IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'business isolation: transaction % belongs to another business (use intercompany funding)', NEW.transaction_id;
  END IF;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated
    FROM debt_settlement_allocations WHERE debt_id = NEW.debt_id AND id <> NEW.id;
  IF allocated + NEW.allocated_amount > d_amount + 0.005 THEN
    RAISE EXCEPTION 'over-allocation: debt % would be % > amount %', NEW.debt_id, allocated + NEW.allocated_amount, d_amount;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_debt_settlement_guard ON debt_settlement_allocations;
CREATE TRIGGER trg_debt_settlement_guard BEFORE INSERT OR UPDATE ON debt_settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_debt_settlement_guard();

-- 6b. Withholding payment: sum(allocations) <= withholding_amount; same business.
CREATE OR REPLACE FUNCTION fn_wht_payment_guard() RETURNS trigger AS $$
DECLARE w_amount NUMERIC; w_business UUID; allocated NUMERIC;
BEGIN
  SELECT withholding_amount, business_id INTO w_amount, w_business
    FROM withholding_records WHERE id = NEW.withholding_record_id FOR UPDATE;
  IF w_amount IS NULL THEN RAISE EXCEPTION 'withholding record % missing amount', NEW.withholding_record_id; END IF;
  IF w_business <> NEW.business_id THEN RAISE EXCEPTION 'business isolation: withholding record other business'; END IF;
  IF (SELECT business_id FROM transactions WHERE id = NEW.transaction_id) IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'business isolation: transaction % other business', NEW.transaction_id;
  END IF;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated
    FROM withholding_payment_allocations WHERE withholding_record_id = NEW.withholding_record_id AND id <> NEW.id;
  IF allocated + NEW.allocated_amount > w_amount + 0.005 THEN
    RAISE EXCEPTION 'over-allocation: withholding % would be % > %', NEW.withholding_record_id, allocated + NEW.allocated_amount, w_amount;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_wht_payment_guard ON withholding_payment_allocations;
CREATE TRIGGER trg_wht_payment_guard BEFORE INSERT OR UPDATE ON withholding_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_wht_payment_guard();

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('document_files','financial_documents','document_links','document_debt_links','document_transaction_links',
  'document_compliance_links','tax_treatments','withholding_records','debt_settlement_allocations','withholding_payment_allocations')
ORDER BY table_name;
