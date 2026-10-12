-- Non-financial registration receipt. CFO BIGINT actor; no Auth bridge or money writer changes.
-- Apply only to own staging after a fresh backup and native restore/projection checks.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.business_creation_requests (
 actor_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL,
 intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object'),
 business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_user_id,request_key)
);
ALTER TABLE public.business_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_creation_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.business_creation_requests TO service_role;
CREATE FUNCTION public.rpc_read_business_creation(p_actor bigint,p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE receipt public.business_creation_requests;
BEGIN
 SELECT * INTO receipt FROM public.business_creation_requests WHERE actor_user_id=p_actor AND request_key=p_request_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF receipt.business_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id
  WHERE b.id=receipt.business_id AND b.owner_user_id=p_actor AND b.type='business' AND b.status='active'
   AND m.user_id=p_actor AND m.role='owner' AND m.status='active'
 ) THEN RAISE EXCEPTION 'company_creation_unavailable'; END IF;
 RETURN receipt.result || jsonb_build_object('is_replay',true);
END $$;
CREATE FUNCTION public.rpc_create_business_once(p_actor bigint,p_request_key uuid,p_intent jsonb,p_categories jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE receipt public.business_creation_requests; company public.businesses; answer jsonb;
 optional_field text; columns_sql text:='owner_user_id,name,base_currency,plan,type';
 values_sql text:='$1,$2->>''name'',$2->>''base_currency'',''free'',''business''';
 unsupported jsonb:='[]'; seeded integer;
BEGIN
 -- Existing statement triggers also take this gate. Enter it BEFORE any parent,
 -- metadata or receipt lock; do not introduce a second lock order.
 PERFORM public.fn_ledger_writer_lock();
 IF p_actor IS NULL OR p_request_key IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor)
  OR p_intent IS NULL OR jsonb_typeof(p_intent)<>'object'
  OR jsonb_typeof(p_intent->'name') IS DISTINCT FROM 'string' OR length(trim(p_intent->>'name')) NOT BETWEEN 1 AND 120
  OR COALESCE(p_intent->>'base_currency','') NOT IN ('IDR','USD','EUR','SGD','MYR','THB','CNY')
  OR (p_intent - ARRAY['name','base_currency','country','timezone','business_type'])<>'{}'::jsonb
  OR p_categories IS NULL OR jsonb_typeof(p_categories)<>'array' OR jsonb_array_length(p_categories)>100
 THEN RAISE EXCEPTION 'invalid_company_creation'; END IF;
 SELECT * INTO receipt FROM public.business_creation_requests WHERE actor_user_id=p_actor AND request_key=p_request_key;
 IF FOUND THEN
  IF receipt.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'company_creation_key_mismatch'; END IF;
  RETURN public.rpc_read_business_creation(p_actor,p_request_key);
 END IF;
 -- Preserve the actual database trial/code defaults. Optional schema fields retain
 -- the previous capability contract, with an explicit unsupported_fields response.
 FOREACH optional_field IN ARRAY ARRAY['country','timezone','business_type'] LOOP
  IF p_intent ? optional_field THEN
   IF jsonb_typeof(p_intent->optional_field) NOT IN ('string','null') OR length(p_intent->>optional_field)>120 THEN RAISE EXCEPTION 'invalid_company_creation'; END IF;
   IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.businesses'::regclass AND attname=optional_field AND NOT attisdropped) THEN
    columns_sql:=columns_sql||format(',%I',optional_field);
    values_sql:=values_sql||format(',$2->>%L',optional_field);
   ELSE unsupported:=unsupported||jsonb_build_array(optional_field); END IF;
  END IF;
 END LOOP;
 EXECUTE 'INSERT INTO public.businesses ('||columns_sql||') VALUES ('||values_sql||') RETURNING *' INTO company USING p_actor,p_intent;
 INSERT INTO public.business_members(business_id,user_id,role,status) VALUES(company.id,p_actor,'owner','active');
 INSERT INTO public.cashflow_categories(business_id,user_id,name,group_type,activity_type,sort_order,is_system,is_active,source)
 SELECT company.id,p_actor,x.name,x.group_type,x.activity_type,x.sort_order,false,true,'default'
 FROM jsonb_to_recordset(p_categories) AS x(name text,group_type text,activity_type text,sort_order integer);
 GET DIAGNOSTICS seeded=ROW_COUNT;
 answer:=jsonb_build_object('business',to_jsonb(company),'categories_seeded',seeded,'unsupported_fields',unsupported,'creation_request_id',p_request_key,'is_replay',false);
 INSERT INTO public.business_creation_requests(actor_user_id,request_key,intent,business_id,result) VALUES(p_actor,p_request_key,p_intent,company.id,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.rpc_create_business_once(bigint,uuid,jsonb,jsonb),public.rpc_read_business_creation(bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_business_once(bigint,uuid,jsonb,jsonb),public.rpc_read_business_creation(bigint,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
