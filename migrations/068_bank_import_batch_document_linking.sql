-- Migration 068 — Bank Import Batch Document Linking & Isolation
-- Date: 2026-10-07
-- ADDITIVE + IDEMPOTENT + ISOLATION ENFORCEMENT
-- Links bank import batches to their original uploaded document (financial_documents).
-- Preserves backwards compatibility for existing batches where document_id is NULL.

BEGIN;

-- 1. Add document_id column to bank_import_batches referencing financial_documents(id)
ALTER TABLE public.bank_import_batches
  ADD COLUMN IF NOT EXISTS document_id UUID NULL REFERENCES public.financial_documents(id) ON DELETE SET NULL;

-- 2. Index for reverse lookups and joins
CREATE INDEX IF NOT EXISTS idx_bank_import_batches_document_id
  ON public.bank_import_batches(document_id);

-- 3. Business isolation trigger: enforce that linked document belongs to the exact same business
CREATE OR REPLACE FUNCTION public.fn_iso_bank_import_batch_document()
RETURNS trigger AS $$
BEGIN
  IF NEW.document_id IS NOT NULL THEN
    IF (SELECT business_id FROM public.financial_documents WHERE id = NEW.document_id) IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'isolation: bank_import_batches document_id belongs to another business';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iso_bank_import_batch_doc ON public.bank_import_batches;

CREATE TRIGGER trg_iso_bank_import_batch_doc
  BEFORE INSERT OR UPDATE ON public.bank_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_iso_bank_import_batch_document();

COMMIT;
