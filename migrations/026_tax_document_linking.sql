-- Migration 026 — Shared Financial Document & Tax Linking V1
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. New tables only. No DROP, NO seed, NO cash movement.
--
-- A SHARED layer over the existing CFO AI ledger. Cash stays exclusively in
-- `transactions`; documents/links/treatments/withholding NEVER move cash.
-- Accountant AI references existing CFO AI records — it never duplicates an
-- invoice, payable, counterparty or transaction.
--
-- VERIFIED key types (live schema):
--   businesses.id        UUID
--   counterparties.id    UUID
--   compliance_events.id UUID
--   debts.id             BIGINT   <-- not UUID
--   transactions.id      BIGINT   <-- not UUID
--   *_user_id            BIGINT
--
-- Evidence retention: links/allocations to a ledger record use ON DELETE
-- RESTRICT so deleting a transaction/debt cannot silently destroy tax evidence.
-- business_id keeps CASCADE (deleting a whole business is a deliberate purge).

-- ── 1. financial_documents (CFO AI Core — shared) ────────────────────────────
CREATE TABLE IF NOT EXISTS financial_documents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_type          TEXT NOT NULL CHECK (document_type IN
    ('vendor_invoice','customer_invoice','tax_invoice','bukti_potong','tax_billing','payment_proof','filing_confirmation','bank_document','other')),
  document_number        TEXT NULL,
  document_date          DATE NULL,
  period_start           DATE NULL,
  period_end             DATE NULL,
  issuer_counterparty_id UUID NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  recipient_business_id  UUID NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  currency               TEXT NULL DEFAULT 'IDR',
  commercial_base_amount NUMERIC(20,2) NULL,   -- commercial service base
  commercial_tax_amount  NUMERIC(20,2) NULL,   -- commercial PPN line
  gross_amount           NUMERIC(20,2) NULL,
  official_tax_base      NUMERIC(20,2) NULL,   -- faktur DPP / withholding DPP
  official_tax_amount    NUMERIC(20,2) NULL,
  storage_path           TEXT NULL,            -- private bucket pointer (no PII)
  file_name              TEXT NULL,
  mime_type              TEXT NULL,
  file_size              BIGINT NULL,
  sha256_hash            TEXT NULL,            -- dedup + integrity
  extraction_status      TEXT NOT NULL DEFAULT 'pending', -- pending|extracting|extracted|failed
  extracted_json         JSONB NULL,           -- AI/OCR output (kept separate from confirmed values)
  review_status          TEXT NOT NULL DEFAULT 'needs_review', -- needs_review|confirmed|rejected
  reviewed_by_user_id    BIGINT NULL,
  reviewed_at            TIMESTAMPTZ NULL,
  created_by_user_id     BIGINT NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  archived_at            TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS fin_docs_business_type_idx ON financial_documents(business_id, document_type);
CREATE INDEX IF NOT EXISTS fin_docs_number_idx        ON financial_documents(business_id, document_number);
-- Dedup: same content/identity not stored twice.
CREATE UNIQUE INDEX IF NOT EXISTS fin_docs_dedup_idx ON financial_documents(business_id, sha256_hash) WHERE sha256_hash IS NOT NULL;

-- ── 2. document_links (document → document graph) ────────────────────────────
CREATE TABLE IF NOT EXISTS document_links (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_document_id   UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  target_document_id   UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  link_type            TEXT NOT NULL CHECK (link_type IN
    ('supports','tax_invoice_for','withholding_for','payment_proof_for','tax_billing_for','filing_for','supersedes','related')),
  match_confidence     NUMERIC NULL,
  match_reason         TEXT NULL,
  match_status         TEXT NOT NULL DEFAULT 'suggested', -- suggested|needs_review|confirmed|rejected
  confirmed_by_user_id BIGINT NULL,
  confirmed_at         TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  CHECK (source_document_id <> target_document_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS document_links_uniq ON document_links(source_document_id, target_document_id, link_type);

-- ── 3. Document ↔ CFO AI entity links (referential integrity, not polymorphic) ─
CREATE TABLE IF NOT EXISTS document_debt_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_id UUID   NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  debt_id     BIGINT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, debt_id)
);
CREATE TABLE IF NOT EXISTS document_transaction_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_id    UUID   NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, transaction_id)
);
CREATE TABLE IF NOT EXISTS document_compliance_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_id         UUID NOT NULL REFERENCES financial_documents(id) ON DELETE CASCADE,
  compliance_event_id UUID NOT NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  created_by_user_id  BIGINT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, compliance_event_id)
);

-- ── 4. tax_treatments (Accountant AI — interpretation of a CFO AI operation) ──
CREATE TABLE IF NOT EXISTS tax_treatments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debt_id             BIGINT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  invoice_document_id UUID NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  treatment_status    TEXT NOT NULL DEFAULT 'suggested',
  -- suggested|needs_review|confirmed|professionally_reviewed|rejected|superseded
  tax_type            TEXT NULL,
  tax_nature          TEXT NULL,            -- e.g. 'final'
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
  suggestion_source   TEXT NULL,            -- ai|rule|manual
  confidence          NUMERIC NULL,
  reviewed_by_user_id BIGINT NULL,
  reviewed_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tax_treatments_business_idx ON tax_treatments(business_id, treatment_status);
CREATE INDEX IF NOT EXISTS tax_treatments_debt_idx     ON tax_treatments(debt_id);

-- ── 5. withholding_records (Accountant AI) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS withholding_records (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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

-- ── 6. Payment allocations (one payable closed by several transactions) ──────
CREATE TABLE IF NOT EXISTS debt_payment_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debt_id          BIGINT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id   BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  allocation_type  TEXT   NOT NULL CHECK (allocation_type IN ('vendor_payment','withholding_tax','refund','adjustment')),
  allocated_amount NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id BIGINT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (debt_id, transaction_id, allocation_type)  -- no duplicate allocation
);
CREATE INDEX IF NOT EXISTS debt_alloc_debt_idx ON debt_payment_allocations(debt_id);

CREATE TABLE IF NOT EXISTS withholding_payment_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID   NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  withholding_record_id UUID  NOT NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  transaction_id       BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  allocated_amount     NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  created_by_user_id   BIGINT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (withholding_record_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS wht_alloc_record_idx ON withholding_payment_allocations(withholding_record_id);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('financial_documents','document_links','document_debt_links',
    'document_transaction_links','document_compliance_links','tax_treatments',
    'withholding_records','debt_payment_allocations','withholding_payment_allocations')
ORDER BY table_name;
