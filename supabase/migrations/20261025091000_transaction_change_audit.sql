-- AC-0 / I-5 (24 Oct 2026): every change to a business operation leaves an audit row in the same transaction.
--
-- 1. rpc_patch_business_transaction (the only edit path, PATCH /api/transactions/:id) wrote no audit: an amount,
--    date, account or currency change was untraceable. It now inserts one audit_events row with the changed fields
--    (before/after), the actor and the actor's role, the channel, the request id, the operation's source/type and
--    the version before/after. The insert is part of the function: if it fails, the edit fails and nothing changes.
--    Same validations, same locks, same result; two optional parameters (p_request_id, p_channel) — callers that do
--    not pass them keep working.
-- 2. rpc_reset_business_financial (DELETE /api/user/reset-data) hard-deleted a company's financial records without
--    any audit. It now writes 'financial_data_reset' (actor, role, per-table counts) inside its own atomic block: an
--    audit failure rolls the deletes back and the reset reports reset_failed.
-- 3. financial_write_requests (the receipts of creates, transfers, corrections, re-anchors, payroll runs) could be
--    changed or deleted. They are now append-only; a company deletion still removes them by cascade.
-- Rollback: 20261025091000_transaction_change_audit_down.sql (previous function bodies, trigger dropped).
-- No row is changed. Run after 20261025090000 (grants).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regprocedure('public.rpc_patch_business_transaction(uuid,bigint,bigint,bigint,jsonb,boolean)') IS NULL
     OR to_regprocedure('public.rpc_reset_business_financial(uuid,bigint)') IS NULL
     OR to_regclass('public.audit_events') IS NULL OR to_regclass('public.financial_write_requests') IS NULL
  THEN RAISE EXCEPTION 'transaction_change_audit_applicability_review_required'; END IF;
  IF to_regprocedure('public.rpc_patch_business_transaction(uuid,bigint,bigint,bigint,jsonb,boolean,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'transaction_change_audit_already_installed'; END IF;
END $$;

-- ── 1. Edit with audit ─────────────────────────────────────────────────────────
DROP FUNCTION public.rpc_patch_business_transaction(uuid,bigint,bigint,bigint,jsonb,boolean);
CREATE FUNCTION public.rpc_patch_business_transaction(p_business_id uuid, p_user_id bigint, p_transaction_id bigint,
  p_expected_version bigint, p_updates jsonb, p_financial boolean DEFAULT false,
  p_request_id text DEFAULT NULL, p_channel text DEFAULT 'web')
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.transactions; result public.transactions; financial boolean; v_role text;
  v_before jsonb := '{}'::jsonb; v_after jsonb := '{}'::jsonb; v_key text;
  FIELDS constant text[] := ARRAY['category','description','wallet_id','transaction_date','amount_original','currency_original','amount_idr','booked_rate','rate_source'];
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  IF p_request_id IS NOT NULL AND length(p_request_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid_request_id: Request id must be 1-128 characters';
  END IF;
  SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found: Transaction not found in company'; END IF;
  IF t.balance_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'transaction_version_conflict: Transaction changed; reload before saving';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_updates) k
    WHERE k NOT IN ('category','description','wallet_id','transaction_date','amount_original','currency_original','amount_idr','booked_rate','rate_source')) THEN
    RAISE EXCEPTION 'invalid_transaction_patch: Unsupported field';
  END IF;
  financial:=p_financial OR p_updates ?| ARRAY['wallet_id','transaction_date','amount_original','currency_original','amount_idr','booked_rate','rate_source'];
  IF financial AND t.source='wallet_opening_balance' THEN
    RAISE EXCEPTION 'opening_balance_cannot_be_modified: Opening balance financial fields are immutable';
  END IF;
  IF financial AND (t.transfer_id IS NOT NULL OR t.source LIKE 'xfer:%') THEN
    RAISE EXCEPTION 'transfer_financial_fields_immutable: Edit the complete transfer instead';
  END IF;
  IF financial AND (t.bank_import_row_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.bank_import_rows r
      WHERE r.business_id=p_business_id AND (r.linked_transaction_id=t.id OR r.matched_transaction_id=t.id))) THEN
    RAISE EXCEPTION 'statement_financial_fields_immutable: Statement financial fields are immutable';
  END IF;
  IF financial AND (t.is_debt_payment OR t.debt_payment_id IS NOT NULL OR t.description LIKE 'Payment:%' OR EXISTS (SELECT 1 FROM public.debts d WHERE d.business_id=p_business_id AND d.linked_transaction_id=t.id)
    OR EXISTS (SELECT 1 FROM public.debt_payment_idempotency i WHERE i.business_id=p_business_id AND i.transaction_id=t.id)) THEN
    RAISE EXCEPTION 'debt_payment_amount_immutable: Edit the linked debt instead';
  END IF;
  IF financial AND (t.type='payroll' OR EXISTS (SELECT 1 FROM public.payroll_payments p WHERE p.business_id=p_business_id AND p.transaction_id=t.id)) THEN
    RAISE EXCEPTION 'payroll_financial_fields_immutable: Edit the linked payroll instead';
  END IF;
  result:=jsonb_populate_record(t,p_updates);
  IF financial AND t.wallet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wallets w
    WHERE w.id=t.wallet_id AND w.business_id=p_business_id AND upper(w.currency)=upper(t.currency_original)) THEN
    RAISE EXCEPTION 'currency_mismatch: Original wallet and transaction currency must match';
  END IF;
  IF financial AND result.type <> 'correction' AND (result.amount_original<=0 OR result.amount_original::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'invalid_amount: Amount must be positive and finite';
  END IF;
  -- Direct RPC uses the same currency validation, even for a currency-only edit.
  IF financial AND result.wallet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wallets w
    WHERE w.id=result.wallet_id AND w.business_id=p_business_id AND upper(w.currency)=upper(result.currency_original)) THEN
    RAISE EXCEPTION 'currency_mismatch: Target wallet and transaction currency must match';
  END IF;
  UPDATE public.transactions SET category=result.category,description=result.description,wallet_id=result.wallet_id,
    is_debt_payment=t.is_debt_payment OR COALESCE(t.description LIKE 'Payment:%',false),
    transaction_date=result.transaction_date,amount_original=result.amount_original,currency_original=result.currency_original,
    amount_idr=result.amount_idr,booked_rate=result.booked_rate,rate_source=result.rate_source
    WHERE id=t.id AND business_id=p_business_id RETURNING * INTO result;
  IF p_updates ? 'amount_original' AND result.amount_original <> (p_updates->>'amount_original')::numeric THEN
    RAISE EXCEPTION 'invalid_amount_precision: Amount exceeds ledger precision';
  END IF;
  -- Audit, atomically with the change: only the fields whose value changed; nothing when nothing changed.
  FOREACH v_key IN ARRAY FIELDS LOOP
    IF (to_jsonb(t)->v_key) IS DISTINCT FROM (to_jsonb(result)->v_key) THEN
      v_before := v_before || jsonb_build_object(v_key, to_jsonb(t)->v_key);
      v_after := v_after || jsonb_build_object(v_key, to_jsonb(result)->v_key);
    END IF;
  END LOOP;
  IF v_after <> '{}'::jsonb THEN
    SELECT m.role INTO v_role FROM public.business_members m
     WHERE m.business_id=p_business_id AND m.user_id=p_user_id AND m.status='active';
    INSERT INTO public.audit_events(business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json, request_id)
    VALUES (p_business_id, p_user_id, v_role, COALESCE(p_channel, 'web'), 'transaction', t.id::text,
      CASE WHEN financial THEN 'transaction_financial_update' ELSE 'transaction_update' END,
      jsonb_build_object('fields', v_before, 'balance_version', t.balance_version, 'type', t.type, 'source', t.source),
      jsonb_build_object('fields', v_after, 'balance_version', result.balance_version, 'operation', 'edit'),
      p_request_id);
  END IF;
  RETURN to_jsonb(result);
END; $function$;
REVOKE ALL ON FUNCTION public.rpc_patch_business_transaction(uuid,bigint,bigint,bigint,jsonb,boolean,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_patch_business_transaction(uuid,bigint,bigint,bigint,jsonb,boolean,text,text) TO service_role;

-- ── 2. Reset with audit (previous body; one audit insert inside its atomic block) ──
CREATE OR REPLACE FUNCTION public.rpc_reset_business_financial(p_business uuid, p_actor_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  r       jsonb := '{}'::jsonb;   -- per-table delete counts
  n       bigint;
  v_type  text;
  v_role  text;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
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

    -- AC-0 / I-5: who reset what, inside the atomic block — an audit failure rolls every delete back.
    INSERT INTO public.audit_events(business_id, actor_user_id, actor_role, channel, entity_type, entity_id, action, before_json, after_json)
    VALUES (p_business, p_actor_user_id, v_role, 'web', 'business', p_business::text, 'financial_data_reset', NULL,
      jsonb_build_object('deleted', r, 'operation', 'reset'));

  EXCEPTION WHEN OTHERS THEN
    -- Any failure → whole subtransaction rolls back. Nothing was deleted.
    RETURN jsonb_build_object('ok', false, 'deleted', '{}'::jsonb, 'error', 'reset_failed');
  END;

  RETURN jsonb_build_object('ok', true, 'deleted', r, 'error', null);
END
$function$;

REVOKE ALL ON FUNCTION public.rpc_reset_business_financial(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reset_business_financial(uuid,bigint) TO service_role;

-- ── 3. Receipts are append-only (a company deletion still cascades) ────────────
CREATE FUNCTION public.fn_financial_write_requests_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'financial_write_requests_append_only: receipts cannot be changed'; END IF;
  -- DELETE: only as the cascade of deleting the company itself (the company row is already gone).
  IF EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
    RAISE EXCEPTION 'financial_write_requests_append_only: receipts cannot be deleted';
  END IF;
  RETURN OLD;
END; $function$;
REVOKE ALL ON FUNCTION public.fn_financial_write_requests_append_only() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER financial_write_requests_append_only BEFORE UPDATE OR DELETE ON public.financial_write_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_financial_write_requests_append_only();

NOTIFY pgrst, 'reload schema';
COMMIT;
