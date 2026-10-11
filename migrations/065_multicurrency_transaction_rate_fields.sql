-- Migration 065 — Multi-currency transaction rate fields (Design v2)
--
-- NOT APPLIED anywhere by this change. The owner applies migrations.
--
-- WHAT:
--   Adds booked_rate, rate_source, fx_quote_id, rate_effective_date to public.transactions.
--   These fields record the exchange rate snapshot used when converting
--   foreign-currency amounts to amount_idr at transaction creation/edit time.
--
-- ADDITIVE and IDEMPOTENT:
--   No existing tables are dropped or modified destructively.
--   Columns default to NULL for backward compatibility with existing IDR rows.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS booked_rate NUMERIC(38,18) NULL,
  ADD COLUMN IF NOT EXISTS rate_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS fx_quote_id UUID NULL,
  ADD COLUMN IF NOT EXISTS rate_effective_date DATE NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'exchange_rate_quotes') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'transactions' AND tc.constraint_type = 'FOREIGN KEY' AND ccu.column_name = 'fx_quote_id'
    ) THEN
      ALTER TABLE public.transactions
        ADD CONSTRAINT fk_transactions_fx_quote_id
        FOREIGN KEY (fx_quote_id) REFERENCES public.exchange_rate_quotes(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
