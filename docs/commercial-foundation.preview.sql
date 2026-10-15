-- DEVELOPMENT PREVIEW, not an applied migration. Test only on a separately restored DB.
-- Business + Platform; no customer ledger mutations; existing businesses remain legacy.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.plan_limits
 ADD COLUMN commercial_available boolean NOT NULL DEFAULT false,
 ADD COLUMN catalog_version bigint NOT NULL DEFAULT 1,
 ADD COLUMN current_version_id uuid;

CREATE FUNCTION public.billing_terms_complete(p_features jsonb,p_limits jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_typeof(p_features)='object' AND jsonb_typeof(p_limits)='object'
 AND p_features ?& ARRAY['documents','ai','import','payroll','team','approvals','export','integrations']
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_features) x WHERE jsonb_typeof(x.value)<>'boolean')
 AND p_limits ?& ARRAY['users','companies','documents','ai','imports']
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_limits) x WHERE
   x.value<>'null'::jsonb AND (jsonb_typeof(x.value)<>'number' OR x.value::text !~ '^[0-9]+$'))
$$;
CREATE TABLE public.plan_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan text NOT NULL REFERENCES public.plan_limits(plan) ON DELETE RESTRICT,
 version bigint NOT NULL CHECK(version>0),
 name_i18n jsonb NOT NULL CHECK(jsonb_typeof(name_i18n)='object' AND name_i18n ?& ARRAY['en','ru','id']),
 description_i18n jsonb NOT NULL CHECK(jsonb_typeof(description_i18n)='object' AND description_i18n ?& ARRAY['en','ru','id']),
 price_minor bigint NOT NULL CHECK(price_minor>=0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 billing_interval text NOT NULL CHECK(billing_interval='month'),
 features jsonb NOT NULL DEFAULT '{}', limits jsonb NOT NULL DEFAULT '{}',
 terms_version text NOT NULL CHECK(length(trim(terms_version))>0),
 approval_status text NOT NULL CHECK(approval_status IN('draft','staging_fixture','approved')),
 fixture_label text,
 effective_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan,version), UNIQUE(id,plan),
 CHECK(approval_status='draft' OR public.billing_terms_complete(features,limits)),
 CHECK(approval_status<>'staging_fixture' OR (fixture_label IS NOT NULL AND length(trim(fixture_label))>0))
);
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_current_version_fkey
 FOREIGN KEY(current_version_id,plan) REFERENCES public.plan_versions(id,plan) ON DELETE RESTRICT;
CREATE FUNCTION public.billing_immutable_terms() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION 'billing_terms_immutable'; END $$;
CREATE TRIGGER billing_terms_immutable BEFORE UPDATE OR DELETE ON public.plan_versions
 FOR EACH ROW EXECUTE FUNCTION public.billing_immutable_terms();

ALTER TABLE public.businesses ADD COLUMN billing_policy text NOT NULL DEFAULT 'legacy'
 CHECK(billing_policy IN('legacy','commercial_v2'));
ALTER TABLE public.businesses ALTER COLUMN billing_policy SET DEFAULT 'commercial_v2';

CREATE TABLE public.billing_accounts (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE RESTRICT,
 selected_plan_version_id uuid REFERENCES public.plan_versions(id) ON DELETE RESTRICT,
 trial_started_at timestamptz, trial_ends_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 environment text NOT NULL DEFAULT 'sandbox' CHECK(environment IN('sandbox','live')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((trial_started_at IS NULL)=(trial_ends_at IS NULL)),
 CHECK(trial_ends_at IS NULL OR trial_ends_at>trial_started_at)
);
CREATE TABLE public.billing_commands (
 business_id uuid NOT NULL REFERENCES public.billing_accounts(business_id) ON DELETE RESTRICT,
 actor_user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 command text NOT NULL, intent jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,actor_user_id,request_key)
);
CREATE TABLE public.billing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.billing_accounts(business_id) ON DELETE RESTRICT,
 event_key text NOT NULL, event_type text NOT NULL, actor_user_id bigint REFERENCES public.users(id),
 payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,event_key)
);

CREATE FUNCTION public.billing_new_business_policy() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public AS $$
 BEGIN
  IF NEW.type='business' AND NEW.billing_policy='commercial_v2' THEN
   NEW.trial_started_at:=NULL; NEW.trial_ends_at:=NULL;
   NEW.trial_status:='none'; NEW.subscription_status:='not_started'; NEW.plan:='free';
  END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER billing_new_business_policy BEFORE INSERT ON public.businesses
 FOR EACH ROW EXECUTE FUNCTION public.billing_new_business_policy();
CREATE FUNCTION public.billing_new_business_account() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,public AS $$
 BEGIN
  IF NEW.type='business' AND NEW.billing_policy='commercial_v2' THEN
   INSERT INTO public.billing_accounts(business_id) VALUES(NEW.id);
   INSERT INTO public.billing_events(business_id,event_key,event_type,actor_user_id)
    VALUES(NEW.id,'company_created','company_created',NEW.owner_user_id);
  END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER billing_new_business_account AFTER INSERT ON public.businesses
 FOR EACH ROW EXECUTE FUNCTION public.billing_new_business_account();

CREATE FUNCTION public.rpc_billing_trial_command(p_actor bigint,p_business uuid,p_key uuid,
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

CREATE FUNCTION public.rpc_billing_snapshot(p_actor bigint,p_business uuid,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts; b public.businesses; answer jsonb; catalog jsonb; terms jsonb;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' AND status='active';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE business_id=p_business
  AND user_id=p_actor AND status='active') THEN RAISE EXCEPTION 'billing_forbidden'; END IF;
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business;
 IF NOT FOUND THEN RETURN jsonb_build_object('policy','legacy','business_id',b.id); END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.price_minor),'[]') INTO catalog
  FROM public.plan_versions v JOIN public.plan_limits p ON p.current_version_id=v.id
  WHERE p.commercial_available AND v.effective_at<=now()
   AND (v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture'));
 SELECT COALESCE(jsonb_agg(to_jsonb(v)),'[]') INTO terms FROM public.plan_versions v WHERE v.id=a.selected_plan_version_id;
 RETURN to_jsonb(a)||jsonb_build_object('policy','commercial_v2','server_now',now(),
  'catalog',catalog,'plan_versions',terms);
END $$;
CREATE FUNCTION public.rpc_billing_command_receipt(p_actor bigint,p_business uuid,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE answer jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id
  WHERE b.id=p_business AND b.type='business' AND b.status='active' AND m.user_id=p_actor AND m.status='active')
 THEN RAISE EXCEPTION 'billing_forbidden'; END IF;
 SELECT result INTO answer FROM public.billing_commands WHERE business_id=p_business AND actor_user_id=p_actor AND request_key=p_key;
 RETURN CASE WHEN FOUND THEN jsonb_build_object('state','completed','result',answer)
  ELSE jsonb_build_object('state','not_found','safe_replay_same_key',true) END;
END $$;

-- Public Data API has no direct access. Existing application identity is BIGINT,
-- not Supabase auth.uid(); membership is checked inside the trusted server RPC.
ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_versions,public.billing_accounts,public.billing_commands,public.billing_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.plan_versions,public.billing_commands,public.billing_events TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.billing_accounts TO service_role;
REVOKE ALL ON FUNCTION public.billing_terms_complete(jsonb,jsonb),public.billing_immutable_terms(),
 public.billing_new_business_policy(),public.billing_new_business_account(),
 public.rpc_billing_trial_command(bigint,uuid,uuid,text,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rpc_billing_snapshot(bigint,uuid,boolean),public.rpc_billing_command_receipt(bigint,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_terms_complete(jsonb,jsonb),public.billing_immutable_terms(),
 public.billing_new_business_policy(),public.billing_new_business_account(),
 public.rpc_billing_trial_command(bigint,uuid,uuid,text,uuid,bigint,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_billing_snapshot(bigint,uuid,boolean),public.rpc_billing_command_receipt(bigint,uuid,uuid) TO service_role;
COMMIT;
