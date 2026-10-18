-- Down for 20261018130000_billing_published_matrix_sync.sql
-- For isolated rehearsal only; never a production rollback step. Fail-closed: explicit confirmation.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_setting('cfo.confirm_down', true) IS DISTINCT FROM '20261018130000' THEN
  RAISE EXCEPTION 'billing_matrix_sync_down_not_confirmed: run SET cfo.confirm_down = ''20261018130000'' in this session first';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.billing_usage(p_business uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT jsonb_object_agg(resource,used) FROM(
   SELECT resource,sum(units) AS used FROM public.billing_quota_reservations WHERE business_id=p_business
    AND resource IN('documents','ai','imports','transactions','bank_rows','mcp','ai_accountant','ai_extraction') AND state IN('reserved','processing','committed')
    AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date GROUP BY resource) u),'{}'::jsonb)
 ||jsonb_build_object(
  'users',(SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active'),
  'companies',1,
  'storage_mb',(SELECT ceil(COALESCE(sum(file_size),0)/1048576.0)::bigint FROM public.document_files WHERE business_id=p_business),
  'integrations',(SELECT count(*) FROM public.payment_provider_connections WHERE business_id=p_business AND status<>'disabled'),
  'accounts',(SELECT count(*) FROM public.wallets WHERE business_id=p_business AND COALESCE(is_active,true)))
$$;

CREATE OR REPLACE FUNCTION public.rpc_create_business_commercial_once(p_actor bigint,p_request_key uuid,p_intent jsonb,p_categories jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE answer jsonb;b businesses;
BEGIN
 answer:=public.rpc_create_business_once(p_actor,p_request_key,p_intent,p_categories);
 IF (answer->>'is_replay')::boolean THEN RETURN answer;END IF;
 UPDATE businesses SET billing_policy='commercial_v2',trial_started_at=NULL,trial_ends_at=NULL,trial_status='none',subscription_status='not_started',plan='free'
  WHERE id=(answer->'business'->>'id')::uuid RETURNING * INTO b;
 INSERT INTO billing_accounts(business_id)VALUES(b.id)ON CONFLICT DO NOTHING;
 INSERT INTO billing_events(business_id,event_key,event_type,actor_user_id)VALUES(b.id,'company_created','company_created',p_actor)ON CONFLICT DO NOTHING;
 answer:=jsonb_set(answer,'{business}',to_jsonb(b));
 UPDATE business_creation_requests SET result=answer WHERE actor_user_id=p_actor AND request_key=p_request_key;
 RETURN answer;
END $$;

REVOKE ALL ON FUNCTION public.rpc_create_business_commercial_once(bigint,uuid,jsonb,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_business_commercial_once(bigint,uuid,jsonb,jsonb)TO service_role;

DELETE FROM public.billing_schema_versions WHERE version='20261018130000';
NOTIFY pgrst,'reload schema';
COMMIT;
