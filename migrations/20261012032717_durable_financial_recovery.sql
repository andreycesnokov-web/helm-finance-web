-- Generated via Supabase CLI; own staging only after backup/projection gates.
-- Existing receipts only, no parallel intent ledger. Keep gate/parent order.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.financial_write_requests DROP CONSTRAINT financial_write_requests_operation_check;
ALTER TABLE public.financial_write_requests ADD CONSTRAINT financial_write_requests_operation_check
  CHECK(operation IN ('wallet_create','transaction_batch','wallet_adjust','wallet_transfer'));
CREATE INDEX financial_write_requests_recovery_recent ON public.financial_write_requests(business_id,actor_user_id,created_at DESC);
ALTER TABLE public.debt_payment_idempotency ADD COLUMN intent jsonb;
ALTER TABLE public.debt_payment_idempotency DROP CONSTRAINT debt_payment_idempotency_biz_key_unique;
ALTER TABLE public.debt_payment_idempotency ADD CONSTRAINT debt_payment_idempotency_actor_key_unique UNIQUE(business_id,user_id,key);
ALTER TABLE public.debt_payment_idempotency DROP CONSTRAINT debt_payment_idempotency_debt_id_fkey;
ALTER TABLE public.debt_payment_idempotency ADD CONSTRAINT debt_payment_idempotency_debt_id_fkey
  FOREIGN KEY(debt_id) REFERENCES public.debts(id) ON DELETE RESTRICT;
CREATE INDEX debt_payment_idempotency_recovery_recent ON public.debt_payment_idempotency(business_id,user_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.rpc_record_debt_payment(
  p_business_id uuid,
  p_user_id bigint,
  p_debt_id bigint,
  p_wallet_id uuid,
  p_amount numeric,
  p_currency text,
  p_amount_idr numeric,
  p_booked_rate numeric,
  p_rate_source text,
  p_payment_date date,
  p_idempotency_key text,
  p_request_hash text,
  p_account_name text DEFAULT NULL,
  p_created_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing RECORD;
  v_debt RECORD;
  v_wallet RECORD;
  v_remaining numeric;
  v_new_paid numeric;
  v_effective_total numeric;
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
  v_remaining := GREATEST(0, v_effective_total - COALESCE(v_debt.paid_amount, 0));

  IF p_amount > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'payment_exceeds_remaining: Payment amount % exceeds remaining debt balance %', p_amount, v_remaining;
  END IF;

  -- 5. Determine new payment states
  v_new_paid := COALESCE(v_debt.paid_amount, 0) + p_amount;
  v_is_fully_paid := v_new_paid >= (v_effective_total - 0.01);
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
    'remaining', GREATEST(0, v_effective_total - v_new_paid),
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
$$;
CREATE OR REPLACE FUNCTION public.rpc_create_business_wallet(
  p_business_id uuid,p_user_id bigint,p_request_key text,p_intent jsonb,p_wallet jsonb,p_opening jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.financial_write_requests; w public.wallets; t public.transactions; answer jsonb; owner_id bigint;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  SELECT owner_user_id INTO owner_id FROM businesses WHERE id=p_business_id AND
    (owner_user_id=p_user_id OR EXISTS(SELECT 1 FROM business_members m WHERE m.business_id=p_business_id
      AND m.user_id=p_user_id AND m.status='active' AND m.role IN ('owner','ceo','admin','cfo')));
  IF NOT FOUND THEN RAISE EXCEPTION 'business_write_forbidden: Wallet management role required'; END IF;
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'idempotency_key_required: Keep a stable request key for this create intent';
  END IF;
  SELECT * INTO prior FROM financial_write_requests WHERE business_id=p_business_id AND actor_user_id=p_user_id
    AND operation='wallet_create' AND request_key=p_request_key;
  IF FOUND THEN
    IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'idempotency_key_mismatch: Request key already used'; END IF;
    SELECT * INTO w FROM wallets WHERE id=(prior.result->'wallet'->>'id')::uuid AND business_id=p_business_id;
    RETURN prior.result || jsonb_build_object('is_replay',true,'result_is_historical',true,
      'object_state',CASE WHEN NOT FOUND THEN 'removed' WHEN w.is_active=false THEN 'archived' ELSE 'active' END);
  END IF;
  IF p_wallet->>'scope' IS DISTINCT FROM 'business' OR nullif(btrim(p_wallet->>'name'),'') IS NULL THEN
    RAISE EXCEPTION 'wallet_scope_mismatch: A named Business wallet is required';
  END IF;
  INSERT INTO wallets(business_id,user_id,name,currency,type,entity_name,color,sort_order,scope)
    VALUES(p_business_id,owner_id,p_wallet->>'name',upper(p_wallet->>'currency'),p_wallet->>'type',
      p_wallet->>'entity_name',p_wallet->>'color',COALESCE((p_wallet->>'sort_order')::int,0),'business') RETURNING * INTO w;
  IF p_opening IS NOT NULL AND p_opening<>'null'::jsonb THEN
    t:=jsonb_populate_record(NULL::public.transactions,p_opening);
    IF t.currency_original IS DISTINCT FROM w.currency OR t.amount_original IS NULL OR t.amount_original<=0
      OR t.type NOT IN ('income','expense') OR t.amount_original::text IN ('NaN','Infinity','-Infinity')
      OR t.amount_original<>(p_opening->>'amount_original')::numeric THEN
      RAISE EXCEPTION 'invalid_opening_balance: Explicit native opening amount/currency required';
    END IF;
    INSERT INTO transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,
      booked_rate,rate_source,category,description,source,is_opening_balance,wallet_id,scope)
      VALUES(p_business_id,owner_id,p_user_id,t.type,t.amount_original,t.currency_original,t.amount_idr,
        t.booked_rate,t.rate_source,'Opening balance',t.description,'wallet_opening_balance',true,w.id,'business');
  END IF;
  answer:=jsonb_build_object('wallet',to_jsonb(w));
  INSERT INTO financial_write_requests VALUES(p_business_id,p_user_id,'wallet_create',p_request_key,p_intent,answer,now());
  RETURN answer;
END $$;

CREATE FUNCTION public.rpc_record_debt_payment_recovery(
 p_business_id uuid,p_user_id bigint,p_debt_id bigint,p_wallet_id uuid,p_amount numeric,p_currency text,
 p_amount_idr numeric,p_booked_rate numeric,p_rate_source text,p_payment_date date,p_idempotency_key text,
 p_request_hash text,p_account_name text,p_created_at timestamptz,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.debt_payment_idempotency; answer jsonb; has_prior boolean;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 PERFORM public.fn_balance_actor(p_business_id,p_user_id);
 IF NOT EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=p_business_id AND
   (b.owner_user_id=p_user_id OR EXISTS(SELECT 1 FROM public.business_members m WHERE m.business_id=b.id AND m.user_id=p_user_id AND m.status='active' AND m.role IN ('owner','ceo','admin','cfo','accountant'))))
 THEN RAISE EXCEPTION 'business_write_forbidden: Confirmed financial role required'; END IF;
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'idempotency_key_required: Stable payment key required'; END IF;
 IF p_intent IS NULL OR p_intent->>'operation' IS DISTINCT FROM 'debt_payment' OR p_intent->>'scope' IS DISTINCT FROM 'business'
   OR p_intent#>>'{payload,debt_id}' IS DISTINCT FROM p_debt_id::text
   OR (p_intent#>>'{payload,wallet_id}' IS NOT NULL AND p_intent#>>'{payload,wallet_id}' IS DISTINCT FROM p_wallet_id::text)
   OR (p_intent#>>'{payload,wallet_id}' IS NULL AND p_intent#>>'{payload,account}' IS DISTINCT FROM p_account_name)
   OR (p_intent#>>'{payload,amount}')::numeric IS DISTINCT FROM p_amount
 THEN RAISE EXCEPTION 'idempotency_key_mismatch: Payment identity does not describe the native write'; END IF;
 SELECT * INTO prior FROM public.debt_payment_idempotency WHERE business_id=p_business_id AND user_id=p_user_id AND key=p_idempotency_key;
 has_prior:=FOUND;
 IF has_prior THEN
   IF prior.intent IS NULL THEN RAISE EXCEPTION 'legacy_receipt_requires_review: Read the historical payment before continuing'; END IF;
   IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'idempotency_key_mismatch: Payment key already used with different payload'; END IF;
   RETURN jsonb_build_object('ok',true,'is_replay',true,'result_is_historical',true,'status',prior.response_status,'data',prior.response_body);
 END IF;
 answer:=public.rpc_record_debt_payment_guarded(p_business_id,p_user_id,p_debt_id,p_wallet_id,p_amount,p_currency,p_amount_idr,p_booked_rate,p_rate_source,p_payment_date,p_idempotency_key,p_request_hash,p_account_name,p_created_at);
 IF answer->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'atomic_payment_failed: No confirmed payment result'; END IF;
 UPDATE public.debt_payment_idempotency SET intent=p_intent WHERE business_id=p_business_id AND user_id=p_user_id AND key=p_idempotency_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'atomic_payment_failed: Payment receipt missing'; END IF;
 RETURN answer;
END $$;

CREATE FUNCTION public.rpc_execute_wallet_transfer_recovery(
 p_business_id uuid,p_user_id bigint,p_from_wallet_id uuid,p_to_wallet_id uuid,p_source_amount numeric,
 p_source_currency text,p_source_amount_idr numeric,p_source_booked_rate numeric,p_target_amount numeric,
 p_target_currency text,p_target_amount_idr numeric,p_target_booked_rate numeric,p_rate_source text,p_description text,
 p_transaction_date date,p_transfer_id uuid,p_scope text,p_request_key text,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.financial_write_requests; answer jsonb;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 PERFORM public.fn_balance_actor(p_business_id,p_user_id);
 IF NOT EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=p_business_id AND
   (b.owner_user_id=p_user_id OR EXISTS(SELECT 1 FROM public.business_members m WHERE m.business_id=b.id AND m.user_id=p_user_id AND m.status='active' AND m.role IN ('owner','ceo','admin','cfo','accountant'))))
 THEN RAISE EXCEPTION 'business_write_forbidden: Confirmed financial role required'; END IF;
 IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'idempotency_key_required: Stable transfer key required'; END IF;
 IF p_scope IS DISTINCT FROM 'business' OR p_intent IS NULL OR p_intent->>'operation' IS DISTINCT FROM 'wallet_transfer'
   OR p_intent->>'scope' IS DISTINCT FROM 'business'
   OR p_intent#>>'{payload,from_wallet_id}' IS DISTINCT FROM p_from_wallet_id::text
   OR p_intent#>>'{payload,to_wallet_id}' IS DISTINCT FROM p_to_wallet_id::text
   OR (p_intent#>>'{payload,amount}')::numeric IS DISTINCT FROM p_source_amount
 THEN RAISE EXCEPTION 'idempotency_key_mismatch: Transfer identity does not describe the native write'; END IF;
 SELECT * INTO prior FROM public.financial_write_requests WHERE business_id=p_business_id AND actor_user_id=p_user_id AND operation='wallet_transfer' AND request_key=p_request_key;
 IF FOUND THEN
   IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'idempotency_key_mismatch: Transfer key already used'; END IF;
   RETURN prior.result || jsonb_build_object('is_replay',true,'result_is_historical',true);
 END IF;
 answer:=public.rpc_execute_wallet_transfer_guarded(p_business_id,p_user_id,p_from_wallet_id,p_to_wallet_id,p_source_amount,p_source_currency,p_source_amount_idr,p_source_booked_rate,p_target_amount,p_target_currency,p_target_amount_idr,p_target_booked_rate,p_rate_source,p_description,p_transaction_date,p_transfer_id,p_scope);
 IF answer->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'atomic_transfer_failed: No confirmed transfer result'; END IF;
 INSERT INTO public.financial_write_requests(business_id,actor_user_id,operation,request_key,intent,result)
   VALUES(p_business_id,p_user_id,'wallet_transfer',p_request_key,p_intent,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_record_debt_payment_recovery(uuid,bigint,bigint,uuid,numeric,text,numeric,numeric,text,date,text,text,text,timestamptz,jsonb),
 public.rpc_execute_wallet_transfer_recovery(uuid,bigint,uuid,uuid,numeric,text,numeric,numeric,numeric,text,numeric,numeric,text,text,date,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_record_debt_payment_recovery(uuid,bigint,bigint,uuid,numeric,text,numeric,numeric,text,date,text,text,text,timestamptz,jsonb),
 public.rpc_execute_wallet_transfer_recovery(uuid,bigint,uuid,uuid,numeric,text,numeric,numeric,numeric,text,numeric,numeric,text,text,date,uuid,text,text,jsonb) TO service_role;
CREATE FUNCTION public.rpc_list_own_financial_receipts(
 p_business_id uuid,p_user_id bigint,p_operation text DEFAULT NULL,p_before timestamptz DEFAULT NULL,
 p_after_operation text DEFAULT NULL,p_after_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE role_name text; answer jsonb;
BEGIN
 SELECT CASE WHEN b.owner_user_id=p_user_id THEN 'owner' ELSE m.role END INTO role_name
 FROM public.businesses b LEFT JOIN public.business_members m ON m.business_id=b.id AND m.user_id=p_user_id AND m.status='active'
 WHERE b.id=p_business_id AND COALESCE(b.type,'business')<>'personal' AND COALESCE(b.status,'active')<>'archived'
   AND (b.owner_user_id=p_user_id OR m.user_id IS NOT NULL);
 IF role_name IS NULL OR role_name NOT IN ('owner','ceo','admin','cfo','accountant') THEN RAISE EXCEPTION 'business_write_forbidden: Current financial membership required'; END IF;
 IF p_operation IS NOT NULL AND p_operation NOT IN ('wallet_create','transaction_batch','wallet_adjust','debt_payment','wallet_transfer')
 THEN RAISE EXCEPTION 'invalid_financial_intent: Unsupported receipt operation'; END IF;
 IF p_operation IN ('wallet_create','wallet_adjust') AND role_name='accountant'
 THEN RAISE EXCEPTION 'business_write_forbidden: Current wallet role required'; END IF;
 WITH receipts AS (
   SELECT operation,request_key,intent,result,created_at FROM public.financial_write_requests
   WHERE business_id=p_business_id AND actor_user_id=p_user_id AND created_at>=now()-interval '7 days'
     AND (p_operation IS NULL OR operation=p_operation)
     AND (role_name<>'accountant' OR operation NOT IN ('wallet_create','wallet_adjust'))
   UNION ALL
   SELECT 'debt_payment'::text,key,intent,response_body,created_at FROM public.debt_payment_idempotency
   WHERE business_id=p_business_id AND user_id=p_user_id AND created_at>=now()-interval '7 days'
     AND (p_operation IS NULL OR p_operation='debt_payment')
 ), selected AS (
   SELECT * FROM receipts WHERE p_before IS NULL OR created_at<p_before OR
     (created_at=p_before AND (operation COLLATE "C",request_key COLLATE "C")>(p_after_operation COLLATE "C",p_after_key COLLATE "C"))
   ORDER BY created_at DESC,operation COLLATE "C",request_key COLLATE "C" LIMIT 26
 ), page AS (
   SELECT * FROM selected ORDER BY created_at DESC,operation COLLATE "C",request_key COLLATE "C" LIMIT 25
 )
 SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,operation COLLATE "C",request_key COLLATE "C") FROM page),'[]'::jsonb),
   'has_more',(SELECT count(*)>25 FROM selected)) INTO answer;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_list_own_financial_receipts(uuid,bigint,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_own_financial_receipts(uuid,bigint,text,timestamptz,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
