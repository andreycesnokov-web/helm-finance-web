-- DOWN for 20261016090000_dated_opening_anchor.sql (isolated test databases / rehearsal only).
-- Restores the previous definitions verbatim (sliced from 20261013031755 and 20261012032717) and
-- drops the new functions. Rows appended by confirmed re-anchors are audited ledger entries and are
-- NOT removed; the constraint is restored only when no 'wallet_reanchor' receipt exists.
-- Requires: SET cfo.confirm_down = '20261016090000'; in the same session (refuses otherwise).
BEGIN;
SET LOCAL lock_timeout='5s';
-- Fail closed: this file sits next to the forward migrations; an accidental run must do nothing.
DO $$ BEGIN
  IF current_setting('cfo.confirm_down',true) IS DISTINCT FROM '20261016090000' THEN
    RAISE EXCEPTION 'd4_down_not_confirmed: run SET cfo.confirm_down = ''20261016090000'' in this session first';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.rpc_reanchor_wallet_opening(uuid,uuid,bigint,text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.rpc_wallet_reconciliation(uuid,uuid,bigint);
CREATE OR REPLACE FUNCTION public.cfo_import_review_state(p_business uuid,p_batch uuid,p_actor bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.bank_import_batches; w public.wallets; role_name text; snapshot jsonb; ledger jsonb; rows jsonb; categories jsonb; counterparties jsonb; opening numeric; current_balance numeric; unknown_dates integer; anchored boolean;
BEGIN
 SELECT CASE WHEN x.owner_user_id=p_actor THEN 'owner' ELSE m.role END INTO role_name
 FROM public.businesses x JOIN public.business_members m ON m.business_id=x.id AND m.user_id=p_actor AND m.status='active'
 WHERE x.id=p_business AND coalesce(x.type,'business')<>'personal' AND coalesce(x.status,'active')<>'archived';
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant','auditor') OR role_name='owner' AND NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business AND owner_user_id=p_actor) THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 SELECT * INTO b FROM public.bank_import_batches WHERE id=p_batch AND business_id=p_business;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
 SELECT * INTO w FROM public.wallets WHERE id=b.wallet_id AND business_id=p_business AND scope='business';
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
 IF upper(b.currency) IS DISTINCT FROM upper(w.currency) THEN RAISE EXCEPTION 'currency_mismatch'; END IF;
 IF b.statement_start IS NULL OR b.statement_end IS NULL OR b.statement_end<b.statement_start THEN RAISE EXCEPTION 'corrupt_statement_period'; END IF;
 IF EXISTS(SELECT 1 FROM public.bank_import_rows WHERE batch_id=b.id AND business_id IS DISTINCT FROM p_business) THEN RAISE EXCEPTION 'import_business_scope_required'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO rows FROM public.bank_import_rows r WHERE batch_id=b.id AND business_id=p_business;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) INTO ledger FROM public.transactions t WHERE t.business_id=p_business AND (t.wallet_id=w.id OR t.wallet_id IS NULL AND t.source=w.name);
 SELECT coalesce(sum(public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr)) FILTER(WHERE t.transaction_date<b.statement_start),0),
  coalesce(sum(public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr)),0),
  count(*) FILTER(WHERE public.fn_ledger_signed(t.type,t.amount_original,t.amount_idr)<>0 AND (t.transaction_date IS NULL OR t.currency_original IS NOT NULL AND upper(t.currency_original)<>upper(w.currency) OR t.amount_original IS NULL AND upper(w.currency)<>'IDR')),
  coalesce(bool_or(t.is_opening_balance AND t.transaction_date<b.statement_start),false)
 INTO opening,current_balance,unknown_dates,anchored FROM public.transactions t WHERE t.business_id=p_business AND (t.wallet_id=w.id OR t.wallet_id IS NULL AND t.source=w.name);
 -- The ledger resolves category/counterparty ids to current text names. Their
 -- reviewed labels and availability must not silently change before confirm.
 -- Existing statement-level financial_writer_gate protects these writers too.
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) INTO categories FROM public.cashflow_categories c WHERE c.business_id=p_business;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) INTO counterparties FROM public.counterparties c WHERE c.business_id=p_business;
 snapshot:=jsonb_build_object('version',2,'business_id',p_business,'batch',to_jsonb(b),'wallet',to_jsonb(w),'rows',rows,'ledger',ledger,'categories',categories,'counterparties',counterparties);
 RETURN jsonb_build_object('review_hash',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),
  'batch_id',b.id,'wallet_id',w.id,'currency',w.currency,'recorded_before',opening::text,'current_balance',current_balance::text,
  'opening_state',CASE WHEN unknown_dates=0 AND anchored THEN 'known' ELSE 'unknown' END,
  'historical_opening',CASE WHEN unknown_dates=0 AND anchored THEN to_jsonb(opening::text) ELSE 'null'::jsonb END,
  'undated_or_invalid_native_rows',unknown_dates,'dated_opening_anchor',anchored,'correction_date',b.statement_start-1,
  'can_correct_opening',role_name IN('owner','ceo','admin','cfo'));
END $$;

CREATE OR REPLACE FUNCTION public.rpc_confirm_bank_import_reviewed(
 p_business uuid,p_batch uuid,p_actor bigint,p_request_key uuid,p_review_hash text,p_intent jsonb,p_plan jsonb,p_opening jsonb DEFAULT NULL,p_flow text DEFAULT 'review')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE company public.businesses; member public.business_members; batch public.bank_import_batches; wallet public.wallets; role_name text; prior public.bank_import_confirm_requests; state jsonb; answer jsonb; raw_opening jsonb; delta numeric; expected numeric; target numeric; rate numeric; idr numeric; correction_id bigint; has_pending boolean; final_status text;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 SELECT * INTO company FROM public.businesses WHERE id=p_business AND coalesce(type,'business')<>'personal' AND coalesce(status,'active')<>'archived' FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 SELECT * INTO member FROM public.business_members WHERE business_id=p_business AND user_id=p_actor AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 role_name:=CASE WHEN company.owner_user_id=p_actor THEN 'owner' ELSE member.role END;
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant') OR role_name='owner' AND company.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 IF p_request_key IS NULL OR p_review_hash IS NULL OR p_review_hash!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 IF p_intent->>'review_hash' IS DISTINCT FROM p_review_hash OR p_intent->>'batch_id' IS DISTINCT FROM p_batch::text OR p_intent->>'operation' IS DISTINCT FROM 'bank_import_confirm' OR p_intent->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 IF p_opening IS NOT NULL AND p_opening<>'null'::jsonb AND jsonb_typeof(p_opening)<>'object' THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 raw_opening:=CASE WHEN jsonb_typeof(p_opening)='object' THEN p_opening-ARRAY['booked_rate','amount_idr','rate_source'] ELSE 'null'::jsonb END;
 IF coalesce(p_intent->'opening','null'::jsonb) IS DISTINCT FROM raw_opening THEN RAISE EXCEPTION 'import_invalid_request'; END IF;
 SELECT * INTO prior FROM public.bank_import_confirm_requests WHERE business_id=p_business AND actor_user_id=p_actor AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.batch_id IS DISTINCT FROM p_batch OR prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'import_request_conflict'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'result_is_historical',true);
 END IF;
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'array' OR jsonb_array_length(p_plan) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid_plan'; END IF;
 SELECT * INTO batch FROM public.bank_import_batches WHERE id=p_batch AND business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
 IF batch.status IN('imported','cancelled') THEN RAISE EXCEPTION 'batch_closed'; END IF;
 SELECT * INTO wallet FROM public.wallets WHERE id=batch.wallet_id AND business_id=p_business AND scope='business' FOR UPDATE;
 IF NOT FOUND OR wallet.is_active=false THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
 state:=public.cfo_import_review_state(p_business,p_batch,p_actor);
 IF state->>'review_hash' IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'import_review_conflict'; END IF;
 IF p_opening IS NOT NULL AND p_opening<>'null'::jsonb THEN
  IF role_name NOT IN('owner','ceo','admin','cfo') THEN RAISE EXCEPTION 'import_opening_forbidden'; END IF;
  IF state->>'opening_state'<>'known' THEN RAISE EXCEPTION 'import_opening_history_unknown'; END IF;
  IF jsonb_typeof(p_opening)<>'object' OR nullif(btrim(p_opening->>'reason'),'') IS NULL OR length(p_opening->>'reason')>500 OR batch.opening_balance IS NULL THEN RAISE EXCEPTION 'import_invalid_opening'; END IF;
  expected:=(p_opening->>'expected_historical_opening')::numeric;target:=(p_opening->>'target_opening')::numeric;
  IF expected IS NULL OR target IS NULL OR expected::text IN('NaN','Infinity','-Infinity') OR target::text IN('NaN','Infinity','-Infinity') OR expected IS DISTINCT FROM (state->>'historical_opening')::numeric OR target IS DISTINCT FROM batch.opening_balance THEN RAISE EXCEPTION 'import_opening_conflict'; END IF;
  delta:=target-expected;
  IF delta<>0 THEN
   rate:=(p_opening->>'booked_rate')::numeric;idr:=(p_opening->>'amount_idr')::numeric;
   IF rate IS NULL OR rate<=0 OR rate::text IN('NaN','Infinity','-Infinity') OR idr IS NULL OR idr::text IN('NaN','Infinity','-Infinity') OR round(delta*rate,2) IS DISTINCT FROM idr OR nullif(btrim(p_opening->>'rate_source'),'') IS NULL OR upper(wallet.currency)='IDR' AND (rate<>1 OR idr<>delta) THEN RAISE EXCEPTION 'import_invalid_opening_valuation'; END IF;
   INSERT INTO public.transactions(business_id,user_id,created_by_user_id,type,amount_original,currency_original,amount_idr,booked_rate,rate_source,description,source,wallet_id,scope,transaction_date,category)
    VALUES(p_business,company.owner_user_id,p_actor,'correction',delta,upper(wallet.currency),idr,rate,p_opening->>'rate_source',p_opening->>'reason','bank_import_opening',wallet.id,'business',batch.statement_start-1,'Balance adjustment') RETURNING id INTO correction_id;
  END IF;
 END IF;
 -- Raw rows need the existing provenance-eligible review state before creating
 -- their ledger link. This does not confirm or book any unselected row.
 UPDATE public.bank_import_rows SET review_status='needs_review' WHERE batch_id=p_batch AND business_id=p_business AND linked_transaction_id IS NULL AND review_status IS NULL;
 -- Preserve canonical compat provenance, validation, feedback and cumulative math.
 answer:=public.rpc_confirm_bank_import(p_business,p_batch,company.owner_user_id,p_actor,p_plan,p_flow);
 -- A suggestion or a saved decision is not a completed ledger operation.
 -- Raw, confirmed and matched-but-unlinked rows remain pending until explicitly
 -- imported/linked or excluded. Preserve their original hints/decisions.
 SELECT EXISTS(SELECT 1 FROM public.bank_import_rows WHERE batch_id=p_batch AND business_id=p_business AND linked_transaction_id IS NULL AND review_status IS DISTINCT FROM 'excluded') INTO has_pending;
 final_status:=CASE WHEN has_pending THEN 'partially_imported' ELSE 'imported' END;
 UPDATE public.bank_import_batches SET status=final_status WHERE id=p_batch AND business_id=p_business;
 answer:=answer||jsonb_build_object('status',final_status);
 answer:=answer||jsonb_build_object('request_id',p_request_key,'batch_id',p_batch,'review_hash',p_review_hash,'opening',jsonb_build_object('state',state->>'opening_state','historical_before',state->'historical_opening','correction_id',correction_id,'delta',coalesce(delta,0)::text,'date',batch.statement_start-1),'result_is_historical',true);
 INSERT INTO public.bank_import_confirm_requests(business_id,actor_user_id,request_key,batch_id,intent,result) VALUES(p_business,p_actor,p_request_key,p_batch,p_intent,answer);
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,entity_type,entity_id,action,request_id,after_json)
  VALUES(p_business,p_actor,role_name,'bank_import',p_batch::text,'import_confirmed',p_request_key::text,jsonb_build_object('result',answer,'intent',p_intent));
 RETURN answer;
END $$;

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

DROP FUNCTION IF EXISTS public.cfo_apply_reanchor(uuid,uuid,bigint,text,uuid,jsonb,numeric,text);
DROP FUNCTION IF EXISTS public.cfo_reanchor_math(uuid,uuid,date,jsonb,text);
DROP FUNCTION IF EXISTS public.cfo_statement_facts(uuid,uuid,date);
DROP FUNCTION IF EXISTS public.fn_wallet_balance_at(uuid,uuid,date);
DROP FUNCTION IF EXISTS public.cfo_wallet_anchor_state(uuid,uuid);
DROP FUNCTION IF EXISTS public.cfo_wallet_ledger(uuid,uuid);
DROP FUNCTION IF EXISTS public.cfo_ledger_anchor_class(text,boolean);
DROP FUNCTION IF EXISTS public.cfo_business_tz(uuid);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.financial_write_requests WHERE operation='wallet_reanchor') THEN
    RAISE NOTICE 'wallet_reanchor receipts exist: the widened operation constraint is kept';
  ELSE
    ALTER TABLE public.financial_write_requests DROP CONSTRAINT financial_write_requests_operation_check;
    ALTER TABLE public.financial_write_requests ADD CONSTRAINT financial_write_requests_operation_check
      CHECK(operation IN ('wallet_create','transaction_batch','wallet_adjust','wallet_transfer'));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cfo_import_review_state(uuid,uuid,bigint),public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text),
  public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfo_import_review_state(uuid,uuid,bigint),public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text),
  public.rpc_create_business_wallet(uuid,bigint,text,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
