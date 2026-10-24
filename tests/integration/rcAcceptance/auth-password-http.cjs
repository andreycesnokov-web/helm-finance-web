'use strict';
// Real stack, NON-production: Email + Password through the app and a real Supabase Auth (GoTrue) server.
// Covers what the hosted setup must provide (V2_AUTH_HOSTED_SUPABASE_CHECKLIST.md): registration with an
// email confirmation gate, sign-in that links to the existing app identity, uniform errors (no account
// enumeration), lockout, reset request, server-side logout, and no Supabase session handed to the browser.
// Synthetic addresses only (@example.invalid); needs admit-http.cjs for C.owner.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {ensurePassword}=require('./_uiLogin.cjs');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),results=[];
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});fs.writeFileSync('/evidence/AUTH_PASSWORD_HTTP.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',results},null,2));console.log('PASS '+name)};
const post=async(path,body,token)=>{const r=await fetch(process.env.BASE_URL+'/api'+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json().catch(()=>null)}};
const get=async(path,token)=>{const r=await fetch(process.env.BASE_URL+'/api'+path,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json().catch(()=>null)}};
const pw=()=>'Pw-'+crypto.randomBytes(10).toString('hex');
const admin=async(path,init={})=>{const key=process.env.SUPABASE_SERVICE_KEY;return fetch(process.env.PLATFORM_URL.replace(/\/$/,'')+'/auth/v1/admin'+path,{...init,headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'}})};
const noSupabaseSession=d=>!/access_token|refresh_token|provider_token/.test(JSON.stringify(d||{}));
(async()=>{
 assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.BASE_URL),'non-production local stack only');
 const s=Date.now();
 // 1. Registration answers the same whether or not the account exists; weak passwords are refused.
 const fresh='pw.reg.'+s+'@example.invalid',p1=pw();
 const r1=await post('/auth/password/register',{email:fresh,password:p1});assert.equal(r1.status,200);assert.equal(r1.data.check_email,true);
 const r2=await post('/auth/password/register',{email:fresh,password:pw()});assert.deepEqual([r2.status,r2.data],[200,r1.data]);
 for(const bad of ['short1','x'.repeat(80)]){const r=await post('/auth/password/register',{email:'pw.weak.'+s+'@example.invalid',password:bad});assert.equal(r.status,400,bad.length+' chars');}
 const same=await post('/auth/password/register',{email:'pw.same.'+s+'@example.invalid',password:'pw.same.'+s+'@example.invalid'});assert.equal(same.status,400);
 pass('registration: same answer for new and existing accounts; too short, too long and password = email refused');
 // 2. An unconfirmed account cannot sign in (hosted Auth sends the confirmation email; here it is created unconfirmed).
 const unconf='pw.unconf.'+s+'@example.invalid',pu=pw();
 assert.ok((await admin('/users',{method:'POST',body:JSON.stringify({email:unconf,password:pu,email_confirm:false})})).ok);
 const u=await post('/auth/password/login',{email:unconf,password:pu});assert.deepEqual([u.status,u.data.error],[403,'email_not_confirmed']);
 pass('an account whose email is not confirmed cannot sign in (email_not_confirmed)');
 // 3. Wrong password and unknown email look the same.
 const w1=await post('/auth/password/login',{email:fresh,password:'Wrong-'+s}),w2=await post('/auth/password/login',{email:'pw.nobody.'+s+'@example.invalid',password:'Wrong-'+s});
 assert.deepEqual([w1.status,w1.data],[401,{error:'invalid_credentials'}]);assert.deepEqual([w2.status,w2.data],[401,{error:'invalid_credentials'}]);
 pass('wrong password and unknown email give the same 401 invalid_credentials');
 // 4. The existing app user signs in with a password and keeps the SAME app identity; no Supabase session leaks.
 const op=await ensurePassword(C.owner.email);
 const L=await post('/auth/password/login',{email:C.owner.email,password:op});assert.equal(L.status,200);assert.ok(L.data.token);
 assert.equal(String(L.data.user.id),String(C.owner.user.id),'same app user');assert.ok(noSupabaseSession(L.data),'no Supabase token in the response');
 assert.equal((await get('/workspaces',L.data.token)).status,200);
 pass('the existing email user signs in with a password as the same app user; the response carries no Supabase session',{user:C.owner.user.id});
 // 5. Logout revokes the server session: the same token stops working.
 const out=await post('/auth/logout',{},L.data.token);assert.equal(out.status,200);assert.ok(out.data.revoked>=1);
 assert.equal((await get('/workspaces',L.data.token)).status,401);
 pass('logout revokes the server session; the old token is refused (401)');
 // 6. Reset request: same answer for known and unknown addresses.
 const f1=await post('/auth/password/forgot',{email:C.owner.email}),f2=await post('/auth/password/forgot',{email:'pw.nobody2.'+s+'@example.invalid'});
 assert.deepEqual([f1.status,f2.status],[200,200]);assert.deepEqual(f1.data,f2.data);
 pass('password reset request answers the same for known and unknown addresses');
 // 7. Repeated failures lock the account temporarily, even from rotating attempts.
 const lock='pw.lock.'+s+'@example.invalid',lp=pw();await post('/auth/password/register',{email:lock,password:lp});
 let codes=[];for(let i=0;i<11;i++)codes.push((await post('/auth/password/login',{email:lock,password:'Bad-'+i+'-'+s})).status);
 assert.ok(codes.slice(0,10).every(c=>c===401),'first ten: '+codes.join(','));assert.equal(codes[10],429);
 assert.equal((await post('/auth/password/login',{email:lock,password:lp})).status,429,'even the right password waits out the lock');
 pass('ten failed sign-ins lock the account (429), even for the right password, until the window passes');
})().catch(e=>{console.error(e);process.exitCode=1});
