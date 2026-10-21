'use strict';
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto'),fs=require('node:fs'),{Client}=require('pg');
const base=process.env.BASE_URL,platform=process.env.PLATFORM_URL;
const evidence=[];
async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});let body;const text=await r.text();try{body=JSON.parse(text)}catch{body={text:text.slice(0,200)}}return {status:r.status,body}}
async function login(email){
 const start=await request(base+'/api/auth/email/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});assert.equal(start.status,200,'email/start: '+JSON.stringify(start.body));assert.ok(start.body.dev_code,'Synthetic dev-only OTP missing');
 const verify=await request(base+'/api/auth/email/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,code:start.body.dev_code})});assert.equal(verify.status,200,'email/verify: '+JSON.stringify(verify.body));assert.ok(verify.body.token);
 return {email,user:verify.body.user,token:verify.body.token};
}
(async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:4000});await db.connect();
 const id=(await db.query('SELECT system_identifier::text id,version() v FROM pg_control_system()')).rows[0];assert.equal(id.id,process.env.EXPECTED_PG_SYSTEM_ID);assert.match(id.v,/PostgreSQL 17\.6/);assert.notEqual(id.id,'7695399891598073890');assert.notEqual(id.id,'7642734024280108049');
 const health=await request(base+'/api/health');assert.equal(health.status,200);evidence.push({case:'real backend health',status:health.status});
 const missing=await request(base+'/api/payroll/runs');assert.equal(missing.status,401);evidence.push({case:'JWT required',status:missing.status});
 const owner=await login('picker.owner.'+Date.now()+'@example.invalid'),other=await login('picker.other.'+Date.now()+'@example.invalid');
 evidence.push({case:'actual application email login -> signed JWT',status:'PASS',owner_id:owner.user.id});
 const biz=randomUUID(),foreign=randomUUID(),wallet=randomUUID();
 await db.query("INSERT INTO businesses(id,name,owner_user_id,type,plan,subscription_status,country,base_currency) VALUES($1,'RC Synthetic Company',$3,'business','founder','active','Indonesia','IDR'),($2,'RC Other Company',$4,'business','founder','active','Indonesia','IDR')",[biz,foreign,owner.user.id,other.user.id]);
 await db.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$3,'owner','active'),($2,$4,'owner','active')",[biz,foreign,owner.user.id,other.user.id]);
 await db.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope,type) VALUES($1,$2,$3,'RC Synthetic Bank','IDR','business','bank')",[wallet,biz,owner.user.id]);
 const auth={apikey:process.env.SUPABASE_SERVICE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_KEY,'content-type':'application/json'};
 const existing=await request(platform+'/storage/v1/bucket/financial-documents',{headers:auth});
 if(existing.status!==200){const bucket=await request(platform+'/storage/v1/bucket',{method:'POST',headers:auth,body:JSON.stringify({id:'financial-documents',name:'financial-documents',public:false})});assert.ok([200,201].includes(bucket.status),'create private bucket '+JSON.stringify(bucket));}
 const check=await request(platform+'/storage/v1/bucket/financial-documents',{headers:auth});assert.equal(check.body.public,false);evidence.push({case:'actual private Storage bucket',status:'PASS'});
 const email='platform.'+Date.now()+'@example.invalid',password=randomBytes(24).toString('hex');
 const user=await request(platform+'/auth/v1/admin/users',{method:'POST',headers:auth,body:JSON.stringify({email,password,email_confirm:true})});assert.ok([200,201].includes(user.status),'GoTrue admin synthetic user '+JSON.stringify(user));
 const gt=await request(platform+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(gt.status,200,'GoTrue signin '+JSON.stringify(gt.body));assert.ok(gt.body.access_token);
 const refresh=await request(platform+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify({refresh_token:gt.body.refresh_token})});assert.equal(refresh.status,200);evidence.push({case:'actual independent GoTrue password login and refresh (app retains custom email JWT)',status:'PASS'});
 const context={owner,other,biz,foreign,wallet,cluster:id.id};fs.writeFileSync('/tmp/acceptance-session.json',JSON.stringify(context),{mode:0o600});
 fs.writeFileSync('/evidence/ADMISSION_HTTP.json',JSON.stringify({cluster:id.id,mock_api:false,tests:evidence,fixtures:{biz,foreign,wallet,owner:owner.user.id,other:other.user.id}},null,2));console.log(JSON.stringify(evidence,null,2));await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
