-- AC-0 / I-12 (24 Oct 2026): bill payments respect non-cash settlement, and every company can see where its bill
-- counters and its payment records disagree.
--
-- Authoritative sources (unchanged): money paid on a bill = its payment operations (transactions.debt_payment_id);
-- non-cash settlement = debt_settlement_allocations of type withholding_record / credit_note / adjustment;
-- remaining = amount − cash paid − non-cash settlement (server/lib/debtWithholding.js). debts.paid_amount is a
-- counter of the cash paid, written by rpc_record_debt_payment in the same transaction as the payment row.
--
-- 1. rpc_record_debt_payment ignored non-cash settlement: after a customer's PPh 23 slip was allocated, the full
--    gross could still be paid, so cash + withholding exceeded the invoice (the withholding counted twice), and a
--    bill settled by cash + withholding stayed 'partial'. Remaining and "fully paid" now include non-cash
--    settlement. Nothing else in the function changes (locks, idempotency, currency checks, the payment row).
-- 2. rpc_debt_settlement_reconciliation(business): read-only; lists every bill whose counter, payments,
--    allocations or status disagree, and payment rows that do not fit their bill. It never writes and never moves
--    cash; differences are exceptions for a person to resolve.
-- Rollback: 20261025093000_debt_settlement_integrity_down.sql (previous payment function, reconciliation dropped).
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regprocedure('public.rpc_record_debt_payment(uuid,bigint,bigint,uuid,numeric,text,numeric,numeric,text,date,text,text,text,timestamptz)') IS NULL
     OR to_regclass('public.debt_settlement_allocations') IS NULL
  THEN RAISE EXCEPTION 'debt_settlement_integrity_applicability_review_required'; END IF;
  IF to_regprocedure('public.rpc_debt_settlement_reconciliation(uuid)') IS NOT NULL
  THEN RAISE EXCEPTION 'debt_settlement_integrity_already_installed'; END IF;
END $$;

-- ── 1. Payment with non-cash settlement ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_debt_payment(p_business_id uuid, p_user_id bigint, p_debt_id bigint, p_wallet_id uuid, p_amount numeric, p_currency text, p_amount_idr numeric, p_booked_rate numeric, p_rate_source text, p_payment_date date, p_idempotency_key text, p_request_hash text, p_account_name text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_existing RECORD;
  v_debt RECORD;
  v_wallet RECORD;
  v_remaining numeric;
  v_new_paid numeric;
  v_effective_total numeric;
  v_noncash numeric;
  v_is_fully_paid boolean;
  v_new_status text;
  v_tx_id bigint;
  v_tx_type text;
  v_result jsonb;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_amount: Payment must be positive and finite';
  END IF;
  -- 1. Check idempotency record first
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.debt_payment_idempotency
    WHERE business_id = p_business_id AND user_id = p_user_id AND key = trim(p_idempotency_key);

    IF FOUND THEN
      IF v_existing.request_hash = p_request_hash THEN
        -- Exact replay with identical parameters: return cached response
        RETURN jsonb_build_object(
          'ok', true,
          'is_replay', true,
          'status', v_existing.response_status,
          'data', v_existing.response_body
        );
      ELSE
        -- Same key used with different payload: reject
        RAISE EXCEPTION 'idempotency_key_mismatch: Key already used with different payment parameters';
      END IF;
    END IF;
  END IF;

  -- 2. Lock debt row FOR UPDATE and verify ownership and currency
  SELECT * INTO v_debt
  FROM public.debts
  WHERE id = p_debt_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'debt_not_found: Debt does not exist or does not belong to active business';
  END IF;

  IF v_debt.currency IS NULL OR upper(trim(v_debt.currency)) <> upper(trim(p_currency)) THEN
    RAISE EXCEPTION 'debt_currency_mismatch: Debt currency does not match payment currency';
  END IF;

  -- 3. Lock wallet row FOR UPDATE and verify ownership and currency
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found: Wallet does not exist or does not belong to active business';
  END IF;

  IF v_wallet.currency IS NULL OR upper(trim(v_wallet.currency)) <> upper(trim(p_currency)) THEN
    RAISE EXCEPTION 'wallet_currency_mismatch: Wallet currency does not match payment currency';
  END IF;

  -- 3b. Re-check idempotency record after acquiring locks to prevent concurrent race
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.debt_payment_idempotency
    WHERE business_id = p_business_id AND user_id = p_user_id AND key = trim(p_idempotency_key);

    IF FOUND THEN
      IF v_existing.request_hash = p_request_hash THEN
        RETURN jsonb_build_object(
          'ok', true,
          'is_replay', true,
          'status', v_existing.response_status,
          'data', v_existing.response_body
        );
      ELSE
        RAISE EXCEPTION 'idempotency_key_mismatch: Key already used with different payment parameters';
      END IF;
    END IF;
  END IF;

  -- 4. Calculate remaining balance with exact precision
  v_effective_total := COALESCE(v_debt.original_amount, v_debt.amount, 0);
  -- AC-0 / I-12: withholding, credit notes and adjustments already allocated to the bill settle it too.
  v_noncash := COALESCE((SELECT sum(a.allocated_amount) FROM public.debt_settlement_allocations a
    WHERE a.debt_id = v_debt.id AND a.business_id = p_business_id AND a.settlement_source_type <> 'transaction'), 0);
  v_remaining := GREATEST(0, v_effective_total - COALESCE(v_debt.paid_amount, 0) - v_noncash);

  IF p_amount > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'payment_exceeds_remaining: Payment amount % exceeds remaining debt balance %', p_amount, v_remaining;
  END IF;

  -- 5. Determine new payment states
  v_new_paid := COALESCE(v_debt.paid_amount, 0) + p_amount;
  v_is_fully_paid := v_new_paid + v_noncash >= (v_effective_total - 0.01);
  v_new_status := CASE WHEN v_is_fully_paid THEN 'paid' ELSE 'partial' END;
  v_tx_type := CASE WHEN v_debt.type = 'payable' THEN 'expense' ELSE 'income' END;

  -- 6. Insert ledger transaction
  INSERT INTO public.transactions (
    business_id,
    debt_payment_id,
    created_by_user_id,
    type,
    amount_original,
    currency_original,
    amount_idr,
    booked_rate,
    rate_source,
    description,
    source,
    wallet_id,
    scope,
    transaction_date,
    created_at
  ) VALUES (
    p_business_id,
    p_debt_id,
    p_user_id,
    v_tx_type,
    p_amount,
    upper(trim(p_currency)),
    p_amount_idr,
    p_booked_rate,
    p_rate_source,
    'Payment: ' || COALESCE(v_debt.counterparty, 'Debt #' || v_debt.id),
    COALESCE(p_account_name, v_wallet.name),
    v_wallet.id,
    COALESCE(v_debt.scope, v_wallet.scope, 'business'),
    p_payment_date,
    COALESCE(p_created_at, now())
  ) RETURNING id INTO v_tx_id;

  IF (SELECT amount_original FROM public.transactions WHERE id=v_tx_id) <> p_amount THEN
    RAISE EXCEPTION 'invalid_amount_precision: Payment exceeds ledger precision';
  END IF;

  -- 7. Update debt
  UPDATE public.debts SET
    paid_amount = v_new_paid,
    status = v_new_status,
    is_settled = v_is_fully_paid,
    settled_at = CASE WHEN v_is_fully_paid THEN COALESCE(settled_at, now()) ELSE NULL END,
    last_payment_at = now(),
    linked_transaction_id = v_tx_id
  WHERE id = v_debt.id;

  -- 8. Build success response body
  v_result := jsonb_build_object(
    'ok', true,
    'isFullyPaid', v_is_fully_paid,
    'remaining', GREATEST(0, v_effective_total - v_new_paid - v_noncash),
    'paid_amount', v_new_paid,
    'status', v_new_status,
    'transaction_id', v_tx_id,
    'debt_id', v_debt.id,
    'debt', (SELECT to_jsonb(d) FROM public.debts d WHERE d.id = v_debt.id)
  );

  -- 9. Store in idempotency table if key provided
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    INSERT INTO public.debt_payment_idempotency (
      business_id,
      debt_id,
      user_id,
      key,
      request_hash,
      transaction_id,
      response_status,
      response_body
    ) VALUES (
      p_business_id,
      v_debt.id,
      p_user_id,
      trim(p_idempotency_key),
      p_request_hash,
      v_tx_id,
      200,
      v_result
    )
    ON CONFLICT (business_id, user_id, key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_replay', false,
    'status', 200,
    'data', v_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_record_debt_payment(uuid,bigint,bigint,uuid,numeric,text,numeric,numeric,text,date,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_record_debt_payment(uuid,bigint,bigint,uuid,numeric,text,numeric,numeric,text,date,text,text,text,timestamptz) TO service_role;

-- ── 2. Read-only reconciliation ───────────────────────────────────────────────
CREATE FUNCTION public.rpc_debt_settlement_reconciliation(p_business uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH d AS (
    SELECT b.id, b.type, upper(COALESCE(b.currency, 'IDR')) currency, COALESCE(b.original_amount, b.amount, 0) total,
           COALESCE(b.paid_amount, 0) paid_counter, COALESCE(b.is_settled, false) is_settled, b.status, b.approval_status,
           COALESCE((SELECT sum(t.amount_original) FROM public.transactions t WHERE t.debt_payment_id = b.id AND t.business_id = b.business_id), 0) cash_paid,
           (SELECT count(*) FROM public.transactions t WHERE t.debt_payment_id = b.id AND t.business_id = b.business_id) payment_rows,
           COALESCE((SELECT sum(a.allocated_amount) FROM public.debt_settlement_allocations a WHERE a.debt_id = b.id AND a.business_id = b.business_id
                     AND a.settlement_source_type <> 'transaction'), 0) noncash
      FROM public.debts b WHERE b.business_id = p_business
  ), bill_issues AS (
    SELECT d.id, x.reason, x.detail FROM d CROSS JOIN LATERAL (VALUES
      ('counter_differs_from_payments', d.paid_counter <> d.cash_paid,
        jsonb_build_object('paid_counter', d.paid_counter, 'payment_rows_total', d.cash_paid, 'payment_rows', d.payment_rows)),
      ('settled_beyond_amount', d.cash_paid + d.noncash > d.total + 0.01,
        jsonb_build_object('total', d.total, 'cash_paid', d.cash_paid, 'non_cash', d.noncash)),
      ('marked_settled_but_open', d.is_settled AND d.total - d.cash_paid - d.noncash > 0.01,
        jsonb_build_object('remaining', d.total - d.cash_paid - d.noncash)),
      ('fully_settled_but_open_status', NOT d.is_settled AND d.total > 0 AND d.total - d.cash_paid - d.noncash <= 0.01,
        jsonb_build_object('status', d.status, 'cash_paid', d.cash_paid, 'non_cash', d.noncash)),
      ('payments_on_unapproved_bill', d.payment_rows > 0 AND d.approval_status IN ('rejected', 'pending_approval'),
        jsonb_build_object('approval_status', d.approval_status, 'payment_rows', d.payment_rows))
    ) AS x(reason, hit, detail) WHERE x.hit
  ), row_issues AS (
    SELECT t.debt_payment_id id, 'payment_row_does_not_fit_bill' reason,
           jsonb_build_object('transaction_id', t.id, 'type', t.type, 'currency', t.currency_original,
             'expected_type', CASE WHEN b.type = 'payable' THEN 'expense' ELSE 'income' END, 'bill_currency', upper(COALESCE(b.currency, 'IDR'))) detail
      FROM public.transactions t JOIN public.debts b ON b.id = t.debt_payment_id
     WHERE t.business_id = p_business AND b.business_id = p_business
       AND (t.type <> CASE WHEN b.type = 'payable' THEN 'expense' ELSE 'income' END
            OR upper(COALESCE(t.currency_original, 'IDR')) <> upper(COALESCE(b.currency, 'IDR')))
    UNION ALL
    SELECT t.debt_payment_id, 'payment_row_points_to_other_company', jsonb_build_object('transaction_id', t.id)
      FROM public.transactions t JOIN public.debts b ON b.id = t.debt_payment_id
     WHERE t.business_id = p_business AND b.business_id IS DISTINCT FROM p_business
    UNION ALL
    SELECT a.debt_id, 'transaction_allocation_without_payment_row', jsonb_build_object('allocation_id', a.id, 'transaction_id', a.transaction_id)
      FROM public.debt_settlement_allocations a LEFT JOIN public.transactions t ON t.id = a.transaction_id
     WHERE a.business_id = p_business AND a.settlement_source_type = 'transaction'
       AND (t.id IS NULL OR t.business_id IS DISTINCT FROM p_business OR t.debt_payment_id IS DISTINCT FROM a.debt_id)
  ), issues AS (SELECT * FROM bill_issues UNION ALL SELECT * FROM row_issues)
  SELECT jsonb_build_object(
    'business_id', p_business,
    'bills_checked', (SELECT count(*) FROM d),
    'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('debt_id', id, 'reason', reason, 'detail', detail) ORDER BY id, reason) FROM issues), '[]'::jsonb),
    'by_reason', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) n FROM issues GROUP BY reason) r), '{}'::jsonb),
    'writes', false)
$function$;
REVOKE ALL ON FUNCTION public.rpc_debt_settlement_reconciliation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_debt_settlement_reconciliation(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
