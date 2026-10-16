-- Down for 20261018090000_billing_plan_matrix. Restores the 20261017120000 definitions (verbatim) and removes the
-- new metered limits. Refuses while any usage of the new resources or any version using the new keys exists.
-- Draft versions created by the up migration stay (versions are immutable); only catalog pointers are kept.
-- For isolated rehearsal only; never a production rollback step. Fail-closed: explicit confirmation.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_setting('cfo.confirm_down', true) IS DISTINCT FROM '20261018090000' THEN
  RAISE EXCEPTION 'billing_plan_matrix_down_not_confirmed: run SET cfo.confirm_down = ''20261018090000'' in this session first';
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_quota_reservations WHERE resource IN('accounts','bank_rows','mcp','ai_accountant','ai_extraction'))
  OR EXISTS(SELECT 1 FROM public.plan_versions WHERE limits ?| ARRAY['accounts','bank_rows','mcp','ai_accountant','ai_extraction'])
  OR EXISTS(SELECT 1 FROM public.billing_overrides WHERE key IN('accounts','bank_rows','mcp','ai_accountant','ai_extraction')) THEN
  RAISE EXCEPTION 'billing_plan_matrix_down_refused_usage_exists';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.billing_public_catalog();
CREATE OR REPLACE FUNCTION public.billing_usage(p_business uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT jsonb_object_agg(resource,used) FROM(
   SELECT resource,sum(units) AS used FROM public.billing_quota_reservations WHERE business_id=p_business
    AND resource IN('documents','ai','imports','transactions') AND state IN('reserved','processing','committed')
    AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date GROUP BY resource) u),'{}'::jsonb)
 ||jsonb_build_object(
  'users',(SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active'),
  'companies',1,
  'storage_mb',(SELECT ceil(COALESCE(sum(file_size),0)/1048576.0)::bigint FROM public.document_files WHERE business_id=p_business),
  'integrations',(SELECT count(*) FROM public.payment_provider_connections WHERE business_id=p_business AND status<>'disabled'))
$$;
CREATE OR REPLACE FUNCTION public.billing_terms_error(p jsonb,p_complete boolean)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE x record;
BEGIN
 IF (p-'action'-'dry_run'-'confirm_publish'-'name_i18n'-'description_i18n'-'price_minor'-'price_annual_minor'-'currency'-'features'-'limits'
   -'limit_policies'-'trial_hours'-'terms_version'-'effective_at'-'approval_status'-'fixture_label'-'publish')<>'{}'::jsonb THEN RETURN 'billing_invalid_terms'; END IF;
 IF jsonb_typeof(p->'name_i18n') IS DISTINCT FROM 'object' OR NOT (p->'name_i18n') ?& ARRAY['en','ru','id']
  OR jsonb_typeof(p->'description_i18n') IS DISTINCT FROM 'object' OR NOT (p->'description_i18n') ?& ARRAY['en','ru','id']
  OR EXISTS(SELECT 1 FROM jsonb_each(p->'name_i18n') n WHERE jsonb_typeof(n.value)<>'string' OR length(trim(n.value#>>'{}'))=0 OR length(n.value#>>'{}')>80)
 THEN RETURN 'billing_invalid_terms'; END IF;
 IF COALESCE(p->>'price_minor','') !~ '^[0-9]{1,16}$' OR (p->>'price_minor')::numeric>9007199254740991
  OR (p ? 'price_annual_minor' AND p->'price_annual_minor'<>'null'::jsonb AND (COALESCE(p->>'price_annual_minor','') !~ '^[0-9]{1,16}$' OR (p->>'price_annual_minor')::numeric>9007199254740991))
  OR COALESCE(p->>'currency','') !~ '^[A-Z]{3}$' OR length(trim(COALESCE(p->>'terms_version','')))=0
  OR COALESCE(p->>'approval_status','') NOT IN('draft','approved','staging_fixture')
  OR (p ? 'trial_hours' AND (COALESCE(p->>'trial_hours','') !~ '^[0-9]{1,4}$' OR (p->>'trial_hours')::int NOT BETWEEN 1 AND 2160))
  OR jsonb_typeof(COALESCE(p->'features','{}')) <> 'object' OR jsonb_typeof(COALESCE(p->'limits','{}')) <> 'object'
  OR jsonb_typeof(COALESCE(p->'limit_policies','{}')) <> 'object'
 THEN RETURN 'billing_invalid_terms'; END IF;
 FOR x IN SELECT f.key,f.value,c.module_status,c.enforcement FROM jsonb_each(COALESCE(p->'features','{}')) f
   LEFT JOIN public.billing_catalog_items c ON c.kind='feature' AND c.key=f.key LOOP
  IF x.module_status IS NULL OR jsonb_typeof(x.value)<>'boolean' THEN RETURN 'billing_unknown_feature'; END IF;
  IF x.module_status='not_released' AND x.value='true'::jsonb THEN RETURN 'billing_feature_not_released'; END IF;
  -- Pulse and data export belong to every plan: a plan cannot promise to take them away.
  IF x.enforcement='always' AND x.value='false'::jsonb THEN RETURN 'billing_feature_always_included'; END IF;
 END LOOP;
 FOR x IN SELECT l.key,l.value,c.required,c.counter FROM jsonb_each(COALESCE(p->'limits','{}')) l
   LEFT JOIN public.billing_catalog_items c ON c.kind='limit' AND c.key=l.key LOOP
  IF x.required IS NULL THEN RETURN 'billing_unknown_limit'; END IF;
  IF NOT x.required AND x.counter IS NULL THEN RETURN 'billing_limit_without_counter'; END IF;
  IF x.value<>'null'::jsonb AND (jsonb_typeof(x.value)<>'number' OR x.value::text !~ '^[0-9]{1,16}$') THEN RETURN 'billing_invalid_terms'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_each(COALESCE(p->'limit_policies','{}')) lp
   WHERE NOT (COALESCE(p->'limits','{}') ? lp.key) OR lp.value NOT IN('"hard"'::jsonb,'"soft"'::jsonb)) THEN RETURN 'billing_invalid_terms'; END IF;
 IF p_complete AND NOT public.billing_terms_complete(COALESCE(p->'features','{}'),COALESCE(p->'limits','{}')) THEN RETURN 'billing_terms_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_quota(p_actor bigint,p_business uuid,p_key uuid,p_resource text,p_action text,p_units integer DEFAULT 1,p_reason text DEFAULT NULL,p_intent jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts;r public.billing_quota_reservations;t jsonb;lim bigint;used bigint;policy text;over boolean;feat text;revive boolean:=false;
 period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"policy":"legacy"}'::jsonb;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE b.id=p_business AND b.status='active' AND m.user_id=p_actor AND m.status='active') THEN RAISE EXCEPTION 'billing_forbidden';END IF;
 IF p_key IS NULL OR p_units IS NULL OR p_units<1 OR p_resource NOT IN('documents','ai','imports','users','companies','transactions','storage_mb','integrations')
  OR p_action NOT IN('reserve','start','commit','release','abandon') THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 SELECT * INTO r FROM public.billing_quota_reservations WHERE business_id=p_business AND request_key=p_key;
 IF FOUND THEN
  IF r.actor_user_id<>p_actor OR r.resource<>p_resource OR r.units<>p_units OR(p_action='reserve' AND r.intent IS DISTINCT FROM p_intent) THEN RAISE EXCEPTION 'billing_command_conflict';END IF;
  -- A request that failed (released) may be retried with the same key: the quota is checked again and the
  -- same reservation is revived. Anything still in flight or committed is a replay.
  IF p_action='reserve' AND r.state='released' THEN revive:=true;
  ELSIF p_action='reserve' THEN RETURN to_jsonb(r)||'{"is_replay":true}'::jsonb;END IF;
  IF NOT revive THEN
   IF p_action='start' THEN
    IF r.resource<>'documents' OR r.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'billing_command_conflict';END IF;
    IF r.state='committed' THEN RETURN to_jsonb(r);END IF;
    IF r.state<>'reserved' THEN RAISE EXCEPTION 'billing_job_in_progress';END IF;
    UPDATE public.billing_quota_reservations SET state='processing',updated_at=now() WHERE business_id=p_business AND request_key=p_key RETURNING * INTO r;
    RETURN to_jsonb(r);
   END IF;
   IF p_action='abandon' THEN
    IF r.resource NOT IN('documents','storage_mb') OR r.state='processing' THEN RAISE EXCEPTION 'billing_reservation_terminal';END IF;
    p_action:='release';
   END IF;
   IF r.state NOT IN('reserved','processing') THEN
    IF (p_action='commit' AND r.state='committed') OR(p_action='release' AND r.state='released')THEN RETURN to_jsonb(r);END IF;
    RAISE EXCEPTION 'billing_reservation_terminal';
   END IF;
   IF p_action='release' AND COALESCE(length(trim(p_reason)),0)<3 THEN RAISE EXCEPTION 'billing_reason_required';END IF;
   UPDATE public.billing_quota_reservations SET state=CASE WHEN p_action='commit' THEN 'committed' ELSE 'released' END,reason=p_reason,updated_at=now() WHERE business_id=p_business AND request_key=p_key RETURNING * INTO r;
   RETURN to_jsonb(r);
  END IF;
 END IF;
 IF NOT revive AND p_action<>'reserve' THEN RAISE EXCEPTION 'billing_reservation_not_found';END IF;
 t:=public.billing_effective_terms(p_business);
 IF t IS NULL THEN RAISE EXCEPTION 'billing_restricted';END IF;
 feat:=CASE p_resource WHEN 'imports' THEN 'import' WHEN 'storage_mb' THEN 'documents' WHEN 'users' THEN NULL WHEN 'companies' THEN NULL ELSE p_resource END;
 IF feat IS NOT NULL AND (t->'features'->>feat) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'billing_feature_denied';END IF;
 lim:=(t->'limits'->>p_resource)::bigint;
 policy:=COALESCE(t->'limit_policies'->>p_resource,'hard');
 IF p_resource='users' THEN
  SELECT (SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active')+
   COALESCE((SELECT sum(greatest(COALESCE(max_uses,1)-uses_count,0)) FROM public.business_invites WHERE business_id=p_business AND status='active' AND expires_at>now()),0)+
   COALESCE((SELECT sum(units) FROM public.billing_quota_reservations WHERE business_id=p_business AND resource='users' AND state IN('reserved','processing')),0) INTO used;
 ELSIF p_resource IN('storage_mb','integrations') THEN
  -- Current-state resources: the real rows plus requests still in flight (committed work is in the rows).
  used:=(public.billing_usage(p_business)->>p_resource)::bigint
   +COALESCE((SELECT sum(units) FROM public.billing_quota_reservations WHERE business_id=p_business AND resource=p_resource AND state IN('reserved','processing')),0);
 ELSE
  SELECT COALESCE(sum(units),0) INTO used FROM public.billing_quota_reservations WHERE business_id=p_business AND resource=p_resource AND period_start=period AND state IN('reserved','processing','committed');
 END IF;
 over:=lim IS NOT NULL AND used+p_units>lim;
 -- 0 means "not available" and is always hard; seats are always hard.
 IF over AND (policy<>'soft' OR lim=0 OR p_resource='users') THEN RAISE EXCEPTION 'billing_quota_reached';END IF;
 IF revive THEN
  UPDATE public.billing_quota_reservations SET state='reserved',reason=NULL,period_start=period,plan_version_id=(t->>'plan_version_id')::uuid,updated_at=now()
   WHERE business_id=p_business AND request_key=p_key RETURNING * INTO r;
 ELSE
  INSERT INTO public.billing_quota_reservations(business_id,request_key,actor_user_id,resource,units,period_start,plan_version_id,intent)
   VALUES(p_business,p_key,p_actor,p_resource,p_units,period,(t->>'plan_version_id')::uuid,p_intent) RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r)||jsonb_build_object('is_replay',false,'revived',revive,'over_limit',over,'limit',lim,'used',used+p_units,'policy',policy);
END $$;
DELETE FROM public.billing_catalog_items WHERE kind='limit' AND key IN('accounts','bank_rows','mcp','ai_accountant','ai_extraction');
UPDATE public.billing_catalog_items SET label_i18n='{"en":"AI requests per month (incl. document recognition)","ru":"AI-запросы в месяц (включая распознавание)","id":"Permintaan AI per bulan (termasuk pengenalan)"}'
 WHERE kind='limit' AND key='ai';
ALTER TABLE public.billing_catalog_items DROP COLUMN definition_i18n, DROP COLUMN unit_i18n,
 DROP CONSTRAINT billing_catalog_items_counter_check,
 ADD CONSTRAINT billing_catalog_items_counter_check CHECK(counter IN('documents','ai','imports','users','transactions','storage_mb','integrations'));
ALTER TABLE public.billing_quota_reservations DROP CONSTRAINT billing_quota_reservations_resource_check,
 ADD CONSTRAINT billing_quota_reservations_resource_check
 CHECK(resource IN('documents','ai','imports','users','companies','transactions','storage_mb','integrations'));
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN('billing_usage','billing_terms_error','rpc_billing_quota') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
DELETE FROM public.billing_schema_versions WHERE version='20261018090000';
NOTIFY pgrst,'reload schema';
COMMIT;
