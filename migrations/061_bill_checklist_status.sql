-- Migration 061 — Bill document checklist: withholding slip and accountant check
-- (Design v2, proposal P-05)
--
-- Approved by the owner in _specs/design-v2/DECISIONS.md (3 Oct 2026).
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT
--   debts.withholding_slip_document_id — the bukti potong (withholding slip) for this bill,
--                                        a financial_documents row of the SAME business.
--   debts.accountant_checked_at        — when an accountant marked the bill as checked.
--   debts.accountant_checked_by        — who did (platform user id).
--
-- "NOTHING CLOSES ON ITS OWN." These are status marks a person sets. Setting them never
-- pays, settles, approves or files anything, and nothing reads them to do so.
--
-- BUSINESS ISOLATION is enforced in the database, same pattern as migrations 031 and 055:
-- the slip document must belong to the bill's business, or the write is rejected.
--
-- ADDITIVE and IDEMPOTENT. Three nullable columns, one index, one isolation trigger.
-- Existing rows keep NULL. No existing column, constraint or trigger is changed.
--
-- WRITES go through PATCH /api/debts/:id/checklist only: owner/ceo/admin/cfo/accountant,
-- each change written to audit_events. POST /api/debts strips these fields from its body.

BEGIN;

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS withholding_slip_document_id UUID        NULL
    REFERENCES public.financial_documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS accountant_checked_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS accountant_checked_by        BIGINT      NULL;

-- Checked-at and checked-by are set and cleared together.
DO $$ BEGIN
  ALTER TABLE public.debts
    ADD CONSTRAINT debts_accountant_check_pair_chk
    CHECK ((accountant_checked_at IS NULL) = (accountant_checked_by IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS debts_withholding_slip_idx
  ON public.debts (withholding_slip_document_id)
  WHERE withholding_slip_document_id IS NOT NULL;

-- Isolation: a slip from another business can never be attached to this bill.
-- Fires only when the column is set or changed, so existing writes to debts are untouched.
CREATE OR REPLACE FUNCTION public.fn_iso_debt_withholding_slip() RETURNS trigger AS $$
BEGIN
  IF NEW.withholding_slip_document_id IS NOT NULL
     AND (SELECT business_id FROM public.financial_documents WHERE id = NEW.withholding_slip_document_id)
         IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'isolation: withholding slip belongs to another business';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iso_debt_withholding_slip ON public.debts;
CREATE TRIGGER trg_iso_debt_withholding_slip
  BEFORE INSERT OR UPDATE OF withholding_slip_document_id, business_id ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.fn_iso_debt_withholding_slip();

COMMENT ON COLUMN public.debts.withholding_slip_document_id IS
  'Design v2 P-05: bukti potong for this bill (same business, trigger-enforced).';
COMMENT ON COLUMN public.debts.accountant_checked_at IS
  'Design v2 P-05: when an accountant marked this bill checked. A status mark only.';

COMMIT;

-- ── verification (run after applying) ────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'debts'
--   AND column_name IN ('withholding_slip_document_id','accountant_checked_at','accountant_checked_by');
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_iso_debt_withholding_slip';
--
-- ── rollback (only if needed) ────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_iso_debt_withholding_slip ON public.debts;
-- DROP FUNCTION IF EXISTS public.fn_iso_debt_withholding_slip();
-- DROP INDEX IF EXISTS public.debts_withholding_slip_idx;
-- ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_accountant_check_pair_chk;
-- ALTER TABLE public.debts DROP COLUMN IF EXISTS accountant_checked_by;
-- ALTER TABLE public.debts DROP COLUMN IF EXISTS accountant_checked_at;
-- ALTER TABLE public.debts DROP COLUMN IF EXISTS withholding_slip_document_id;
