-- ════════════════════════════════════════════════════════════════════════════
-- R001 — Atomic, business-scoped financial reset RPC.
--
-- Standalone utility. NOT one of the gated Personal/Funding migrations (037–039)
-- and NOT migration 040. This file is ADDITIVE and SAFE TO APPLY:
--   • It ONLY runs DROP/CREATE FUNCTION + REVOKE/GRANT.
--   • It does NOT execute a reset and does NOT delete any data on apply.
--
-- The reset itself only happens later, when the application calls the function
-- with a specific business id + actor. A Postgres function body runs inside a
-- single implicit transaction, and the inner BEGIN…EXCEPTION block forms a
-- subtransaction — so the delete set is ALL-OR-NOTHING: either every scoped
-- delete commits, or nothing is deleted and a structured error is returned.
--
-- Authorization is enforced INSIDE Postgres (not only in Node) and is identical
-- to the rest of the app: the actor must have an ACTIVE business_members row with
-- an approver role — being businesses.owner_user_id is NOT sufficient on its own.
--
-- Always returns structured JSON:
--   success: { "ok": true,  "deleted": { ...counts... }, "error": null }
--   failure: { "ok": false, "deleted": {}, "error": "<reason>" }
--   reasons: business_not_found | personal_workspace_not_allowed | forbidden | reset_failed
-- ════════════════════════════════════════════════════════════════════════════

-- Remove the legacy one-argument overload so it can never be called without an actor.
DROP FUNCTION IF EXISTS rpc_reset_business_financial(uuid);

CREATE OR REPLACE FUNCTION rpc_reset_business_financial(
  p_business      uuid,
  p_actor_user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  r       jsonb := '{}'::jsonb;   -- per-table delete counts
  n       bigint;
  v_type  text;
  v_role  text;
BEGIN
  -- ── Authorization (runs BEFORE any delete; a reject touches no data) ─────────
  SELECT b.type INTO v_type FROM public.businesses b WHERE b.id = p_business;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'business_not_found');
  END IF;
  IF v_type = 'personal' THEN
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'personal_workspace_not_allowed');
  END IF;

  -- Active membership with an approver role is REQUIRED — even for the owner.
  SELECT m.role INTO v_role
    FROM public.business_members m
   WHERE m.business_id = p_business
     AND m.user_id     = p_actor_user_id
     AND m.status      = 'active';
  IF NOT FOUND OR v_role NOT IN ('owner', 'admin', 'ceo', 'cfo') THEN
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'forbidden');
  END IF;

  -- ── Atomic delete set (subtransaction: any error rolls the whole thing back) ─
  BEGIN
    -- 1) Allocation / link rows first. These RESTRICT-reference transactions, debts,
    --    withholding_records and tax_treatments, so every allocation must go before the
    --    records and the core rows it points at. Order within this block matters:
    --    tax_deposit_allocations references withholding_records + tax_treatments, so it
    --    must precede them (and precede tax_deposit_entries / accounts).
    IF to_regclass('public.withholding_payment_allocations') IS NOT NULL THEN
      DELETE FROM public.withholding_payment_allocations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('withholding_payment_allocations', n);
    END IF;
    IF to_regclass('public.debt_settlement_allocations') IS NOT NULL THEN
      DELETE FROM public.debt_settlement_allocations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('debt_payments', n);
    END IF;
    IF to_regclass('public.tax_deposit_allocations') IS NOT NULL THEN
      DELETE FROM public.tax_deposit_allocations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_deposit_allocations', n);
    END IF;
    -- Intercompany settlement allocations have no business_id column — scope through the
    -- funding record (either side of the transfer touching this business).
    IF to_regclass('public.intercompany_settlement_allocations') IS NOT NULL
       AND to_regclass('public.intercompany_funding_records') IS NOT NULL THEN
      DELETE FROM public.intercompany_settlement_allocations a
        USING public.intercompany_funding_records f
       WHERE a.funding_record_id = f.id
         AND (f.cash_payer_business_id = p_business OR f.economic_owner_business_id = p_business);
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('intercompany_settlement_allocations', n);
    END IF;
    IF to_regclass('public.document_transaction_links') IS NOT NULL THEN
      DELETE FROM public.document_transaction_links WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('document_transaction_links', n);
    END IF;
    IF to_regclass('public.document_debt_links') IS NOT NULL THEN
      DELETE FROM public.document_debt_links WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('document_debt_links', n);
    END IF;

    -- 1b) Tax-deposit (034) + intercompany funding (033) parent rows. RESTRICT-reference
    --     transactions / debts, so delete after their allocations and before the core rows.
    IF to_regclass('public.tax_deposit_entries') IS NOT NULL THEN
      DELETE FROM public.tax_deposit_entries WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_deposit_entries', n);
    END IF;
    IF to_regclass('public.tax_deposit_accounts') IS NOT NULL THEN
      DELETE FROM public.tax_deposit_accounts WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_deposit_accounts', n);
    END IF;
    IF to_regclass('public.intercompany_funding_records') IS NOT NULL THEN
      DELETE FROM public.intercompany_funding_records
       WHERE cash_payer_business_id = p_business OR economic_owner_business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('intercompany_funding_records', n);
    END IF;

    -- 1c) Tax records (now unreferenced by the allocations above; still before debts).
    IF to_regclass('public.withholding_records') IS NOT NULL THEN
      DELETE FROM public.withholding_records WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('withholding_records', n);
    END IF;
    IF to_regclass('public.tax_treatments') IS NOT NULL THEN
      DELETE FROM public.tax_treatments WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('tax_treatments', n);
    END IF;

    -- 2) Bank import staging / history (children before batches)
    IF to_regclass('public.bank_import_matches') IS NOT NULL THEN
      DELETE FROM public.bank_import_matches WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_import_matches', n);
    END IF;
    IF to_regclass('public.bank_reconciliations') IS NOT NULL THEN
      DELETE FROM public.bank_reconciliations WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_reconciliations', n);
    END IF;
    IF to_regclass('public.bank_import_rows') IS NOT NULL THEN
      DELETE FROM public.bank_import_rows WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_import_rows', n);
    END IF;
    IF to_regclass('public.bank_import_batches') IS NOT NULL THEN
      DELETE FROM public.bank_import_batches WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('bank_import_batches', n);
    END IF;

    -- 3) Payroll financial child rows — COLUMN-SAFE. The static DELETE inside each
    --    branch is only PLANNED when its guard is true (plpgsql plans lazily), so a
    --    missing business_id column never raises. Falls back to the FK link, then
    --    skips cleanly if neither path exists (the row is CASCADE-cleared with the
    --    parent payroll_payments below in that case).
    IF to_regclass('public.payroll_payment_items') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'payroll_payment_items'
                    AND column_name = 'business_id') THEN
        DELETE FROM public.payroll_payment_items WHERE business_id = p_business;
        GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payment_items', n);
      ELSIF to_regclass('public.payroll_payments') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'payroll_payment_items'
                           AND column_name = 'payroll_payment_id') THEN
        DELETE FROM public.payroll_payment_items i
          USING public.payroll_payments pp
         WHERE i.payroll_payment_id = pp.id AND pp.business_id = p_business;
        GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payment_items', n);
      ELSE
        -- No scoping column available — leave to ON DELETE CASCADE from payroll_payments.
        r := r || jsonb_build_object('payroll_payment_items', 'skipped_no_scope_column');
      END IF;
    END IF;
    IF to_regclass('public.payroll_payments') IS NOT NULL THEN
      DELETE FROM public.payroll_payments WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_payments', n);
    END IF;

    -- 3b) Invoices (migration 041) — children first, then parents, then counters.
    --     Guarded: no-op until 041 is applied. Reset clears the per-business invoice
    --     numbering counter too (next invoice restarts at 00001 after a full reset).
    --     invoices.linked_debt_id is ON DELETE SET NULL, so order vs debts is irrelevant.
    IF to_regclass('public.invoice_line_items') IS NOT NULL THEN
      DELETE FROM public.invoice_line_items WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('invoice_line_items', n);
    END IF;
    IF to_regclass('public.invoices') IS NOT NULL THEN
      DELETE FROM public.invoices WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('invoices', n);
    END IF;
    IF to_regclass('public.invoice_counters') IS NOT NULL THEN
      DELETE FROM public.invoice_counters WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('invoice_counters', n);
    END IF;

    -- 4) Core financial rows
    DELETE FROM public.transactions WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('transactions', n);
    DELETE FROM public.debts WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('debts', n);
    IF to_regclass('public.reminders') IS NOT NULL THEN
      DELETE FROM public.reminders WHERE business_id = p_business;
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('reminders', n);
    END IF;
    -- payroll_employees is PRESERVED (employee master, like team), but its
    -- default_wallet_id RESTRICT-references wallets — null it for this business's
    -- wallets first so wallet deletion can't fail. Scoped via wallet membership
    -- (no dependency on payroll_employees.business_id), guarded for column presence.
    IF to_regclass('public.payroll_employees') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'payroll_employees'
                      AND column_name = 'default_wallet_id') THEN
      UPDATE public.payroll_employees
         SET default_wallet_id = NULL
       WHERE default_wallet_id IN (SELECT id FROM public.wallets WHERE business_id = p_business);
      GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('payroll_employee_wallet_refs_cleared', n);
    END IF;
    DELETE FROM public.wallets WHERE business_id = p_business;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('wallets', n);

  EXCEPTION WHEN OTHERS THEN
    -- Any failure → whole subtransaction rolls back. Nothing was deleted.
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'reset_failed');
  END;

  RETURN jsonb_build_object('ok', true, 'deleted', r, 'error', null);
END
$$;

-- Lock down execution: only the service role (used by the backend) may call it.
-- Supabase auto-grants EXECUTE to anon/authenticated/service_role via ALTER DEFAULT
-- PRIVILEGES, so revoking PUBLIC is not enough — revoke the PostgREST client roles by
-- name. (The owner role `postgres` keeps EXECUTE; it is not a client-facing role.)
REVOKE ALL ON FUNCTION rpc_reset_business_financial(uuid, bigint) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION rpc_reset_business_financial(uuid, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION rpc_reset_business_financial(uuid, bigint) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION rpc_reset_business_financial(uuid, bigint) TO service_role;
  END IF;
END $$;
