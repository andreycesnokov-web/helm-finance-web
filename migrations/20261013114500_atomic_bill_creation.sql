-- New bounded creation contract; no date/currency edit policy or ledger changes.
-- NOT APPLIED. Requires native preview and fresh own staging rollout gates.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.fn_ledger_writer_lock()') IS NULL OR to_regclass('public.audit_events') IS NULL THEN RAISE EXCEPTION 'bill_dependencies_missing'; END IF;
 IF to_regclass('public.bill_creation_requests') IS NOT NULL OR to_regprocedure('public.rpc_create_business_bill(bigint,uuid,uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'bill_existing_schema_requires_review'; END IF;
END $$;
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
CREATE FUNCTION public.rpc_create_business_bill(p_actor bigint,p_business uuid,p_request_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; m public.business_members; role_name text; prior public.bill_creation_requests;
 d public.debts; aid uuid; answer jsonb; amount_value numeric; due_value date;
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 IF p_actor IS NULL OR p_request_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
   OR NOT(p_payload ?& ARRAY['type','counterparty','amount','currency','due_date','description','scope'])
   OR p_payload-ARRAY['type','counterparty','amount','currency','due_date','description','scope']<>'{}'::jsonb
   OR p_payload->>'scope' IS DISTINCT FROM 'business' THEN RAISE EXCEPTION 'bill_invalid_request'; END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' AND COALESCE(status,'active')<>'archived' FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_business_required'; END IF;
 SELECT * INTO m FROM public.business_members WHERE business_id=b.id AND user_id=p_actor AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bill_forbidden'; END IF;
 role_name:=CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END;
 IF role_name IS NULL OR role_name NOT IN('owner','ceo','admin','cfo','accountant','manager','employee') OR role_name='owner' AND b.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'bill_forbidden'; END IF;
 SELECT * INTO prior FROM public.bill_creation_requests WHERE business_id=b.id AND actor_user_id=p_actor AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'bill_request_conflict'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true,'historical',true);
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
 INSERT INTO public.debts(user_id,business_id,type,counterparty,amount,original_amount,paid_amount,currency,due_date,description,scope,is_settled,status,source_channel,created_by_user_id,created_by_role,approval_status)
 VALUES(p_actor,b.id,p_payload->>'type',btrim(p_payload->>'counterparty'),amount_value,amount_value,0,p_payload->>'currency',due_value::timestamp AT TIME ZONE 'UTC',p_payload->>'description','business',false,'open','web',p_actor,role_name,
   CASE WHEN role_name IN('owner','ceo','admin','cfo','accountant') THEN 'approved' ELSE 'pending_approval' END)
 RETURNING * INTO d;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json,request_id)
 VALUES(b.id,p_actor,role_name,'web','debt',d.id::text,'debt_created',NULL,jsonb_build_object('debt',to_jsonb(d),'payload',p_payload,'operation','create'),p_request_key::text) RETURNING id INTO aid;
 answer:=jsonb_build_object('ok',true,'debt',to_jsonb(d),'request_id',p_request_key,'audit_id',aid,'replayed',false,'historical',false);
 INSERT INTO public.bill_creation_requests(business_id,actor_user_id,request_key,payload,result) VALUES(b.id,p_actor,p_request_key,p_payload,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_create_business_bill(bigint,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_business_bill(bigint,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
