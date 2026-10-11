-- Migration 031 — Shared Financial Document Foundation V1 (hardened)
-- Date: 2026-06-15. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash.
-- Cash lives ONLY in `transactions`. Physical file (document_files, dedup) is
-- separate from logical document (financial_documents, page range). DB-level
-- business isolation + row-locked over-allocation guards. Evidence = RESTRICT;
-- businesses are soft-deleted in the app (hard purge = separate admin procedure).
-- Verified types: businesses/counterparties/compliance_events/payroll_payments UUID;
--   debts.id / transactions.id BIGINT; *_user_id BIGINT.

BEGIN;

-- 1. document_files (physical) — dedup here
CREATE TABLE IF NOT EXISTS document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL, file_name TEXT, mime_type TEXT,
  file_size BIGINT CHECK (file_size IS NULL OR file_size >= 0),
  sha256_hash TEXT NOT NULL, upload_channel TEXT, uploaded_by_user_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(), archived_at TIMESTAMPTZ);
CREATE UNIQUE INDEX IF NOT EXISTS document_files_dedup_idx ON document_files(business_id, sha256_hash);

-- 2. financial_documents (logical) — file_id + page range, NO sha unique
CREATE TABLE IF NOT EXISTS financial_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  file_id UUID NOT NULL REFERENCES document_files(id) ON DELETE RESTRICT,
  page_start INT NOT NULL DEFAULT 1, page_end INT NOT NULL DEFAULT 1,
  document_type TEXT NOT NULL CHECK (document_type IN ('vendor_invoice','customer_invoice','tax_invoice','bukti_potong','tax_billing','payment_proof','filing_confirmation','bank_document','other')),
  document_number TEXT, document_date DATE, period_start DATE, period_end DATE,
  issuer_counterparty_id UUID REFERENCES counterparties(id) ON DELETE RESTRICT,
  recipient_business_id UUID REFERENCES businesses(id) ON DELETE RESTRICT,
  currency TEXT DEFAULT 'IDR',
  commercial_base_amount NUMERIC(20,2) CHECK (commercial_base_amount IS NULL OR commercial_base_amount >= 0),
  commercial_tax_amount  NUMERIC(20,2) CHECK (commercial_tax_amount  IS NULL OR commercial_tax_amount  >= 0),
  gross_amount           NUMERIC(20,2) CHECK (gross_amount           IS NULL OR gross_amount           >= 0),
  official_tax_base      NUMERIC(20,2) CHECK (official_tax_base      IS NULL OR official_tax_base      >= 0),
  official_tax_amount    NUMERIC(20,2) CHECK (official_tax_amount    IS NULL OR official_tax_amount    >= 0),
  extraction_status TEXT NOT NULL DEFAULT 'pending', extracted_json JSONB,
  review_status TEXT NOT NULL DEFAULT 'needs_review', reviewed_by_user_id BIGINT, reviewed_at TIMESTAMPTZ,
  created_by_user_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), archived_at TIMESTAMPTZ,
  CHECK (page_start > 0), CHECK (page_end >= page_start),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start));
CREATE INDEX IF NOT EXISTS fin_docs_business_type_idx ON financial_documents(business_id, document_type);
CREATE INDEX IF NOT EXISTS fin_docs_number_idx ON financial_documents(business_id, document_number);
CREATE INDEX IF NOT EXISTS fin_docs_file_idx ON financial_documents(file_id);

-- 3. links
CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  source_document_id UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  target_document_id UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('supports','tax_invoice_for','withholding_for','payment_proof_for','tax_billing_for','filing_for','supersedes','related')),
  match_confidence NUMERIC CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  match_reason TEXT, match_status TEXT NOT NULL DEFAULT 'suggested',
  confirmed_by_user_id BIGINT, confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (source_document_id <> target_document_id));
CREATE UNIQUE INDEX IF NOT EXISTS document_links_uniq ON document_links(source_document_id, target_document_id, link_type);

CREATE TABLE IF NOT EXISTS document_debt_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  debt_id BIGINT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (document_id, debt_id));
CREATE TABLE IF NOT EXISTS document_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (document_id, transaction_id));
CREATE TABLE IF NOT EXISTS document_compliance_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  compliance_event_id UUID NOT NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (document_id, compliance_event_id));

-- 4. tax_treatments + withholding_records
CREATE TABLE IF NOT EXISTS tax_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id BIGINT REFERENCES debts(id) ON DELETE RESTRICT,
  invoice_document_id UUID REFERENCES financial_documents(id) ON DELETE RESTRICT,
  treatment_status TEXT NOT NULL DEFAULT 'suggested',
  tax_type TEXT, tax_nature TEXT, tax_object_code TEXT,
  commercial_base NUMERIC(20,2) CHECK (commercial_base IS NULL OR commercial_base >= 0),
  vat_dpp NUMERIC(20,2) CHECK (vat_dpp IS NULL OR vat_dpp >= 0),
  vat_amount NUMERIC(20,2) CHECK (vat_amount IS NULL OR vat_amount >= 0),
  withholding_dpp NUMERIC(20,2) CHECK (withholding_dpp IS NULL OR withholding_dpp >= 0),
  withholding_rate NUMERIC CHECK (withholding_rate IS NULL OR (withholding_rate >= 0 AND withholding_rate <= 1)),
  withholding_amount NUMERIC(20,2) CHECK (withholding_amount IS NULL OR withholding_amount >= 0),
  expected_vendor_net NUMERIC(20,2) CHECK (expected_vendor_net IS NULL OR expected_vendor_net >= 0),
  rule_id UUID REFERENCES tax_rules(id) ON DELETE SET NULL, rule_version INT,
  source_id UUID REFERENCES official_sources(id) ON DELETE SET NULL,
  suggestion_source TEXT,
  confidence NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reviewed_by_user_id BIGINT, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS tax_treatments_business_idx ON tax_treatments(business_id, treatment_status);
CREATE INDEX IF NOT EXISTS tax_treatments_debt_idx ON tax_treatments(debt_id);

CREATE TABLE IF NOT EXISTS withholding_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  tax_treatment_id UUID REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  debt_id BIGINT REFERENCES debts(id) ON DELETE RESTRICT,
  invoice_document_id UUID REFERENCES financial_documents(id) ON DELETE RESTRICT,
  bukti_potong_document_id UUID REFERENCES financial_documents(id) ON DELETE RESTRICT,
  tax_type TEXT, tax_nature TEXT, tax_object_code TEXT,
  tax_base NUMERIC(20,2) CHECK (tax_base IS NULL OR tax_base >= 0),
  tax_rate NUMERIC CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 1)),
  withholding_amount NUMERIC(20,2) CHECK (withholding_amount IS NULL OR withholding_amount >= 0),
  expected_vendor_net_amount NUMERIC(20,2) CHECK (expected_vendor_net_amount IS NULL OR expected_vendor_net_amount >= 0),
  status TEXT NOT NULL DEFAULT 'suggested', reported_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, filing_status TEXT DEFAULT 'not_filed',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS withholding_records_business_idx ON withholding_records(business_id, status);
CREATE INDEX IF NOT EXISTS withholding_records_debt_idx ON withholding_records(debt_id);

-- 5. settlement allocations
CREATE TABLE IF NOT EXISTS debt_settlement_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id BIGINT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  settlement_source_type TEXT NOT NULL CHECK (settlement_source_type IN ('transaction','withholding_record','credit_note','adjustment')),
  transaction_id BIGINT REFERENCES transactions(id) ON DELETE RESTRICT,
  withholding_record_id UUID REFERENCES withholding_records(id) ON DELETE RESTRICT,
  credit_note_document_id UUID REFERENCES financial_documents(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (settlement_source_type='transaction'        AND transaction_id IS NOT NULL AND withholding_record_id IS NULL AND credit_note_document_id IS NULL) OR
    (settlement_source_type='withholding_record'  AND withholding_record_id IS NOT NULL AND transaction_id IS NULL AND credit_note_document_id IS NULL) OR
    (settlement_source_type='credit_note'         AND credit_note_document_id IS NOT NULL AND transaction_id IS NULL AND withholding_record_id IS NULL) OR
    (settlement_source_type='adjustment'          AND transaction_id IS NULL AND withholding_record_id IS NULL AND credit_note_document_id IS NULL)));
CREATE INDEX IF NOT EXISTS debt_settle_debt_idx ON debt_settlement_allocations(debt_id);
CREATE UNIQUE INDEX IF NOT EXISTS debt_settle_tx_uniq ON debt_settlement_allocations(debt_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS debt_settle_wht_uniq ON debt_settlement_allocations(debt_id, withholding_record_id) WHERE withholding_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS withholding_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  withholding_record_id UUID NOT NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (withholding_record_id, transaction_id));
CREATE INDEX IF NOT EXISTS wht_alloc_record_idx ON withholding_payment_allocations(withholding_record_id);

-- 6. Business-isolation triggers (parents must share NEW.business_id) ─────────
CREATE OR REPLACE FUNCTION fn_iso_financial_documents() RETURNS trigger AS $$
BEGIN
  IF (SELECT business_id FROM document_files WHERE id=NEW.file_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: file other business'; END IF;
  IF NEW.issuer_counterparty_id IS NOT NULL AND (SELECT business_id FROM counterparties WHERE id=NEW.issuer_counterparty_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: counterparty other business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_fin_docs ON financial_documents;
CREATE TRIGGER trg_iso_fin_docs BEFORE INSERT OR UPDATE ON financial_documents FOR EACH ROW EXECUTE FUNCTION fn_iso_financial_documents();

CREATE OR REPLACE FUNCTION fn_iso_document_links() RETURNS trigger AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.source_document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM financial_documents WHERE id=NEW.target_document_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_links cross-business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_document_links ON document_links;
CREATE TRIGGER trg_iso_document_links BEFORE INSERT OR UPDATE ON document_links FOR EACH ROW EXECUTE FUNCTION fn_iso_document_links();

CREATE OR REPLACE FUNCTION fn_iso_doc_debt_links() RETURNS trigger AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM debts WHERE id=NEW.debt_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_debt_links cross-business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_doc_debt ON document_debt_links;
CREATE TRIGGER trg_iso_doc_debt BEFORE INSERT OR UPDATE ON document_debt_links FOR EACH ROW EXECUTE FUNCTION fn_iso_doc_debt_links();

CREATE OR REPLACE FUNCTION fn_iso_doc_tx_links() RETURNS trigger AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_transaction_links cross-business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_doc_tx ON document_transaction_links;
CREATE TRIGGER trg_iso_doc_tx BEFORE INSERT OR UPDATE ON document_transaction_links FOR EACH ROW EXECUTE FUNCTION fn_iso_doc_tx_links();

CREATE OR REPLACE FUNCTION fn_iso_doc_comp_links() RETURNS trigger AS $$
BEGIN
  IF (SELECT business_id FROM financial_documents WHERE id=NEW.document_id) IS DISTINCT FROM NEW.business_id
     OR (SELECT business_id FROM compliance_events WHERE id=NEW.compliance_event_id) IS DISTINCT FROM NEW.business_id
  THEN RAISE EXCEPTION 'isolation: document_compliance_links cross-business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_doc_comp ON document_compliance_links;
CREATE TRIGGER trg_iso_doc_comp BEFORE INSERT OR UPDATE ON document_compliance_links FOR EACH ROW EXECUTE FUNCTION fn_iso_doc_comp_links();

CREATE OR REPLACE FUNCTION fn_iso_tax_treatments() RETURNS trigger AS $$
BEGIN
  IF NEW.debt_id IS NOT NULL AND (SELECT business_id FROM debts WHERE id=NEW.debt_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: treatment debt other business'; END IF;
  IF NEW.invoice_document_id IS NOT NULL AND (SELECT business_id FROM financial_documents WHERE id=NEW.invoice_document_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: treatment invoice other business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_treatment ON tax_treatments;
CREATE TRIGGER trg_iso_treatment BEFORE INSERT OR UPDATE ON tax_treatments FOR EACH ROW EXECUTE FUNCTION fn_iso_tax_treatments();

CREATE OR REPLACE FUNCTION fn_iso_withholding() RETURNS trigger AS $$
BEGIN
  IF NEW.tax_treatment_id IS NOT NULL AND (SELECT business_id FROM tax_treatments WHERE id=NEW.tax_treatment_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: withholding treatment other business'; END IF;
  IF NEW.debt_id IS NOT NULL AND (SELECT business_id FROM debts WHERE id=NEW.debt_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: withholding debt other business'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_iso_withholding ON withholding_records;
CREATE TRIGGER trg_iso_withholding BEFORE INSERT OR UPDATE ON withholding_records FOR EACH ROW EXECUTE FUNCTION fn_iso_withholding();

-- 7. Over-allocation guards (row-locked) + isolation, accounting for legacy paid_amount
CREATE OR REPLACE FUNCTION fn_debt_settlement_guard() RETURNS trigger AS $$
DECLARE ceiling NUMERIC; legacy_paid NUMERIC; d_business UUID; allocated NUMERIC; available NUMERIC;
BEGIN
  SELECT COALESCE(original_amount, amount), COALESCE(paid_amount,0), business_id
    INTO ceiling, legacy_paid, d_business FROM debts WHERE id=NEW.debt_id FOR UPDATE;
  IF ceiling IS NULL THEN RAISE EXCEPTION 'debt % not found', NEW.debt_id; END IF;
  IF d_business <> NEW.business_id THEN RAISE EXCEPTION 'isolation: debt other business'; END IF;
  IF NEW.transaction_id IS NOT NULL AND (SELECT business_id FROM transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: settlement transaction other business (use intercompany funding)'; END IF;
  IF NEW.withholding_record_id IS NOT NULL AND (SELECT business_id FROM withholding_records WHERE id=NEW.withholding_record_id) IS DISTINCT FROM NEW.business_id
    THEN RAISE EXCEPTION 'isolation: settlement withholding other business'; END IF;
  -- single source of truth: legacy paid_amount + new allocations cannot exceed ceiling
  available := ceiling - legacy_paid;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated FROM debt_settlement_allocations WHERE debt_id=NEW.debt_id AND id<>NEW.id;
  IF allocated + NEW.allocated_amount > available + 0.005 THEN
    RAISE EXCEPTION 'over-allocation: debt % alloc % + % > available % (ceiling % - legacy paid %)',
      NEW.debt_id, allocated, NEW.allocated_amount, available, ceiling, legacy_paid; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_debt_settlement_guard ON debt_settlement_allocations;
CREATE TRIGGER trg_debt_settlement_guard BEFORE INSERT OR UPDATE ON debt_settlement_allocations FOR EACH ROW EXECUTE FUNCTION fn_debt_settlement_guard();

CREATE OR REPLACE FUNCTION fn_wht_payment_guard() RETURNS trigger AS $$
DECLARE w_amount NUMERIC; w_business UUID; allocated NUMERIC;
BEGIN
  SELECT withholding_amount, business_id INTO w_amount, w_business FROM withholding_records WHERE id=NEW.withholding_record_id FOR UPDATE;
  IF w_amount IS NULL THEN RAISE EXCEPTION 'withholding % missing amount', NEW.withholding_record_id; END IF;
  IF w_business <> NEW.business_id THEN RAISE EXCEPTION 'isolation: withholding other business'; END IF;
  IF (SELECT business_id FROM transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: tax payment transaction other business'; END IF;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated FROM withholding_payment_allocations WHERE withholding_record_id=NEW.withholding_record_id AND id<>NEW.id;
  IF allocated + NEW.allocated_amount > w_amount + 0.005 THEN RAISE EXCEPTION 'over-allocation: withholding % %>%', NEW.withholding_record_id, allocated+NEW.allocated_amount, w_amount; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_wht_payment_guard ON withholding_payment_allocations;
CREATE TRIGGER trg_wht_payment_guard BEFORE INSERT OR UPDATE ON withholding_payment_allocations FOR EACH ROW EXECUTE FUNCTION fn_wht_payment_guard();

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN
 ('document_files','financial_documents','document_links','document_debt_links','document_transaction_links',
  'document_compliance_links','tax_treatments','withholding_records','debt_settlement_allocations','withholding_payment_allocations')
ORDER BY table_name;
