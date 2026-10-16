-- Down for 20261017120000_billing_enforcement. Restores the 20261017090000 definitions verbatim.
-- Fail-closed: explicit session confirmation, and refuses while reservations for the new resources exist.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_setting('cfo.confirm_down',true) IS DISTINCT FROM '20261017120000' THEN
  RAISE EXCEPTION 'billing_enforcement_down_not_confirmed: run SET cfo.confirm_down = ''20261017120000'' in this session first';
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_quota_reservations WHERE resource IN('transactions','storage_mb','integrations')) THEN
  RAISE EXCEPTION 'billing_enforcement_down_would_lose_usage';
 END IF;
END $$;
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
 FOR x IN SELECT f.key,f.value,c.module_status FROM jsonb_each(COALESCE(p->'features','{}')) f
   LEFT JOIN public.billing_catalog_items c ON c.kind='feature' AND c.key=f.key LOOP
  IF x.module_status IS NULL OR jsonb_typeof(x.value)<>'boolean' THEN RETURN 'billing_unknown_feature'; END IF;
  IF x.module_status='not_released' AND x.value='true'::jsonb THEN RETURN 'billing_feature_not_released'; END IF;
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
CREATE OR REPLACE FUNCTION public.billing_effective_terms(p_business uuid,p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v public.plan_versions; f jsonb; l jsonb; o record;
BEGIN
 SELECT * INTO v FROM public.plan_versions WHERE id=public.billing_effective_version(p_business,p_at);
 IF NOT FOUND THEN RETURN NULL; END IF;
 f:=v.features; l:=v.limits;
 FOR o IN SELECT kind,key,value FROM public.billing_overrides WHERE business_id=p_business AND kind IN('limit','feature')
   AND revoked_at IS NULL AND starts_at<=p_at AND (ends_at IS NULL OR ends_at>p_at) ORDER BY starts_at,id LOOP
  IF o.kind='limit' THEN l:=l||jsonb_build_object(o.key,o.value); ELSE f:=f||jsonb_build_object(o.key,o.value); END IF;
 END LOOP;
 RETURN jsonb_build_object('plan_version_id',v.id,'plan',v.plan,'features',f,'limits',l,'limit_policies',v.limit_policies);
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_quota(p_actor bigint,p_business uuid,p_key uuid,p_resource text,p_action text,p_units integer DEFAULT 1,p_reason text DEFAULT NULL,p_intent jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts;r public.billing_quota_reservations;t jsonb;lim bigint;used bigint;policy text;over boolean;
 period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"policy":"legacy"}'::jsonb;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE b.id=p_business AND b.status='active' AND m.user_id=p_actor AND m.status='active') THEN RAISE EXCEPTION 'billing_forbidden';END IF;
 IF p_key IS NULL OR p_units IS NULL OR p_units<1 OR p_resource NOT IN('documents','ai','imports','users','companies') OR p_action NOT IN('reserve','start','commit','release','abandon') THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 SELECT * INTO r FROM public.billing_quota_reservations WHERE business_id=p_business AND request_key=p_key;
 IF FOUND THEN
  IF r.actor_user_id<>p_actor OR r.resource<>p_resource OR r.units<>p_units OR(p_action='reserve' AND r.intent IS DISTINCT FROM p_intent) THEN RAISE EXCEPTION 'billing_command_conflict';END IF;
  IF p_action='reserve' THEN RETURN to_jsonb(r)||'{"is_replay":true}'::jsonb;END IF;
  IF p_action='start' THEN
   IF r.resource<>'documents' OR r.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'billing_command_conflict';END IF;
   IF r.state='committed' THEN RETURN to_jsonb(r);END IF;
   IF r.state<>'reserved' THEN RAISE EXCEPTION 'billing_job_in_progress';END IF;
   UPDATE public.billing_quota_reservations SET state='processing',updated_at=now() WHERE business_id=p_business AND request_key=p_key RETURNING * INTO r;
   RETURN to_jsonb(r);
  END IF;
  IF p_action='abandon' THEN
   IF r.resource<>'documents' OR r.state='processing' THEN RAISE EXCEPTION 'billing_reservation_terminal';END IF;
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
 IF p_action<>'reserve' THEN RAISE EXCEPTION 'billing_reservation_not_found';END IF;
 t:=public.billing_effective_terms(p_business);
 IF t IS NULL THEN RAISE EXCEPTION 'billing_restricted';END IF;
 IF p_resource IN('documents','ai','imports') AND (t->'features'->>(CASE WHEN p_resource='imports' THEN 'import' ELSE p_resource END)) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'billing_feature_denied';END IF;
 lim:=(t->'limits'->>p_resource)::bigint;
 policy:=COALESCE(t->'limit_policies'->>p_resource,'hard');
 SELECT COALESCE(sum(units),0) INTO used FROM public.billing_quota_reservations WHERE business_id=p_business AND resource=p_resource AND period_start=period AND state IN('reserved','processing','committed');
 IF p_resource='users' THEN
  SELECT (SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active')+
   COALESCE((SELECT sum(greatest(COALESCE(max_uses,1)-uses_count,0)) FROM public.business_invites WHERE business_id=p_business AND status='active' AND expires_at>now()),0)+
   COALESCE((SELECT sum(units) FROM public.billing_quota_reservations WHERE business_id=p_business AND resource='users' AND state IN('reserved','processing')),0) INTO used;
 END IF;
 over:=lim IS NOT NULL AND used+p_units>lim;
 -- 0 means "not available" and is always hard; seats (users) are always hard.
 IF over AND (policy<>'soft' OR lim=0 OR p_resource='users') THEN RAISE EXCEPTION 'billing_quota_reached';END IF;
 INSERT INTO public.billing_quota_reservations(business_id,request_key,actor_user_id,resource,units,period_start,plan_version_id,intent)
  VALUES(p_business,p_key,p_actor,p_resource,p_units,period,(t->>'plan_version_id')::uuid,p_intent) RETURNING * INTO r;
 RETURN to_jsonb(r)||jsonb_build_object('is_replay',false,'over_limit',over,'limit',lim,'used',used+p_units,'policy',policy);
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_snapshot(p_actor bigint,p_business uuid,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts;b public.businesses;catalog jsonb;terms jsonb;grants jsonb;periods jsonb;usage jsonb;history jsonb;overrides jsonb;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' AND status='active';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE business_id=p_business AND user_id=p_actor AND status='active') THEN RAISE EXCEPTION 'billing_forbidden';END IF;
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business;
 IF NOT FOUND THEN RETURN jsonb_build_object('policy','legacy','business_id',b.id,'server_now',now());END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(v)||jsonb_build_object('recommended',p.recommended,'display_order',p.display_order) ORDER BY p.display_order,v.price_minor,v.plan),'[]') INTO catalog
  FROM public.plan_versions v JOIN public.plan_limits p ON p.current_version_id=v.id
  WHERE p.commercial_available AND p.archived_at IS NULL AND v.effective_at<=now()
   AND (v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture'));
 SELECT COALESCE(jsonb_agg(to_jsonb(g)),'[]') INTO grants FROM public.billing_grants g WHERE business_id=p_business;
 SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') INTO periods FROM public.billing_service_periods s WHERE business_id=p_business;
 SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.created_at),'[]') INTO overrides FROM public.billing_overrides o WHERE business_id=p_business;
 SELECT COALESCE(jsonb_agg(to_jsonb(v)),'[]') INTO terms FROM public.plan_versions v WHERE v.id IN(a.selected_plan_version_id,a.scheduled_plan_version_id,public.billing_effective_version(p_business))
  OR v.id IN(SELECT plan_version_id FROM public.billing_grants WHERE business_id=p_business)
  OR v.id IN(SELECT plan_version_id FROM public.billing_service_periods WHERE business_id=p_business);
 SELECT COALESCE(jsonb_object_agg(resource,used),'{}') INTO usage FROM(
  SELECT resource,sum(units) AS used FROM public.billing_quota_reservations WHERE business_id=p_business AND state IN('reserved','processing','committed')
   AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date GROUP BY resource) u;
 usage:=usage||jsonb_build_object('companies',1,'users',(SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active'));
 SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC),'[]') INTO history FROM(
  SELECT action,created_at,intent,result FROM public.billing_admin_commands WHERE business_id=p_business ORDER BY created_at DESC LIMIT 30)x;
 RETURN to_jsonb(a)||jsonb_build_object('policy','commercial_v2','server_now',now(),'catalog',catalog,'plan_versions',terms,
  'grants',grants,'service_periods',periods,'overrides',overrides,'usage',usage,'history',history);
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_admin_rows()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('server_now',now(),
  'companies',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'billing_policy',b.billing_policy,'created_at',b.created_at,
    'business',jsonb_build_object('id',b.id,'trial_started_at',b.trial_started_at,'trial_ends_at',b.trial_ends_at,'plan',b.plan,'subscription_status',b.subscription_status,
     'admin_override_plan',b.admin_override_plan,'override_started_at',b.override_started_at,'override_ends_at',b.override_ends_at,'billing_policy',b.billing_policy),
    'account',to_jsonb(a)) ORDER BY b.created_at DESC),'[]')
   FROM public.businesses b LEFT JOIN public.billing_accounts a ON a.business_id=b.id WHERE b.type='business' AND b.status='active'),
  'versions',(SELECT COALESCE(jsonb_agg(to_jsonb(v)),'[]') FROM public.plan_versions v),
  'grants',(SELECT COALESCE(jsonb_agg(to_jsonb(g)),'[]') FROM public.billing_grants g),
  'service_periods',(SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM public.billing_service_periods s),
  'overrides',(SELECT COALESCE(jsonb_agg(to_jsonb(o)),'[]') FROM public.billing_overrides o))
$$;
DROP FUNCTION public.billing_usage(uuid);
DROP FUNCTION public.billing_feature_defaults();
UPDATE public.billing_catalog_items SET enforcement='none',counter=NULL,reset_period='none' WHERE kind='limit' AND key IN('transactions','storage_mb','integrations');
UPDATE public.billing_catalog_items SET enforcement='none' WHERE kind='feature' AND key IN('pulse','export','radar','transactions','accounts','bills','cfo_ai','ai_accountant','tax_compliance','accounting_export','approvals','integrations');
UPDATE public.billing_catalog_items SET module_status='not_released',enforcement='none' WHERE kind='feature' AND key='api';
ALTER TABLE public.billing_catalog_items DROP COLUMN absent_allows,
 DROP CONSTRAINT billing_catalog_items_counter_check,
 ADD CONSTRAINT billing_catalog_items_counter_check CHECK(counter IN('documents','ai','imports','users')),
 DROP CONSTRAINT billing_catalog_items_enforcement_check,
 ADD CONSTRAINT billing_catalog_items_enforcement_check CHECK(enforcement IN('server','none'));
ALTER TABLE public.billing_quota_reservations DROP CONSTRAINT billing_quota_reservations_resource_check,
 ADD CONSTRAINT billing_quota_reservations_resource_check CHECK(resource IN('documents','ai','imports','users','companies'));
DELETE FROM public.billing_schema_versions WHERE version='20261017120000';
NOTIFY pgrst,'reload schema';
COMMIT;
