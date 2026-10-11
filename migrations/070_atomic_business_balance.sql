-- 070: atomic manual business balance boundary. 069 is reserved by PR #148.
-- No historical backfill, no rewrite of 066/067. Apply before the backend.
BEGIN;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS debt_payment_id bigint REFERENCES public.debts(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS is_debt_payment boolean NOT NULL DEFAULT false;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS is_opening_balance boolean NOT NULL DEFAULT false;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS bank_import_row_id uuid
  REFERENCES public.bank_import_rows(id);
-- Also covers the existing batch endpoint's transfer legs. If historical
-- duplicates exist, migration fails for explicit review; it never deletes them.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_transfer_leg_unique
  ON public.transactions(business_id,transfer_id,type)
  WHERE transfer_id IS NOT NULL AND type IN ('expense','income');

-- A coarse ledger writer gate is intentional: direct INSERT/UPDATE/DELETE callers
-- must participate, including name-addressed business rows. Acquire BEFORE tuple
-- and wallet locks. RPCs below acquire the same gate before debt/wallet locks.
-- It serializes ledger writers across companies; replace only with a proven
-- finer protocol, not a per-RPC lock that other writers can bypass.
CREATE OR REPLACE FUNCTION public.fn_ledger_writer_lock() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ledger_isolation_unsupported: Ledger writes require READ COMMITTED';
  END IF;
  PERFORM pg_advisory_xact_lock(7070, 1);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_ledger_writer_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN PERFORM public.fn_ledger_writer_lock(); RETURN NULL; END; $$;
DROP TRIGGER IF EXISTS ledger_writer_gate ON public.transactions;
CREATE TRIGGER ledger_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();

CREATE OR REPLACE FUNCTION public.fn_balance_actor(p_business uuid, p_actor bigint) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=p_business
    AND b.type <> 'personal' AND (b.owner_user_id=p_actor OR EXISTS (
      SELECT 1 FROM public.business_members m WHERE m.business_id=b.id AND m.user_id=p_actor
        AND m.status='active' AND m.role IN ('owner','ceo','admin','cfo','accountant')))) THEN
    RAISE EXCEPTION 'business_write_forbidden: Financial write access required';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_ledger_signed(p_type text, p_native numeric, p_idr numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_type='income' THEN COALESCE(p_native,p_idr,0)
    WHEN p_type IN ('expense','payroll') THEN -COALESCE(p_native,p_idr,0)
    WHEN p_type='correction' THEN COALESCE(p_native,p_idr,0) ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.fn_wallet_ledger_balance(p_wallet uuid) RETURNS numeric
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(sum(public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr)),0)
  FROM public.wallets w JOIN public.transactions t
    ON t.business_id=w.business_id
    AND (t.wallet_id=w.id OR (t.wallet_id IS NULL AND t.source=w.name))
  WHERE w.id=p_wallet
$$;

CREATE OR REPLACE FUNCTION public.fn_business_balance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.transactions; n public.transactions; w public.wallets;
  ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP <> 'INSERT' THEN o:=OLD; END IF;
  IF TG_OP <> 'DELETE' THEN n:=NEW; END IF;
  -- Personal retains its existing policy. Scope text alone is never sufficient
  -- to opt a business transaction out of this guard.
  IF NOT EXISTS (SELECT 1 FROM public.businesses b
    WHERE b.id=COALESCE(n.business_id,o.business_id) AND b.type <> 'personal') THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF TG_OP='UPDATE' THEN NEW.balance_version:=OLD.balance_version+1; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE' AND (n.amount_original::text IN ('NaN','Infinity','-Infinity') OR n.amount_idr::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'invalid_amount: Monetary values must be finite';
  END IF;
  IF TG_OP='UPDATE' AND n.business_id IS DISTINCT FROM o.business_id THEN
    RAISE EXCEPTION 'business_change_forbidden: Transaction company cannot change';
  END IF;
  IF TG_OP='INSERT' AND n.is_opening_balance AND (n.wallet_id IS NULL
    OR n.source IS DISTINCT FROM 'wallet_opening_balance'
    OR EXISTS (SELECT 1 FROM public.transactions t WHERE t.business_id=n.business_id
      AND (t.wallet_id=n.wallet_id OR (t.wallet_id IS NULL AND t.source=(SELECT name FROM public.wallets WHERE id=n.wallet_id))))) THEN
    RAISE EXCEPTION 'invalid_opening_balance: Opening balance requires a new empty wallet';
  END IF;
  -- Only a trusted import endpoint supplies provenance; never a batch/body flag.
  IF TG_OP='INSERT' AND n.bank_import_row_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.bank_import_rows r JOIN public.bank_import_batches b ON b.id=r.batch_id
      WHERE r.id=n.bank_import_row_id AND r.business_id=n.business_id AND b.business_id=n.business_id
        AND b.wallet_id IS NOT DISTINCT FROM n.wallet_id AND r.amount=n.amount_original
        AND (r.tx_date IS NULL OR r.tx_date IS NOT DISTINCT FROM n.transaction_date)
        AND upper(b.currency)=upper(n.currency_original)) THEN
      RAISE EXCEPTION 'invalid_import_provenance: Import row does not match transaction';
    END IF;
  END IF;
  FOR w IN SELECT * FROM public.wallets WHERE business_id=COALESCE(n.business_id,o.business_id)
    AND (id IN (n.wallet_id,o.wallet_id)
      OR (n.wallet_id IS NULL AND name=n.source) OR (o.wallet_id IS NULL AND name=o.source))
    ORDER BY id FOR UPDATE LOOP
    ids:=array_append(ids,w.id);
    IF n.id IS NOT NULL AND (n.wallet_id=w.id OR (n.wallet_id IS NULL AND n.source=w.name)) THEN
      IF (TG_OP='INSERT' OR ROW(n.wallet_id,n.amount_original,n.currency_original,n.type)
          IS DISTINCT FROM ROW(o.wallet_id,o.amount_original,o.currency_original,o.type))
          AND upper(n.currency_original) <> upper(w.currency) THEN
        RAISE EXCEPTION 'currency_mismatch: Transaction currency must match wallet';
      END IF;
    END IF;
  END LOOP;
  IF n.wallet_id IS NOT NULL AND NOT n.wallet_id=ANY(ids) THEN
    RAISE EXCEPTION 'wallet_not_found: Wallet must belong to transaction company';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' THEN NEW.balance_version:=OLD.balance_version+1; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS business_balance_guard ON public.transactions;
CREATE TRIGGER business_balance_guard BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_business_balance_guard();

-- Transition tables check the whole statement's native cash delta. A batch
-- with a valid incoming/outgoing net does not depend on INSERT row ordering.
CREATE OR REPLACE FUNCTION public.fn_balance_statement(p_old jsonb, p_new jsonb, p_insert boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE w public.wallets; delta numeric; after_balance numeric;
BEGIN
  FOR w IN SELECT aw.* FROM public.wallets aw JOIN public.businesses b ON b.id=aw.business_id
    WHERE b.type <> 'personal' AND EXISTS (
      SELECT 1 FROM jsonb_populate_recordset(NULL::public.transactions,p_old || p_new) t
      WHERE t.business_id=aw.business_id
      AND (t.wallet_id=aw.id OR (t.wallet_id IS NULL AND t.source=aw.name)))
    ORDER BY aw.id FOR UPDATE OF aw LOOP
    SELECT COALESCE(sum(public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr)),0)
      INTO delta FROM jsonb_populate_recordset(NULL::public.transactions,p_new) t
      WHERE t.business_id=w.business_id
        AND (t.wallet_id=w.id OR (t.wallet_id IS NULL AND t.source=w.name))
        AND NOT (p_insert AND (t.bank_import_row_id IS NOT NULL OR t.type='correction' OR t.is_opening_balance));
    SELECT delta-COALESCE(sum(public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr)),0)
      INTO delta FROM jsonb_populate_recordset(NULL::public.transactions,p_old) t
      WHERE t.business_id=w.business_id
        AND (t.wallet_id=w.id OR (t.wallet_id IS NULL AND t.source=w.name));
    after_balance:=public.fn_wallet_ledger_balance(w.id);
    IF delta<0 AND after_balance<0 AND lower(COALESCE(w.type,'')) NOT IN ('card','credit_card','credit_line','overdraft') THEN
      RAISE EXCEPTION '%: Change would reduce wallet % from % to %',
        CASE WHEN after_balance-delta<0 THEN 'wallet_balance_negative' ELSE 'insufficient_balance' END,
        w.name,after_balance-delta,after_balance;
    END IF;
  END LOOP;
END; $$;
CREATE OR REPLACE FUNCTION public.fn_balance_after_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE o jsonb:='[]'; n jsonb:='[]';
BEGIN
  IF TG_OP <> 'INSERT' THEN SELECT COALESCE(jsonb_agg(t),'[]') INTO o FROM ledger_old t; END IF;
  IF TG_OP <> 'DELETE' THEN SELECT COALESCE(jsonb_agg(t),'[]') INTO n FROM ledger_new t; END IF;
  PERFORM public.fn_balance_statement(o,n,TG_OP='INSERT'); RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS balance_after_insert ON public.transactions;
CREATE TRIGGER balance_after_insert AFTER INSERT ON public.transactions REFERENCING NEW TABLE AS ledger_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_balance_after_statement();
DROP TRIGGER IF EXISTS balance_after_update ON public.transactions;
CREATE TRIGGER balance_after_update AFTER UPDATE ON public.transactions REFERENCING OLD TABLE AS ledger_old NEW TABLE AS ledger_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_balance_after_statement();
DROP TRIGGER IF EXISTS balance_after_delete ON public.transactions;
CREATE TRIGGER balance_after_delete AFTER DELETE ON public.transactions REFERENCING OLD TABLE AS ledger_old
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_balance_after_statement();

-- Optimistic version check also protects derived FX values computed by the API.
-- No lost update or recomputation from a stale amount/currency/date snapshot.
CREATE OR REPLACE FUNCTION public.rpc_patch_business_transaction(
  p_business_id uuid, p_user_id bigint, p_transaction_id bigint,
  p_expected_version bigint, p_updates jsonb, p_financial boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE t public.transactions; result public.transactions; financial boolean;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
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
  RETURN to_jsonb(result);
END; $$;

-- Replacement in a NEW migration; prior migration files remain unchanged.
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

  -- 3b. Re-check idempotency record after acquiring locks to prevent concurrent race
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing
    FROM public.debt_payment_idempotency
    WHERE business_id = p_business_id AND key = trim(p_idempotency_key);

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
    ON CONFLICT (business_id, key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_replay', false,
    'status', 200,
    'data', v_result
  );
END;
$$;


-- Replacement in a NEW migration; prior migration files remain unchanged.
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
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  IF p_transfer_id IS NULL OR p_source_amount IS NULL OR p_target_amount IS NULL
    OR p_source_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_target_amount::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_transfer_amount: Finite amounts and transfer id are required';
  END IF;
  -- Validate amounts
  IF p_source_amount <= 0 OR p_target_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_transfer_amount: Source and target amounts must be greater than zero';
  END IF;

  -- Validate distinct wallets
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'cannot_transfer_to_same_wallet: Source and destination wallets must be different';
  END IF;

  -- Replay / idempotency protection: return existing record if transfer_id was already executed
  IF p_transfer_id IS NOT NULL THEN
    SELECT
      MAX(CASE WHEN type = 'expense' THEN id END),
      MAX(CASE WHEN type = 'income' THEN id END)
    INTO v_debit_id, v_credit_id
    FROM public.transactions
    WHERE business_id = p_business_id AND transfer_id = p_transfer_id;

    IF v_debit_id IS NOT NULL OR v_credit_id IS NOT NULL THEN
      IF v_debit_id IS NULL OR v_credit_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.transactions d JOIN public.transactions c ON c.id=v_credit_id
        WHERE d.id=v_debit_id AND d.wallet_id=p_from_wallet_id AND c.wallet_id=p_to_wallet_id
          AND d.amount_original=p_source_amount AND c.amount_original=p_target_amount
          AND upper(d.currency_original)=upper(trim(p_source_currency))
          AND upper(c.currency_original)=upper(trim(p_target_currency))
          AND d.transaction_date IS NOT DISTINCT FROM p_transaction_date
          AND c.transaction_date IS NOT DISTINCT FROM p_transaction_date) THEN
        RAISE EXCEPTION 'idempotency_key_mismatch: Transfer id already used with different parameters';
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'is_replay', true,
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
    END IF;
  END IF;

  PERFORM 1 FROM public.wallets WHERE id IN (p_from_wallet_id,p_to_wallet_id) ORDER BY id FOR UPDATE;
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

  -- Re-check transfer replay under wallet row locks
  IF p_transfer_id IS NOT NULL THEN
    SELECT
      MAX(CASE WHEN type = 'expense' THEN id END),
      MAX(CASE WHEN type = 'income' THEN id END)
    INTO v_debit_id, v_credit_id
    FROM public.transactions
    WHERE business_id = p_business_id AND transfer_id = p_transfer_id;

    IF v_debit_id IS NOT NULL OR v_credit_id IS NOT NULL THEN
      IF v_debit_id IS NULL OR v_credit_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.transactions d JOIN public.transactions c ON c.id=v_credit_id
        WHERE d.id=v_debit_id AND d.wallet_id=p_from_wallet_id AND c.wallet_id=p_to_wallet_id
          AND d.amount_original=p_source_amount AND c.amount_original=p_target_amount
          AND upper(d.currency_original)=upper(trim(p_source_currency))
          AND upper(c.currency_original)=upper(trim(p_target_currency))
          AND d.transaction_date IS NOT DISTINCT FROM p_transaction_date
          AND c.transaction_date IS NOT DISTINCT FROM p_transaction_date) THEN
        RAISE EXCEPTION 'idempotency_key_mismatch: Transfer id already used with different parameters';
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'is_replay', true,
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
    END IF;
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

  IF (SELECT amount_original FROM public.transactions WHERE id=v_debit_id) <> p_source_amount
    OR (SELECT amount_original FROM public.transactions WHERE id=v_credit_id) <> p_target_amount THEN
    RAISE EXCEPTION 'invalid_amount_precision: Transfer exceeds ledger precision';
  END IF;

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
  PERFORM public.fn_ledger_writer_lock();
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


-- New backend requires this name; a database with only 066/067 fails closed.
CREATE OR REPLACE FUNCTION public.rpc_record_debt_payment_guarded(
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
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  RETURN public.rpc_record_debt_payment(p_business_id,p_user_id,p_debt_id,p_wallet_id,p_amount,p_currency,p_amount_idr,p_booked_rate,p_rate_source,p_payment_date,p_idempotency_key,p_request_hash,p_account_name,p_created_at);
END; $$;

-- New backend requires this name; a database with only 066/067 fails closed.
CREATE OR REPLACE FUNCTION public.rpc_execute_wallet_transfer_guarded(
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
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  RETURN public.rpc_execute_wallet_transfer(p_business_id,p_user_id,p_from_wallet_id,p_to_wallet_id,p_source_amount,p_source_currency,p_source_amount_idr,p_source_booked_rate,p_target_amount,p_target_currency,p_target_amount_idr,p_target_booked_rate,p_rate_source,p_description,p_transaction_date,p_transfer_id,p_scope);
END; $$;

-- Preserve whole-batch insertion and native precision. Recheck transfer replay
-- under the common gate instead of trusting the API's earlier SELECT.
CREATE OR REPLACE FUNCTION public.rpc_insert_business_transactions(
  p_business_id uuid, p_user_id bigint, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE j jsonb; r public.transactions; owner_id bigint; saved integer;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  SELECT owner_user_id INTO owner_id FROM public.businesses WHERE id=p_business_id;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_transaction_patch: Rows must be an array';
  END IF;
  FOR j IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    r:=jsonb_populate_record(NULL::public.transactions,j);
    IF r.amount_original <> (j->>'amount_original')::numeric THEN
      RAISE EXCEPTION 'invalid_amount_precision: Amount exceeds ledger precision';
    END IF;
    IF r.amount_original IS NULL OR r.amount_original::text IN ('NaN','Infinity','-Infinity')
      OR r.type NOT IN ('income','expense','payroll','correction','transfer')
      OR (r.type='correction' AND r.amount_original=0) OR (r.type<>'correction' AND r.amount_original<=0) THEN
      RAISE EXCEPTION 'invalid_amount: Invalid transaction amount or type';
    END IF;
    IF r.transfer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.transactions t
      WHERE t.business_id=p_business_id AND t.transfer_id=r.transfer_id) AND NOT EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.business_id=p_business_id AND t.transfer_id=r.transfer_id
        AND t.type=r.type AND t.wallet_id IS NOT DISTINCT FROM r.wallet_id
        AND t.amount_original=r.amount_original AND t.currency_original=r.currency_original
        AND t.transaction_date IS NOT DISTINCT FROM r.transaction_date) THEN
      RAISE EXCEPTION 'idempotency_key_mismatch: Transfer id already used with different parameters';
    END IF;
  END LOOP;
  IF EXISTS (SELECT transfer_id FROM jsonb_populate_recordset(NULL::public.transactions,p_rows)
    WHERE transfer_id IS NOT NULL GROUP BY transfer_id
    HAVING count(*)<>2 OR count(*) FILTER (WHERE type='income')<>1
      OR count(*) FILTER (WHERE type='expense')<>1 OR count(DISTINCT wallet_id)<>2) THEN
    RAISE EXCEPTION 'invalid_transaction_patch: Transfer must contain both distinct wallet legs';
  END IF;
  INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,
    amount_idr,booked_rate,rate_source,description,source,scope,project,category,transaction_date,
    cashflow_category_id,counterparty_id,counterparty_name,business_direction_id,activity_type_id,wallet_id,transfer_id)
    SELECT p_business_id,owner_id,p_user_id,t.type,t.amount_original,t.currency_original,t.amount_idr,
      t.booked_rate,t.rate_source,t.description,t.source,t.scope,t.project,t.category,t.transaction_date,
      t.cashflow_category_id,t.counterparty_id,t.counterparty_name,t.business_direction_id,t.activity_type_id,t.wallet_id,t.transfer_id
    FROM jsonb_populate_recordset(NULL::public.transactions,p_rows) t
    WHERE t.transfer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.transactions e
      WHERE e.business_id=p_business_id AND e.transfer_id=t.transfer_id);
  GET DIAGNOSTICS saved=ROW_COUNT;
  RETURN jsonb_build_object('saved',saved);
END; $$;

-- Existing payroll rows/items, same calculations supplied by the backend, now
-- one transaction. No redesign, no change to gross/net/currency calculations.
CREATE OR REPLACE FUNCTION public.rpc_record_business_payroll(
  p_business_id uuid, p_user_id bigint, p_transaction jsonb, p_payment jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE t public.transactions; p public.payroll_payments; i public.payroll_payment_items;
  tx public.transactions; payment public.payroll_payments; owner_id bigint;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  SELECT owner_user_id INTO owner_id FROM public.businesses WHERE id=p_business_id;
  IF owner_id <> p_user_id AND NOT EXISTS (SELECT 1 FROM public.business_members m
    WHERE m.business_id=p_business_id AND m.user_id=p_user_id AND m.status='active'
      AND m.role IN ('owner','ceo','admin','cfo')) THEN
    RAISE EXCEPTION 'business_write_forbidden: Payroll write access required';
  END IF;
  t:=jsonb_populate_record(NULL::public.transactions,p_transaction);
  p:=jsonb_populate_record(NULL::public.payroll_payments,p_payment);
  IF p.employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payroll_employees e
    WHERE e.id=p.employee_id AND e.business_id=p_business_id) THEN
    RAISE EXCEPTION 'business_write_forbidden: Employee must belong to payroll company';
  END IF;
  IF t.type <> 'payroll' OR t.amount_original IS NULL OR t.amount_original <= 0
    OR p.amount IS DISTINCT FROM t.amount_original OR p.wallet_id IS DISTINCT FROM t.wallet_id THEN
    RAISE EXCEPTION 'invalid_amount: Payroll ledger and payment must agree';
  END IF;
  INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,amount_idr,
    booked_rate,rate_source,currency_original,description,source,wallet_id,scope,category,transaction_date)
    VALUES(p_business_id,owner_id,p_user_id,t.type,t.amount_original,t.amount_idr,t.booked_rate,t.rate_source,
      t.currency_original,t.description,t.source,t.wallet_id,t.scope,t.category,t.transaction_date) RETURNING * INTO tx;
  IF tx.amount_original <> p.amount THEN
    RAISE EXCEPTION 'invalid_amount_precision: Payroll exceeds ledger precision';
  END IF;
  INSERT INTO public.payroll_payments(business_id,user_id,created_by_user_id,employee_id,transaction_id,
    employee_name,amount,gross_amount,deduction_amount,net_amount,currency,payment_type,period_month,
    payment_date,wallet_id,status,notes)
    VALUES(p_business_id,owner_id,p_user_id,p.employee_id,tx.id,p.employee_name,p.amount,p.gross_amount,
      p.deduction_amount,p.net_amount,p.currency,p.payment_type,p.period_month,p.payment_date,p.wallet_id,p.status,p.notes)
    RETURNING * INTO payment;
  FOR i IN SELECT * FROM jsonb_populate_recordset(NULL::public.payroll_payment_items,COALESCE(p_items,'[]')) LOOP
    INSERT INTO public.payroll_payment_items(business_id,user_id,payroll_payment_id,item_type,label,amount,direction,notes)
      VALUES(p_business_id,owner_id,payment.id,i.item_type,i.label,i.amount,i.direction,i.notes);
  END LOOP;
  RETURN jsonb_build_object('transaction',to_jsonb(tx),'payment',to_jsonb(payment));
END; $$;

-- Backend service is the trusted caller; neither PUBLIC nor client roles may
-- forge p_user_id/business_id. Functions remain SECURITY INVOKER, fixed path.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('fn_ledger_writer_lock','fn_ledger_writer_statement',
      'fn_balance_actor','fn_ledger_signed','fn_wallet_ledger_balance','fn_business_balance_guard','fn_balance_statement','fn_balance_after_statement',
      'rpc_patch_business_transaction','rpc_record_debt_payment','rpc_execute_wallet_transfer','rpc_delete_wallet_transfer','rpc_record_business_payroll','rpc_insert_business_transactions','rpc_record_debt_payment_guarded','rpc_execute_wallet_transfer_guarded') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',r.signature); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',r.signature); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature); END IF;
  END LOOP;
END; $$;
COMMIT;
