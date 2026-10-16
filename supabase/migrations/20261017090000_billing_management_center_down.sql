-- Down for 20261017090000_billing_management_center. Restores the 20261015033808 definitions verbatim.
-- Fail-closed: requires an explicit session confirmation and refuses while data that the old schema cannot
-- represent exists (overrides, non-168h trials, soft policies, annual prices, plans beyond the original three).
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_setting('cfo.confirm_down',true) IS DISTINCT FROM '20261017090000' THEN
  RAISE EXCEPTION 'billing_center_down_not_confirmed: run SET cfo.confirm_down = ''20261017090000'' in this session first';
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_overrides) OR EXISTS(SELECT 1 FROM public.billing_accounts WHERE trial_hours IS DISTINCT FROM NULL AND trial_hours<>168)
  OR EXISTS(SELECT 1 FROM public.plan_versions WHERE trial_hours<>168 OR limit_policies<>'{}'::jsonb OR price_annual_minor IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.plan_versions WHERE plan NOT IN('starter','control','pro')) THEN
  RAISE EXCEPTION 'billing_center_down_would_lose_terms';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_trial_command(p_actor bigint,p_business uuid,p_key uuid,
 p_command text,p_plan_version uuid,p_expected_version bigint,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts; v public.plan_versions; receipt public.billing_commands;
 intent jsonb; answer jsonb; clock timestamptz; available boolean;
BEGIN
 IF p_actor IS NULL OR p_key IS NULL OR p_business IS NULL OR p_command IS NULL OR p_command NOT IN('select_plan','activate_trial')
 THEN RAISE EXCEPTION 'billing_invalid_command'; END IF;
 -- Account lock is the one serialization point for trial and later payment commands.
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_not_enrolled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id
  WHERE b.id=p_business AND b.type='business' AND b.status='active' AND m.user_id=p_actor AND m.role='owner' AND m.status='active')
 THEN RAISE EXCEPTION 'billing_forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_email_identities WHERE user_id=p_actor AND email_verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'billing_email_verification_required'; END IF;
 IF to_jsonb(a)->>'legacy_fallback'='true' THEN RAISE EXCEPTION 'billing_legacy_trial_disabled';END IF;
 intent:=jsonb_build_object('plan_version',p_plan_version,'expected_version',p_expected_version);
 SELECT * INTO receipt FROM public.billing_commands WHERE business_id=p_business AND actor_user_id=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF receipt.command<>p_command OR receipt.intent IS DISTINCT FROM intent THEN RAISE EXCEPTION 'billing_command_conflict'; END IF;
  RETURN receipt.result||jsonb_build_object('is_replay',true);
 END IF;
 IF p_command='activate_trial' AND a.trial_started_at IS NOT NULL THEN
  -- A second tab/key cannot restart or extend trial. Current terms stay unchanged.
  answer:=to_jsonb(a)||jsonb_build_object('is_replay',false,'already_started',true);
 ELSE
  IF p_expected_version IS NULL OR p_expected_version<>a.version THEN RAISE EXCEPTION 'billing_stale'; END IF;
  SELECT * INTO v FROM public.plan_versions WHERE id=p_plan_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_plan_not_found'; END IF;
  SELECT commercial_available INTO available FROM public.plan_limits WHERE plan=v.plan;
  IF p_command='select_plan' AND NOT EXISTS(SELECT 1 FROM public.plan_limits WHERE plan=v.plan AND current_version_id=v.id) THEN RAISE EXCEPTION 'billing_plan_not_approved';END IF;
  IF NOT available OR v.effective_at>clock_timestamp() OR NOT public.billing_terms_complete(v.features,v.limits)
   OR NOT(v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture'))
  THEN RAISE EXCEPTION 'billing_plan_not_approved'; END IF;
  IF p_command='activate_trial' AND a.selected_plan_version_id IS DISTINCT FROM p_plan_version
  THEN RAISE EXCEPTION 'billing_select_plan_first'; END IF;
  clock:=clock_timestamp();
  UPDATE public.billing_accounts SET selected_plan_version_id=v.id,version=version+1,
   trial_started_at=CASE WHEN p_command='activate_trial' THEN clock ELSE trial_started_at END,
   trial_ends_at=CASE WHEN p_command='activate_trial' THEN clock+interval '168 hours' ELSE trial_ends_at END
   WHERE business_id=p_business RETURNING * INTO a;
  INSERT INTO public.billing_events(business_id,event_key,event_type,actor_user_id,payload)
   VALUES(p_business,p_key::text,CASE WHEN p_command='activate_trial' THEN 'trial_activated' ELSE 'plan_selected' END,
    p_actor,jsonb_build_object('plan_version_id',v.id,'account_version',a.version));
  answer:=to_jsonb(a)||jsonb_build_object('is_replay',false,'already_started',false);
 END IF;
 INSERT INTO public.billing_commands(business_id,actor_user_id,request_key,command,intent,result)
  VALUES(p_business,p_actor,p_key,p_command,intent,answer);
 RETURN answer;
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_snapshot(p_actor bigint,p_business uuid,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a billing_accounts;b businesses;catalog jsonb;terms jsonb;grants jsonb;periods jsonb;usage jsonb;history jsonb;
BEGIN
 SELECT * INTO b FROM businesses WHERE id=p_business AND type='business' AND status='active';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM business_members WHERE business_id=p_business AND user_id=p_actor AND status='active') THEN RAISE EXCEPTION 'billing_forbidden';END IF;
 SELECT * INTO a FROM billing_accounts WHERE business_id=p_business;
 IF NOT FOUND THEN RETURN jsonb_build_object('policy','legacy','business_id',b.id,'server_now',now());END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.price_minor),'[]') INTO catalog FROM plan_versions v JOIN plan_limits p ON p.current_version_id=v.id
 WHERE p.commercial_available AND v.effective_at<=now() AND (v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture'));
 SELECT COALESCE(jsonb_agg(to_jsonb(g)),'[]') INTO grants FROM billing_grants g WHERE business_id=p_business;
 SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') INTO periods FROM billing_service_periods s WHERE business_id=p_business;
 SELECT COALESCE(jsonb_agg(to_jsonb(v)),'[]') INTO terms FROM plan_versions v WHERE v.id IN(a.selected_plan_version_id,a.scheduled_plan_version_id,public.billing_effective_version(p_business))
 OR v.id IN(SELECT plan_version_id FROM billing_grants WHERE business_id=p_business)
 OR v.id IN(SELECT plan_version_id FROM billing_service_periods WHERE business_id=p_business);
 SELECT COALESCE(jsonb_object_agg(resource,used),'{}') INTO usage FROM(
  SELECT resource,sum(units) AS used FROM billing_quota_reservations WHERE business_id=p_business AND state IN('reserved','processing','committed')
   AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date GROUP BY resource) u;
 usage:=usage||jsonb_build_object('companies',1,'users',(SELECT count(*)FROM business_members WHERE business_id=p_business AND status='active'));
 SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC),'[]') INTO history FROM(
  SELECT action,created_at,intent,result FROM billing_admin_commands WHERE business_id=p_business ORDER BY created_at DESC LIMIT 30)x;
 RETURN to_jsonb(a)||jsonb_build_object('policy','commercial_v2','server_now',now(),'catalog',catalog,'plan_versions',terms,
  'grants',grants,'service_periods',periods,'usage',usage,'history',history);
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_catalog_command(p_actor bigint,p_key uuid,p_code text,p_expected bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE p plan_limits;v plan_versions;r billing_admin_commands;answer jsonb;cid uuid:=gen_random_uuid();intent jsonb;
BEGIN
 IF p_code NOT IN('starter','control','pro') OR p_key IS NULL OR p_actor IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cfo-billing-catalog'));
 intent:=jsonb_build_object('code',p_code,'expected',p_expected,'payload',p_payload);
 SELECT * INTO r FROM billing_admin_commands WHERE actor_user_id=p_actor AND request_key=p_key;
 IF FOUND THEN IF r.action<>'catalog' OR r.intent<>intent THEN RAISE EXCEPTION 'billing_command_conflict';END IF;RETURN r.result||'{"is_replay":true}'::jsonb;END IF;
 SELECT * INTO p FROM plan_limits WHERE plan=p_code FOR UPDATE;
 IF NOT FOUND THEN
  IF p_expected IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'billing_stale';END IF;
  INSERT INTO plan_limits(plan,catalog_version)VALUES(p_code,1) RETURNING * INTO p;
 ELSE IF p_expected IS DISTINCT FROM p.catalog_version THEN RAISE EXCEPTION 'billing_stale';END IF;END IF;
 IF p_payload->>'action'='archive' THEN
  UPDATE plan_limits SET commercial_available=false,catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
 ELSE
  IF (p_payload-'action'-'name_i18n'-'description_i18n'-'price_minor'-'currency'-'features'-'limits'-'terms_version'-'effective_at'-'approval_status'-'fixture_label'-'publish')<>'{}'::jsonb
   OR COALESCE(p_payload->>'price_minor','') !~ '^[0-9]+$' OR (p_payload->>'price_minor')::numeric>9007199254740991
   OR COALESCE(p_payload->>'approval_status','') NOT IN('draft','approved','staging_fixture')
   OR (p_payload->>'approval_status'<>'draft' AND NOT billing_terms_complete(p_payload->'features',p_payload->'limits'))
   OR (COALESCE((p_payload->>'publish')::boolean,false) AND p_payload->>'approval_status'='draft')
  THEN RAISE EXCEPTION 'billing_invalid_terms';END IF;
  INSERT INTO plan_versions(plan,version,name_i18n,description_i18n,price_minor,currency,billing_interval,features,limits,terms_version,approval_status,fixture_label,effective_at)
  VALUES(p_code,COALESCE((SELECT max(version)+1 FROM plan_versions WHERE plan=p_code),1),p_payload->'name_i18n',p_payload->'description_i18n',(p_payload->>'price_minor')::bigint,
   p_payload->>'currency','month',COALESCE(p_payload->'features','{}'),COALESCE(p_payload->'limits','{}'),p_payload->>'terms_version',p_payload->>'approval_status',p_payload->>'fixture_label',(p_payload->>'effective_at')::timestamptz)RETURNING * INTO v;
  UPDATE plan_limits SET current_version_id=v.id,commercial_available=COALESCE((p_payload->>'publish')::boolean,false),catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
 END IF;
 answer:=jsonb_build_object('plan',to_jsonb(p),'terms',to_jsonb(v),'is_replay',false);
 INSERT INTO billing_admin_commands(id,actor_user_id,request_key,action,intent,result)VALUES(cid,p_actor,p_key,'catalog',intent,answer);
 RETURN answer;
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_admin_command(p_actor bigint,p_key uuid,p_business uuid,p_expected bigint,p_action text,p_payload jsonb,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a billing_accounts;v plan_versions;r billing_admin_commands;answer jsonb;intent jsonb;cid uuid:=gen_random_uuid();old jsonb;deadline timestamptz;starts timestamptz;reason text;
BEGIN
 IF p_actor IS NULL OR p_key IS NULL OR p_action NOT IN('assign','schedule','grant','revoke','extend') OR p_action IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 -- Explicit admin action can overlay legacy access; expiration falls back to its
 -- old access policy instead of turning existing companies into expired accounts.
 INSERT INTO billing_accounts(business_id,legacy_fallback) SELECT id,true FROM businesses WHERE id=p_business AND type='business' AND billing_policy='legacy' ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_not_enrolled';END IF;
 intent:=jsonb_build_object('business_id',p_business,'expected',p_expected,'action',p_action,'payload',p_payload);
 SELECT * INTO r FROM billing_admin_commands WHERE actor_user_id=p_actor AND request_key=p_key;
 IF FOUND THEN IF r.intent<>intent OR r.action<>p_action THEN RAISE EXCEPTION 'billing_command_conflict';END IF;RETURN r.result||'{"is_replay":true}'::jsonb;END IF;
 IF p_expected IS NULL OR p_expected<>a.version THEN RAISE EXCEPTION 'billing_stale';END IF;
 reason:=trim(p_payload->>'reason');IF reason IS NULL OR length(reason)<5 OR length(reason)>2000 THEN RAISE EXCEPTION 'billing_reason_required';END IF;
 old:=to_jsonb(a);
 IF p_action IN('assign','schedule','grant') THEN
  SELECT * INTO v FROM plan_versions WHERE id=(p_payload->>'plan_version_id')::uuid;
  IF NOT FOUND OR v.effective_at>now() OR NOT billing_terms_complete(v.features,v.limits)
   OR NOT(v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture')) THEN RAISE EXCEPTION 'billing_plan_not_approved';END IF;
 END IF;
 IF p_action='assign' THEN
  -- Changes trial selection only. Never creates paid access or a new trial.
  IF EXISTS(SELECT 1 FROM billing_service_periods WHERE business_id=p_business AND revoked_at IS NULL AND payment_verified AND ends_at>now()) THEN RAISE EXCEPTION 'billing_schedule_required';END IF;
  UPDATE billing_accounts SET selected_plan_version_id=v.id,scheduled_plan_version_id=NULL,scheduled_at=NULL WHERE business_id=p_business;
 ELSIF p_action='schedule' THEN
  deadline:=(p_payload->>'effective_at')::timestamptz;
  IF deadline IS NULL OR deadline<=now() THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  IF deadline<(SELECT max(ends_at) FROM billing_service_periods WHERE business_id=p_business AND revoked_at IS NULL AND payment_verified AND ends_at>now()) THEN RAISE EXCEPTION 'billing_schedule_required';END IF;
  UPDATE billing_accounts SET scheduled_plan_version_id=v.id,scheduled_at=deadline WHERE business_id=p_business;
 ELSIF p_action='grant' THEN
  starts:=COALESCE((p_payload->>'starts_at')::timestamptz,now());deadline:=(p_payload->>'ends_at')::timestamptz;
  IF deadline IS NULL OR deadline<=starts OR deadline<=now() THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  IF EXISTS(SELECT 1 FROM billing_grants WHERE business_id=p_business AND revoked_at IS NULL AND starts_at<deadline AND ends_at>starts) THEN RAISE EXCEPTION 'billing_grant_overlap';END IF;
  INSERT INTO billing_grants(business_id,plan_version_id,starts_at,ends_at,reason,audit_id)VALUES(p_business,v.id,starts,deadline,reason,cid);
 ELSIF p_action='revoke' THEN
  UPDATE billing_grants SET revoked_at=now() WHERE business_id=p_business AND id=(p_payload->>'grant_id')::uuid AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_grant_not_found';END IF;
 ELSE
  deadline:=(p_payload->>'ends_at')::timestamptz;
  IF a.trial_started_at IS NULL OR deadline IS NULL OR deadline<=a.trial_ends_at OR deadline<=now() THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  UPDATE billing_accounts SET trial_ends_at=deadline,trial_extension=jsonb_build_object('audit_id',cid,'reason',reason,'before',a.trial_ends_at,'after',deadline)WHERE business_id=p_business;
 END IF;
 UPDATE billing_accounts SET version=version+1 WHERE business_id=p_business RETURNING * INTO a;
 answer:=jsonb_build_object('before',old,'after',to_jsonb(a),'reason',reason,'audit_id',cid,'is_replay',false);
 INSERT INTO billing_admin_commands(id,actor_user_id,request_key,business_id,action,intent,result)VALUES(cid,p_actor,p_key,p_business,p_action,intent,answer);
 RETURN answer;
END $$;
CREATE OR REPLACE FUNCTION public.rpc_billing_quota(p_actor bigint,p_business uuid,p_key uuid,p_resource text,p_action text,p_units integer DEFAULT 1,p_reason text DEFAULT NULL,p_intent jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a billing_accounts;r billing_quota_reservations;v plan_versions;lim bigint;used bigint;period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO a FROM billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"policy":"legacy"}'::jsonb;END IF;
 IF NOT EXISTS(SELECT 1 FROM business_members m JOIN businesses b ON b.id=m.business_id WHERE b.id=p_business AND b.status='active' AND m.user_id=p_actor AND m.status='active') THEN RAISE EXCEPTION 'billing_forbidden';END IF;
 IF p_key IS NULL OR p_units IS NULL OR p_units<1 OR p_resource NOT IN('documents','ai','imports','users','companies') OR p_action NOT IN('reserve','start','commit','release','abandon') THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 SELECT * INTO r FROM billing_quota_reservations WHERE business_id=p_business AND request_key=p_key;
 IF FOUND THEN
  IF r.actor_user_id<>p_actor OR r.resource<>p_resource OR r.units<>p_units OR(p_action='reserve' AND r.intent IS DISTINCT FROM p_intent) THEN RAISE EXCEPTION 'billing_command_conflict';END IF;
  IF p_action='reserve' THEN RETURN to_jsonb(r)||'{"is_replay":true}'::jsonb;END IF;
  IF p_action='start' THEN
   IF r.resource<>'documents' OR r.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'billing_command_conflict';END IF;
   IF r.state='committed' THEN RETURN to_jsonb(r);END IF;
   IF r.state<>'reserved' THEN RAISE EXCEPTION 'billing_job_in_progress';END IF;
   UPDATE billing_quota_reservations SET state='processing',updated_at=now()WHERE business_id=p_business AND request_key=p_key RETURNING * INTO r;
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
  UPDATE billing_quota_reservations SET state=CASE WHEN p_action='commit' THEN 'committed' ELSE 'released' END,reason=p_reason,updated_at=now()WHERE business_id=p_business AND request_key=p_key RETURNING * INTO r;
  RETURN to_jsonb(r);
 END IF;
 IF p_action<>'reserve' THEN RAISE EXCEPTION 'billing_reservation_not_found';END IF;
 SELECT * INTO v FROM plan_versions WHERE id=billing_effective_version(p_business);
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_restricted';END IF;
 IF p_resource IN('documents','ai','imports') AND (v.features->>(CASE WHEN p_resource='imports' THEN 'import' ELSE p_resource END)) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'billing_feature_denied';END IF;
 lim:=(v.limits->>p_resource)::bigint;
 SELECT COALESCE(sum(units),0) INTO used FROM billing_quota_reservations WHERE business_id=p_business AND resource=p_resource AND period_start=period AND state IN('reserved','processing','committed');
 IF p_resource='users' THEN
  SELECT (SELECT count(*) FROM business_members WHERE business_id=p_business AND status='active')+
   COALESCE((SELECT sum(greatest(COALESCE(max_uses,1)-uses_count,0)) FROM business_invites WHERE business_id=p_business AND status='active' AND expires_at>now()),0)+
   COALESCE((SELECT sum(units)FROM billing_quota_reservations WHERE business_id=p_business AND resource='users' AND state IN('reserved','processing')),0) INTO used;
 END IF;
 IF lim IS NOT NULL AND used+p_units>lim THEN RAISE EXCEPTION 'billing_quota_reached';END IF;
 INSERT INTO billing_quota_reservations(business_id,request_key,actor_user_id,resource,units,period_start,plan_version_id,intent)VALUES(p_business,p_key,p_actor,p_resource,p_units,period,v.id,p_intent)RETURNING * INTO r;
 RETURN to_jsonb(r)||'{"is_replay":false}'::jsonb;
END $$;
DROP FUNCTION public.rpc_billing_admin_rows();
DROP FUNCTION public.billing_effective_terms(uuid,timestamptz);
DROP FUNCTION public.billing_terms_error(jsonb,boolean);
DROP TABLE public.billing_overrides;
DROP TABLE public.billing_catalog_items;
ALTER TABLE public.billing_accounts DROP COLUMN trial_hours;
ALTER TABLE public.plan_limits DROP CONSTRAINT plan_limits_draft_version_fkey, DROP COLUMN draft_version_id, DROP COLUMN archived_at, DROP COLUMN recommended, DROP COLUMN display_order;
ALTER TABLE public.plan_versions DROP COLUMN limit_policies, DROP COLUMN trial_hours, DROP COLUMN price_annual_minor;
DELETE FROM public.billing_schema_versions WHERE version='20261017090000';
NOTIFY pgrst,'reload schema';
COMMIT;
