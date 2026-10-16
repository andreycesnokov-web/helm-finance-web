-- Billing plan matrix (Business + Platform admin). Additive on 20261017120000; extends the SAME catalog, quota
-- reservations, effective terms and admission — no second billing system, no ledger or financial RPC changes.
--  1. New metered limits: accounts (current), bank_rows, mcp, ai_accountant, ai_extraction (per UTC month).
--     The `ai` limit is the AI Assistant (CFO AI) quota; AI Accountant and AI document reading get their own.
--  2. Catalog items carry public unit and definition texts (EN/RU/ID) for the pricing page.
--  3. Publication contract: a version can be published only when EVERY server-metered limit of the catalog is
--     explicitly set (integer, 0 = disabled, null = unlimited). An absent key is "not decided", never unlimited.
--     Versions published earlier keep their meaning (absent = unlimited for keys they predate).
--  4. billing_public_catalog(): the published commercial catalog for the public pricing page (no drafts, no
--     fixtures, no internal notes).
--  5. Starter / Control / Pro get a DRAFT version with the owner-approved values (2026-10-17) — only while the
--     catalog is still the untouched seed. Values marked PENDING APPROVAL are left unset, so the drafts cannot be
--     published until an admin sets them in Platform Admin.
-- Every name is schema-qualified.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_schema_versions WHERE version='20261017120000') THEN
  RAISE EXCEPTION 'billing_plan_matrix_requires_20261017120000';
 END IF;
END $$;

ALTER TABLE public.billing_quota_reservations DROP CONSTRAINT billing_quota_reservations_resource_check,
 ADD CONSTRAINT billing_quota_reservations_resource_check
 CHECK(resource IN('documents','ai','imports','users','companies','transactions','storage_mb','integrations',
                   'accounts','bank_rows','mcp','ai_accountant','ai_extraction'));

ALTER TABLE public.billing_catalog_items
 DROP CONSTRAINT billing_catalog_items_counter_check,
 ADD CONSTRAINT billing_catalog_items_counter_check CHECK(counter IN('documents','ai','imports','users','transactions','storage_mb',
   'integrations','accounts','bank_rows','mcp','ai_accountant','ai_extraction')),
 ADD COLUMN unit_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(unit_i18n)='object'),
 ADD COLUMN definition_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(definition_i18n)='object');

INSERT INTO public.billing_catalog_items(key,kind,label_i18n,module_status,enforcement,counter,reset_period,required,sort_order) VALUES
 ('accounts','limit','{"en":"Financial accounts","ru":"Финансовые счета","id":"Rekening keuangan"}','released','server','accounts','none',false,25),
 ('bank_rows','limit','{"en":"Bank statement rows per month","ru":"Строки банковских выписок в месяц","id":"Baris mutasi bank per bulan"}','released','server','bank_rows','month_utc',false,55),
 ('ai_accountant','limit','{"en":"AI Accountant requests per month","ru":"Запросы к AI-бухгалтеру в месяц","id":"Permintaan AI Akuntan per bulan"}','beta','server','ai_accountant','month_utc',false,65),
 ('ai_extraction','limit','{"en":"AI document readings per month","ru":"AI-распознавания документов в месяц","id":"Pembacaan dokumen AI per bulan"}','released','server','ai_extraction','month_utc',false,66),
 ('mcp','limit','{"en":"MCP / API requests per month","ru":"Запросы MCP / API в месяц","id":"Permintaan MCP / API per bulan"}','released','server','mcp','month_utc',false,67)
ON CONFLICT (kind,key) DO NOTHING;
UPDATE public.billing_catalog_items SET label_i18n='{"en":"AI Assistant questions per month","ru":"Вопросы AI-ассистенту в месяц","id":"Pertanyaan AI Assistant per bulan"}'
 WHERE kind='limit' AND key='ai';

-- Public unit and definition texts (what is counted, when it resets, what happens at the limit).
UPDATE public.billing_catalog_items c SET unit_i18n=t.u, definition_i18n=t.d FROM (VALUES
 ('users','{"en":"seats","ru":"мест","id":"kursi"}'::jsonb,'{"en":"Active members of the company, including open invitations. The owner counts as one seat.","ru":"Активные участники компании, включая открытые приглашения. Владелец занимает одно место.","id":"Anggota aktif perusahaan, termasuk undangan terbuka. Pemilik dihitung satu kursi."}'::jsonb),
 ('transactions','{"en":"per month","ru":"в месяц","id":"per bulan"}','{"en":"Every booked money movement: an income or expense entry, a transfer between accounts, a bill payment, a payroll payment, a balance correction and every confirmed bank statement row. Resets on the 1st of each month (UTC).","ru":"Каждое проведённое движение денег: приход или расход, перевод между счетами, оплата счёта, выплата зарплаты, корректировка остатка и каждая подтверждённая строка выписки. Обнуляется 1-го числа каждого месяца (UTC).","id":"Setiap pergerakan uang yang dicatat: pemasukan atau pengeluaran, transfer antar rekening, pembayaran tagihan, pembayaran gaji, koreksi saldo, dan setiap baris mutasi yang dikonfirmasi. Direset setiap tanggal 1 (UTC)."}'),
 ('documents','{"en":"uploads per month","ru":"загрузок в месяц","id":"unggahan per bulan"}','{"en":"Each file uploaded to the company documents. Deleting a file does not return the upload. Resets monthly (UTC).","ru":"Каждый файл, загруженный в документы компании. Удаление файла не возвращает загрузку. Обнуляется ежемесячно (UTC).","id":"Setiap file yang diunggah ke dokumen perusahaan. Menghapus file tidak mengembalikan kuota. Direset bulanan (UTC)."}'),
 ('storage_mb','{"en":"MB","ru":"МБ","id":"MB"}','{"en":"Total size of stored files. Reaching it stops new uploads; existing files are never deleted.","ru":"Общий объём хранимых файлов. При достижении новые загрузки останавливаются; существующие файлы не удаляются.","id":"Total ukuran file tersimpan. Bila tercapai, unggahan baru berhenti; file yang ada tidak pernah dihapus."}'),
 ('ai','{"en":"questions per month","ru":"вопросов в месяц","id":"pertanyaan per bulan"}','{"en":"Each question answered by the AI Assistant (CFO AI). Retrying the same question does not count again. Resets monthly (UTC).","ru":"Каждый вопрос, на который ответил AI-ассистент (AI CFO). Повтор того же запроса не списывается повторно. Обнуляется ежемесячно (UTC).","id":"Setiap pertanyaan yang dijawab AI Assistant (CFO AI). Mengulang permintaan yang sama tidak dihitung lagi. Direset bulanan (UTC)."}'),
 ('ai_accountant','{"en":"requests per month","ru":"запросов в месяц","id":"permintaan per bulan"}','{"en":"Each request to the AI Accountant, including building the company tax profile from documents. Resets monthly (UTC).","ru":"Каждый запрос к AI-бухгалтеру, включая составление налогового профиля по документам. Обнуляется ежемесячно (UTC).","id":"Setiap permintaan ke AI Akuntan, termasuk menyusun profil pajak dari dokumen. Direset bulanan (UTC)."}'),
 ('ai_extraction','{"en":"readings per month","ru":"распознаваний в месяц","id":"pembacaan per bulan"}','{"en":"Each document read by AI to identify it or extract its fields (also from Claude or ChatGPT via MCP). Resets monthly (UTC).","ru":"Каждое распознавание документа AI для определения типа или извлечения полей (в том числе из Claude или ChatGPT через MCP). Обнуляется ежемесячно (UTC).","id":"Setiap dokumen yang dibaca AI untuk dikenali atau diambil datanya (juga dari Claude atau ChatGPT lewat MCP). Direset bulanan (UTC)."}'),
 ('mcp','{"en":"requests per month","ru":"запросов в месяц","id":"permintaan per bulan"}','{"en":"Each tool call made by Claude, ChatGPT or another MCP client to the company data. Resets monthly (UTC).","ru":"Каждый вызов инструмента из Claude, ChatGPT или другого MCP-клиента к данным компании. Обнуляется ежемесячно (UTC).","id":"Setiap panggilan alat dari Claude, ChatGPT, atau klien MCP lain ke data perusahaan. Direset bulanan (UTC)."}'),
 ('imports','{"en":"statements per month","ru":"выписок в месяц","id":"mutasi per bulan"}','{"en":"Each bank statement file read for import. Resets monthly (UTC).","ru":"Каждый файл банковской выписки, прочитанный для импорта. Обнуляется ежемесячно (UTC).","id":"Setiap file mutasi bank yang dibaca untuk impor. Direset bulanan (UTC)."}'),
 ('bank_rows','{"en":"rows per month","ru":"строк в месяц","id":"baris per bulan"}','{"en":"Each statement row submitted for review. Confirmed rows also count as transactions. Resets monthly (UTC).","ru":"Каждая строка выписки, отправленная на проверку. Подтверждённые строки также считаются операциями. Обнуляется ежемесячно (UTC).","id":"Setiap baris mutasi yang dikirim untuk ditinjau. Baris yang dikonfirmasi juga dihitung sebagai transaksi. Direset bulanan (UTC)."}'),
 ('accounts','{"en":"accounts","ru":"счетов","id":"rekening"}','{"en":"Active bank, cash and e-wallet accounts of the company. Archived accounts do not count.","ru":"Активные банковские, кассовые и электронные счета компании. Архивные не считаются.","id":"Rekening bank, kas, dan dompet elektronik aktif perusahaan. Rekening yang diarsipkan tidak dihitung."}'),
 ('integrations','{"en":"connections","ru":"подключений","id":"koneksi"}','{"en":"Connected payment providers.","ru":"Подключённые платёжные провайдеры.","id":"Penyedia pembayaran yang terhubung."}'),
 ('companies','{"en":"companies","ru":"компаний","id":"perusahaan"}','{"en":"Companies one owner can run on this plan.","ru":"Компании, которые один владелец может вести на этом тарифе.","id":"Perusahaan yang dapat dijalankan satu pemilik pada paket ini."}'),
 ('exports','{"en":"per month","ru":"в месяц","id":"per bulan"}','{"en":"Exporting your own data is always available.","ru":"Выгрузка собственных данных доступна всегда.","id":"Ekspor data Anda sendiri selalu tersedia."}')
) AS t(key,u,d) WHERE c.kind='limit' AND c.key=t.key;

-- Usage as the server counts it (monthly reservations; current-state real rows).
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

-- Same reservation machine; extended resource list, feature mapping and the `accounts` current-state counter.
CREATE OR REPLACE FUNCTION public.rpc_billing_quota(p_actor bigint, p_business uuid, p_key uuid, p_resource text, p_action text, p_units integer DEFAULT 1, p_reason text DEFAULT NULL::text, p_intent jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE a public.billing_accounts;r public.billing_quota_reservations;t jsonb;lim bigint;used bigint;policy text;over boolean;feat text;revive boolean:=false;
 period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT * INTO a FROM public.billing_accounts WHERE business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"policy":"legacy"}'::jsonb;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE b.id=p_business AND b.status='active' AND m.user_id=p_actor AND m.status='active') THEN RAISE EXCEPTION 'billing_forbidden';END IF;
 IF p_key IS NULL OR p_units IS NULL OR p_units<1 OR p_resource NOT IN('documents','ai','imports','users','companies','transactions','storage_mb','integrations',
     'accounts','bank_rows','mcp','ai_accountant','ai_extraction')
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
 feat:=CASE p_resource WHEN 'imports' THEN 'import' WHEN 'bank_rows' THEN 'import' WHEN 'storage_mb' THEN 'documents' WHEN 'users' THEN NULL
  WHEN 'companies' THEN NULL WHEN 'mcp' THEN 'api' WHEN 'ai_extraction' THEN 'ai' ELSE p_resource END;
 IF feat IS NOT NULL AND (t->'features'->>feat) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'billing_feature_denied';END IF;
 lim:=(t->'limits'->>p_resource)::bigint;
 policy:=COALESCE(t->'limit_policies'->>p_resource,'hard');
 IF p_resource='users' THEN
  SELECT (SELECT count(*) FROM public.business_members WHERE business_id=p_business AND status='active')+
   COALESCE((SELECT sum(greatest(COALESCE(max_uses,1)-uses_count,0)) FROM public.business_invites WHERE business_id=p_business AND status='active' AND expires_at>now()),0)+
   COALESCE((SELECT sum(units) FROM public.billing_quota_reservations WHERE business_id=p_business AND resource='users' AND state IN('reserved','processing')),0) INTO used;
 ELSIF p_resource IN('storage_mb','integrations','accounts') THEN
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
END $function$;

-- Publication contract: every released or beta server-metered limit must be decided explicitly.
CREATE OR REPLACE FUNCTION public.billing_terms_error(p jsonb, p_complete boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
 -- An undecided metered limit is never published as "unlimited".
 IF p_complete AND EXISTS(SELECT 1 FROM public.billing_catalog_items c WHERE c.kind='limit' AND c.enforcement='server' AND c.counter IS NOT NULL
   AND c.module_status<>'not_released' AND NOT (COALESCE(p->'limits','{}') ? c.key)) THEN RETURN 'billing_terms_incomplete'; END IF;
 RETURN NULL;
END $function$;

-- Published catalog for the public pricing page. Only approved, visible, effective, not archived versions;
-- features with their release status; limits as value + state (limited / unlimited / disabled / not_set).
CREATE OR REPLACE FUNCTION public.billing_public_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 WITH d AS (SELECT public.billing_feature_defaults() AS d),
 plans AS (
  SELECT p.display_order,p.recommended,v.* FROM public.plan_limits p JOIN public.plan_versions v ON v.id=p.current_version_id
   WHERE v.approval_status='approved' AND p.commercial_available AND p.archived_at IS NULL AND v.effective_at<=now()
     AND v.fixture_label IS NULL)
 SELECT jsonb_build_object('generated_at',now(),'plans',COALESCE(jsonb_agg(jsonb_build_object(
   'plan',pl.plan,'version',pl.version,'effective_at',pl.effective_at,'display_order',pl.display_order,'recommended',pl.recommended,
   'name',pl.name_i18n,'description',pl.description_i18n,'price_minor',pl.price_minor,'price_annual_minor',pl.price_annual_minor,
   'currency',pl.currency,'billing_interval',pl.billing_interval,'trial_hours',pl.trial_hours,
   'features',(SELECT jsonb_agg(jsonb_build_object('key',c.key,'label',c.label_i18n,'status',c.module_status,
       'included',COALESCE((d.d->'always'->>c.key)::boolean,false) OR COALESCE((pl.features->>c.key)::boolean,(d.d->'absent'->>c.key)::boolean,false))
     ORDER BY c.sort_order,c.key) FROM public.billing_catalog_items c, d WHERE c.kind='feature' AND c.module_status<>'not_released'),
   'limits',(SELECT jsonb_agg(jsonb_build_object('key',c.key,'label',c.label_i18n,'unit',c.unit_i18n,'definition',c.definition_i18n,
       'reset',c.reset_period,'enforced',c.enforcement='server','status',c.module_status,
       'value',CASE WHEN pl.limits ? c.key AND pl.limits->c.key<>'null'::jsonb THEN (pl.limits->>c.key)::bigint END,
       'state',CASE WHEN NOT (pl.limits ? c.key) THEN 'not_set' WHEN pl.limits->c.key='null'::jsonb THEN 'unlimited'
                    WHEN (pl.limits->>c.key)::bigint=0 THEN 'disabled' ELSE 'limited' END,
       'at_limit',CASE WHEN COALESCE(pl.limit_policies->>c.key,'hard')='soft' AND c.key<>'users' THEN 'warn' ELSE 'block' END)
     ORDER BY c.sort_order,c.key) FROM public.billing_catalog_items c WHERE c.kind='limit' AND c.module_status<>'not_released')
  ) ORDER BY pl.display_order,pl.plan),'[]'::jsonb)) FROM plans pl
$$;

-- Owner-approved starting values (2026-10-17) as DRAFT versions, only on the untouched seed catalog.
-- PENDING APPROVAL keys and the feature matrix stay unset: publication is refused until an admin sets them.
DO $$
DECLARE p record; v public.plan_versions; nv uuid;
 vals jsonb:='{"starter":{"users":2,"transactions":1000,"documents":100,"ai":50},
              "control":{"users":5,"transactions":5000,"documents":500,"ai":300},
              "pro":{"users":15,"transactions":20000,"documents":2000,"ai":1000}}';
BEGIN
 FOR p IN SELECT * FROM public.plan_limits WHERE plan IN('starter','control','pro') FOR UPDATE LOOP
  SELECT * INTO v FROM public.plan_versions WHERE id=p.current_version_id;
  CONTINUE WHEN NOT FOUND OR v.terms_version<>'unapproved-v1' OR p.draft_version_id IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.plan_versions x WHERE x.plan=p.plan AND x.approval_status<>'draft');
  INSERT INTO public.plan_versions(plan,version,name_i18n,description_i18n,price_minor,price_annual_minor,currency,billing_interval,
    features,limits,limit_policies,terms_version,approval_status,effective_at,trial_hours)
  VALUES(p.plan,(SELECT max(version)+1 FROM public.plan_versions WHERE plan=p.plan),v.name_i18n,v.description_i18n,v.price_minor,v.price_annual_minor,
    v.currency,v.billing_interval,'{}'::jsonb,vals->p.plan,'{}'::jsonb,'owner-2026-10-17 (PENDING APPROVAL values unset)','draft',now(),168)
  RETURNING id INTO nv;
  UPDATE public.plan_limits SET current_version_id=nv,draft_version_id=nv,catalog_version=catalog_version+1 WHERE plan=p.plan;
 END LOOP;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN('billing_usage','billing_terms_error','rpc_billing_quota','billing_public_catalog') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
INSERT INTO public.billing_schema_versions(version) VALUES('20261018090000');
NOTIFY pgrst,'reload schema';
COMMIT;
