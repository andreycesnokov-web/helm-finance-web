-- Billing Management Center (Platform admin + Business). Additive on 20261015033808; no customer ledger access.
-- Adds: a feature/limit catalog that says what the server really enforces, unlimited plan codes, separate
-- draft/current versions (a draft never replaces published terms), annual price and per-version trial length
-- (existing versions keep 168h), hard/soft limit policies, customer overrides (limit / feature / discount)
-- applied on top of the effective plan, and admin commands for them. Payments stay disconnected.
-- Every name is schema-qualified: the migration must not depend on the session search_path.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_schema_versions WHERE version='20261015033808') THEN
  RAISE EXCEPTION 'billing_center_requires_20261015033808';
 END IF;
END $$;

-- ── Catalog of sellable features and measurable limits ───────────────────────────────────────
-- enforcement='server': the API refuses the workflow when the feature is off / the quota is spent.
-- enforcement='none': shown for planning only; a plan cannot claim to limit it (no backend counter).
CREATE TABLE public.billing_catalog_items(
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_]{1,39}$'),
 kind text NOT NULL CHECK(kind IN('feature','limit')),
 label_i18n jsonb NOT NULL CHECK(jsonb_typeof(label_i18n)='object' AND label_i18n ?& ARRAY['en','ru','id']),
 module_status text NOT NULL CHECK(module_status IN('released','beta','not_released')),
 enforcement text NOT NULL CHECK(enforcement IN('server','none')),
 counter text CHECK(counter IN('documents','ai','imports','users')),
 reset_period text NOT NULL DEFAULT 'none' CHECK(reset_period IN('month_utc','none')),
 required boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 100,
 CHECK(kind='feature' OR enforcement='none' OR counter IS NOT NULL),
 CHECK(kind='limit' OR counter IS NULL),
 PRIMARY KEY(kind,key) -- a feature and a limit may share a key (documents, ai)
);
INSERT INTO public.billing_catalog_items(key,kind,label_i18n,module_status,enforcement,counter,reset_period,required,sort_order)
SELECT k,kind,jsonb_build_object('en',en,'ru',ru,'id',idn),st,enf,cnt,rp,req,ord FROM (VALUES
 ('documents','feature','Documents','Документы','Dokumen','released','server',NULL,'none',true,10),
 ('ai','feature','AI (CFO AI, AI Accountant, document recognition)','AI (AI CFO, AI-бухгалтер, распознавание документов)','AI (AI CFO, AI Akuntan, pengenalan dokumen)','released','server',NULL,'none',true,20),
 ('import','feature','Bank statement import','Импорт банковских выписок','Impor mutasi bank','released','server',NULL,'none',true,30),
 ('payroll','feature','Payroll','Зарплаты','Penggajian','released','server',NULL,'none',true,40),
 ('team','feature','Team invitations','Приглашения в команду','Undangan tim','released','server',NULL,'none',true,50),
 ('approvals','feature','Approvals','Согласования','Persetujuan','released','none',NULL,'none',true,60),
 ('export','feature','Data export','Экспорт данных','Ekspor data','released','none',NULL,'none',true,70),
 ('integrations','feature','Integrations','Интеграции','Integrasi','beta','none',NULL,'none',true,80),
 ('pulse','feature','Pulse','Пульс','Pulse','released','none',NULL,'none',false,100),
 ('radar','feature','Radar','Радар','Radar','released','none',NULL,'none',false,110),
 ('transactions','feature','Transactions','Операции','Transaksi','released','none',NULL,'none',false,120),
 ('accounts','feature','Accounts','Счета','Rekening','released','none',NULL,'none',false,130),
 ('bills','feature','Invoices and bills','Счета к оплате и выставленные','Tagihan dan faktur','released','none',NULL,'none',false,140),
 ('cfo_ai','feature','CFO AI','AI CFO','CFO AI','released','none',NULL,'none',false,150),
 ('ai_accountant','feature','AI Accountant','AI-бухгалтер','AI Akuntan','beta','none',NULL,'none',false,160),
 ('tax_compliance','feature','Tax and compliance','Налоги и отчётность','Pajak dan kepatuhan','beta','none',NULL,'none',false,170),
 ('accounting_export','feature','Accounting export','Выгрузка для бухгалтерии','Ekspor akuntansi','beta','none',NULL,'none',false,180),
 ('api','feature','API','API','API','not_released','none',NULL,'none',false,190),
 ('users','limit','Users','Пользователи','Pengguna','released','server','users','none',true,10),
 ('companies','limit','Companies','Компании','Perusahaan','released','none',NULL,'none',true,20),
 ('documents','limit','Uploaded documents per month','Загрузки документов в месяц','Unggahan dokumen per bulan','released','server','documents','month_utc',true,30),
 ('ai','limit','AI requests per month (incl. document recognition)','AI-запросы в месяц (включая распознавание)','Permintaan AI per bulan (termasuk pengenalan)','released','server','ai','month_utc',true,40),
 ('imports','limit','Statement imports per month','Импорты выписок в месяц','Impor mutasi per bulan','released','server','imports','month_utc',true,50),
 ('transactions','limit','Transactions per period','Операции за период','Transaksi per periode','released','none',NULL,'none',false,60),
 ('storage_mb','limit','File storage (MB)','Хранилище файлов (МБ)','Penyimpanan file (MB)','released','none',NULL,'none',false,70),
 ('exports','limit','Data exports per month','Экспорты данных в месяц','Ekspor data per bulan','released','none',NULL,'none',false,80),
 ('integrations','limit','Connected integrations','Подключённые интеграции','Integrasi terhubung','beta','none',NULL,'none',false,90)
) s(k,kind,en,ru,idn,st,enf,cnt,rp,req,ord);

-- ── Versioned commercial terms (existing rows: monthly only, 168h trial, every limit hard) ──
ALTER TABLE public.plan_versions
 ADD COLUMN price_annual_minor bigint CHECK(price_annual_minor IS NULL OR price_annual_minor BETWEEN 0 AND 9007199254740991),
 ADD COLUMN trial_hours integer NOT NULL DEFAULT 168 CHECK(trial_hours BETWEEN 1 AND 2160),
 ADD COLUMN limit_policies jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(limit_policies)='object');
-- Mutable presentation of the plan head; terms stay in immutable versions.
ALTER TABLE public.plan_limits
 ADD COLUMN display_order integer NOT NULL DEFAULT 100,
 ADD COLUMN recommended boolean NOT NULL DEFAULT false,
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN draft_version_id uuid,
 ADD CONSTRAINT plan_limits_draft_version_fkey FOREIGN KEY(draft_version_id,plan) REFERENCES public.plan_versions(id,plan) ON DELETE RESTRICT;
-- Length of the trial actually granted, fixed at activation (NULL = activated before this migration = 168h).
ALTER TABLE public.billing_accounts ADD COLUMN trial_hours integer CHECK(trial_hours BETWEEN 1 AND 2160);

-- ── Customer overrides: individual commercial terms, separate from emergency admin grants ──
CREATE TABLE public.billing_overrides(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.billing_accounts(business_id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('limit','feature','discount')),
 key text,
 value jsonb NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 2000),
 approved_by bigint NOT NULL REFERENCES public.users(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz, revoked_at timestamptz,
 audit_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR ends_at>starts_at),
 CHECK((kind='discount')=(key IS NULL)),
 CHECK(kind<>'feature' OR jsonb_typeof(value)='boolean'),
 CHECK(kind<>'limit' OR value='null'::jsonb OR (jsonb_typeof(value)='number' AND value::text ~ '^[0-9]+$')),
 CHECK(kind<>'discount' OR (jsonb_typeof(value->'percent')='number' AND (value->>'percent')::numeric BETWEEN 1 AND 100))
);
CREATE INDEX billing_overrides_business_idx ON public.billing_overrides(business_id) WHERE revoked_at IS NULL;

-- ── Validation of proposed terms against the catalog ─────────────────────────────────────────
CREATE FUNCTION public.billing_terms_error(p jsonb,p_complete boolean)
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

-- ── Effective terms: base version (grant > verified paid period > trial) + active overrides ──
-- Overrides change terms only; they never create access for a company without an effective version.
CREATE FUNCTION public.billing_effective_terms(p_business uuid,p_at timestamptz DEFAULT now())
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

-- ── Trial: length comes from the selected version and is fixed on the account at activation ──
CREATE OR REPLACE FUNCTION public.rpc_billing_trial_command(p_actor bigint,p_business uuid,p_key uuid,
 p_command text,p_plan_version uuid,p_expected_version bigint,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts; v public.plan_versions; receipt public.billing_commands;
 intent jsonb; answer jsonb; clock timestamptz; available boolean;
BEGIN
 IF p_actor IS NULL OR p_key IS NULL OR p_business IS NULL OR p_command IS NULL OR p_command NOT IN('select_plan','activate_trial')
 THEN RAISE EXCEPTION 'billing_invalid_command'; END IF;
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_not_enrolled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_members m ON m.business_id=b.id
  WHERE b.id=p_business AND b.type='business' AND b.status='active' AND m.user_id=p_actor AND m.role='owner' AND m.status='active')
 THEN RAISE EXCEPTION 'billing_forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_email_identities WHERE user_id=p_actor AND email_verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'billing_email_verification_required'; END IF;
 IF a.legacy_fallback THEN RAISE EXCEPTION 'billing_legacy_trial_disabled';END IF;
 intent:=jsonb_build_object('plan_version',p_plan_version,'expected_version',p_expected_version);
 SELECT * INTO receipt FROM public.billing_commands WHERE business_id=p_business AND actor_user_id=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF receipt.command<>p_command OR receipt.intent IS DISTINCT FROM intent THEN RAISE EXCEPTION 'billing_command_conflict'; END IF;
  RETURN receipt.result||jsonb_build_object('is_replay',true);
 END IF;
 IF p_command='activate_trial' AND a.trial_started_at IS NOT NULL THEN
  answer:=to_jsonb(a)||jsonb_build_object('is_replay',false,'already_started',true);
 ELSE
  IF p_expected_version IS NULL OR p_expected_version<>a.version THEN RAISE EXCEPTION 'billing_stale'; END IF;
  SELECT * INTO v FROM public.plan_versions WHERE id=p_plan_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_plan_not_found'; END IF;
  SELECT commercial_available AND archived_at IS NULL INTO available FROM public.plan_limits WHERE plan=v.plan;
  IF p_command='select_plan' AND NOT EXISTS(SELECT 1 FROM public.plan_limits WHERE plan=v.plan AND current_version_id=v.id) THEN RAISE EXCEPTION 'billing_plan_not_approved';END IF;
  IF NOT available OR v.effective_at>clock_timestamp() OR NOT public.billing_terms_complete(v.features,v.limits)
   OR NOT(v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture'))
  THEN RAISE EXCEPTION 'billing_plan_not_approved'; END IF;
  IF p_command='activate_trial' AND a.selected_plan_version_id IS DISTINCT FROM p_plan_version
  THEN RAISE EXCEPTION 'billing_select_plan_first'; END IF;
  clock:=clock_timestamp();
  UPDATE public.billing_accounts SET selected_plan_version_id=v.id,version=version+1,
   trial_started_at=CASE WHEN p_command='activate_trial' THEN clock ELSE trial_started_at END,
   trial_ends_at=CASE WHEN p_command='activate_trial' THEN clock+make_interval(hours=>v.trial_hours) ELSE trial_ends_at END,
   trial_hours=CASE WHEN p_command='activate_trial' THEN v.trial_hours ELSE trial_hours END
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

-- ── Snapshot: catalog in display order (published + visible + not archived) and overrides ──
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

-- ── Catalog command: any plan code; draft / publish (confirmed) / archive / unarchive / presentation ──
CREATE OR REPLACE FUNCTION public.rpc_billing_catalog_command(p_actor bigint,p_key uuid,p_code text,p_expected bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE p public.plan_limits;v public.plan_versions;cur public.plan_versions;dft public.plan_versions;r public.billing_admin_commands;
 answer jsonb;cid uuid:=gen_random_uuid();intent jsonb;act text;dry boolean;err text;exists_row boolean;subs bigint;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[a-z][a-z0-9_]{1,39}$' OR p_key IS NULL OR p_actor IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 act:=COALESCE(p_payload->>'action','version');dry:=COALESCE(p_payload->>'dry_run','false')='true';
 IF act NOT IN('version','draft','publish','archive','unarchive','presentation') THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 IF act='version' THEN act:=CASE WHEN p_payload->>'approval_status'='draft' THEN 'draft' ELSE 'publish' END; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cfo-billing-catalog'));
 intent:=jsonb_build_object('code',p_code,'expected',p_expected,'payload',p_payload);
 IF NOT dry THEN
  SELECT * INTO r FROM public.billing_admin_commands WHERE actor_user_id=p_actor AND request_key=p_key;
  IF FOUND THEN IF r.action<>'catalog' OR r.intent<>intent THEN RAISE EXCEPTION 'billing_command_conflict';END IF;RETURN r.result||'{"is_replay":true}'::jsonb;END IF;
 END IF;
 SELECT * INTO p FROM public.plan_limits WHERE plan=p_code FOR UPDATE;
 exists_row:=FOUND;
 -- Rows without versions belong to the legacy plan policy (free/business/founder/enterprise): never reuse them.
 IF exists_row AND NOT EXISTS(SELECT 1 FROM public.plan_versions WHERE plan=p_code) THEN RAISE EXCEPTION 'billing_plan_code_reserved';END IF;
 IF NOT exists_row AND act NOT IN('draft','publish') THEN RAISE EXCEPTION 'billing_plan_not_found';END IF;
 IF COALESCE(p.catalog_version,0) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'billing_stale';END IF;
 SELECT * INTO cur FROM public.plan_versions WHERE id=p.current_version_id;
 SELECT * INTO dft FROM public.plan_versions WHERE id=p.draft_version_id;
 IF act IN('draft','publish') THEN
  err:=public.billing_terms_error(p_payload,act='publish');
  IF err IS NULL AND act='publish' AND p_payload->>'approval_status'='draft' THEN err:='billing_invalid_terms'; END IF;
  IF err IS NULL AND act='draft' AND p_payload->>'approval_status'<>'draft' THEN err:='billing_invalid_terms'; END IF;
  IF err IS NULL AND p_payload->>'approval_status'='staging_fixture' AND length(trim(COALESCE(p_payload->>'fixture_label','')))=0 THEN err:='billing_invalid_terms'; END IF;
 ELSIF act='presentation' THEN
  IF (p_payload-'action'-'dry_run'-'display_order'-'recommended'-'visible')<>'{}'::jsonb
   OR (p_payload ? 'display_order' AND COALESCE(p_payload->>'display_order','') !~ '^[0-9]{1,6}$')
   OR (p_payload ? 'recommended' AND jsonb_typeof(p_payload->'recommended')<>'boolean')
   OR (p_payload ? 'visible' AND jsonb_typeof(p_payload->'visible')<>'boolean') THEN err:='billing_invalid_terms';
  ELSIF COALESCE(p_payload->>'visible','false')='true' AND (p.archived_at IS NOT NULL OR cur.approval_status IS DISTINCT FROM 'approved' AND cur.approval_status IS DISTINCT FROM 'staging_fixture') THEN err:='billing_plan_not_approved';
  END IF;
 END IF;
 SELECT count(*) INTO subs FROM public.billing_accounts a JOIN public.plan_versions x ON x.id=a.selected_plan_version_id WHERE x.plan=p_code;
 IF dry THEN
  -- Preview only: nothing is written and no receipt is stored.
  RETURN jsonb_build_object('dry_run',true,'action',act,'valid',err IS NULL,'error',err,'current',to_jsonb(cur),'draft',to_jsonb(dft),
   'subscribers',subs,'note','Existing subscribers keep their version; only new selections and explicit admin changes use the new one.');
 END IF;
 IF err IS NOT NULL THEN RAISE EXCEPTION '%',err; END IF;
 IF act='publish' AND COALESCE(p_payload->>'confirm_publish','false')<>'true' THEN RAISE EXCEPTION 'billing_publish_not_confirmed';END IF;
 IF NOT exists_row THEN INSERT INTO public.plan_limits(plan,catalog_version)VALUES(p_code,0) RETURNING * INTO p; END IF;
 IF act IN('draft','publish') THEN
  INSERT INTO public.plan_versions(plan,version,name_i18n,description_i18n,price_minor,price_annual_minor,currency,billing_interval,features,limits,limit_policies,
   trial_hours,terms_version,approval_status,fixture_label,effective_at)
  VALUES(p_code,COALESCE((SELECT max(version)+1 FROM public.plan_versions WHERE plan=p_code),1),p_payload->'name_i18n',p_payload->'description_i18n',
   (p_payload->>'price_minor')::bigint,NULLIF(p_payload->>'price_annual_minor','')::bigint,p_payload->>'currency','month',
   COALESCE(p_payload->'features','{}'),COALESCE(p_payload->'limits','{}'),COALESCE(p_payload->'limit_policies','{}'),
   COALESCE((p_payload->>'trial_hours')::int,168),p_payload->>'terms_version',p_payload->>'approval_status',p_payload->>'fixture_label',
   COALESCE((p_payload->>'effective_at')::timestamptz,now())) RETURNING * INTO v;
  IF act='draft' THEN
   -- A draft never replaces published terms; it becomes current only while the plan has never been published.
   UPDATE public.plan_limits SET draft_version_id=v.id,
    current_version_id=CASE WHEN cur.approval_status IN('approved','staging_fixture') THEN current_version_id ELSE v.id END,
    catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
  ELSE
   UPDATE public.plan_limits SET current_version_id=v.id,draft_version_id=NULL,archived_at=NULL,
    commercial_available=COALESCE((p_payload->>'publish')::boolean,commercial_available),catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
  END IF;
 ELSIF act='archive' THEN
  UPDATE public.plan_limits SET archived_at=COALESCE(archived_at,now()),commercial_available=false,recommended=false,catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
 ELSIF act='unarchive' THEN
  UPDATE public.plan_limits SET archived_at=NULL,catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
 ELSE
  UPDATE public.plan_limits SET display_order=COALESCE((p_payload->>'display_order')::int,display_order),
   recommended=COALESCE((p_payload->>'recommended')::boolean,recommended),commercial_available=COALESCE((p_payload->>'visible')::boolean,commercial_available),
   catalog_version=catalog_version+1 WHERE plan=p_code RETURNING * INTO p;
 END IF;
 answer:=jsonb_build_object('plan',to_jsonb(p),'terms',to_jsonb(v),'previous',to_jsonb(cur),'subscribers',subs,'is_replay',false);
 INSERT INTO public.billing_admin_commands(id,actor_user_id,request_key,action,intent,result)VALUES(cid,p_actor,p_key,'catalog',intent,answer);
 RETURN answer;
END $$;

-- ── Admin command: + customer overrides; archived plans cannot be newly assigned or scheduled ──
CREATE OR REPLACE FUNCTION public.rpc_billing_admin_command(p_actor bigint,p_key uuid,p_business uuid,p_expected bigint,p_action text,p_payload jsonb,p_allow_fixture boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a public.billing_accounts;v public.plan_versions;r public.billing_admin_commands;answer jsonb;intent jsonb;cid uuid:=gen_random_uuid();old jsonb;
 deadline timestamptz;starts timestamptz;reason text;okind text;okey text;oval jsonb;item public.billing_catalog_items;
BEGIN
 IF p_actor IS NULL OR p_key IS NULL OR p_action IS NULL OR p_action NOT IN('assign','schedule','grant','revoke','extend','override','revoke_override') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
 INSERT INTO public.billing_accounts(business_id,legacy_fallback) SELECT id,true FROM public.businesses WHERE id=p_business AND type='business' AND billing_policy='legacy' ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_not_enrolled';END IF;
 intent:=jsonb_build_object('business_id',p_business,'expected',p_expected,'action',p_action,'payload',p_payload);
 SELECT * INTO r FROM public.billing_admin_commands WHERE actor_user_id=p_actor AND request_key=p_key;
 IF FOUND THEN IF r.intent<>intent OR r.action<>p_action THEN RAISE EXCEPTION 'billing_command_conflict';END IF;RETURN r.result||'{"is_replay":true}'::jsonb;END IF;
 IF p_expected IS NULL OR p_expected<>a.version THEN RAISE EXCEPTION 'billing_stale';END IF;
 reason:=trim(p_payload->>'reason');IF reason IS NULL OR length(reason)<5 OR length(reason)>2000 THEN RAISE EXCEPTION 'billing_reason_required';END IF;
 old:=to_jsonb(a);
 IF p_action IN('assign','schedule','grant') THEN
  SELECT * INTO v FROM public.plan_versions WHERE id=(p_payload->>'plan_version_id')::uuid;
  IF NOT FOUND OR v.effective_at>now() OR NOT public.billing_terms_complete(v.features,v.limits)
   OR NOT(v.approval_status='approved' OR (p_allow_fixture AND a.environment='sandbox' AND v.approval_status='staging_fixture')) THEN RAISE EXCEPTION 'billing_plan_not_approved';END IF;
  IF p_action IN('assign','schedule') AND EXISTS(SELECT 1 FROM public.plan_limits WHERE plan=v.plan AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'billing_plan_archived';END IF;
 END IF;
 IF p_action='assign' THEN
  IF EXISTS(SELECT 1 FROM public.billing_service_periods WHERE business_id=p_business AND revoked_at IS NULL AND payment_verified AND ends_at>now()) THEN RAISE EXCEPTION 'billing_schedule_required';END IF;
  UPDATE public.billing_accounts SET selected_plan_version_id=v.id,scheduled_plan_version_id=NULL,scheduled_at=NULL WHERE business_id=p_business;
 ELSIF p_action='schedule' THEN
  deadline:=(p_payload->>'effective_at')::timestamptz;
  IF deadline IS NULL OR deadline<=now() THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  IF deadline<(SELECT max(ends_at) FROM public.billing_service_periods WHERE business_id=p_business AND revoked_at IS NULL AND payment_verified AND ends_at>now()) THEN RAISE EXCEPTION 'billing_schedule_required';END IF;
  UPDATE public.billing_accounts SET scheduled_plan_version_id=v.id,scheduled_at=deadline WHERE business_id=p_business;
 ELSIF p_action='grant' THEN
  starts:=COALESCE((p_payload->>'starts_at')::timestamptz,now());deadline:=(p_payload->>'ends_at')::timestamptz;
  IF deadline IS NULL OR deadline<=starts OR deadline<=now() THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  IF EXISTS(SELECT 1 FROM public.billing_grants WHERE business_id=p_business AND revoked_at IS NULL AND starts_at<deadline AND ends_at>starts) THEN RAISE EXCEPTION 'billing_grant_overlap';END IF;
  INSERT INTO public.billing_grants(business_id,plan_version_id,starts_at,ends_at,reason,audit_id)VALUES(p_business,v.id,starts,deadline,reason,cid);
 ELSIF p_action='revoke' THEN
  UPDATE public.billing_grants SET revoked_at=now() WHERE business_id=p_business AND id=(p_payload->>'grant_id')::uuid AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_grant_not_found';END IF;
 ELSIF p_action='extend' THEN
  deadline:=(p_payload->>'ends_at')::timestamptz;
  IF a.trial_started_at IS NULL OR deadline IS NULL OR deadline<=a.trial_ends_at OR deadline<=now() THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  UPDATE public.billing_accounts SET trial_ends_at=deadline,trial_extension=jsonb_build_object('audit_id',cid,'reason',reason,'before',a.trial_ends_at,'after',deadline)WHERE business_id=p_business;
 ELSIF p_action='override' THEN
  okind:=p_payload->>'kind';okey:=NULLIF(p_payload->>'key','');oval:=p_payload->'value';
  IF (p_payload-'kind'-'key'-'value'-'starts_at'-'ends_at'-'reason')<>'{}'::jsonb OR okind IS NULL OR okind NOT IN('limit','feature','discount') THEN RAISE EXCEPTION 'billing_invalid_command';END IF;
  IF okind<>'discount' THEN
   SELECT * INTO item FROM public.billing_catalog_items WHERE kind=okind AND key=okey;
   -- Only terms the server can enforce may be overridden: a counterless limit would be a promise nobody keeps.
   IF NOT FOUND OR item.enforcement<>'server' THEN RAISE EXCEPTION 'billing_override_not_enforceable';END IF;
  ELSIF okey IS NOT NULL THEN RAISE EXCEPTION 'billing_invalid_command';
  END IF;
  starts:=COALESCE((p_payload->>'starts_at')::timestamptz,now());deadline:=(p_payload->>'ends_at')::timestamptz;
  IF (deadline IS NOT NULL AND (deadline<=starts OR deadline<=now())) THEN RAISE EXCEPTION 'billing_invalid_date';END IF;
  IF EXISTS(SELECT 1 FROM public.billing_overrides WHERE business_id=p_business AND kind=okind AND key IS NOT DISTINCT FROM okey AND revoked_at IS NULL
    AND (ends_at IS NULL OR ends_at>starts) AND (deadline IS NULL OR starts_at<deadline)) THEN RAISE EXCEPTION 'billing_override_overlap';END IF;
  INSERT INTO public.billing_overrides(business_id,kind,key,value,reason,approved_by,starts_at,ends_at,audit_id)
   VALUES(p_business,okind,okey,oval,reason,p_actor,starts,deadline,cid);
 ELSE
  UPDATE public.billing_overrides SET revoked_at=now() WHERE business_id=p_business AND id=(p_payload->>'override_id')::uuid AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_override_not_found';END IF;
 END IF;
 UPDATE public.billing_accounts SET version=version+1 WHERE business_id=p_business RETURNING * INTO a;
 answer:=jsonb_build_object('before',old,'after',to_jsonb(a),'reason',reason,'audit_id',cid,'is_replay',false);
 INSERT INTO public.billing_admin_commands(id,actor_user_id,request_key,business_id,action,intent,result)VALUES(cid,p_actor,p_key,p_business,p_action,intent,answer);
 RETURN answer;
END $$;

-- ── Quota: effective terms incl. overrides; soft limits allow and report, hard (default) refuse ──
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

-- ── Platform overview, read-only aggregate (counts only; no customer financial data) ──
CREATE FUNCTION public.rpc_billing_admin_rows()
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

ALTER TABLE public.billing_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_catalog_items,public.billing_overrides FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_catalog_items TO service_role;
GRANT SELECT,INSERT ON public.billing_overrides TO service_role;
GRANT UPDATE(revoked_at) ON public.billing_overrides TO service_role;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN('billing_terms_error','billing_effective_terms','rpc_billing_admin_rows','rpc_billing_trial_command','rpc_billing_snapshot',
    'rpc_billing_catalog_command','rpc_billing_admin_command','rpc_billing_quota') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
INSERT INTO public.billing_schema_versions(version) VALUES('20261017090000');
NOTIFY pgrst,'reload schema';
COMMIT;
