-- Combined into the final migration; technical bounds protect exact quota arithmetic.
CREATE OR REPLACE FUNCTION public.billing_terms_complete(p_features jsonb,p_limits jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_typeof(p_features)='object' AND jsonb_typeof(p_limits)='object'
 AND p_features ?& ARRAY['documents','ai','import','payroll','team','approvals','export','integrations']
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_features) x WHERE jsonb_typeof(x.value)<>'boolean')
 AND p_limits ?& ARRAY['users','companies','documents','ai','imports']
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_limits) x WHERE x.value<>'null'::jsonb AND
 CASE WHEN jsonb_typeof(x.value)='number' AND x.value::text ~ '^[0-9]+$' THEN x.value::text::numeric>9007199254740991 ELSE true END)
$$;
-- Combined into the final migration after the reviewed foundation, before COMMIT.
ALTER TABLE public.billing_accounts ADD COLUMN scheduled_plan_version_id uuid REFERENCES public.plan_versions(id),
 ADD COLUMN scheduled_at timestamptz, ADD COLUMN trial_extension jsonb,ADD COLUMN legacy_fallback boolean NOT NULL DEFAULT false;
CREATE TABLE public.billing_service_periods(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.billing_accounts(business_id),
 plan_version_id uuid NOT NULL REFERENCES public.plan_versions(id),payment_id text NOT NULL UNIQUE,
 payment_verified boolean NOT NULL DEFAULT false,environment text NOT NULL CHECK(environment IN('sandbox','live')),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,revoked_at timestamptz,CHECK(ends_at>starts_at));
-- No API writes service periods in the trial/admin release. Payment integration is OFF.
CREATE TABLE public.billing_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES public.billing_accounts(business_id),
 plan_version_id uuid NOT NULL REFERENCES public.plan_versions(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=5),audit_id uuid NOT NULL,revoked_at timestamptz,CHECK(ends_at>starts_at));
CREATE TABLE public.billing_admin_commands(
 id uuid PRIMARY KEY,actor_user_id bigint NOT NULL REFERENCES public.users(id),request_key uuid NOT NULL,
 business_id uuid REFERENCES public.businesses(id),action text NOT NULL,intent jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_user_id,request_key));
CREATE TABLE public.billing_quota_reservations(
 business_id uuid NOT NULL REFERENCES public.billing_accounts(business_id),request_key uuid NOT NULL,
 actor_user_id bigint NOT NULL REFERENCES public.users(id),resource text NOT NULL CHECK(resource IN('documents','ai','imports','users','companies')),
 units integer NOT NULL CHECK(units>0),period_start date NOT NULL,plan_version_id uuid NOT NULL REFERENCES public.plan_versions(id),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','processing','committed','released')),
 reason text,intent jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,request_key));

CREATE FUNCTION public.billing_effective_version(p_business uuid,p_at timestamptz DEFAULT now())
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(
 (SELECT plan_version_id FROM billing_grants WHERE business_id=p_business AND revoked_at IS NULL AND starts_at<=p_at AND ends_at>p_at ORDER BY starts_at DESC,id LIMIT 1),
 (SELECT plan_version_id FROM billing_service_periods s JOIN billing_accounts a USING(business_id)
  WHERE business_id=p_business AND payment_verified AND payment_id IS NOT NULL AND s.environment=a.environment
   AND revoked_at IS NULL AND starts_at<=p_at AND ends_at>p_at ORDER BY starts_at DESC,s.id LIMIT 1),
 (SELECT CASE WHEN scheduled_at<=p_at THEN scheduled_plan_version_id ELSE selected_plan_version_id END FROM billing_accounts WHERE business_id=p_business AND trial_started_at<=p_at AND trial_ends_at>p_at))
$$;

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

CREATE FUNCTION public.rpc_billing_catalog_command(p_actor bigint,p_key uuid,p_code text,p_expected bigint,p_payload jsonb)
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

CREATE FUNCTION public.rpc_billing_admin_command(p_actor bigint,p_key uuid,p_business uuid,p_expected bigint,p_action text,p_payload jsonb,p_allow_fixture boolean DEFAULT false)
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

CREATE FUNCTION public.rpc_billing_quota(p_actor bigint,p_business uuid,p_key uuid,p_resource text,p_action text,p_units integer DEFAULT 1,p_reason text DEFAULT NULL,p_intent jsonb DEFAULT '{}')
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

DO $$ DECLARE t text;f record; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_service_periods','billing_grants','billing_admin_commands','billing_quota_reservations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('billing_effective_version','rpc_billing_snapshot','rpc_billing_catalog_command','rpc_billing_admin_command','rpc_billing_quota') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
-- Immutable commercial history, including audit and provider-confirmed periods.
CREATE TRIGGER billing_audit_immutable BEFORE UPDATE OR DELETE ON billing_admin_commands FOR EACH ROW EXECUTE FUNCTION billing_immutable_terms();
REVOKE UPDATE ON billing_service_periods,billing_admin_commands FROM service_role;

-- Owner-approved prices, UNAPPROVED capacities: drafts cannot be activated.
CREATE FUNCTION public.rpc_create_business_commercial_once(p_actor bigint,p_request_key uuid,p_intent jsonb,p_categories jsonb)
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
GRANT UPDATE(result) ON public.business_creation_requests TO service_role;
INSERT INTO plan_limits(plan)VALUES('starter'),('control'),('pro')ON CONFLICT DO NOTHING;
INSERT INTO plan_versions(plan,version,name_i18n,description_i18n,price_minor,currency,billing_interval,features,limits,terms_version,approval_status,effective_at)
SELECT code,1,jsonb_build_object('en',label,'ru',label,'id',label),
 jsonb_build_object('en','Commercial limits pending approval','ru','Коммерческие лимиты ожидают утверждения','id','Batas komersial menunggu persetujuan'),
 price,'USD','month','{}','{}','unapproved-v1','draft',now()
FROM(VALUES('starter','Starter',5900),('control','Control',14900),('pro','Pro',29900))s(code,label,price)
WHERE NOT EXISTS(SELECT 1 FROM plan_versions WHERE plan=s.code);
UPDATE plan_limits p SET current_version_id=v.id FROM plan_versions v WHERE p.plan=v.plan AND v.version=1 AND p.current_version_id IS NULL;
