-- Published Commercial Matrix Synchronization (Starter $59, Control $149, Pro $249)
-- Aligns database plan versions, limits, features, and multi-company counting with PRICING_SOURCE_OF_TRUTH.md
-- Every name is schema-qualified. Fail-closed: requires 20261018090000.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_schema_versions WHERE version='20261018090000') THEN
  RAISE EXCEPTION 'billing_matrix_sync_requires_20261018090000';
 END IF;
END $$;

-- 1. Accurate Multi-Company Counting in billing_usage
-- Counts active company workspaces owned by the owner of this business.
CREATE OR REPLACE FUNCTION public.billing_usage(p_business uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT jsonb_object_agg(resource,used) FROM(
   SELECT resource,sum(units) AS used FROM public.billing_quota_reservations WHERE business_id=p_business
    AND resource IN('documents','ai','imports','transactions','bank_rows','mcp','ai_accountant','ai_extraction') AND state IN('reserved','processing','committed')
    AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date GROUP BY resource) u),'{}'::jsonb)
 ||jsonb_build_object(
  'users',(SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active'),
  'companies',COALESCE((SELECT count(*) FROM public.businesses WHERE owner_user_id=(SELECT owner_user_id FROM public.businesses WHERE id=p_business) AND type='business' AND status='active'),1),
  'storage_mb',(SELECT ceil(COALESCE(sum(file_size),0)/1048576.0)::bigint FROM public.document_files WHERE business_id=p_business),
  'integrations',(SELECT count(*) FROM public.payment_provider_connections WHERE business_id=p_business AND status<>'disabled'),
  'accounts',(SELECT count(*) FROM public.wallets WHERE business_id=p_business AND COALESCE(is_active,true)))
$$;

-- 2. Gate Multi-Company Creation in rpc_create_business_commercial_once
CREATE OR REPLACE FUNCTION public.rpc_create_business_commercial_once(p_actor bigint,p_request_key uuid,p_intent jsonb,p_categories jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE answer jsonb;b businesses;owned_count integer;max_allowed bigint;owner_biz uuid;
BEGIN
 -- Check multi-company limit for existing owners before creation
 SELECT count(*) INTO owned_count FROM public.businesses WHERE owner_user_id=p_actor AND type='business' AND status='active';
 IF owned_count >= 1 THEN
  -- Check if owner has an active commercial business with available company slots
  SELECT biz.id INTO owner_biz FROM public.businesses biz
    JOIN public.billing_accounts a ON a.business_id=biz.id
    LEFT JOIN public.plan_versions v ON v.id=a.selected_plan_version_id
    WHERE biz.owner_user_id=p_actor AND biz.type='business' AND biz.status='active'
    ORDER BY (CASE WHEN COALESCE(v.plan, biz.plan)='pro' THEN 3 WHEN COALESCE(v.plan, biz.plan)='control' THEN 2 WHEN COALESCE(v.plan, biz.plan)='starter' THEN 1 ELSE 0 END) DESC, biz.created_at ASC
    LIMIT 1;
  IF owner_biz IS NOT NULL THEN
   SELECT (public.billing_effective_terms(owner_biz)->'limits'->>'companies')::bigint INTO max_allowed;
   IF max_allowed IS NOT NULL AND owned_count >= max_allowed THEN
    RAISE EXCEPTION 'company_limit_reached';
   END IF;
  ELSE
   -- Free tier allows only 1 company
   RAISE EXCEPTION 'company_limit_reached';
  END IF;
 END IF;

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

-- 3. Publish and Approve Commercial Plans (Starter $59, Control $149, Pro $249)
DO $$
DECLARE
 v_starter uuid; v_control uuid; v_pro uuid;
 f_starter jsonb := '{"documents":true,"ai":true,"cfo_ai":true,"import":true,"transactions":true,"accounts":true,"bills":true,"pulse":true,"radar":true,"team":true,"export":true,"api":true,"approvals":false,"payroll":false,"ai_accountant":false,"tax_compliance":false,"accounting_export":false,"integrations":false}';
 f_control jsonb := '{"documents":true,"ai":true,"cfo_ai":true,"import":true,"transactions":true,"accounts":true,"bills":true,"pulse":true,"radar":true,"team":true,"export":true,"api":true,"approvals":true,"payroll":true,"ai_accountant":true,"tax_compliance":true,"accounting_export":true,"integrations":false}';
 f_pro jsonb     := '{"documents":true,"ai":true,"cfo_ai":true,"import":true,"transactions":true,"accounts":true,"bills":true,"pulse":true,"radar":true,"team":true,"export":true,"api":true,"approvals":true,"payroll":true,"ai_accountant":true,"tax_compliance":true,"accounting_export":true,"integrations":true}';

 l_starter jsonb := '{"companies":1,"users":5,"accounts":5,"transactions":2000,"documents":200,"storage_mb":2048,"imports":5,"bank_rows":1000,"ai":50,"ai_extraction":100,"ai_accountant":0,"mcp":500,"integrations":0}';
 l_control jsonb := '{"companies":2,"users":10,"accounts":15,"transactions":10000,"documents":1000,"storage_mb":10240,"imports":20,"bank_rows":10000,"ai":300,"ai_extraction":500,"ai_accountant":50,"mcp":3000,"integrations":1}';
 l_pro jsonb     := '{"companies":5,"users":30,"accounts":50,"transactions":50000,"documents":3000,"storage_mb":51200,"imports":100,"bank_rows":50000,"ai":1000,"ai_extraction":1500,"ai_accountant":200,"mcp":15000,"integrations":5}';

 pol_starter jsonb := '{"companies":"hard","users":"hard","accounts":"hard","transactions":"hard","documents":"hard","storage_mb":"hard","imports":"hard","bank_rows":"hard","ai":"hard","ai_extraction":"hard","ai_accountant":"hard","mcp":"hard","integrations":"hard"}';
 pol_control jsonb := '{"companies":"hard","users":"hard","accounts":"hard","transactions":"hard","documents":"hard","storage_mb":"hard","imports":"hard","bank_rows":"hard","ai":"hard","ai_extraction":"hard","ai_accountant":"hard","mcp":"hard","integrations":"hard"}';
 pol_pro jsonb     := '{"companies":"hard","users":"hard","accounts":"hard","transactions":"hard","documents":"hard","storage_mb":"hard","imports":"hard","bank_rows":"hard","ai":"hard","ai_extraction":"hard","ai_accountant":"hard","mcp":"hard","integrations":"hard"}';
BEGIN
 -- Update or Insert STARTER Version
 INSERT INTO public.plan_versions(plan,version,name_i18n,description_i18n,price_minor,currency,billing_interval,
   features,limits,limit_policies,terms_version,approval_status,effective_at,trial_hours)
 VALUES('starter',COALESCE((SELECT max(version)+1 FROM public.plan_versions WHERE plan='starter'),1),
   '{"en":"Starter","ru":"Starter","id":"Starter"}'::jsonb,
   '{"en":"For small businesses that need cash visibility and organized financial records.","ru":"Для владельцев бизнеса, которым нужен понятный учет и прозрачность денежных потоков.","id":"Untuk pemilik bisnis yang menginginkan keuangan rapi dan visibilitas kas jelas."}'::jsonb,
   5900,'USD','month',f_starter,l_starter,pol_starter,'published-2026-10-18','approved',now()-interval '1 minute',168)
 RETURNING id INTO v_starter;

 -- Update or Insert CONTROL Version
 INSERT INTO public.plan_versions(plan,version,name_i18n,description_i18n,price_minor,currency,billing_interval,
   features,limits,limit_policies,terms_version,approval_status,effective_at,trial_hours)
 VALUES('control',COALESCE((SELECT max(version)+1 FROM public.plan_versions WHERE plan='control'),1),
   '{"en":"Control","ru":"Control","id":"Control"}'::jsonb,
   '{"en":"For growing businesses needing deeper intelligence, approvals, and tax readiness.","ru":"Для растущего бизнеса с согласованиями платежей, зарплатами и налоговой отчетностью.","id":"Untuk bisnis berkembang dengan persetujuan pengeluaran, penggajian, dan kesiapan pajak."}'::jsonb,
   14900,'USD','month',f_control,l_control,pol_control,'published-2026-10-18','approved',now()-interval '1 minute',168)
 RETURNING id INTO v_control;

 -- Update or Insert PRO Version
 INSERT INTO public.plan_versions(plan,version,name_i18n,description_i18n,price_minor,currency,billing_interval,
   features,limits,limit_policies,terms_version,approval_status,effective_at,trial_hours)
 VALUES('pro',COALESCE((SELECT max(version)+1 FROM public.plan_versions WHERE plan='pro'),1),
   '{"en":"Pro","ru":"Pro","id":"Pro"}'::jsonb,
   '{"en":"For multi-entity businesses requiring high volume, audit logs, and API access.","ru":"Для холдингов и нескольких юрлиц с высокими объемами операций и доступом к API.","id":"Untuk bisnis multi-entitas dengan volume transaksi tinggi, audit trail, dan akses API."}'::jsonb,
   24900,'USD','month',f_pro,l_pro,pol_pro,'published-2026-10-18','approved',now()-interval '1 minute',168)
 RETURNING id INTO v_pro;

 -- Update plan_limits pointers and availability
 UPDATE public.plan_limits SET
   commercial_available=true, current_version_id=v_starter, draft_version_id=NULL,
   catalog_version=catalog_version+1, display_order=1, recommended=false,
   max_businesses=1, max_users=5, max_wallets=5, max_transactions_per_month=2000, max_invoices_per_month=200, max_ai_questions_per_month=50,
   approval_flow_enabled=false, payroll_enabled=false, team_access_enabled=true, export_enabled=true, integrations_enabled=false
 WHERE plan='starter';

 UPDATE public.plan_limits SET
   commercial_available=true, current_version_id=v_control, draft_version_id=NULL,
   catalog_version=catalog_version+1, display_order=2, recommended=true,
   max_businesses=2, max_users=10, max_wallets=15, max_transactions_per_month=10000, max_invoices_per_month=1000, max_ai_questions_per_month=300,
   approval_flow_enabled=true, payroll_enabled=true, team_access_enabled=true, export_enabled=true, integrations_enabled=false
 WHERE plan='control';

 UPDATE public.plan_limits SET
   commercial_available=true, current_version_id=v_pro, draft_version_id=NULL,
   catalog_version=catalog_version+1, display_order=3, recommended=false,
   max_businesses=5, max_users=30, max_wallets=50, max_transactions_per_month=50000, max_invoices_per_month=3000, max_ai_questions_per_month=1000,
   approval_flow_enabled=true, payroll_enabled=true, team_access_enabled=true, export_enabled=true, integrations_enabled=true
 WHERE plan='pro';
END $$;

INSERT INTO public.billing_schema_versions(version) VALUES('20261018130000') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
