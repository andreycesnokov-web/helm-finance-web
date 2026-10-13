-- Business import review CAS and durable atomic confirm wrapper.
-- Apply only after exact native rehearsal/backup; preserves existing compat RPC.
-- No history repair, Personal writer, auth change or automatic unknown opening.
BEGIN;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.rpc_confirm_bank_import(uuid,uuid,bigint,bigint,jsonb,text)'::regprocedure);
 IF definition NOT LIKE '%fn_ledger_writer_lock%' OR definition NOT LIKE '%bank_import_row_id%' OR definition NOT LIKE '%Snapshot includes earlier partial confirms%' THEN RAISE EXCEPTION 'import_canonical_compat_required'; END IF;
END $$;

CREATE TABLE public.bank_import_confirm_requests (
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
 actor_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 batch_id uuid NOT NULL REFERENCES public.bank_import_batches(id) ON DELETE RESTRICT,
 intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(business_id,actor_user_id,request_key)
);
ALTER TABLE public.bank_import_confirm_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bank_import_confirm_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.bank_import_confirm_requests TO service_role;
CREATE INDEX bank_import_confirm_requests_batch ON public.bank_import_confirm_requests(business_id,batch_id,created_at DESC);

CREATE FUNCTION public.cfo_import_review_state(p_business uuid,p_batch uuid,p_actor bigint)
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

CREATE FUNCTION public.rpc_confirm_bank_import_reviewed(
 p_business uuid,p_batch uuid,p_actor bigint,p_request_key uuid,p_review_hash text,p_intent jsonb,p_plan jsonb,p_opening jsonb DEFAULT NULL,p_flow text DEFAULT 'review')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE company public.businesses; member public.business_members; batch public.bank_import_batches; wallet public.wallets; role_name text; prior public.bank_import_confirm_requests; state jsonb; answer jsonb; raw_opening jsonb; delta numeric; expected numeric; target numeric; rate numeric; idr numeric; correction_id bigint;
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
 -- Unselected raw rows must remain pending even before suggest/classification.
 -- Otherwise the existing review flow can mark a raw two-row batch complete
 -- after the first selected row, leaving the second permanently unprocessed.
 UPDATE public.bank_import_rows SET review_status='needs_review' WHERE batch_id=p_batch AND business_id=p_business AND linked_transaction_id IS NULL AND review_status IS NULL;
 -- Preserve canonical compat provenance, validation, feedback and cumulative math.
 answer:=public.rpc_confirm_bank_import(p_business,p_batch,company.owner_user_id,p_actor,p_plan,p_flow);
 answer:=answer||jsonb_build_object('request_id',p_request_key,'batch_id',p_batch,'review_hash',p_review_hash,'opening',jsonb_build_object('state',state->>'opening_state','historical_before',state->'historical_opening','correction_id',correction_id,'delta',coalesce(delta,0)::text,'date',batch.statement_start-1),'result_is_historical',true);
 INSERT INTO public.bank_import_confirm_requests(business_id,actor_user_id,request_key,batch_id,intent,result) VALUES(p_business,p_actor,p_request_key,p_batch,p_intent,answer);
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,entity_type,entity_id,action,request_id,after_json)
  VALUES(p_business,p_actor,role_name,'bank_import',p_batch::text,'import_confirmed',p_request_key::text,jsonb_build_object('result',answer,'intent',p_intent));
 RETURN answer;
END $$;

CREATE FUNCTION public.rpc_read_bank_import_confirm(p_business uuid,p_batch uuid,p_actor bigint,p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.bank_import_confirm_requests; role_name text;
BEGIN
 SELECT CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END INTO role_name FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id AND m.user_id=p_actor AND m.status='active'
 WHERE b.id=p_business AND coalesce(b.type,'business')<>'personal' AND coalesce(b.status,'active')<>'archived';
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant') OR role_name='owner' AND NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p_business AND owner_user_id=p_actor) THEN RAISE EXCEPTION 'import_review_forbidden'; END IF;
 SELECT * INTO prior FROM public.bank_import_confirm_requests WHERE business_id=p_business AND batch_id=p_batch AND actor_user_id=p_actor AND request_key=p_request_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found','request_id',p_request_key); END IF;
 RETURN jsonb_build_object('state','confirmed','request_id',p_request_key,'batch_id',p_batch,'intent',prior.intent,'result',prior.result,'confirmed_at',prior.created_at,'result_is_historical',true,'automatic_retry',false);
END $$;
REVOKE ALL ON FUNCTION public.cfo_import_review_state(uuid,uuid,bigint),public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text),public.rpc_read_bank_import_confirm(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfo_import_review_state(uuid,uuid,bigint),public.rpc_confirm_bank_import_reviewed(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb,text),public.rpc_read_bank_import_confirm(uuid,uuid,bigint,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
