-- Migration 027 — Tax settlement modes + treatment context + multi-tax billing
-- Date: 2026-06-15
-- ADDITIVE + IDEMPOTENT. No DROP, NO seed, NO cash movement. Depends on 026.

-- ── tax_treatments: withholding mode + context (payroll / vendor / periodic) ──
ALTER TABLE tax_treatments
  ADD COLUMN IF NOT EXISTS withholding_mode  TEXT NULL,
  ADD COLUMN IF NOT EXISTS context_type      TEXT NULL,   -- vendor_invoice|vendor_service|payroll|periodic_revenue|other
  ADD COLUMN IF NOT EXISTS payroll_payment_id UUID NULL REFERENCES payroll_payments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS compliance_event_id UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS period_start      DATE NULL,
  ADD COLUMN IF NOT EXISTS period_end        DATE NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tax_treatments_withholding_mode_chk') THEN
    ALTER TABLE tax_treatments ADD CONSTRAINT tax_treatments_withholding_mode_chk
      CHECK (withholding_mode IS NULL OR withholding_mode IN
        ('deducted_from_vendor','company_bears_tax','paid_gross_not_deducted','not_deducted_requires_review','gross_up','unknown'));
  END IF;
END $$;

ALTER TABLE withholding_records
  ADD COLUMN IF NOT EXISTS withholding_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS context_type     TEXT NULL,
  ADD COLUMN IF NOT EXISTS compliance_event_id UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT;

-- ── Multi-tax billing: one tax_billing document → many tax obligations ───────
-- Exactly one allocation target (treatment | withholding | compliance event).
CREATE TABLE IF NOT EXISTS tax_billing_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  billing_document_id  UUID NOT NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  tax_treatment_id     UUID NULL REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  withholding_record_id UUID NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  compliance_event_id  UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  allocated_amount     NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_by_user_id BIGINT NULL,
  allocated_at         TIMESTAMPTZ DEFAULT NOW(),
  CHECK ( (tax_treatment_id IS NOT NULL)::int + (withholding_record_id IS NOT NULL)::int + (compliance_event_id IS NOT NULL)::int = 1 )
);
CREATE INDEX IF NOT EXISTS tax_billing_alloc_doc_idx ON tax_billing_allocations(billing_document_id);

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'tax_treatments.withholding_mode' AS check,
  (SELECT count(*)::text FROM information_schema.columns WHERE table_name='tax_treatments' AND column_name='withholding_mode') AS value
UNION ALL SELECT 'tax_billing_allocations',
  (SELECT count(*)::text FROM information_schema.tables WHERE table_name='tax_billing_allocations');
