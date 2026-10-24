-- Business purpose and accountant review of an operation (management vs accounting preparation, 24 Oct 2026).
-- PREPARED ONLY; release approval required.
-- Additive: one new table beside the ledger. No transaction row, amount, balance, category or document changes,
-- and the guarded ledger table (balances, versions, statement evidence) gets no new column or trigger.
--
-- One optional row per operation:
--   business_purpose  what the operation is for, set by a person: 'operating' (a business operating expense or
--                     income), 'personal' (a personal / non-business movement paid from a company account),
--                     'capital' (a capital asset purchase), 'non_pnl' (financing, transfer or other movement
--                     outside profit) or 'needs_review'. NULL / no row = not set: the operation keeps exactly
--                     its previous treatment (category group, funding register, keywords).
--   accountant_reviewed_at / _by   a status mark a person with an accounting role sets; set and cleared together.
--                     Nothing reads it to approve, file or decide tax treatment. Tax treatment stays undetermined.
--   note              an exception / review note for the accountant.
-- The cash forecast (Pulse burn, Radar, 30/60/90 days) never reads this table: every cash movement keeps
-- moving cash whatever its purpose. The P&L and the month figures read it for THIS company only.
-- Writes go through PUT /api/transactions/:id/classification (role-checked, audited in audit_events).
-- Rollback: 20261024150000_transaction_classifications_down.sql (drops the table; nothing else to undo).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regclass('public.transactions') IS NULL OR to_regclass('public.businesses') IS NULL OR to_regclass('public.users') IS NULL
  OR to_regprocedure('public.fn_ledger_writer_statement()') IS NULL
  THEN RAISE EXCEPTION 'transaction_classifications_applicability_review_required'; END IF;
 IF to_regclass('public.transaction_classifications') IS NOT NULL THEN RAISE EXCEPTION 'transaction_classifications_already_installed'; END IF;
END $$;

CREATE TABLE public.transaction_classifications (
 transaction_id integer PRIMARY KEY REFERENCES public.transactions(id) ON DELETE CASCADE,
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 business_purpose text NULL CHECK (business_purpose IN ('operating','personal','capital','non_pnl','needs_review')),
 purpose_set_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
 purpose_set_at timestamptz NULL,
 accountant_reviewed_at timestamptz NULL,
 accountant_reviewed_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
 -- The reviewer's company role at the moment of the mark. Only 'accountant' is shown as an accountant's review;
 -- an owner's / CEO's / admin's / CFO's mark is shown as theirs, never as an accountant's verification.
 accountant_reviewed_role text NULL CHECK (accountant_reviewed_role IN ('owner','ceo','admin','cfo','accountant')),
 note text NULL CHECK (note IS NULL OR char_length(note) <= 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_classifications_review_pair_chk CHECK ((accountant_reviewed_at IS NULL) = (accountant_reviewed_by IS NULL)
   AND (accountant_reviewed_at IS NULL) = (accountant_reviewed_role IS NULL))
);
CREATE INDEX transaction_classifications_business ON public.transaction_classifications(business_id);

-- A row belongs to the company that owns the operation; it can never point across companies.
CREATE FUNCTION public.fn_transaction_classification_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = NEW.transaction_id AND t.business_id = NEW.business_id)
  THEN RAISE EXCEPTION 'transaction_classification_business_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transaction_classification_guard BEFORE INSERT OR UPDATE ON public.transaction_classifications
 FOR EACH ROW EXECUTE FUNCTION public.fn_transaction_classification_guard();
-- Same writer ordering as the ledger rows it describes.
CREATE TRIGGER financial_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.transaction_classifications
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();

ALTER TABLE public.transaction_classifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_classifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_classifications TO service_role;
REVOKE ALL ON FUNCTION public.fn_transaction_classification_guard() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
