-- Metadata only. No financial rows, trigger arguments, function bodies,
-- policy expressions or GUC values are exported; definitions are fingerprinted.
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='1s';
SELECT 'runtime' AS category,jsonb_build_object('postgres',current_setting('server_version'),
  'transaction_read_only',current_setting('transaction_read_only'),
  'schemas',ARRAY['public','auth','storage','supabase_migrations']) AS item;
SELECT 'relations' AS category,jsonb_build_object('schema',n.nspname,'name',c.relname,
  'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
  'partition_key_hash',md5(pg_get_partkeydef(c.oid)),
  'partition_bound_hash',md5(pg_get_expr(c.relpartbound,c.oid)),
  'force_rls',c.relforcerowsecurity,'options',c.reloptions,
  'acl',COALESCE(c.relacl,acldefault('r',c.relowner))::text) AS item
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND c.relkind IN ('r','p','v','m','S') ORDER BY n.nspname,c.relname;
SELECT 'columns' AS category,jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
  'ordinal',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default_hash',md5(pg_get_expr(d.adbin,d.adrelid)),
  'serial_sequence',pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname),
  'column_acl',a.attacl::text) AS item
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND c.relkind IN ('r','p','v','m')
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum;
SELECT 'constraints' AS category,jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,
  'type',k.contype,'validated',k.convalidated,'deferrable',k.condeferrable,'initially_deferred',k.condeferred,
  'source_keys',k.conkey,'target',k.confrelid::regclass::text,'target_keys',k.confkey,
  'on_delete',k.confdeltype,'on_update',k.confupdtype,'definition_hash',md5(pg_get_constraintdef(k.oid,true))) AS item
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') ORDER BY n.nspname,c.relname,k.conname;
SELECT 'functions' AS category,jsonb_build_object('schema',n.nspname,'name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'return_type',pg_get_function_result(p.oid),
  'security_definer',p.prosecdef,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,
  'body_hash',md5(p.prosrc),'definition_hash',md5(pg_get_functiondef(p.oid)),
  'config_fingerprints',(SELECT jsonb_agg(jsonb_build_object('name',split_part(x,'=',1),'hash',md5(x)) ORDER BY x) FROM unnest(p.proconfig)x),
  'acl',COALESCE(p.proacl,acldefault('f',p.proowner))::text) AS item
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid);
SELECT 'triggers' AS category,jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
  'enabled',t.tgenabled,'type',t.tgtype,'function',t.tgfoid::regprocedure::text,
  'definition_hash',md5(pg_get_triggerdef(t.oid,true))) AS item
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname;
SELECT 'indexes' AS category,jsonb_build_object('schema',n.nspname,'table',c.relname,'name',idx.relname,
  'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,'definition_hash',md5(pg_get_indexdef(i.indexrelid))) AS item
 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') ORDER BY n.nspname,c.relname,idx.relname;
SELECT 'policies' AS category,jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,
  'command',p.polcmd,'permissive',p.polpermissive,'roles',
  (SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles)r),
  'using_hash',md5(pg_get_expr(p.polqual,p.polrelid)),'check_hash',md5(pg_get_expr(p.polwithcheck,p.polrelid))) AS item
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') ORDER BY n.nspname,c.relname,p.polname;
SELECT 'views' AS category,jsonb_build_object('schema',n.nspname,'name',c.relname,'options',c.reloptions,
  'definition_hash',md5(pg_get_viewdef(c.oid,true))) AS item
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND c.relkind IN ('v','m') ORDER BY n.nspname,c.relname;
SELECT 'schema_acl' AS category,jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text) AS item
 FROM pg_namespace n WHERE n.nspname IN ('public','auth','storage','supabase_migrations') ORDER BY n.nspname;
SELECT 'default_acl' AS category,jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,
  'object_type',d.defaclobjtype,'acl',d.defaclacl::text) AS item FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') OR d.defaclnamespace=0 ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype;
SELECT 'roles' AS category,jsonb_build_object('name',rolname,'superuser',rolsuper,'bypass_rls',rolbypassrls,'inherit',rolinherit) AS item
 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator','postgres') ORDER BY rolname;
SELECT 'role_memberships' AS category,jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),
  'grantor',pg_get_userbyid(grantor),'admin_option',admin_option,'inherit_option',inherit_option,'set_option',set_option) AS item
 FROM pg_auth_members WHERE pg_get_userbyid(roleid) IN ('anon','authenticated','service_role','authenticator','postgres')
 OR pg_get_userbyid(member) IN ('anon','authenticated','service_role','authenticator','postgres') ORDER BY pg_get_userbyid(roleid),pg_get_userbyid(member);
SELECT 'sequences' AS category,jsonb_build_object('schema',n.nspname,'name',c.relname,'type',format_type(s.seqtypid,NULL),
  'start',s.seqstart,'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle) AS item
 FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') ORDER BY n.nspname,c.relname;
SELECT 'custom_types' AS category,jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype,
  'owner',pg_get_userbyid(t.typowner),'base_type',format_type(t.typbasetype,t.typtypmod),'not_null',t.typnotnull,
  'default_hash',md5(t.typdefault),'acl',t.typacl::text,
  'enum_labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),
  'domain_constraints',(SELECT jsonb_agg(jsonb_build_object('name',k.conname,'hash',md5(pg_get_constraintdef(k.oid,true))) ORDER BY k.conname) FROM pg_constraint k WHERE k.contypid=t.oid)) AS item
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND t.typtype IN ('e','d') ORDER BY n.nspname,t.typname;
SELECT 'extensions' AS category,jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) AS item
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname;
DO $$ DECLARE history jsonb; BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
   RAISE NOTICE 'CFO_HISTORY_JSON={"status":"absent_not_verified"}';
 ELSE
   EXECUTE 'SELECT jsonb_agg(jsonb_build_object(''version'',to_jsonb(m)->>''version'',''name'',to_jsonb(m)->>''name'',''statements_hash'',md5((to_jsonb(m)->''statements'')::text)) ORDER BY to_jsonb(m)->>''version'') FROM supabase_migrations.schema_migrations m' INTO history;
   RAISE NOTICE 'CFO_HISTORY_JSON=%',jsonb_build_object('status','observed','rows',COALESCE(history,'[]'::jsonb));
 END IF;
END $$;
ROLLBACK;
