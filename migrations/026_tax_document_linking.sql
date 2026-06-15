-- Migration 026 — Tax Document Linking V1
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. New tables only. No DROP, no seed data.
-- A document layer over the existing ledger: documents/links/withholding never
-- create cash by themselves — cash stays with transactions (vendor payment +
-- separate tax payment). business_id UUID; *_user_id BIGINT.

-- ── Financial documents (invoice / faktur / bukti potong / proofs) ───────────
CREATE TABLE IF NOT EXISTS financial_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_type         TEXT NOT NULL,
  -- vendor_invoice | tax_invoice | bukti_potong | tax_billing | payment_proof | filing_confirmation
  document_number       TEXT NULL,
  document_date         DATE NULL,
  tax_period            TEXT NULL,                 -- 'YYYY-MM'
  issuer_counterparty_id UUID NULL REFERENCES counterparties(id),
  recipient_business_id UUID NULL REFERENCES businesses(id),
  currency              TEXT NULL DEFAULT 'IDR',
  -- Commercial figures (what the invoice shows)
  subtotal_amount       NUMERIC NULL,             -- commercial service base
  commercial_tax_amount NUMERIC NULL,             -- commercial PPN line
  gross_amount          NUMERIC NULL,
  -- Official tax-document figures (faktur DPP/PPN, or withholding DPP/amount)
  official_tax_base     NUMERIC NULL,
  official_tax_amount   NUMERIC NULL,
  status                TEXT NOT NULL DEFAULT 'uploaded',
  -- uploaded | extracting | needs_review | confirmed | linked | archived
  source_file_id        TEXT NULL,                -- pointer to stored file (no PII)
  linked_debt_id        UUID NULL,                -- the payable this doc belongs to
  extracted_json        JSONB NULL,               -- raw extraction (redacted)
  created_by_user_id    BIGINT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS financial_documents_business_idx ON financial_documents(business_id, document_type);
CREATE INDEX IF NOT EXISTS financial_documents_number_idx   ON financial_documents(business_id, document_number);

-- ── Document links (graph: invoice → faktur → bukti potong → payment → …) ────
CREATE TABLE IF NOT EXISTS document_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_document_id  UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  target_document_id  UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  link_type           TEXT NOT NULL,
  -- supports | tax_invoice_for | withholding_for | payment_for | tax_payment_for | filing_for | supersedes
  match_confidence    NUMERIC NULL,
  match_reason        TEXT NULL,
  confirmed_by_user_id BIGINT NULL,
  confirmed_at        TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS document_links_src_idx ON document_links(source_document_id);
CREATE INDEX IF NOT EXISTS document_links_tgt_idx ON document_links(target_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS document_links_uniq ON document_links(source_document_id, target_document_id, link_type);

-- ── Withholding records (PPh 4(2) etc.) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS withholding_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_invoice_id          UUID NULL REFERENCES financial_documents(id),
  bukti_potong_document_id   UUID NULL REFERENCES financial_documents(id),
  tax_type                   TEXT NULL,            -- e.g. 'pph_4_2'
  tax_nature                 TEXT NULL,
  tax_object_code            TEXT NULL,
  tax_base                   NUMERIC NULL,         -- withholding DPP
  tax_rate                   NUMERIC NULL,
  withholding_amount         NUMERIC NULL,
  expected_vendor_net_amount NUMERIC NULL,
  status                     TEXT NOT NULL DEFAULT 'suggested',
  -- suggested | needs_review | confirmed | certificate_issued | tax_payable | paid | filed | reconciled
  linked_tax_payment_transaction_id BIGINT NULL,   -- the separate tax cash-out tx
  reported_at                TIMESTAMPTZ NULL,
  paid_at                    TIMESTAMPTZ NULL,
  filing_status              TEXT NULL DEFAULT 'not_filed',
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS withholding_records_business_idx ON withholding_records(business_id, status);
CREATE INDEX IF NOT EXISTS withholding_records_invoice_idx  ON withholding_records(vendor_invoice_id);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('financial_documents','document_links','withholding_records')
ORDER BY table_name;
