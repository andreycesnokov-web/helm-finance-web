-- Migration 066 — Debt Payment Idempotency and Atomic Execution RPC
-- Date: 2026-10-05. ADDITIVE + IDEMPOTENT + TRANSACTIONAL.
-- Provides server-side idempotency storage and atomic PostgreSQL RPC for debt payments.
-- Ensures that concurrent requests cannot overpay debts and request retries do not duplicate transactions.

BEGIN;

CREATE TABLE IF NOT EXISTS public.debt_payment_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  debt_id bigint NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  user_id bigint NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  transaction_id bigint REFERENCES public.transactions(id) ON DELETE SET NULL,
  response_status integer NOT NULL DEFAULT 200,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debt_payment_idempotency_biz_key_unique UNIQUE (business_id, key)
);

CREATE INDEX IF NOT EXISTS idx_debt_payment_idempotency_debt ON public.debt_payment_idempotency (debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_payment_idempotency_key ON public.debt_payment_idempotency (business_id, key);

-- Atomic PostgreSQL RPC for recording debt payment with row locking & idempotency
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
  -- 1. Check idempotency record first
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.debt_payment_idempotency
    WHERE business_id = p_business_id AND key = trim(p_idempotency_key);

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
    'debt_id', v_debt.id
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
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_replay', false,
    'status', 200,
    'data', v_result
  );
END;
$$;

COMMIT;
