-- Additive after 069, 070, 071, 20261010143341. No backfill or historical rewrite.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.fn_ledger_writer_lock()') IS NULL THEN
    RAISE EXCEPTION 'financial_protocol_requires_070';
  END IF;
END $$;

-- Statement triggers run BEFORE row locks and FK cascades. A row trigger alone
-- is too late for UPDATE/DELETE. Include parents/allocation writers that can
-- otherwise retain a tuple lock before a ledger statement acquires the gate.
-- The gate is deliberately still global, including Personal; no capacity claim.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','businesses','business_members','debts',
    'bank_import_batches','bank_import_rows','classification_feedback','reminders',
    'payroll_employees','payroll_payments','payroll_payment_items',
    'debt_payment_idempotency','debt_settlement_allocations',
    'withholding_records','withholding_payment_allocations','tax_treatments',
    'tax_deposit_accounts','tax_deposit_entries','tax_deposit_allocations',
    'intercompany_funding_records','intercompany_settlement_allocations',
    'business_funding_records','business_funding_repayments',
    'funding_transfers','funding_repayments','personal_business_relationships',
    'wallet_transfers','exchange_rate_quotes','document_transaction_links','document_debt_links',
    'financial_documents','document_files','document_links','document_compliance_links',
    'counterparties','cashflow_categories','business_directions','activity_types','projects'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE TRIGGER financial_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement()',t);
    END IF;
  END LOOP;
  CREATE TRIGGER financial_parent_delete_gate BEFORE DELETE ON public.users
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ledger_writer_statement();
END $$;

-- Existing PL/pgSQL RPCs which lock funding/reset parents BEFORE a ledger write
-- must enter the gate before their first SELECT FOR UPDATE. Preserve signatures,
-- bodies, SECURITY INVOKER and grants; never edit already-applied source files.
-- Only these explicit names are transformed. Missing dark RPCs are reported by
-- preflight and are not invented here. Future installation needs this migration
-- reapplied as a new version / identical prefix in those RPCs (see runbook).
DO $$ DECLARE r record; definition text; BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND l.lanname='plpgsql' AND p.proname IN (
      'rpc_reset_business_financial','rpc_confirm_funding_transfer',
      'rpc_repay_funding_transfer','rpc_cancel_funding_transfer','rpc_create_wallet_transfer',
      'rpc_request_personal_business_connection','rpc_confirm_personal_business_connection',
      'rpc_reject_personal_business_connection','rpc_revoke_personal_business_connection',
      'rpc_create_fx_quote_record','rpc_create_funding_transfer',
      'rpc_document_link','rpc_document_unlink','rpc_document_archive',
      'rpc_document_update_metadata','rpc_document_finalize_upload') LOOP
    definition:=pg_get_functiondef(r.oid);
    IF definition NOT LIKE '%fn_ledger_writer_lock%' THEN
      IF definition !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'Cannot prefix %',r.proname; END IF;
      definition:=regexp_replace(definition,'\mBEGIN\M','BEGIN' || E'\n  PERFORM public.fn_ledger_writer_lock();','i');
      EXECUTE definition;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.fn_wallet_metadata_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE has_money boolean; has_legacy boolean;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND (NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.scope IS DISTINCT FROM OLD.scope) THEN
    RAISE EXCEPTION 'wallet_scope_mismatch: Wallet workspace and scope cannot change';
  END IF;
  IF NEW.business_id IS NULL THEN RETURN NEW; END IF; -- legacy orphan reference; no automatic assignment
  IF NOT EXISTS(SELECT 1 FROM businesses b WHERE b.id=NEW.business_id AND
    ((b.type='personal' AND NEW.scope='personal') OR (b.type<>'personal' AND NEW.scope='business'))) THEN
    RAISE EXCEPTION 'wallet_scope_mismatch: Wallet scope must match workspace';
  END IF;
  IF EXISTS(SELECT 1 FROM wallets w WHERE w.business_id=NEW.business_id
      AND w.name=NEW.name AND w.id<>NEW.id) THEN
    RAISE EXCEPTION 'wallet_name_ambiguous: Another wallet already uses this name';
  END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM transactions t WHERE t.business_id=NEW.business_id
        AND t.wallet_id IS NULL AND t.source=NEW.name) THEN
      RAISE EXCEPTION 'wallet_legacy_binding_requires_review: Existing unlinked history needs explicit review';
    END IF;
    RETURN NEW;
  END IF;
  SELECT EXISTS(SELECT 1 FROM transactions t WHERE t.business_id=OLD.business_id
    AND t.wallet_id IS NULL AND t.source=OLD.name) INTO has_legacy;
  SELECT has_legacy OR EXISTS(SELECT 1 FROM transactions t WHERE t.business_id=OLD.business_id
    AND t.wallet_id=OLD.id) OR EXISTS(SELECT 1 FROM bank_import_batches b WHERE b.wallet_id=OLD.id)
    INTO has_money;
  IF NEW.name IS DISTINCT FROM OLD.name AND (has_legacy OR EXISTS(
    SELECT 1 FROM transactions t WHERE t.business_id=NEW.business_id AND t.wallet_id IS NULL AND t.source=NEW.name)) THEN
    RAISE EXCEPTION 'wallet_legacy_name_locked: Resolve legacy references before renaming; history is not rewritten';
  END IF;
  IF has_money AND (upper(NEW.currency) IS DISTINCT FROM upper(OLD.currency)
      OR (to_jsonb(NEW)->'asset_code') IS DISTINCT FROM (to_jsonb(OLD)->'asset_code')
      OR (lower(COALESCE(NEW.type,'')) IN ('card','credit_card','credit_line','overdraft'))
        IS DISTINCT FROM (lower(COALESCE(OLD.type,'')) IN ('card','credit_card','credit_line','overdraft'))) THEN
    RAISE EXCEPTION 'wallet_metadata_locked: Currency, asset and credit policy are fixed once financial records exist';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_metadata_guard BEFORE INSERT OR UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.fn_wallet_metadata_guard();

CREATE FUNCTION public.fn_active_business_wallet_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Historical records remain readable; unchanged metadata PATCH and keyed replay
  -- do not create a new movement. New movements require an active wallet.
  IF EXISTS(SELECT 1 FROM wallets w JOIN businesses b ON b.id=w.business_id
    WHERE w.id=NEW.wallet_id AND b.type<>'personal' AND w.is_active IS FALSE) THEN
    RAISE EXCEPTION 'wallet_inactive: Choose an active business wallet';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER active_business_wallet_write BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_active_business_wallet_write();

-- PATCH's earlier HTTP paid_amount read is not a concurrency boundary. Recheck
-- the native ceiling on the row after entering the common statement gate.
CREATE FUNCTION public.fn_debt_metadata_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'business_change_forbidden: Debt workspace cannot change';
  END IF;
  IF NEW.original_amount IS DISTINCT FROM OLD.original_amount AND
      COALESCE(NEW.original_amount,NEW.amount,0)<COALESCE(NEW.paid_amount,0) THEN
    RAISE EXCEPTION 'invalid_amount: Debt total cannot fall below confirmed native payments';
  END IF;
  IF COALESCE(OLD.paid_amount,0)>0 AND (NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.type IS DISTINCT FROM OLD.type OR NEW.scope IS DISTINCT FROM OLD.scope) THEN
    RAISE EXCEPTION 'debt_metadata_locked: Paid money cannot be reinterpreted by debt metadata';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER debt_metadata_write_guard BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.fn_debt_metadata_write_guard();
REVOKE ALL ON FUNCTION public.fn_debt_metadata_write_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_debt_metadata_write_guard() TO service_role;

CREATE FUNCTION public.rpc_update_business_wallet(p_business_id uuid,p_user_id bigint,p_wallet_id uuid,p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE w public.wallets; n public.wallets;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  IF NOT EXISTS(SELECT 1 FROM businesses b WHERE b.id=p_business_id AND
    (b.owner_user_id=p_user_id OR EXISTS(SELECT 1 FROM business_members m
      WHERE m.business_id=b.id AND m.user_id=p_user_id AND m.status='active'
      AND m.role IN ('owner','ceo','admin','cfo')))) THEN
    RAISE EXCEPTION 'business_write_forbidden: Wallet management role required';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_updates) k WHERE k NOT IN
    ('name','currency','type','entity_name','color','sort_order','is_active','scope')) THEN
    RAISE EXCEPTION 'invalid_transaction_patch: Unsupported wallet metadata';
  END IF;
  SELECT * INTO w FROM wallets WHERE id=p_wallet_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found: Wallet not in business'; END IF;
  n:=jsonb_populate_record(w,p_updates);
  UPDATE wallets SET name=n.name,currency=n.currency,type=n.type,entity_name=n.entity_name,
    color=n.color,sort_order=n.sort_order,is_active=n.is_active,scope=n.scope,updated_at=now()
    WHERE id=w.id RETURNING * INTO n;
  RETURN to_jsonb(n);
END $$;

-- Recheck confirmation, ownership, last workspace and ALL original financial
-- counts INSIDE the same gate/transaction as DELETE. Never use stale HTTP counts.
CREATE FUNCTION public.rpc_delete_empty_business(p_business_id uuid,p_user_id bigint,p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; next_id uuid; counts jsonb:='{}'; t text; amount bigint;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  SELECT * INTO b FROM businesses WHERE id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_write_forbidden: Workspace not accessible'; END IF;
  IF b.type='personal' THEN RAISE EXCEPTION 'business_write_forbidden: Business required'; END IF;
  IF b.owner_user_id IS DISTINCT FROM p_user_id OR NOT EXISTS(SELECT 1 FROM business_members
    WHERE business_id=b.id AND user_id=p_user_id AND role='owner' AND status='active') THEN
    RAISE EXCEPTION 'business_write_forbidden: Owner membership required';
  END IF;
  IF p_confirm IS DISTINCT FROM 'DELETE BUSINESS' AND p_confirm IS DISTINCT FROM b.name THEN
    RETURN jsonb_build_object('ok',false,'error','confirm_required');
  END IF;
  SELECT m.business_id INTO next_id FROM business_members m JOIN businesses x ON x.id=m.business_id
    WHERE m.user_id=p_user_id AND m.status='active' AND x.type<>'personal' AND x.id<>b.id
    ORDER BY x.id LIMIT 1;
  IF next_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','last_business'); END IF;
  FOREACH t IN ARRAY ARRAY['transactions','debts','wallets','reminders','payroll_payments','bank_import_batches'] LOOP
    -- Missing tables are a schema error, never an invented zero.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE business_id=$1',t) INTO amount USING b.id;
    counts:=counts || jsonb_build_object(t,amount);
    IF amount>0 THEN RETURN jsonb_build_object('ok',false,'error','business_not_empty','counts',counts); END IF;
  END LOOP;
  DELETE FROM businesses WHERE id=b.id;
  RETURN jsonb_build_object('ok',true,'deleted_business_id',b.id,'next_business_id',next_id);
END $$;

REVOKE ALL ON FUNCTION public.fn_wallet_metadata_guard(),public.fn_active_business_wallet_write(),
  public.rpc_update_business_wallet(uuid,bigint,uuid,jsonb),public.rpc_delete_empty_business(uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wallet_metadata_guard(),public.fn_active_business_wallet_write(),
  public.rpc_update_business_wallet(uuid,bigint,uuid,jsonb),public.rpc_delete_empty_business(uuid,bigint,text) TO service_role;
-- Durable receipts for an explicit create intent. Never use FX output as the
-- identity: a refreshed quote can differ after an unknown transport outcome.
CREATE TABLE public.financial_write_requests (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN ('wallet_create','transaction_batch','wallet_adjust')),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),
  intent jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,actor_user_id,operation,request_key)
);
ALTER TABLE public.financial_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_write_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.financial_write_requests TO service_role;

CREATE FUNCTION public.rpc_insert_business_transactions_once(
  p_business_id uuid,p_user_id bigint,p_request_key text,p_intent jsonb,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.financial_write_requests; answer jsonb;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'idempotency_key_required: Keep a stable request key for this create intent';
  END IF;
  SELECT * INTO prior FROM financial_write_requests WHERE business_id=p_business_id
    AND actor_user_id=p_user_id AND operation='transaction_batch' AND request_key=p_request_key;
  IF FOUND THEN
    IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'idempotency_key_mismatch: Request key already used'; END IF;
    RETURN prior.result || jsonb_build_object('is_replay',true);
  END IF;
  answer:=public.rpc_insert_business_transactions(p_business_id,p_user_id,p_rows);
  INSERT INTO financial_write_requests VALUES(p_business_id,p_user_id,'transaction_batch',p_request_key,p_intent,answer,now());
  RETURN answer;
END $$;

CREATE FUNCTION public.rpc_create_business_wallet(
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
    IF NOT FOUND THEN RAISE EXCEPTION 'financial_intent_invalidated: Original wallet was later removed'; END IF;
    RETURN jsonb_build_object('wallet',to_jsonb(w),'is_replay',true);
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
REVOKE ALL ON FUNCTION public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb),
  public.rpc_insert_business_transactions_once(uuid,bigint,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb),
  public.rpc_insert_business_transactions_once(uuid,bigint,text,jsonb,jsonb) TO service_role;
CREATE FUNCTION public.rpc_adjust_business_wallet(
  p_business_id uuid,p_user_id bigint,p_wallet_id uuid,p_request_key text,p_intent jsonb,
  p_expected_balance numeric,p_target numeric,p_correction jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.financial_write_requests; w public.wallets; current_balance numeric;
  delta numeric; tx_id bigint; t public.transactions; answer jsonb; owner_id bigint;
BEGIN
  PERFORM public.fn_ledger_writer_lock();
  PERFORM public.fn_balance_actor(p_business_id,p_user_id);
  SELECT owner_user_id INTO owner_id FROM businesses WHERE id=p_business_id AND
    (owner_user_id=p_user_id OR EXISTS(SELECT 1 FROM business_members m WHERE m.business_id=p_business_id
      AND m.user_id=p_user_id AND m.status='active' AND m.role IN ('owner','ceo','admin','cfo')));
  IF NOT FOUND THEN RAISE EXCEPTION 'business_write_forbidden: Wallet management role required'; END IF;
  IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'idempotency_key_required: Stable adjustment key required';
  END IF;
  SELECT * INTO prior FROM financial_write_requests WHERE business_id=p_business_id AND actor_user_id=p_user_id
    AND operation='wallet_adjust' AND request_key=p_request_key;
  IF FOUND THEN
    IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'idempotency_key_mismatch: Request key already used'; END IF;
    RETURN prior.result || jsonb_build_object('is_replay',true);
  END IF;
  SELECT * INTO w FROM wallets WHERE id=p_wallet_id AND business_id=p_business_id AND scope='business' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found: Business wallet required'; END IF;
  IF p_target IS NULL OR p_target::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_amount: Finite target required'; END IF;
  current_balance:=public.fn_wallet_ledger_balance(w.id);
  IF current_balance IS DISTINCT FROM p_expected_balance THEN
    RAISE EXCEPTION 'transaction_version_conflict: Wallet changed; refresh before adjusting';
  END IF;
  delta:=p_target-current_balance;
  IF delta<>0 THEN
    t:=jsonb_populate_record(NULL::public.transactions,p_correction);
    IF t.amount_original IS DISTINCT FROM delta OR t.currency_original IS DISTINCT FROM w.currency
      OR t.amount_original<>(p_correction->>'amount_original')::numeric THEN
      RAISE EXCEPTION 'invalid_amount_precision: Correction must preserve native delta and currency';
    END IF;
    INSERT INTO transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,
      booked_rate,rate_source,description,source,wallet_id,scope,category,transaction_date)
      VALUES(p_business_id,owner_id,p_user_id,'correction',delta,w.currency,t.amount_idr,t.booked_rate,t.rate_source,
        t.description,w.name,w.id,'business','Balance Correction',t.transaction_date) RETURNING id INTO tx_id;
  END IF;
  answer:=jsonb_build_object('ok',true,'previous_balance',current_balance,'delta',delta,'new_balance',p_target,'transaction_id',tx_id);
  INSERT INTO financial_write_requests VALUES(p_business_id,p_user_id,'wallet_adjust',p_request_key,p_intent,answer,now());
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_adjust_business_wallet(uuid,bigint,uuid,text,jsonb,numeric,numeric,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_business_wallet(uuid,bigint,uuid,text,jsonb,numeric,numeric,jsonb) TO service_role;
-- Guarded public backend entry points require stable request identities. Legacy
-- service-only low-level RPCs remain compatibility primitives, not retry APIs.
DO $$ DECLARE r record; definition text; validation text; BEGIN
  FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('rpc_record_debt_payment_guarded','rpc_execute_wallet_transfer_guarded') LOOP
    definition:=pg_get_functiondef(r.oid);
    validation:=CASE r.proname WHEN 'rpc_record_debt_payment_guarded' THEN
      'IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION ''idempotency_key_required: Stable payment key required''; END IF;'
      ELSE 'IF p_transfer_id IS NULL THEN RAISE EXCEPTION ''idempotency_key_required: Stable transfer ID required''; END IF;' END;
    definition:=regexp_replace(definition,'\mBEGIN\M','BEGIN' || E'\n  ' || validation,'i');
    EXECUTE definition;
  END LOOP;
END $$;
COMMIT;
