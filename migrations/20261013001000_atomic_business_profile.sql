-- Business profile only. Original040/history, finance SQL and auth are unchanged.
-- Apply first to a fresh owned native PG17 restore, then the synthetic staging.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regclass('public.tax_profiles') IS NULL THEN RAISE EXCEPTION 'profile_baseline_missing'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tax_profiles' AND column_name IN('foreign_owned','company_legal_name','brand_name','kpp','pkp_effective_date','nib_issue_date','primary_kbli','additional_kbli','actual_business_activities','employee_count','local_employee_count','foreign_employee_count','payroll_frequency','bpjs_registered','transaction_types','field_verification','profile_version','verified_profile_version')) THEN RAISE EXCEPTION 'profile_schema_already_present_reconcile_first'; END IF;
END $$;
ALTER TABLE public.tax_profiles
 ADD COLUMN foreign_owned text, ADD COLUMN company_legal_name text, ADD COLUMN brand_name text,
 ADD COLUMN kpp text, ADD COLUMN pkp_effective_date date, ADD COLUMN nib_issue_date date,
 ADD COLUMN primary_kbli text, ADD COLUMN additional_kbli text[], ADD COLUMN actual_business_activities text,
 ADD COLUMN employee_count integer CHECK(employee_count>=0), ADD COLUMN local_employee_count integer CHECK(local_employee_count>=0), ADD COLUMN foreign_employee_count integer CHECK(foreign_employee_count>=0),
 ADD COLUMN payroll_frequency text, ADD COLUMN bpjs_registered boolean, ADD COLUMN transaction_types text[],
 ADD COLUMN field_verification jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(field_verification)='object'),
 ADD COLUMN profile_version bigint NOT NULL DEFAULT 1 CHECK(profile_version>0),
 ADD COLUMN verified_profile_version bigint CHECK(verified_profile_version=profile_version);
-- Legacy verification is deliberately not retrospectively bound to version1.
CREATE UNIQUE INDEX cfo_profile_request_identity ON public.audit_events(business_id,actor_user_id,request_id)
 WHERE entity_type='tax_profile' AND request_id IS NOT NULL;

CREATE FUNCTION public.cfo_profile_same(p_field text,p_a jsonb,p_b jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE a text; b text;
BEGIN
 IF p_field IN('npwp','nib') THEN
  a:=regexp_replace(coalesce(p_a#>>'{}',''),'\D','','g');b:=regexp_replace(coalesce(p_b#>>'{}',''),'\D','','g');RETURN a<>'' AND a=b;
 END IF;
 IF jsonb_typeof(p_a)='array' AND jsonb_typeof(p_b)='array' THEN
  RETURN (SELECT coalesce(jsonb_agg(v ORDER BY v),'[]') FROM jsonb_array_elements(p_a) v)=(SELECT coalesce(jsonb_agg(v ORDER BY v),'[]') FROM jsonb_array_elements(p_b) v);
 END IF;
 IF jsonb_typeof(p_a)='string' AND jsonb_typeof(p_b)='string' THEN RETURN lower(trim(p_a#>>'{}'))=lower(trim(p_b#>>'{}')); END IF;
 RETURN coalesce(p_a,'null')=coalesce(p_b,'null');
END $$;

CREATE FUNCTION public.cfo_profile_missing(p jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE f text; missing text[]:=ARRAY[]::text[];
BEGIN
 FOREACH f IN ARRAY ARRAY['country','jurisdiction','legal_entity_type','tax_regime','financial_year_start','financial_year_end','vat_status'] LOOP
  IF f='vat_status' AND regexp_replace(lower(trim(coalesce(p->>'pkp_status',''))),'\s+','_','g') IN('non_pkp','non-pkp','nonpkp','not_pkp','not_registered','no','false') THEN CONTINUE; END IF;
  IF coalesce(p->>f,'')='' THEN missing:=array_append(missing,f); END IF;
 END LOOP;RETURN missing;
END $$;

CREATE FUNCTION public.cfo_profile_source(p_business uuid,p_field text,p_value jsonb,p_source jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE state text; did uuid; d public.financial_documents; file public.document_files; suggestion jsonb; other jsonb;
BEGIN
 state:=CASE WHEN jsonb_typeof(p_source)='string' THEN p_source#>>'{}' ELSE p_source->>'state' END;
 IF state IS NULL OR state NOT IN('missing','user_declared','document_uploaded','extracted','conflict') THEN RAISE EXCEPTION 'profile_invalid_provenance'; END IF;
 IF jsonb_typeof(p_source)='object' AND p_source-ARRAY['state','document_id']<>'{}'::jsonb THEN RAISE EXCEPTION 'profile_invalid_provenance'; END IF;
 IF state IN('extracted','document_uploaded') AND coalesce(p_source->>'document_id','')='' THEN RAISE EXCEPTION 'profile_document_required'; END IF;
 IF coalesce(p_source->>'document_id','')='' THEN RETURN to_jsonb(state); END IF;
 IF (p_source->>'document_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'profile_source_unavailable'; END IF;
 did:=(p_source->>'document_id')::uuid;
 SELECT * INTO d FROM public.financial_documents WHERE id=did AND business_id=p_business AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_source_unavailable'; END IF;
 -- Parent file precedes document metadata. No external reading inside locks.
 SELECT * INTO file FROM public.document_files WHERE id=d.file_id AND business_id=p_business FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_source_unavailable'; END IF;
 SELECT * INTO d FROM public.financial_documents WHERE id=did AND business_id=p_business AND archived_at IS NULL AND file_id=file.id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_source_unavailable'; END IF;
 IF state='extracted' THEN
  suggestion:=d.extracted_json#>ARRAY['ai_profile','fields',p_field];
  IF d.extracted_json#>>'{ai_profile,v}' IS DISTINCT FROM '1' OR suggestion IS NULL OR NOT(suggestion?'value') THEN RAISE EXCEPTION 'profile_extraction_not_confirmed'; END IF;
  IF NOT public.cfo_profile_same(p_field,suggestion->'value',p_value) THEN RAISE EXCEPTION 'profile_extraction_value_mismatch'; END IF;
  FOR other IN SELECT x.extracted_json#>ARRAY['ai_profile','fields',p_field,'value']
    FROM public.financial_documents x JOIN public.document_files f ON f.id=x.file_id AND f.business_id=p_business
    WHERE x.business_id=p_business AND x.archived_at IS NULL AND x.id<>did AND x.extracted_json#>>'{ai_profile,v}'='1' AND (x.extracted_json#>ARRAY['ai_profile','fields',p_field])?'value' LOOP
   IF NOT public.cfo_profile_same(p_field,other,p_value) THEN RAISE EXCEPTION 'profile_source_conflict'; END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('state',state,'document_id',did);
END $$;

CREATE FUNCTION public.rpc_write_business_profile(p_actor bigint,p_business uuid,p_operation text,p_expected_version bigint,p_request_key uuid,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE b public.businesses; m public.business_members; t public.tax_profiles; n public.tax_profiles;
 role text; previous jsonb; patch jsonb:=coalesce(p_patch,'{}'); final jsonb; field text; value jsonb; source jsonb; event public.audit_events; missing text[];
 allowed text[]:=ARRAY['country','jurisdiction','legal_entity_type','tax_residency','tax_regime','tax_identifier','npwp','nib','financial_year_start','financial_year_end','vat_status','pkp_status','employee_status','payroll_tax_status','withholding_tax_status','industry','business_activity_codes','accounting_method','reporting_currency','filing_frequency','foreign_owned','company_legal_name','brand_name','kpp','pkp_effective_date','nib_issue_date','primary_kbli','additional_kbli','actual_business_activities','employee_count','local_employee_count','foreign_employee_count','payroll_frequency','bpjs_registered','transaction_types','field_verification'];
BEGIN
 PERFORM public.fn_ledger_writer_lock();
 IF p_actor IS NULL OR p_request_key IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_operation IS NULL OR p_operation NOT IN('save','verify') OR jsonb_typeof(patch)<>'object' OR patch-allowed<>'{}' THEN RAISE EXCEPTION 'profile_invalid_request'; END IF;
 IF p_operation='verify' AND patch<>'{}' THEN RAISE EXCEPTION 'profile_invalid_request'; END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND type='business' FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_business_required'; END IF;
 SELECT * INTO m FROM public.business_members WHERE business_id=b.id AND user_id=p_actor AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_forbidden'; END IF;
 role:=CASE WHEN b.owner_user_id=p_actor THEN 'owner' ELSE m.role END;
 IF role IS NULL OR role NOT IN('owner','ceo','admin','cfo') OR role='owner' AND b.owner_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'profile_forbidden'; END IF;
 SELECT * INTO event FROM public.audit_events WHERE business_id=b.id AND actor_user_id=p_actor AND entity_type='tax_profile' AND request_id=p_request_key::text;
 IF FOUND THEN
  IF event.after_json->>'operation' IS DISTINCT FROM p_operation OR event.after_json->'payload' IS DISTINCT FROM patch OR event.after_json->>'expected_version' IS DISTINCT FROM p_expected_version::text THEN RAISE EXCEPTION 'profile_request_conflict'; END IF;
  RETURN jsonb_build_object('ok',true,'profile',event.after_json->'profile','request_id',p_request_key,'audit_id',event.id,'replayed',true,'historical',coalesce((SELECT profile_version FROM public.tax_profiles WHERE business_id=b.id),0) IS DISTINCT FROM (event.after_json#>>'{profile,profile_version}')::bigint);
 END IF;
 SELECT * INTO t FROM public.tax_profiles WHERE business_id=b.id FOR UPDATE;
 IF coalesce(t.profile_version,0)<>p_expected_version THEN RAISE EXCEPTION 'profile_version_conflict'; END IF;
 previous:=CASE WHEN t.id IS NULL THEN NULL ELSE to_jsonb(t) END;
 IF p_operation='verify' THEN
  IF t.id IS NULL THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF b.country IS NOT NULL AND t.country IS DISTINCT FROM b.country THEN RAISE EXCEPTION 'profile_country_mismatch'; END IF;
  IF b.country IN('Indonesia','Singapore','Malaysia','Thailand') AND t.jurisdiction IS DISTINCT FROM (CASE b.country WHEN 'Indonesia' THEN 'ID' WHEN 'Singapore' THEN 'SG' WHEN 'Malaysia' THEN 'MY' WHEN 'Thailand' THEN 'TH' END) THEN RAISE EXCEPTION 'profile_country_mismatch'; END IF;
  missing:=public.cfo_profile_missing(previous);IF cardinality(missing)>0 THEN RAISE EXCEPTION 'profile_incomplete' USING DETAIL=to_jsonb(missing)::text; END IF;
  FOR field,source IN SELECT e.key,e.value FROM jsonb_each(t.field_verification) e ORDER BY e.key LOOP
   IF coalesce(source->>'state',source#>>'{}')='conflict' THEN RAISE EXCEPTION 'profile_source_conflict'; END IF;
   PERFORM public.cfo_profile_source(b.id,field,previous->field,source);
  END LOOP;
  UPDATE public.tax_profiles SET profile_status='verified',verified_profile_version=profile_version,verified_by_user_id=p_actor,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO n;
 ELSE
  FOR field,value IN SELECT e.key,e.value FROM jsonb_each(patch) e ORDER BY e.key LOOP
   IF field='field_verification' THEN IF jsonb_typeof(value)<>'object' THEN RAISE EXCEPTION 'profile_invalid_provenance'; END IF;CONTINUE; END IF;
   IF value='null'::jsonb THEN CONTINUE; END IF;
   IF field IN('employee_count','local_employee_count','foreign_employee_count') THEN
    IF jsonb_typeof(value)<>'number' OR value::text!~'^\d+$' THEN RAISE EXCEPTION 'profile_invalid_value'; END IF;
   ELSIF field='bpjs_registered' THEN IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'profile_invalid_value'; END IF;
   ELSIF field IN('additional_kbli','transaction_types') THEN
    IF jsonb_typeof(value)<>'array' OR jsonb_array_length(value)>40 OR EXISTS(SELECT 1 FROM jsonb_array_elements(value) x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>100) THEN RAISE EXCEPTION 'profile_invalid_value'; END IF;
   ELSIF jsonb_typeof(value)<>'string' OR length(value#>>'{}')>500 THEN RAISE EXCEPTION 'profile_invalid_value'; END IF;
  END LOOP;
  final:=coalesce(previous,'{}')||(patch-'field_verification')||jsonb_build_object('id',coalesce(t.id,gen_random_uuid()),'business_id',b.id,'created_at',coalesce(t.created_at,clock_timestamp()),'updated_at',clock_timestamp(),'created_by_user_id',coalesce(t.created_by_user_id,p_actor),'profile_version',coalesce(t.profile_version,0)+1,'verified_profile_version',NULL,'verified_at',NULL,'verified_by_user_id',NULL,'field_verification',coalesce(t.field_verification,'{}'));
  IF b.country IS NOT NULL AND final->>'country' IS NOT NULL AND b.country<>final->>'country' THEN RAISE EXCEPTION 'profile_country_mismatch'; END IF;
  IF b.country IN('Indonesia','Singapore','Malaysia','Thailand') AND final->>'jurisdiction' IS NOT NULL AND final->>'jurisdiction'<>(CASE b.country WHEN 'Indonesia' THEN 'ID' WHEN 'Singapore' THEN 'SG' WHEN 'Malaysia' THEN 'MY' WHEN 'Thailand' THEN 'TH' END) THEN RAISE EXCEPTION 'profile_country_mismatch'; END IF;
  FOR field,value IN SELECT e.key,e.value FROM jsonb_each(patch-'field_verification') e ORDER BY e.key LOOP
   IF previous->field IS DISTINCT FROM value THEN final:=jsonb_set(final,ARRAY['field_verification',field],to_jsonb(CASE WHEN value='null' THEN 'missing' ELSE 'user_declared' END)); END IF;
  END LOOP;
  FOR field,source IN SELECT e.key,e.value FROM jsonb_each(coalesce(patch->'field_verification','{}')) e ORDER BY e.key LOOP
   IF NOT field=ANY(allowed) OR field='field_verification' THEN RAISE EXCEPTION 'profile_invalid_provenance'; END IF;
   IF coalesce(source->>'state',source#>>'{}')='accountant_verified' THEN RAISE EXCEPTION 'profile_confirmation_required'; END IF;
   final:=jsonb_set(final,ARRAY['field_verification',field],public.cfo_profile_source(b.id,field,final->field,source));
  END LOOP;
  missing:=public.cfo_profile_missing(final);
  final:=final||jsonb_build_object('profile_status',CASE WHEN cardinality(missing)>0 THEN 'incomplete' ELSE 'needs_review' END);
  n:=jsonb_populate_record(NULL::public.tax_profiles,final);
  IF t.id IS NULL THEN INSERT INTO public.tax_profiles SELECT (n).*;
  ELSE
   -- Explicit existing+new fields, preserves unrelated partner/creation metadata.
   UPDATE public.tax_profiles SET country=n.country,jurisdiction=n.jurisdiction,legal_entity_type=n.legal_entity_type,tax_residency=n.tax_residency,tax_regime=n.tax_regime,tax_identifier=n.tax_identifier,npwp=n.npwp,nib=n.nib,financial_year_start=n.financial_year_start,financial_year_end=n.financial_year_end,vat_status=n.vat_status,pkp_status=n.pkp_status,employee_status=n.employee_status,payroll_tax_status=n.payroll_tax_status,withholding_tax_status=n.withholding_tax_status,industry=n.industry,business_activity_codes=n.business_activity_codes,accounting_method=n.accounting_method,reporting_currency=n.reporting_currency,filing_frequency=n.filing_frequency,foreign_owned=n.foreign_owned,company_legal_name=n.company_legal_name,brand_name=n.brand_name,kpp=n.kpp,pkp_effective_date=n.pkp_effective_date,nib_issue_date=n.nib_issue_date,primary_kbli=n.primary_kbli,additional_kbli=n.additional_kbli,actual_business_activities=n.actual_business_activities,employee_count=n.employee_count,local_employee_count=n.local_employee_count,foreign_employee_count=n.foreign_employee_count,payroll_frequency=n.payroll_frequency,bpjs_registered=n.bpjs_registered,transaction_types=n.transaction_types,field_verification=n.field_verification,profile_version=n.profile_version,verified_profile_version=NULL,profile_status=n.profile_status,verified_by_user_id=NULL,verified_at=NULL,updated_at=n.updated_at WHERE id=t.id;
  END IF;
 END IF;
 INSERT INTO public.audit_events(business_id,actor_user_id,actor_role,channel,entity_type,entity_id,action,before_json,after_json,request_id)
 VALUES(b.id,p_actor,role,'web','tax_profile',n.id::text,CASE WHEN p_operation='verify' THEN 'verified' ELSE 'profile_saved' END,previous,jsonb_build_object('profile',to_jsonb(n),'operation',p_operation,'expected_version',p_expected_version::text,'payload',patch),p_request_key::text) RETURNING * INTO event;
 RETURN jsonb_build_object('ok',true,'profile',to_jsonb(n),'request_id',p_request_key,'audit_id',event.id,'replayed',false,'historical',false);
END $$;
REVOKE ALL ON FUNCTION public.cfo_profile_same(text,jsonb,jsonb),public.cfo_profile_missing(jsonb),public.cfo_profile_source(uuid,text,jsonb,jsonb),public.rpc_write_business_profile(bigint,uuid,text,bigint,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cfo_profile_same(text,jsonb,jsonb),public.cfo_profile_missing(jsonb),public.cfo_profile_source(uuid,text,jsonb,jsonb),public.rpc_write_business_profile(bigint,uuid,text,bigint,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
