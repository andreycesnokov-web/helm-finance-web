-- Migration 027 — Tax settlement modes + treatment context + multi-tax billing
-- Date: 2026-06-15. ADDITIVE + IDEMPOTENT + TRANSACTIONAL. No DROP, NO seed, NO cash. Needs 026.

BEGIN;

ALTER TABLE tax_treatments
  ADD COLUMN IF NOT EXISTS withholding_mode    TEXT NULL,
  ADD COLUMN IF NOT EXISTS context_type        TEXT NULL,   -- vendor_invoice|vendor_service|payroll|periodic_revenue|other
  ADD COLUMN IF NOT EXISTS payroll_payment_id  UUID NULL REFERENCES payroll_payments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS compliance_event_id UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS period_start        DATE NULL,
  ADD COLUMN IF NOT EXISTS period_end          DATE NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tax_treatments_withholding_mode_chk') THEN
    ALTER TABLE tax_treatments ADD CONSTRAINT tax_treatments_withholding_mode_chk
      CHECK (withholding_mode IS NULL OR withholding_mode IN
        ('deducted_from_vendor','company_bears_tax','paid_gross_not_deducted','not_deducted_requires_review','gross_up','unknown'));
  END IF;
END $$;

ALTER TABLE withholding_records
  ADD COLUMN IF NOT EXISTS withholding_mode    TEXT NULL,
  ADD COLUMN IF NOT EXISTS context_type        TEXT NULL,
  ADD COLUMN IF NOT EXISTS compliance_event_id UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT;

-- One tax_billing document → many tax obligations; exactly one target each.
CREATE TABLE IF NOT EXISTS tax_billing_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  billing_document_id   UUID NOT NULL REFERENCES financial_documents(id) ON DELETE RESTRICT,
  tax_treatment_id      UUID NULL REFERENCES tax_treatments(id) ON DELETE RESTRICT,
  withholding_record_id UUID NULL REFERENCES withholding_records(id) ON DELETE RESTRICT,
  compliance_event_id   UUID NULL REFERENCES compliance_events(id) ON DELETE RESTRICT,
  allocated_amount      NUMERIC(20,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_by_user_id  BIGINT NULL,
  allocated_at          TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((tax_treatment_id IS NOT NULL)::int + (withholding_record_id IS NOT NULL)::int + (compliance_event_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS tax_billing_alloc_doc_idx ON tax_billing_allocations(billing_document_id);

-- Guard: sum(billing allocations) <= billing nominal; same-business only.
CREATE OR REPLACE FUNCTION fn_tax_billing_alloc_guard() RETURNS trigger AS $$
DECLARE nominal NUMERIC; doc_business UUID; allocated NUMERIC;
BEGIN
  SELECT COALESCE(gross_amount, official_tax_amount), business_id INTO nominal, doc_business
    FROM financial_documents WHERE id = NEW.billing_document_id FOR UPDATE;
  IF doc_business IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'business isolation: billing doc other business'; END IF;
  IF NEW.tax_treatment_id IS NOT NULL AND (SELECT business_id FROM tax_treatments WHERE id=NEW.tax_treatment_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: billing target treatment other business'; END IF;
  IF NEW.withholding_record_id IS NOT NULL AND (SELECT business_id FROM withholding_records WHERE id=NEW.withholding_record_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: billing target withholding other business'; END IF;
  IF NEW.compliance_event_id IS NOT NULL AND (SELECT business_id FROM compliance_events WHERE id=NEW.compliance_event_id) IS DISTINCT FROM NEW.business_id THEN RAISE EXCEPTION 'isolation: billing target compliance other business'; END IF;
  IF nominal IS NOT NULL THEN
    SELECT COALESCE(SUM(allocated_amount),0) INTO allocated
      FROM tax_billing_allocations WHERE billing_document_id = NEW.billing_document_id AND id <> NEW.id;
    IF allocated + NEW.allocated_amount > nominal + 0.005 THEN
      RAISE EXCEPTION 'over-allocation: billing % would be % > nominal %', NEW.billing_document_id, allocated + NEW.allocated_amount, nominal;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tax_billing_alloc_guard ON tax_billing_allocations;
CREATE TRIGGER trg_tax_billing_alloc_guard BEFORE INSERT OR UPDATE ON tax_billing_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_tax_billing_alloc_guard();

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT 'tax_treatments.withholding_mode' AS check,
  (SELECT count(*)::text FROM information_schema.columns WHERE table_name='tax_treatments' AND column_name='withholding_mode') AS value
UNION ALL SELECT 'tax_billing_allocations',
  (SELECT count(*)::text FROM information_schema.tables WHERE table_name='tax_billing_allocations');
