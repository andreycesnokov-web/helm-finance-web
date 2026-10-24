-- AC-0 / I-11 (24 Oct 2026): the database itself refuses an operation on a missing or another company's money
-- account, and an operation type the ledger does not know.
--
-- Before: transactions.wallet_id had no foreign key (an operation could point at a missing account, or at another
-- company's account if a writer forgot to check), and transactions.type had no check (fn_ledger_signed counts only
-- income / expense / payroll / correction; aiAccountantCore counted topup / funding / refund / withdrawal / fee too,
-- so such a row would show different balances on different screens).
-- After (smallest safe change):
--   * (wallet_id, business_id) → wallets(id, business_id): the account exists and belongs to the same company.
--     MATCH SIMPLE: legacy rows without an account (wallet_id NULL) are still allowed and still matched by name.
--   * type ∈ income, expense, payroll, correction, transfer — every type any writer produces today.
-- Staged: both are added NOT VALID (enforced for every new or changed row at once), then VALIDATEd only when no
-- existing row violates them; otherwise they stay NOT VALID and the migration reports the counts (production on
-- 24 Oct: 0 violations of either). Balances do not change: no row is touched.
-- Rollback: 20261025094000_transaction_integrity_constraints_down.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('public.transactions') IS NULL OR to_regclass('public.wallets') IS NULL
  THEN RAISE EXCEPTION 'transaction_integrity_applicability_review_required'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transactions'::regclass AND conname = 'transactions_wallet_same_business_fkey')
  THEN RAISE EXCEPTION 'transaction_integrity_already_installed'; END IF;
END $$;

-- wallets.id is the primary key, so (id, business_id) is unique by definition; the composite key is what the
-- company-consistent foreign key needs.
ALTER TABLE public.wallets ADD CONSTRAINT wallets_id_business_key UNIQUE (id, business_id);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_wallet_same_business_fkey
  FOREIGN KEY (wallet_id, business_id) REFERENCES public.wallets (id, business_id) NOT VALID;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_known
  CHECK (type IN ('income', 'expense', 'payroll', 'correction', 'transfer')) NOT VALID;

DO $$
DECLARE v_fk bigint; v_type bigint;
BEGIN
  SELECT count(*) INTO v_fk FROM public.transactions t
   WHERE t.wallet_id IS NOT NULL AND t.business_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.wallets w WHERE w.id = t.wallet_id AND w.business_id = t.business_id);
  SELECT count(*) INTO v_type FROM public.transactions WHERE type IS NOT NULL
     AND type NOT IN ('income', 'expense', 'payroll', 'correction', 'transfer');
  IF v_fk = 0 THEN ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_wallet_same_business_fkey;
  ELSE RAISE NOTICE 'transactions_wallet_same_business_fkey left NOT VALID: % existing rows need review', v_fk; END IF;
  IF v_type = 0 THEN ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_type_known;
  ELSE RAISE NOTICE 'transactions_type_known left NOT VALID: % existing rows need review', v_type; END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
