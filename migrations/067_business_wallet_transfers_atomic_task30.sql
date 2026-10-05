-- Migration 067 — Business Wallet Transfers Atomic Execution (TASK 30)
-- Date: 2026-10-05. ADDITIVE + IDEMPOTENT + TRANSACTIONAL.
-- Completes business wallet-to-wallet transfers with atomic double-entry (debit/credit),
-- shared transfer_id, and cross-currency FX rate fixation.

BEGIN;

-- 1. Ensure transactions table has transfer_id column for direct linking
ALTER TABLE public.transactions 
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_id 
  ON public.transactions (transfer_id);

-- 2. Atomic PostgreSQL RPC for executing business wallet transfers
CREATE OR REPLACE FUNCTION public.rpc_execute_wallet_transfer(
  p_business_id uuid,
  p_user_id bigint,
  p_from_wallet_id uuid,
  p_to_wallet_id uuid,
  p_source_amount numeric,
  p_source_currency text,
  p_source_amount_idr numeric,
  p_source_booked_rate numeric,
  p_target_amount numeric,
  p_target_currency text,
  p_target_amount_idr numeric,
  p_target_booked_rate numeric,
  p_rate_source text,
  p_description text,
  p_transaction_date date,
  p_transfer_id uuid,
  p_scope text DEFAULT 'business'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_from_wallet RECORD;
  v_to_wallet RECORD;
  v_debit_id bigint;
  v_credit_id bigint;
  v_transfer_ref text;
  v_desc text;
BEGIN
  -- Validate amounts
  IF p_source_amount <= 0 OR p_target_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_transfer_amount: Source and target amounts must be greater than zero';
  END IF;

  -- Validate distinct wallets
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'cannot_transfer_to_same_wallet: Source and destination wallets must be different';
  END IF;

  -- Lock and verify source wallet (enforcing business workspace boundary)
  SELECT * INTO v_from_wallet
  FROM public.wallets
  WHERE id = p_from_wallet_id AND business_id = p_business_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source_wallet_not_found: Source wallet does not exist or does not belong to active business';
  END IF;

  -- Lock and verify target wallet (enforcing business workspace boundary)
  SELECT * INTO v_to_wallet
  FROM public.wallets
  WHERE id = p_to_wallet_id AND business_id = p_business_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_wallet_not_found: Target wallet does not exist or does not belong to active business';
  END IF;

  v_transfer_ref := 'xfer:' || p_transfer_id::text;
  v_desc := COALESCE(p_description, 'Transfer: ' || v_from_wallet.name || ' → ' || v_to_wallet.name);

  -- Insert Debit Leg (Expense from source wallet)
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
    category,
    transaction_date,
    transfer_id
  ) VALUES (
    p_business_id,
    p_user_id,
    'expense',
    p_source_amount,
    upper(trim(p_source_currency)),
    p_source_amount_idr,
    p_source_booked_rate,
    p_rate_source,
    v_desc,
    v_transfer_ref,
    p_from_wallet_id,
    p_scope,
    'Transfer',
    p_transaction_date,
    p_transfer_id
  ) RETURNING id INTO v_debit_id;

  -- Insert Credit Leg (Income to destination wallet)
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
    category,
    transaction_date,
    transfer_id
  ) VALUES (
    p_business_id,
    p_user_id,
    'income',
    p_target_amount,
    upper(trim(p_target_currency)),
    p_target_amount_idr,
    p_target_booked_rate,
    p_rate_source,
    v_desc,
    v_transfer_ref,
    p_to_wallet_id,
    p_scope,
    'Transfer',
    p_transaction_date,
    p_transfer_id
  ) RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'transfer_id', p_transfer_id,
    'debit_transaction_id', v_debit_id,
    'credit_transaction_id', v_credit_id,
    'from_wallet_id', p_from_wallet_id,
    'to_wallet_id', p_to_wallet_id,
    'source_amount', p_source_amount,
    'source_currency', upper(trim(p_source_currency)),
    'target_amount', p_target_amount,
    'target_currency', upper(trim(p_target_currency)),
    'transaction_date', p_transaction_date
  );
END;
$$;

-- 3. Atomic PostgreSQL RPC for deleting a wallet transfer (deletes both legs atomically)
CREATE OR REPLACE FUNCTION public.rpc_delete_wallet_transfer(
  p_business_id uuid,
  p_transfer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.transactions
  WHERE business_id = p_business_id
    AND (transfer_id = p_transfer_id OR source = ('xfer:' || p_transfer_id::text));
  
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_legs', v_count,
    'transfer_id', p_transfer_id
  );
END;
$$;

COMMIT;
