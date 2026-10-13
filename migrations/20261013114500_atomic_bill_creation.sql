-- New bounded creation contract; no date/currency edit policy or ledger changes.
-- NOT APPLIED. Requires native preview and fresh own staging rollout gates.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.fn_ledger_writer_lock()') IS NULL OR to_regclass('public.audit_events') IS NULL THEN RAISE EXCEPTION 'bill_dependencies_missing'; END IF;
 IF to_regclass('public.bill_creation_requests') IS NOT NULL OR to_regprocedure('public.rpc_create_business_bill(bigint,uuid,uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'bill_existing_schema_requires_review'; END IF;
END $$;
ALTER TABLE public.debts ADD COLUMN invoice_number text, ADD COLUMN invoice_date date,
 ADD COLUMN bill_version bigint NOT NULL DEFAULT 1 CHECK(bill_version>0);
CREATE FUNCTION public.fn_bill_version() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN NEW.bill_version:=OLD.bill_version+1; RETURN NEW; END $$;
CREATE TRIGGER bill_version BEFORE UPDATE ON public.debts FOR EACH ROW EXECUTE FUNCTION public.fn_bill_version();
REVOKE ALL ON FUNCTION public.fn_bill_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bill_version() TO service_role;
CREATE TABLE public.bill_creation_requests(
 business_id uuid NOT NULL REFERENCES public.businesses(id), actor_user_id bigint NOT NULL,
 request_key uuid NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(business_id,actor_user_id,request_key)
);
ALTER TABLE public.bill_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bill_creation_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.bill_creation_requests TO service_role;
CREATE FUNCTION public.fn_bill_creation_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'bill_receipt_immutable'; END $$;
CREATE TRIGGER bill_receipt_immutable BEFORE UPDATE OR DELETE ON public.bill_creation_requests
 FOR EACH ROW EXECUTE FUNCTION public.fn_bill_creation_receipt_immutable();
CREATE TRIGGER bill_receipt_no_truncate BEFORE TRUNCATE ON public.bill_creation_requests
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_bill_creation_receipt_immutable();
REVOKE ALL ON FUNCTION public.fn_bill_creation_receipt_immutable() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bill_creation_receipt_immutable() TO service_role;
CREATE FUNCTION public.rpc_create_business_bill(p_actor bigint,p_business uuid,p_request_key uuid,p_payload jsonb,p_context jsonb DEFAULT '{}',p_limit bigint DEFAULT NULL,p_limit_since timestamptz DEFAULT NULL,p_limit_scope text DEFAULT 'actor')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; m public.business_members; role_name text; prior public.bill_creation_requests;
 d public.debts; aid uuid; answer jsonb; amount_value numeric; due_value date; identity jsonb; c public.debts; used bigint; channel_name text; pending boolean; invoice_date_value date;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 IF p_actor IS NULL OR p_request_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
   OR NOT(p_payload ?& ARRAY['type','counterparty','amount','currency','due_date','description','scope'])
   OR p_payload-ARRAY['type','counterparty','amount','currency','due_date','description','scope','invoice_number','invoice_date']<>'{}'::jsonb
   OR p_payload->>'scope' IS DISTINCT FROM 'business' THEN RAISE EXCEPTION 'bill_invalid_request'; END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' AND COALESCE(status,'active')<>'archived' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_business_required'; END IF;
 SELECT * INTO m FROM public.business_members WHERE business_id=b.id AND user_id=p_actor AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_forbidden'; END IF;
 role_name:=CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END;
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant','manager','employee') OR role_name='owner' AND b.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'bill_forbidden'; END IF;
 IF jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR p_context-ARRAY['source_channel','raw_input_text','raw_input_language','confidence_score','attachment_url','attachments','created_by_telegram_id','created_by_name','training_type','is_training','notes','last_action_channel','pending']<>'{}'::jsonb THEN RAISE EXCEPTION 'bill_invalid_request'; END IF;
 channel_name:=coalesce(p_context->>'source_channel','web');
 IF channel_name NOT IN('web','telegram','mcp') THEN RAISE EXCEPTION 'bill_invalid_request'; END IF;
 pending:=channel_name='mcp' OR coalesce((p_context->>'pending')::boolean,false) OR coalesce((p_context->>'is_training')::boolean,false);
 identity:=CASE WHEN p_context='{}'::jsonb THEN p_payload ELSE p_payload||jsonb_build_object('_transport',p_context) END;
 SELECT * INTO prior FROM public.bill_creation_requests WHERE business_id=b.id AND actor_user_id=p_actor AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM identity THEN RAISE EXCEPTION 'bill_request_conflict'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'historical',true);
 END IF;
 IF p_limit IS NOT NULL THEN
  IF p_limit<0 OR p_limit_since IS NULL OR p_limit_scope NOT IN('actor','business') THEN RAISE EXCEPTION 'bill_invalid_quota'; END IF;
  SELECT count(*) INTO used FROM public.debts WHERE created_at>=p_limit_since AND CASE WHEN p_limit_scope='actor' THEN user_id=p_actor ELSE business_id=p_business END;
  IF used>=p_limit THEN RAISE EXCEPTION 'bill_quota_reached'; END IF;
 END IF;
 IF jsonb_typeof(p_payload->'type') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'counterparty') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'amount') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'currency') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'due_date') NOT IN('string','null')
   OR p_payload->>'type' NOT IN('payable','receivable') OR NULLIF(btrim(p_payload->>'counterparty'),'') IS NULL
   OR p_payload->>'currency' !~ '^[A-Z]{3}$' OR p_payload->>'amount' !~ '^[0-9]+([.][0-9]{1,2})?$'
   OR jsonb_typeof(p_payload->'description') NOT IN('string','null') THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
 amount_value:=(p_payload->>'amount')::numeric;
 IF amount_value<=0 OR amount_value>=10000000000000000 THEN RAISE EXCEPTION 'bill_invalid_amount'; END IF;
 IF p_payload->>'due_date' IS NOT NULL THEN
  IF p_payload->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
  due_value:=(p_payload->>'due_date')::date;
  IF to_char(due_value,'YYYY-MM-DD') IS DISTINCT FROM p_payload->>'due_date' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
 END IF;
 IF p_payload ? 'invoice_number' AND jsonb_typeof(p_payload->'invoice_number') NOT IN('string','null') OR length(p_payload->>'invoice_number')>200 THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
 IF p_payload->>'invoice_date' IS NOT NULL THEN
  IF jsonb_typeof(p_payload->'invoice_date')<>'string' OR p_payload->>'invoice_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
  invoice_date_value:=(p_payload->>'invoice_date')::date;
  IF to_char(invoice_date_value,'YYYY-MM-DD') IS DISTINCT FROM p_payload->>'invoice_date' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
 END IF;
 c:=jsonb_populate_record(NULL::public.debts,p_context-ARRAY['source_channel','pending']);
 INSERT INTO public.debts(user_id,business_id,type,counterparty,amount,original_amount,paid_amount,currency,due_date,description,scope,is_settled,status,source_channel,created_by_user_id,created_by_role,approval_status,raw_input_text,raw_input_language,confidence_score,attachment_url,attachments,created_by_telegram_id,created_by_name,training_type,is_training,notes,last_action_channel,invoice_number,invoice_date)
 -- Same attribution as the existing bizWriteFields: user_id remains the owner
 -- for retained queries; created_by_user_id and the receipt belong to the actor.
 VALUES(b.owner_user_id,b.id,p_payload->>'type',btrim(p_payload->>'counterparty'),amount_value,amount_value,0,p_payload->>'currency',due_value::timestamp AT TIME ZONE 'UTC',p_payload->>'description','business',false,'open',channel_name,p_actor,role_name,
   CASE WHEN NOT pending AND role_name IN('owner','ceo','admin','cfo','accountant') THEN 'approved' ELSE 'pending_approval' END,c.raw_input_text,c.raw_input_language,c.confidence_score,c.attachment_url,c.attachments,c.created_by_telegram_id,c.created_by_name,c.training_type,coalesce(c.is_training,false),c.notes,coalesce(c.last_action_channel,channel_name),p_payload->>'invoice_number',invoice_date_value)
 RETURNING * INTO d;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json,request_id)
 VALUES(b.id,p_actor,role_name,channel_name,'debt',d.id::text,'debt_created',NULL,jsonb_build_object('debt',to_jsonb(d),'payload',p_payload,'operation','create'),p_request_key::text) RETURNING id INTO aid;
 answer:=jsonb_build_object('ok',true,'debt',to_jsonb(d),'request_id',p_request_key,'audit_id',aid,'replayed',false,'historical',false);
 INSERT INTO public.bill_creation_requests(business_id,actor_user_id,request_key,payload,result) VALUES(b.id,p_actor,p_request_key,identity,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_create_business_bill(bigint,uuid,uuid,jsonb,jsonb,bigint,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_business_bill(bigint,uuid,uuid,jsonb,jsonb,bigint,timestamptz,text) TO service_role;
CREATE FUNCTION public.rpc_read_own_bill_creation(p_actor bigint,p_business uuid,p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE role_name text; answer jsonb;
BEGIN
 SELECT CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END INTO role_name
 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id AND m.user_id=p_actor AND m.status='active'
 WHERE b.id=p_business AND b.type='business' AND coalesce(b.status,'active')<>'archived';
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant','manager','employee') THEN RAISE EXCEPTION 'business_write_forbidden: Current bill membership required'; END IF;
 SELECT jsonb_build_object('payload',payload,'result',result,'created_at',created_at) INTO answer
 FROM public.bill_creation_requests WHERE business_id=p_business AND actor_user_id=p_actor AND request_key=p_request_key;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_read_own_bill_creation(bigint,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_read_own_bill_creation(bigint,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.rpc_list_own_financial_receipts(
 p_business_id uuid,p_user_id bigint,p_operation text DEFAULT NULL,p_before timestamptz DEFAULT NULL,
 p_after_operation text DEFAULT NULL,p_after_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE role_name text; answer jsonb;
BEGIN
 SELECT CASE WHEN b.owner_user_id=p_user_id THEN 'owner' ELSE m.role END INTO role_name
 FROM public.businesses b LEFT JOIN public.business_members m ON m.business_id=b.id AND m.user_id=p_user_id AND m.status='active'
 WHERE b.id=p_business_id AND COALESCE(b.type,'business')<>'personal' AND COALESCE(b.status,'active')<>'archived'
   AND (b.owner_user_id=p_user_id OR m.user_id IS NOT NULL);
 IF role_name IS NULL OR role_name NOT IN ('owner','ceo','admin','cfo','accountant','manager','employee') THEN RAISE EXCEPTION 'business_write_forbidden: Current financial membership required'; END IF;
 IF p_operation IS NOT NULL AND p_operation NOT IN ('wallet_create','transaction_batch','wallet_adjust','debt_payment','wallet_transfer','bill_create')
 THEN RAISE EXCEPTION 'invalid_financial_intent: Unsupported receipt operation'; END IF;
 IF p_operation IN ('wallet_create','wallet_adjust') AND role_name='accountant'
 THEN RAISE EXCEPTION 'business_write_forbidden: Current wallet role required'; END IF;
 IF role_name IN('manager','employee') AND p_operation IS NOT NULL AND p_operation<>'bill_create' THEN RAISE EXCEPTION 'business_write_forbidden: Current financial role required'; END IF;
 WITH receipts AS (
   SELECT operation,request_key,intent,result,created_at FROM public.financial_write_requests
   WHERE role_name NOT IN('manager','employee') AND business_id=p_business_id AND actor_user_id=p_user_id AND created_at>=now()-interval '7 days'
     AND (p_operation IS NULL OR operation=p_operation)
     AND (role_name<>'accountant' OR operation NOT IN ('wallet_create','wallet_adjust'))
   UNION ALL
   SELECT 'debt_payment'::text,key,intent,response_body,created_at FROM public.debt_payment_idempotency
   WHERE role_name NOT IN('manager','employee') AND business_id=p_business_id AND user_id=p_user_id AND created_at>=now()-interval '7 days'
     AND (p_operation IS NULL OR p_operation='debt_payment')
   UNION ALL
   SELECT 'bill_create'::text,request_key::text,jsonb_build_object('version',1,'operation','bill_create','scope','business','payload',payload),result,created_at FROM public.bill_creation_requests
   WHERE business_id=p_business_id AND actor_user_id=p_user_id AND created_at>=now()-interval '7 days' AND (p_operation IS NULL OR p_operation='bill_create')
     AND EXISTS(SELECT 1 FROM public.business_members WHERE business_id=p_business_id AND user_id=p_user_id AND status='active')
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

CREATE FUNCTION public.rpc_update_business_bill(p_actor bigint,p_business uuid,p_debt bigint,p_expected_version bigint,p_patch jsonb,p_action text DEFAULT 'metadata')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; m public.business_members; d public.debts; n public.debts; role_name text; withheld numeric; aid uuid; invoice_day date; due_day date;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' AND coalesce(status,'active')<>'archived' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_business_required'; END IF;
 SELECT * INTO m FROM public.business_members WHERE business_id=p_business AND user_id=p_actor AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_forbidden'; END IF;
 role_name:=CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END;
 IF role_name NOT IN('owner','ceo','admin','cfo','accountant') OR role_name='owner' AND b.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'bill_forbidden'; END IF;
 SELECT * INTO d FROM public.debts WHERE id=p_debt AND business_id=p_business AND scope='business' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'bill_invalid_version'; END IF;
 IF d.bill_version<>p_expected_version THEN RAISE EXCEPTION 'bill_stale'; END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch='{}'::jsonb THEN RAISE EXCEPTION 'bill_invalid_request'; END IF;
 IF p_action='checklist' THEN
  IF p_patch-ARRAY['accountant_checked']<>'{}'::jsonb OR jsonb_typeof(p_patch->'accountant_checked') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
  UPDATE public.debts SET accountant_checked_at=CASE WHEN (p_patch->>'accountant_checked')::boolean THEN now() ELSE NULL END,
    accountant_checked_by=CASE WHEN (p_patch->>'accountant_checked')::boolean THEN p_actor ELSE NULL END WHERE id=d.id RETURNING * INTO n;
 ELSIF p_action='metadata' THEN
  IF p_patch-ARRAY['counterparty','description','currency','due_date','invoice_date','invoice_number','type','amount','scope']<>'{}'::jsonb THEN RAISE EXCEPTION 'bill_invalid_request'; END IF;
  n:=jsonb_populate_record(d,p_patch-ARRAY['due_date','invoice_date']);
  IF n.scope IS DISTINCT FROM 'business' OR n.type NOT IN('payable','receivable') OR nullif(btrim(n.counterparty),'') IS NULL OR n.currency !~ '^[A-Z]{3}$'
   OR n.amount IS NULL OR n.amount<=0 OR n.amount::text IN('NaN','Infinity','-Infinity') OR n.amount>=10000000000000000 OR length(n.invoice_number)>200 THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
  IF p_patch ? 'amount' THEN
   IF jsonb_typeof(p_patch->'amount') IS DISTINCT FROM 'string' OR p_patch->>'amount' !~ '^[0-9]+([.][0-9]{1,2})?$' OR n.amount IS DISTINCT FROM (p_patch->>'amount')::numeric THEN RAISE EXCEPTION 'bill_invalid_amount'; END IF;
   n.original_amount:=n.amount;
  END IF;
  SELECT coalesce(sum(allocated_amount),0) INTO withheld FROM public.debt_settlement_allocations WHERE debt_id=d.id;
  IF n.original_amount<coalesce(d.paid_amount,0)+withheld THEN RAISE EXCEPTION 'bill_invalid_amount'; END IF;
  IF (n.currency IS DISTINCT FROM d.currency OR n.type IS DISTINCT FROM d.type) AND (
   coalesce(d.paid_amount,0)>0 OR EXISTS(SELECT 1 FROM public.transactions WHERE debt_payment_id=d.id)
   OR EXISTS(SELECT 1 FROM public.debt_settlement_allocations WHERE debt_id=d.id)
   OR EXISTS(SELECT 1 FROM public.withholding_records WHERE debt_id=d.id)) THEN RAISE EXCEPTION 'bill_metadata_locked'; END IF;
  IF p_patch ? 'due_date' THEN
   IF p_patch->>'due_date' IS NOT NULL THEN
    IF jsonb_typeof(p_patch->'due_date')<>'string' OR p_patch->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
    due_day:=(p_patch->>'due_date')::date;
    IF to_char(due_day,'YYYY-MM-DD') IS DISTINCT FROM p_patch->>'due_date' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
   END IF;
   n.due_date:=due_day::timestamp AT TIME ZONE 'UTC';
  END IF;
  IF p_patch ? 'invoice_date' THEN
   IF p_patch->>'invoice_date' IS NOT NULL THEN
    IF jsonb_typeof(p_patch->'invoice_date')<>'string' OR p_patch->>'invoice_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
    invoice_day:=(p_patch->>'invoice_date')::date;
    IF to_char(invoice_day,'YYYY-MM-DD') IS DISTINCT FROM p_patch->>'invoice_date' THEN RAISE EXCEPTION 'bill_invalid_value'; END IF;
   END IF;
   n.invoice_date:=invoice_day;
  END IF;
  UPDATE public.debts SET counterparty=n.counterparty,description=n.description,currency=n.currency,type=n.type,amount=n.amount,original_amount=n.original_amount,
   invoice_number=n.invoice_number,invoice_date=n.invoice_date,due_date=n.due_date WHERE id=d.id RETURNING * INTO n;
 ELSE RAISE EXCEPTION 'bill_invalid_request'; END IF;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json)
 VALUES(p_business,p_actor,role_name,'web','debt',d.id::text,CASE WHEN p_action='checklist' THEN 'debt_checklist_updated' ELSE 'debt_metadata_updated' END,to_jsonb(d),to_jsonb(n)) RETURNING id INTO aid;
 RETURN jsonb_build_object('ok',true,'debt',to_jsonb(n),'audit_id',aid);
END $$;
REVOKE ALL ON FUNCTION public.rpc_update_business_bill(bigint,uuid,bigint,bigint,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_business_bill(bigint,uuid,bigint,bigint,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
