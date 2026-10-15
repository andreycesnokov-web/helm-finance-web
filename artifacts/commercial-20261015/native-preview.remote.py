import subprocess,pathlib,json,hashlib,concurrent.futures,datetime
db='cfo-os-staging-20261011-db-1'
root=pathlib.Path('/opt/cfo-os-staging-20261011/backups/commercial-20261014T235614Z')
backup=root/'pre-commercial.dump'
copy='commercial_native_'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
def run(args,stdin=None):
 r=subprocess.run(args,input=stdin,capture_output=True,text=True)
 if r.returncode: raise RuntimeError((r.stdout+r.stderr)[-2400:])
 return r.stdout.strip()
def sql(q):return run(['docker','exec','-i',db,'psql','-U','supabase_admin','-d',copy,'-v','ON_ERROR_STOP=1','-At'],q)
run(['docker','exec',db,'createdb','-U','supabase_admin',copy])
with backup.open('rb') as f:
 r=subprocess.run(['docker','exec','-i',db,'pg_restore','-U','supabase_admin','-d',copy,'--exit-on-error','--no-owner'],stdin=f,capture_output=True,text=True)
if r.returncode:raise RuntimeError('restore with ACL failed: '+r.stderr[-1700:])
preview=PREVIEW_SQL
sql(preview)
tests=[]
def check(name,q):
 sql(q);tests.append({'name':name,'status':'PASS'})
check('existing companies retain legacy enrollment',"DO $$ BEGIN IF EXISTS(SELECT 1 FROM businesses WHERE billing_policy<>'legacy') THEN RAISE EXCEPTION 'legacy migration changed enrollment';END IF;END $$;")
schema=sql("SELECT json_agg(json_build_object('name',column_name,'nullable',is_nullable,'default',column_default)) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_email_identities';")
sql("""INSERT INTO users(id,first_name) VALUES(-90000000000001,'BILLING native fixture'),(-90000000000002,'BILLING unverified fixture');
INSERT INTO user_email_identities(user_id,email,email_verified_at) VALUES(-90000000000001,'billing-native@example.invalid',now());
INSERT INTO businesses(id,owner_user_id,name,type) VALUES('11111111-1111-4111-8111-111111111111',-90000000000001,'BILLING native company A','business'),('22222222-2222-4222-8222-222222222222',-90000000000002,'BILLING native company B','business');
INSERT INTO business_members(business_id,user_id,role,status) VALUES('11111111-1111-4111-8111-111111111111',-90000000000001,'owner','active'),('22222222-2222-4222-8222-222222222222',-90000000000002,'owner','active');
INSERT INTO plan_limits(plan,commercial_available) VALUES('starter',true),('control',true),('pro',true);
INSERT INTO plan_versions(id,plan,version,name_i18n,description_i18n,price_minor,currency,billing_interval,features,limits,terms_version,approval_status,fixture_label,effective_at)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','starter',1,'{"en":"Starter","ru":"Starter","id":"Starter"}','{"en":"STAGING ONLY","ru":"ТОЛЬКО ТЕСТ","id":"KHUSUS UJI"}',5900,'USD','month',
'{"documents":true,"ai":true,"import":true,"payroll":false,"team":true,"approvals":false,"export":true,"integrations":false}',
'{"users":3,"companies":1,"documents":20,"ai":10,"imports":2}','staging-fixture-1','staging_fixture','Not approved commercial limits',now());""")
check('new company is not started until explicit activation',"DO $$ BEGIN IF EXISTS(SELECT 1 FROM billing_accounts WHERE trial_started_at IS NOT NULL) OR EXISTS(SELECT 1 FROM businesses WHERE id='11111111-1111-4111-8111-111111111111' AND (trial_started_at IS NOT NULL OR trial_ends_at IS NOT NULL OR subscription_status<>'not_started')) THEN RAISE EXCEPTION 'premature trial';END IF; END $$;")
def call(actor=-90000000000001,business='11111111-1111-4111-8111-111111111111',key='33333333-3333-4333-8333-333333333333',command='select_plan',version=1,fixture=True):
 return f"SELECT public.rpc_billing_trial_command({actor},'{business}','{key}','{command}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{version},{str(fixture).lower()});"
def denied(name,q,error):
 check(name,"DO $t$ BEGIN BEGIN "+q+" RAISE EXCEPTION 'expected denial missing'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%"+error+"%' THEN RAISE; END IF; END; END $t$;")
denied('unapproved fixture is denied for public activation',call(fixture=False),'billing_plan_not_approved')
denied('cross-company actor denied',call(business='22222222-2222-4222-8222-222222222222'),'billing_forbidden')
denied('unverified owner denied',call(actor=-90000000000002,business='22222222-2222-4222-8222-222222222222'),'billing_email_verification_required')
denied('activation requires explicit plan selection',call(command='activate_trial'),'billing_select_plan_first')
sql('SET ROLE service_role;'+call())
check('selection persists and resumes on a new connection',"DO $$ BEGIN IF (SELECT selected_plan_version_id FROM billing_accounts WHERE business_id='11111111-1111-4111-8111-111111111111')<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' THEN RAISE EXCEPTION 'selection not saved'; END IF; END $$;")
check('same command replays after response loss','SET ROLE service_role;'+call())
denied('request key cannot change intent',call(version=2),'billing_command_conflict')
denied('stale command cannot overwrite account',call(key='44444444-4444-4444-8444-444444444444',version=1),'billing_stale')
commands=[call(key=k,command='activate_trial',version=2) for k in ['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666']]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda q:sql('SET ROLE service_role;'+q),commands))
check('two concurrent activations yield one exact 168h interval',"DO $$ BEGIN IF (SELECT count(*) FROM billing_events WHERE event_type='trial_activated')<>1 OR (SELECT trial_ends_at-trial_started_at FROM billing_accounts WHERE business_id='11111111-1111-4111-8111-111111111111')<>interval '168 hours' THEN RAISE EXCEPTION 'trial race'; END IF; END $$;")
check('both tabs receive the same original interval',"DO $$ BEGIN IF (SELECT count(DISTINCT result->>'trial_started_at') FROM billing_commands WHERE command='activate_trial')<>1 THEN RAISE EXCEPTION 'different intervals'; END IF; END $$;")
check('snapshot resumes selected terms under current membership',"SET ROLE service_role; DO $$ DECLARE s jsonb; BEGIN s:=rpc_billing_snapshot(-90000000000001,'11111111-1111-4111-8111-111111111111',true); IF s->>'selected_plan_version_id'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' OR jsonb_array_length(s->'plan_versions')<>1 THEN RAISE EXCEPTION 'snapshot incomplete'; END IF; END $$;")
check('public catalog omits unapproved staging fixtures',"SET ROLE service_role; DO $$ DECLARE s jsonb; BEGIN s:=rpc_billing_snapshot(-90000000000001,'11111111-1111-4111-8111-111111111111',false); IF s->'catalog'<>'[]'::jsonb THEN RAISE EXCEPTION 'fixture leaked'; END IF; END $$;")
sql("UPDATE billing_accounts SET trial_started_at=now()-interval '8 days',trial_ends_at=now()-interval '1 day' WHERE business_id='11111111-1111-4111-8111-111111111111'; DELETE FROM user_email_identities WHERE user_id=-90000000000001;")
check('expired receipt recovery does not require new trial/email/quota',"SET ROLE service_role; DO $$ DECLARE r jsonb; BEGIN r:=rpc_billing_command_receipt(-90000000000001,'11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555'); IF r->>'state'<>'completed' THEN RAISE EXCEPTION 'receipt lost';END IF; END $$;")
denied('cross-company receipt recovery denied',"PERFORM rpc_billing_command_receipt(-90000000000002,'11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555');",'billing_forbidden')
denied('accepted terms are immutable',"UPDATE plan_versions SET price_minor=1 WHERE plan='starter';",'billing_terms_immutable')
check('anon and authenticated have no billing access',"DO $$ BEGIN IF has_table_privilege('anon','public.billing_accounts','SELECT') OR has_table_privilege('authenticated','public.plan_versions','SELECT') OR has_function_privilege('authenticated','public.rpc_billing_trial_command(bigint,uuid,uuid,text,uuid,bigint,boolean)','EXECUTE') THEN RAISE EXCEPTION 'public billing access'; END IF; END $$;")
check('no new monetary operation on copied ledger',"DO $$ BEGIN IF (SELECT count(*) FROM transactions)<>1403 THEN RAISE EXCEPTION 'money changed';END IF; END $$;")
out={'status':'NATIVE_PREVIEW_ONLY','database':copy,'preview_sha256':hashlib.sha256(preview.encode()).hexdigest(),'tests':tests,'count':len(tests),'live_schema_changed':False,'live_data_changed':False,'provider_tested':False}
(root/'native-preview-results.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
