-- ════════════════════════════════════════════════════════════════════════════
-- R001 — Atomic, business-scoped financial reset RPC. Standalone utility (NOT one
-- of the gated Personal/Funding migrations 037–039/040). Additive + idempotent.
-- A Postgres function runs in a single implicit transaction → all-or-nothing:
-- either every scoped delete commits, or nothing is deleted. PROPOSAL — apply when
-- ready (read-only otherwise; required for the reset endpoint to function).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rpc_reset_business_financial(p_business uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r jsonb := '{}'::jsonb; n bigint;
BEGIN
  -- child / link rows first (each guarded; skip if the table is absent)
  IF to_regclass('public.debt_settlement_allocations') IS NOT NULL THEN
    DELETE FROM public.debt_settlement_allocations a USING public.debts d
      WHERE a.debt_id = d.id AND d.business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('debt_payments', n);
  END IF;
  IF to_regclass('public.document_transaction_links') IS NOT NULL THEN
    DELETE FROM public.document_transaction_links l USING public.transactions t
      WHERE l.transaction_id = t.id AND t.business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('document_transaction_links', n);
  END IF;
  IF to_regclass('public.document_debt_links') IS NOT NULL THEN
    DELETE FROM public.document_debt_links l USING public.debts d
      WHERE l.debt_id = d.id AND d.business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('document_debt_links', n);
  END IF;
  IF to_regclass('public.payroll_payments') IS NOT NULL THEN
    DELETE FROM public.payroll_payments WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payments', n);
  END IF;
  -- core financial rows
  DELETE FROM public.transactions WHERE business_id = p_business;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('transactions', n);
  DELETE FROM public.debts WHERE business_id = p_business;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('debts', n);
  IF to_regclass('public.reminders') IS NOT NULL THEN
    DELETE FROM public.reminders WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('reminders', n);
  END IF;
  DELETE FROM public.wallets WHERE business_id = p_business;
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('wallets', n);
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION rpc_reset_business_financial(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
  THEN GRANT EXECUTE ON FUNCTION rpc_reset_business_financial(uuid) TO service_role; END IF; END $$;
